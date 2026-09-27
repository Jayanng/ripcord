/**
 * Cooperative refund + to_local recovery module.
 *
 * Implements Design V4 §5 + §6 (cooperative refund into revocable to_local commitment)
 * and Design V4 §5 (to_local self-exit payout sweep after toSelfDelay relative CSV).
 *
 * Live-probed against regtest daemon (v0.39.0 / https://rpc-regtest.tachibtc.com):
 *   - `buildToLocalP2trOutput` derives the NUMS-internal-key P2TR output with
 *     an OP_IF penalty branch (M-of-N node quorum) and an OP_ELSE self-exit branch
 *     (userDelayedPubkey after toSelfDelay blocks).
 *   - `buildRefundPsbt` builds the unsigned refund spending the vault funding outpoint
 *     through the cooperative leaf, paying into to_local output[0].
 *   - `verifyRefundPsbt` requires expectedDelayedPubkey and expectedUserValueSats.
 *   - `signRefundPsbtAsUser` signs the cooperative leaf as the vault owner.
 *   - `cosignRefund` submits the wire form to POST /tachi_signTransaction and attaches
 *     the node quorum's threshold of BIP-340 partials.
 *   - `finalizeRefundPsbt` produces the raw transaction hex for Bitcoin L1 broadcast.
 *   - `buildToLocalSelfExitPsbt` -> `verifyToLocalSelfExitPsbt` -> `signToLocalSelfExitPsbtAsUser`
 *     -> `finalizeToLocalSelfExitPsbt` sweeps the to_local output to a SegWit destination.
 */

import {
  buildRefundPsbt,
  verifyRefundPsbt,
  signRefundPsbtAsUser,
  cosignRefund,
  finalizeRefundPsbt,
  buildToLocalP2trOutput,
  buildToLocalScript,
  buildToLocalSelfExitPsbt,
  verifyToLocalSelfExitPsbt,
  signToLocalSelfExitPsbtAsUser,
  finalizeToLocalSelfExitPsbt,
  type TaprootSigner,
  type ToLocalP2trOutput,
  type BuiltRefundPsbt,
  type BuiltToLocalSelfExitPsbt,
  type CosignRefundResult,
  type RefundFundingInput,
  type RefundExtraOutput,
  type VaultNetworkName,
  type Vault as SdkVault,
  type XOnlyPubkey,
  type VerifyRefundPsbtOptions,
  type VerifyToLocalSelfExitOptions,
} from '@tachibtc/taurus-vault-core';
import type * as bitcoin from 'bitcoinjs-lib';
import {
  asDisplayTxid,
  asUserAddress,
  isDisplayTxid,
  isUserAddress,
  toSdkVault,
  type DisplayTxid,
  type Identity,
  type VaultRecord,
} from './types.js';
import { RipcordCode, RipcordError, mapDaemonError } from './errors.js';
import { makeSigner } from './keys.js';
import { joinDaemonUrl } from './net.js';

export const MIN_FEE_SATS = 1n;
/** Default fee for cooperative refund transaction (1 input, 1 to_local output). */
export const DEFAULT_REFUND_FEE_SATS = 500n;
/** Default fee for claiming to_local self-exit payout (~179 vB standard SegWit tx). */
export const DEFAULT_CLAIM_FEE_SATS = 200n;

interface BitcoinRpcResponse {
  readonly result?: unknown;
  readonly error?: { code?: number; message?: string };
}

interface DecodedTx {
  readonly txid: string;
  readonly vsize: number;
  readonly vin: ReadonlyArray<{ sequence?: number }>;
}

interface TxOutResult {
  readonly confirmations?: number;
  readonly value?: number;
}

async function bitcoinRpc(
  baseUrl: string,
  method: string,
  params: unknown[],
): Promise<BitcoinRpcResponse> {
  const url = joinDaemonUrl(baseUrl, '');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (err) {
    throw new RipcordError(
      RipcordCode.DAEMON_UNREACHABLE,
      `Bitcoin RPC ${method} failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (!response.ok) {
    throw new RipcordError(
      RipcordCode.DAEMON_UNREACHABLE,
      `Bitcoin RPC ${method} HTTP ${response.status}`,
    );
  }
  return (await response.json()) as BitcoinRpcResponse;
}

function requireFee(feeSats: bigint): bigint {
  if (typeof feeSats !== 'bigint' || feeSats < MIN_FEE_SATS) {
    throw new RipcordError(
      RipcordCode.FEE_TOO_LOW,
      `feeSats must be >= ${MIN_FEE_SATS}, got ${feeSats}`,
      { hint: 'Minimum fee is 1 sat.' },
    );
  }
  return feeSats;
}

function requireDest(destAddress: string, prohibitedAddress?: string): string {
  if (!isUserAddress(destAddress)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Destination must be a SegWit address, got: ${destAddress}`,
      { hint: 'Use the identity L1 P2WPKH address' },
    );
  }
  if (prohibitedAddress && destAddress === prohibitedAddress) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Destination cannot be the source commitment or vault address',
      { hint: 'A payout to the vault/to_local P2TR is owned by the tweaked key and is unspendable by the user' },
    );
  }
  return destAddress;
}

function wrapSdk(err: unknown): RipcordError {
  if (err instanceof RipcordError) return err;
  return mapDaemonError(err);
}

async function inspectFunding(
  vault: VaultRecord,
  baseUrl: string,
): Promise<{ status: 'unfunded' | 'spent' | 'present'; confirmations: number }> {
  const funding = vault.funding;
  if (!funding || !isDisplayTxid(funding.txid)) {
    return { status: 'unfunded', confirmations: 0 };
  }

  const txout = await bitcoinRpc(baseUrl, 'gettxout', [funding.txid, funding.vout, true]);
  if (txout.error) {
    throw mapDaemonError(txout.error);
  }
  if (txout.result && typeof txout.result === 'object') {
    const row = txout.result as TxOutResult;
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        'gettxout returned no finite funding value',
      );
    }
    const actualSats = BigInt(Math.round(row.value * 100_000_000));
    if (actualSats !== funding.valueSats) {
      throw new RipcordError(
        RipcordCode.AMOUNT_MISMATCH,
        `Funding value mismatch: record says ${funding.valueSats} sats, chain says ${actualSats} sats`,
      );
    }
    const confirmations = typeof row.confirmations === 'number' ? row.confirmations : 0;
    return { status: 'present', confirmations };
  }

  const raw = await bitcoinRpc(baseUrl, 'getrawtransaction', [funding.txid, true]);
  if (raw.result) {
    return { status: 'spent', confirmations: 0 };
  }
  return { status: 'unfunded', confirmations: 0 };
}

// ============================================================================
// 1. buildToLocalCommitment
// ============================================================================

export interface BuildToLocalCommitmentParams {
  readonly vault: VaultRecord | SdkVault;
  /** User delayed pubkey (who can sweep payout after toSelfDelay). Defaults to vault userKey. */
  readonly userDelayedPubkey?: Buffer | string;
  readonly network?: VaultNetworkName;
  readonly toSelfDelay?: number;
  readonly threshold?: number;
  readonly nodePubkeys?: readonly (Buffer | string)[];
}

/**
 * Construct the revocable to_local Taproot commitment bound to this vault:
 * same network, penalty quorum, threshold, and the vault's fixed exit CSV.
 */
export function buildToLocalCommitment(
  paramsOrVault: BuildToLocalCommitmentParams | VaultRecord | SdkVault,
  maybeDelayedKey?: Buffer | string,
): ToLocalP2trOutput {
  const params: BuildToLocalCommitmentParams =
    'vault' in paramsOrVault && paramsOrVault.vault !== undefined
      ? (paramsOrVault as BuildToLocalCommitmentParams)
      : { vault: paramsOrVault as VaultRecord | SdkVault, userDelayedPubkey: maybeDelayedKey };

  const rawVault = params.vault;
  const sdkVault: SdkVault =
    'userKey' in rawVault && 'p2tr' in rawVault && rawVault.userKey !== undefined
      ? (rawVault as SdkVault)
      : toSdkVault(rawVault as VaultRecord);

  const network: VaultNetworkName =
    params.network ??
    (sdkVault.p2tr as any).network ??
    ((rawVault as any).userKeyDescriptor?.network as VaultNetworkName) ??
    'regtest';

  const userDelayedPubkey =
    params.userDelayedPubkey ??
    sdkVault.userKey.xOnly;

  const nodePubkeys =
    params.nodePubkeys ??
    sdkVault.p2tr.cooperativeLeaf.nodeKeysCompressed;

  const threshold =
    params.threshold ??
    sdkVault.p2tr.cooperativeLeaf.threshold;

  const toSelfDelay =
    params.toSelfDelay ??
    sdkVault.p2tr.exitLeaf.csvBlocks;

  try {
    return buildToLocalP2trOutput({
      network,
      nodePubkeys,
      threshold,
      userDelayedPubkey,
      toSelfDelay,
    });
  } catch (err) {
    throw wrapSdk(err);
  }
}

// Re-export SDK buildToLocalScript for direct script construction if needed.
export { buildToLocalScript };

// ============================================================================
// 2. buildRefund
// ============================================================================

export interface BuildRefundParams {
  readonly vault: VaultRecord | SdkVault;
  readonly funding?: RefundFundingInput | {
    readonly txid: string;
    readonly vout: number;
    readonly valueSats: bigint;
    readonly scriptPubKey?: string;
  };
  readonly toLocal: ToLocalP2trOutput;
  readonly userValueSats: bigint;
  readonly feeSats: bigint;
  readonly extraOutputs?: readonly RefundExtraOutput[];
  readonly version?: number;
  readonly locktime?: number;
  readonly dustRelayFeeSatsPerKvB?: bigint;
}

/**
 * Build an unsigned refund PSBT spending the vault's funding output through the
 * cooperative leaf, paying userValueSats into the given toLocal commitment.
 * feeSats must equal funding.valueSats - sum(outputs) exactly.
 */
export function buildRefund(params: BuildRefundParams): BuiltRefundPsbt {
  const sdkVault: SdkVault =
    'userKey' in params.vault && 'p2tr' in params.vault && params.vault.userKey !== undefined
      ? (params.vault as SdkVault)
      : toSdkVault(params.vault as VaultRecord);

  let fundingInput: RefundFundingInput;
  if (params.funding) {
    const spk = params.funding.scriptPubKey ?? Buffer.from(sdkVault.p2tr.output).toString('hex');
    fundingInput = {
      txid: params.funding.txid,
      vout: params.funding.vout,
      valueSats: params.funding.valueSats,
      scriptPubKey: spk,
    };
  } else if ('funding' in params.vault && params.vault.funding) {
    const f = params.vault.funding;
    fundingInput = {
      txid: f.txid,
      vout: f.vout,
      valueSats: f.valueSats,
      scriptPubKey: Buffer.from(sdkVault.p2tr.output).toString('hex'),
    };
  } else {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      'Vault has no funding outpoint for refund',
      { hint: 'Supply funding parameter or use a funded VaultRecord' },
    );
  }

  if (typeof params.feeSats !== 'bigint' || params.feeSats < MIN_FEE_SATS) {
    throw new RipcordError(
      RipcordCode.FEE_TOO_LOW,
      `feeSats must be >= ${MIN_FEE_SATS}, got ${params.feeSats}`,
    );
  }

  if (typeof params.userValueSats !== 'bigint' || params.userValueSats <= 0n) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `userValueSats must be a positive bigint, got ${params.userValueSats}`,
    );
  }

  const extraSum = (params.extraOutputs ?? []).reduce((acc, o) => acc + o.valueSats, 0n);
  const totalOutputs = params.userValueSats + extraSum;
  if (fundingInput.valueSats - totalOutputs !== params.feeSats) {
    throw new RipcordError(
      RipcordCode.AMOUNT_MISMATCH,
      `feeSats (${params.feeSats}) must equal funding.valueSats (${fundingInput.valueSats}) - sum(outputs) (${totalOutputs}) exactly`,
      { hint: 'Bitcoin fee is implicit: funding - sum(outputs)' },
    );
  }

  try {
    return buildRefundPsbt({
      vault: sdkVault,
      funding: fundingInput,
      toLocal: params.toLocal,
      userValueSats: params.userValueSats,
      feeSats: params.feeSats,
      extraOutputs: params.extraOutputs,
      version: params.version,
      locktime: params.locktime,
      dustRelayFeeSatsPerKvB: params.dustRelayFeeSatsPerKvB,
    });
  } catch (err) {
    throw wrapSdk(err);
  }
}

// ============================================================================
// 3. verifyRefund
// ============================================================================

export interface VerifyRefundOptions {
  readonly toLocal: ToLocalP2trOutput;
  readonly expectedUserValueSats: bigint;
  /** REQUIRED: The 32-byte x-only key expected to control the to_local self-exit branch */
  readonly expectedDelayedPubkey: XOnlyPubkey | Buffer | string;
  readonly maxFeeSats: bigint;
  readonly dustRelayFeeSatsPerKvB?: bigint;
  readonly maxFeeRateSatVb?: number;
}

export interface VerifyRefundParams extends VerifyRefundOptions {
  readonly psbt: bitcoin.Psbt;
  readonly vault: VaultRecord | SdkVault;
}

/**
 * Re-verify a refund PSBT before signing or trusting it: spends only the funding output
 * via the cooperative leaf, every output SegWit, output[0] is exactly the expected toLocal
 * commitment paying expectedUserValueSats into expectedDelayedPubkey, fee within maxFeeSats.
 */
export function verifyRefund(
  paramsOrPsbt: VerifyRefundParams | bitcoin.Psbt,
  maybeVault?: VaultRecord | SdkVault,
  maybeOptions?: VerifyRefundOptions,
): void {
  let psbt: bitcoin.Psbt;
  let vault: VaultRecord | SdkVault;
  let options: VerifyRefundOptions;

  if ('psbt' in paramsOrPsbt) {
    psbt = paramsOrPsbt.psbt;
    vault = paramsOrPsbt.vault;
    options = paramsOrPsbt;
  } else {
    psbt = paramsOrPsbt;
    vault = maybeVault!;
    options = maybeOptions!;
  }

  if (!options || !options.expectedDelayedPubkey) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'expectedDelayedPubkey is REQUIRED for verifyRefund — without it a refund can route the claimable branch to an attacker key',
      { hint: 'Supply the user x-only pubkey expected to sweep the refund after delay' },
    );
  }

  let delayedPubkeyBuf: Buffer;
  if (typeof options.expectedDelayedPubkey === 'string') {
    if (!/^[0-9a-fA-F]{64}$/.test(options.expectedDelayedPubkey)) {
      throw new RipcordError(RipcordCode.INVALID_FORMAT, 'expectedDelayedPubkey must be a 32-byte hex string');
    }
    delayedPubkeyBuf = Buffer.from(options.expectedDelayedPubkey, 'hex');
  } else {
    delayedPubkeyBuf = Buffer.from(options.expectedDelayedPubkey);
  }
  if (delayedPubkeyBuf.length !== 32) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `expectedDelayedPubkey must be 32 bytes, got ${delayedPubkeyBuf.length}`,
    );
  }

  if (typeof options.expectedUserValueSats !== 'bigint' || options.expectedUserValueSats <= 0n) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'expectedUserValueSats (positive bigint) is REQUIRED for verifyRefund',
    );
  }

  if (typeof options.maxFeeSats !== 'bigint' || options.maxFeeSats < 0n) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'maxFeeSats (bigint >= 0) is REQUIRED for verifyRefund',
    );
  }

  const sdkVault: SdkVault =
    'userKey' in vault && 'p2tr' in vault && vault.userKey !== undefined
      ? (vault as SdkVault)
      : toSdkVault(vault as VaultRecord);

  try {
    verifyRefundPsbt(psbt, sdkVault, {
      toLocal: options.toLocal,
      expectedUserValueSats: options.expectedUserValueSats,
      expectedDelayedPubkey: delayedPubkeyBuf,
      maxFeeSats: options.maxFeeSats,
      dustRelayFeeSatsPerKvB: options.dustRelayFeeSatsPerKvB,
      maxFeeRateSatVb: options.maxFeeRateSatVb,
    });
  } catch (err) {
    throw wrapSdk(err);
  }
}

// ============================================================================
// 4. signRefundAsUser
// ============================================================================

export interface SignRefundParams extends VerifyRefundOptions {
  readonly psbt: bitcoin.Psbt;
  readonly userSigner: TaprootSigner;
  readonly vault: VaultRecord | SdkVault;
}

/**
 * Re-verifies a cooperative refund PSBT (including expectedDelayedPubkey and expectedUserValueSats),
 * then attaches the user's tapScriptSig on every input. Does not finalize — quorum still co-signs.
 */
export async function signRefundAsUser(
  paramsOrPsbt: SignRefundParams | bitcoin.Psbt,
  maybeSigner?: TaprootSigner,
  maybeVault?: VaultRecord | SdkVault,
  maybeOptions?: VerifyRefundOptions,
): Promise<void> {
  let psbt: bitcoin.Psbt;
  let userSigner: TaprootSigner;
  let vault: VaultRecord | SdkVault;
  let options: VerifyRefundOptions;

  if ('userSigner' in paramsOrPsbt) {
    psbt = paramsOrPsbt.psbt;
    userSigner = paramsOrPsbt.userSigner;
    vault = paramsOrPsbt.vault;
    options = paramsOrPsbt;
  } else {
    psbt = paramsOrPsbt;
    userSigner = maybeSigner!;
    vault = maybeVault!;
    options = maybeOptions!;
  }

  verifyRefund(psbt, vault, options);

  const sdkVault: SdkVault =
    'userKey' in vault && 'p2tr' in vault && vault.userKey !== undefined
      ? (vault as SdkVault)
      : toSdkVault(vault as VaultRecord);

  const delayedPubkey = Buffer.isBuffer(options.expectedDelayedPubkey)
    ? options.expectedDelayedPubkey
    : Buffer.from(options.expectedDelayedPubkey as string, 'hex');

  try {
    await signRefundPsbtAsUser(psbt, userSigner, sdkVault, {
      toLocal: options.toLocal,
      expectedUserValueSats: options.expectedUserValueSats,
      expectedDelayedPubkey: delayedPubkey,
      maxFeeSats: options.maxFeeSats,
      dustRelayFeeSatsPerKvB: options.dustRelayFeeSatsPerKvB,
      maxFeeRateSatVb: options.maxFeeRateSatVb,
    });
  } catch (err) {
    throw wrapSdk(err);
  }
}

// ============================================================================
// 5. cosignRefundWithQuorum
// ============================================================================

export interface CosignRefundWithQuorumParams {
  readonly psbt: bitcoin.Psbt;
  readonly vault: VaultRecord | SdkVault;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly allowInsecureHttp?: boolean;
  readonly maxRetriesOn504?: number;
  readonly retryDelayMs?: number;
}

/**
 * Projects the user-signed refund PSBT to the daemon's wire form, calls
 * POST /tachi_signTransaction, and attaches the quorum's partial signatures.
 *
 * Handles documented outcomes:
 *   - 504: fewer than threshold answered before ceremony wait (can resubmit same bytes)
 *   - 400: failed daemon validation (do not retry)
 *   - user must sign first
 *   - vault must be registered on-ledger
 */
export async function cosignRefundWithQuorum(
  params: CosignRefundWithQuorumParams,
): Promise<CosignRefundResult> {
  const {
    psbt,
    vault,
    baseUrl,
    timeoutMs = 65000,
    allowInsecureHttp,
    maxRetriesOn504 = 0,
    retryDelayMs = 1000,
  } = params;

  // Gate 1: User signs first
  const input0 = psbt.data.inputs[0];
  if (!input0?.tapScriptSig || input0.tapScriptSig.length === 0) {
    throw new RipcordError(
      RipcordCode.INVALID_SIGNATURE,
      'User must sign refund before quorum cosign',
      { hint: 'Call signRefundAsUser before cosignRefundWithQuorum; the daemon verifies the user signature before fanning out' },
    );
  }


  const sdkVault: SdkVault =
    'userKey' in vault && 'p2tr' in vault && vault.userKey !== undefined
      ? (vault as SdkVault)
      : toSdkVault(vault as VaultRecord);

  const cosignUrl = joinDaemonUrl(baseUrl, 'tachi_signTransaction');

  let attempts = 0;
  while (true) {
    try {
      return await cosignRefund(psbt, sdkVault, {
        url: cosignUrl,
        timeoutMs,
        allowInsecureHttp,
      });
    } catch (err: any) {
      const status =
        err?.status ??
        (typeof err?.message === 'string' && /HTTP (400|503|504)/.exec(err.message)?.[1]
          ? Number(/HTTP (400|503|504)/.exec(err.message)![1])
          : undefined);

      if (status === 504) {
        if (attempts < maxRetriesOn504) {
          attempts++;
          await new Promise(r => setTimeout(r, retryDelayMs));
          continue;
        }
        throw new RipcordError(
          RipcordCode.DAEMON_UNREACHABLE,
          'Quorum ceremony timeout: fewer than threshold answered (HTTP 504)',
          { cause: err, daemonCode: 504, hint: 'Resubmit the same PSBT bytes to resume collection under the same sighash' },
        );
      }

      if (status === 400) {
        throw new RipcordError(
          RipcordCode.INVALID_FORMAT,
          `Refund failed daemon validation (HTTP 400): ${err.message}`,
          { cause: err, daemonCode: 400, hint: 'Vault must be registered and funding outpoint valid; do not retry identical bytes' },
        );
      }

      throw wrapSdk(err);
    }
  }
}

// ============================================================================
// 6. finalizeRefund
// ============================================================================

export interface FinalizeRefundParams extends VerifyRefundOptions {
  readonly psbt: bitcoin.Psbt;
  readonly vault: VaultRecord | SdkVault;
}

/**
 * Re-verifies the refund (same checks as verifyRefund) with quorum partials attached,
 * assembles the cooperative-leaf witness, and returns the raw tx hex.
 * Broadcast this hex to bitcoind, NOT the daemon.
 */
export function finalizeRefund(
  paramsOrPsbt: FinalizeRefundParams | bitcoin.Psbt,
  maybeVault?: VaultRecord | SdkVault,
  maybeOptions?: VerifyRefundOptions,
): string {
  let psbt: bitcoin.Psbt;
  let vault: VaultRecord | SdkVault;
  let options: VerifyRefundOptions;

  if ('psbt' in paramsOrPsbt) {
    psbt = paramsOrPsbt.psbt;
    vault = paramsOrPsbt.vault;
    options = paramsOrPsbt;
  } else {
    psbt = paramsOrPsbt;
    vault = maybeVault!;
    options = maybeOptions!;
  }

  verifyRefund(psbt, vault, options);

  const sdkVault: SdkVault =
    'userKey' in vault && 'p2tr' in vault && vault.userKey !== undefined
      ? (vault as SdkVault)
      : toSdkVault(vault as VaultRecord);

  const delayedPubkey = Buffer.isBuffer(options.expectedDelayedPubkey)
    ? options.expectedDelayedPubkey
    : Buffer.from(options.expectedDelayedPubkey as string, 'hex');

  try {
    const raw = finalizeRefundPsbt(psbt, sdkVault, {
      toLocal: options.toLocal,
      expectedUserValueSats: options.expectedUserValueSats,
      expectedDelayedPubkey: delayedPubkey,
      maxFeeSats: options.maxFeeSats,
      dustRelayFeeSatsPerKvB: options.dustRelayFeeSatsPerKvB,
      maxFeeRateSatVb: options.maxFeeRateSatVb,
    });
    return typeof raw === 'string' ? raw : Buffer.from(raw).toString('hex');
  } catch (err) {
    throw wrapSdk(err);
  }
}

// ============================================================================
// 7. assessRefund & executeRefund
// ============================================================================

export interface AssessRefundParams {
  readonly vault: VaultRecord;
  readonly identity: Identity;
  readonly baseUrl: string;
  readonly feeSats?: bigint;
  readonly userValueSats?: bigint;
  readonly toLocal?: ToLocalP2trOutput;
}

export interface RefundReadiness {
  readonly status: 'ready' | 'unfunded' | 'spent';
  readonly confirmations: number;
  readonly toLocal?: ToLocalP2trOutput;
  readonly userValueSats?: bigint;
  readonly feeSats?: bigint;
  readonly dryRun?: {
    readonly toLocalAddress: string;
    readonly userValueSats: bigint;
    readonly feeSats: bigint;
    readonly psbtBase64: string;
    readonly psbtHex: string;
  };
  readonly reason?: string;
}

/**
 * Dry-run refund assessment: inspects funding, constructs to_local commitment,
 * builds, verifies, and user-signs the refund PSBT. Never broadcasts.
 */
export async function assessRefund(params: AssessRefundParams): Promise<RefundReadiness> {
  const fundingState = await inspectFunding(params.vault, params.baseUrl);
  if (fundingState.status === 'unfunded') {
    return {
      status: 'unfunded',
      confirmations: 0,
      reason: 'Vault has no funding outpoint on L1',
    };
  }
  if (fundingState.status === 'spent') {
    return {
      status: 'spent',
      confirmations: 0,
      reason: 'Funding outpoint is spent',
    };
  }

  if (params.identity.userKeyDescriptor.index !== params.vault.userKeyIndex) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'identity key index does not match vault.userKeyIndex',
      { hint: 'Derive the identity at the same index the vault was created with' },
    );
  }

  const feeSats = requireFee(params.feeSats ?? DEFAULT_REFUND_FEE_SATS);
  const fundingValue = params.vault.funding!.valueSats;
  const userValueSats = params.userValueSats ?? (fundingValue - feeSats);

  if (userValueSats <= 0n || fundingValue <= feeSats) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Refund fee ${feeSats} leaves no payout from ${fundingValue}`,
    );
  }

  const sdkVault = toSdkVault(params.vault);
  const toLocal = params.toLocal ?? buildToLocalCommitment(params.vault);

  const built = buildRefund({
    vault: params.vault,
    toLocal,
    userValueSats,
    feeSats,
  });

  const verifyOpts: VerifyRefundOptions = {
    toLocal,
    expectedUserValueSats: userValueSats,
    expectedDelayedPubkey: sdkVault.userKey.xOnly,
    maxFeeSats: feeSats,
  };

  verifyRefund(built.psbt, sdkVault, verifyOpts);

  const signer = makeSigner(params.identity.mnemonic, 'regtest', params.vault.userKeyIndex);
  await signRefundAsUser(built.psbt, signer, sdkVault, verifyOpts);

  return {
    status: 'ready',
    confirmations: fundingState.confirmations,
    toLocal,
    userValueSats,
    feeSats,
    dryRun: {
      toLocalAddress: toLocal.address,
      userValueSats,
      feeSats,
      psbtBase64: built.psbt.toBase64(),
      psbtHex: built.psbt.toHex(),
    },
  };
}

export interface ExecuteRefundParams {
  readonly vault: VaultRecord;
  readonly identity: Identity;
  readonly signer: TaprootSigner;
  readonly baseUrl: string;
  readonly feeSats?: bigint;
  readonly userValueSats?: bigint;
  readonly toLocal?: ToLocalP2trOutput;
  readonly psbt?: bitcoin.Psbt;
  readonly allowInsecureHttp?: boolean;
}

export interface ExecuteRefundResult {
  readonly txid: DisplayTxid;
  readonly rawHex: string;
  readonly toLocal: ToLocalP2trOutput;
  readonly userValueSats: bigint;
  readonly cosignResult: CosignRefundResult;
}

/**
 * Full cooperative refund execution: build + sign + cosignRefund with quorum +
 * finalizeRefund + broadcast to Bitcoin L1 via Bitcoin RPC proxy sendrawtransaction.
 */
export async function executeRefund(params: ExecuteRefundParams): Promise<ExecuteRefundResult> {
  const fundingState = await inspectFunding(params.vault, params.baseUrl);
  if (fundingState.status === 'unfunded') {
    throw new RipcordError(RipcordCode.FUNDING_MISSING, 'Vault has no funding outpoint on L1');
  }
  if (fundingState.status === 'spent') {
    throw new RipcordError(RipcordCode.FUNDING_MISSING, 'Funding outpoint is already spent');
  }

  const feeSats = requireFee(params.feeSats ?? DEFAULT_REFUND_FEE_SATS);
  const fundingValue = params.vault.funding!.valueSats;
  const userValueSats = params.userValueSats ?? (fundingValue - feeSats);
  const sdkVault = toSdkVault(params.vault);
  const toLocal = params.toLocal ?? buildToLocalCommitment(params.vault);

  const verifyOpts: VerifyRefundOptions = {
    toLocal,
    expectedUserValueSats: userValueSats,
    expectedDelayedPubkey: sdkVault.userKey.xOnly,
    maxFeeSats: feeSats,
  };

  let psbt = params.psbt;
  if (!psbt) {
    const built = buildRefund({
      vault: params.vault,
      toLocal,
      userValueSats,
      feeSats,
    });
    psbt = built.psbt;
    verifyRefund(psbt, sdkVault, verifyOpts);
    await signRefundAsUser(psbt, params.signer, sdkVault, verifyOpts);
  }

  const cosignResult = await cosignRefundWithQuorum({
    psbt,
    vault: sdkVault,
    baseUrl: params.baseUrl,
    allowInsecureHttp: params.allowInsecureHttp,
  });

  const rawHex = finalizeRefund(psbt, sdkVault, verifyOpts);

  const sent = await bitcoinRpc(params.baseUrl, 'sendrawtransaction', [rawHex]);
  if (sent.error) {
    throw mapDaemonError(sent.error);
  }
  if (typeof sent.result !== 'string' || !isDisplayTxid(sent.result)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'sendrawtransaction did not return a display-order txid',
    );
  }

  return {
    txid: asDisplayTxid(sent.result),
    rawHex,
    toLocal,
    userValueSats,
    cosignResult,
  };
}

// ============================================================================
// 8. The to_local CLAIM path (self-exit)
// ============================================================================

export interface AssessToLocalClaimParams {
  readonly toLocal: ToLocalP2trOutput;
  readonly funding: {
    readonly txid: string;
    readonly vout?: number;
    readonly valueSats: bigint;
  };
  readonly identity: Identity;
  readonly baseUrl: string;
  readonly destAddress?: string;
  readonly feeSats?: bigint;
  readonly signer?: TaprootSigner;
}

export type ToLocalClaimReadinessStatus = 'live' | 'maturing' | 'unfunded' | 'spent';

export interface ToLocalClaimReadiness {
  readonly status: ToLocalClaimReadinessStatus;
  readonly confirmations: number;
  readonly requiredConfirmations: number;
  readonly confirmationsRemaining: number;
  readonly dryRun?: {
    readonly txid: DisplayTxid;
    readonly destination: string;
    readonly vsize: number;
    readonly sequence: number;
    readonly rawHex: string;
  };
  readonly reason?: string;
}

export interface ClaimToLocalPayoutParams {
  readonly toLocal: ToLocalP2trOutput;
  readonly funding: {
    readonly txid: string;
    readonly vout?: number;
    readonly valueSats: bigint;
  };
  readonly signer: TaprootSigner;
  readonly destAddress: string;
  readonly baseUrl: string;
  readonly feeSats?: bigint;
}

/**
 * Inspect live maturity of a broadcast to_local output on Bitcoin L1.
 */
export async function inspectToLocalMaturity(params: {
  readonly toLocal: ToLocalP2trOutput;
  readonly fundingTxid: string;
  readonly fundingVout?: number;
  readonly baseUrl: string;
}): Promise<{
  status: 'unfunded' | 'spent' | 'live' | 'maturing';
  confirmations: number;
  requiredConfirmations: number;
  confirmationsRemaining: number;
}> {
  const vout = params.fundingVout ?? 0;
  const required = params.toLocal.toSelfDelay;

  const txout = await bitcoinRpc(params.baseUrl, 'gettxout', [params.fundingTxid, vout, true]);
  if (txout.error) {
    throw mapDaemonError(txout.error);
  }
  if (txout.result && typeof txout.result === 'object') {
    const row = txout.result as TxOutResult;
    const confirmations = typeof row.confirmations === 'number' ? row.confirmations : 0;
    const remaining = Math.max(0, required - confirmations);
    return {
      status: remaining === 0 ? 'live' : 'maturing',
      confirmations,
      requiredConfirmations: required,
      confirmationsRemaining: remaining,
    };
  }

  const raw = await bitcoinRpc(params.baseUrl, 'getrawtransaction', [params.fundingTxid, true]);
  if (raw.result) {
    return {
      status: 'spent',
      confirmations: 0,
      requiredConfirmations: required,
      confirmationsRemaining: 0,
    };
  }
  return {
    status: 'unfunded',
    confirmations: 0,
    requiredConfirmations: required,
    confirmationsRemaining: required,
  };
}

/**
 * Dry-run claim assessment for a to_local commitment output:
 * builds, verifies, signs, and finalizes the self-exit PSBT. Never broadcasts.
 */
export async function assessToLocalClaim(params: AssessToLocalClaimParams): Promise<ToLocalClaimReadiness> {
  const feeSats = requireFee(params.feeSats ?? DEFAULT_CLAIM_FEE_SATS);
  const destAddress = requireDest(
    params.destAddress ?? params.identity.l1Address,
    params.toLocal.address,
  );

  const maturity = await inspectToLocalMaturity({
    toLocal: params.toLocal,
    fundingTxid: params.funding.txid,
    fundingVout: params.funding.vout,
    baseUrl: params.baseUrl,
  });

  if (maturity.status === 'unfunded') {
    return {
      status: 'unfunded',
      confirmations: 0,
      requiredConfirmations: maturity.requiredConfirmations,
      confirmationsRemaining: maturity.requiredConfirmations,
      reason: 'to_local funding outpoint not found on L1',
    };
  }
  if (maturity.status === 'spent') {
    return {
      status: 'spent',
      confirmations: 0,
      requiredConfirmations: maturity.requiredConfirmations,
      confirmationsRemaining: 0,
      reason: 'to_local funding outpoint is spent',
    };
  }

  const signer =
    params.signer ??
    makeSigner(params.identity.mnemonic, 'regtest', params.identity.userKeyDescriptor.index);
  const signerPublicKey = Buffer.from(signer.publicKey);
  const signerXOnly = signerPublicKey.length === 33 ? signerPublicKey.subarray(1) : signerPublicKey;

  const vout = params.funding.vout ?? 0;
  const valueSats = params.funding.valueSats;
  if (valueSats <= feeSats) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Claim fee ${feeSats} leaves no payout from ${valueSats}`,
    );
  }

  const payoutSats = valueSats - feeSats;
  const built = buildToLocalSelfExitPsbt({
    toLocal: params.toLocal,
    funding: {
      txid: params.funding.txid,
      vout,
      valueSats,
      scriptPubKey: Buffer.from(params.toLocal.output).toString('hex'),
    },
    outputs: [{ address: destAddress, valueSats: payoutSats }],
    feeSats,
    sequence: params.toLocal.toSelfDelay,
  });

  const verifyOpts: VerifyToLocalSelfExitOptions = {
    maxFeeSats: feeSats,
    expectedDelayedPubkey: signerXOnly,
    minToSelfDelay: params.toLocal.toSelfDelay,
  };

  verifyToLocalSelfExitPsbt(built.psbt, params.toLocal, verifyOpts);
  await signToLocalSelfExitPsbtAsUser(built.psbt, signer, params.toLocal, {
    maxFeeSats: feeSats,
    minToSelfDelay: params.toLocal.toSelfDelay,
  });

  const rawHex = finalizeToLocalSelfExitPsbt(built.psbt, params.toLocal, verifyOpts);

  const decodedRpc = await bitcoinRpc(params.baseUrl, 'decoderawtransaction', [rawHex]);
  if (decodedRpc.error || !decodedRpc.result || typeof decodedRpc.result !== 'object') {
    throw mapDaemonError(decodedRpc.error ?? { message: 'decoderawtransaction returned no result' });
  }
  const decoded = decodedRpc.result as DecodedTx;

  const dryRun = {
    txid: asDisplayTxid(decoded.txid),
    destination: asUserAddress(destAddress),
    vsize: decoded.vsize,
    sequence: decoded.vin?.[0]?.sequence ?? built.sequence,
    rawHex,
  };

  if (maturity.status === 'live') {
    return {
      status: 'live',
      confirmations: maturity.confirmations,
      requiredConfirmations: maturity.requiredConfirmations,
      confirmationsRemaining: 0,
      dryRun,
    };
  }

  return {
    status: 'maturing',
    confirmations: maturity.confirmations,
    requiredConfirmations: maturity.requiredConfirmations,
    confirmationsRemaining: maturity.confirmationsRemaining,
    dryRun,
    reason: 'non-BIP68-final',
  };
}

/**
 * Claim a matured to_local output to a SegWit destination on Bitcoin L1.
 * Broadcasts via sendrawtransaction. Immature spends fail as RipcordCode.EXIT_IMMATURE.
 */
export async function claimToLocalPayout(
  params: ClaimToLocalPayoutParams,
): Promise<{ txid: DisplayTxid; rawHex: string }> {
  const feeSats = requireFee(params.feeSats ?? DEFAULT_CLAIM_FEE_SATS);
  const destAddress = requireDest(params.destAddress, params.toLocal.address);

  const signerPublicKey = Buffer.from(params.signer.publicKey);
  const signerXOnly = signerPublicKey.length === 33 ? signerPublicKey.subarray(1) : signerPublicKey;

  const vout = params.funding.vout ?? 0;
  const valueSats = params.funding.valueSats;
  if (valueSats <= feeSats) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Claim fee ${feeSats} leaves no payout from ${valueSats}`,
    );
  }

  const payoutSats = valueSats - feeSats;
  let built: BuiltToLocalSelfExitPsbt;
  try {
    built = buildToLocalSelfExitPsbt({
      toLocal: params.toLocal,
      funding: {
        txid: params.funding.txid,
        vout,
        valueSats,
        scriptPubKey: Buffer.from(params.toLocal.output).toString('hex'),
      },
      outputs: [{ address: destAddress, valueSats: payoutSats }],
      feeSats,
      sequence: params.toLocal.toSelfDelay,
    });
  } catch (err) {
    throw wrapSdk(err);
  }

  const verifyOpts: VerifyToLocalSelfExitOptions = {
    maxFeeSats: feeSats,
    expectedDelayedPubkey: signerXOnly,
    minToSelfDelay: params.toLocal.toSelfDelay,
  };

  try {
    verifyToLocalSelfExitPsbt(built.psbt, params.toLocal, verifyOpts);
    await signToLocalSelfExitPsbtAsUser(built.psbt, params.signer, params.toLocal, {
      maxFeeSats: feeSats,
      minToSelfDelay: params.toLocal.toSelfDelay,
    });
  } catch (err) {
    throw wrapSdk(err);
  }

  let rawHex: string;
  try {
    rawHex = finalizeToLocalSelfExitPsbt(built.psbt, params.toLocal, verifyOpts);
  } catch (err) {
    throw wrapSdk(err);
  }

  const sent = await bitcoinRpc(params.baseUrl, 'sendrawtransaction', [rawHex]);
  if (sent.error) {
    throw mapDaemonError(sent.error);
  }
  if (typeof sent.result !== 'string' || !isDisplayTxid(sent.result)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'sendrawtransaction did not return a display-order txid',
    );
  }

  return {
    txid: asDisplayTxid(sent.result),
    rawHex,
  };
}
