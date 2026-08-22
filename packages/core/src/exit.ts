/**
 * Unilateral exit (the Ripcord test-pull) and L1 broadcast.
 *
 * Live-probed 2026-08-22 against daemon v0.39.0 / Bitcoin RPC proxy:
 *   - `finalizeUnilateralExitPsbt` returns a hex STRING (not a Buffer).
 *     `docs/01-VERIFIED-API.md` §11 previously said Buffer; the current SDK
 *     (`taurus-vault-core@0.3.3`) returns `psbt.extractTransaction().toHex()`.
 *   - Decoded exit: version 2, vsize 125, nSequence === vault.csvBlocks (2).
 *   - Immature `sendrawtransaction` → HTTP 200 with
 *     `{ error: { code: -1, message: "bitcoin rpc error -26: non-BIP68-final" } }`.
 *     Maturity is decided from `gettxout.confirmations` vs `csvBlocks`.
 *     `assessExit` never broadcasts. `executeExit` maps that RPC error to
 *     `EXIT_IMMATURE`.
 *
 * Destination must be SegWit. Change/payout to the vault P2TR is unspendable
 * by the user. Use the identity L1 P2WPKH address.
 */

import {
  buildUnilateralExitPsbt,
  verifyUnilateralExitPsbt,
  signUnilateralExitPsbtAsUser,
  finalizeUnilateralExitPsbt,
  type TaprootSigner,
} from '@tachibtc/taurus-vault-core';
import {
  asDisplayTxid,
  isDisplayTxid,
  isUserAddress,
  toSdkVault,
  type DisplayTxid,
  type ExitReadiness,
  type Identity,
  type VaultRecord,
} from './types.js';
import { RipcordCode, RipcordError, mapDaemonError } from './errors.js';
import { makeSigner } from './keys.js';
import { bytesEqual } from '@tachibtc/taurus-vault-core';

const MIN_FEE_SATS = 1n;
/** Live-probed: a 125-vB exit with 200 sat fee builds, decodes, and is standard. */
export const DEFAULT_EXIT_FEE_SATS = 200n;

export interface AssessExitParams {
  readonly vault: VaultRecord;
  readonly identity: Identity;
  readonly baseUrl: string;
  readonly feeSats?: bigint;
  /** SegWit payout. Defaults to `identity.l1Address`. */
  readonly destAddress?: string;
}

export interface ExecuteExitParams {
  readonly vault: VaultRecord;
  readonly identity: Identity;
  readonly signer: TaprootSigner;
  readonly destAddress: string;
  readonly baseUrl: string;
  readonly feeSats?: bigint;
}

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
  const url = `${baseUrl.replace(/\/+$/, '')}/`;
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

function requireDest(destAddress: string, vaultAddress: string): string {
  if (!isUserAddress(destAddress)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Exit destination must be a SegWit address, got: ${destAddress}`,
      { hint: 'Use the identity L1 P2WPKH address, never the vault P2TR' },
    );
  }
  if (destAddress === vaultAddress) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Exit destination cannot be the vault address',
      { hint: 'A payout to the vault P2TR is owned by the tweaked key and is unspendable by the user' },
    );
  }
  return destAddress;
}

function vaultScriptHex(vault: VaultRecord): string {
  if (!vault.p2tr) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'VaultRecord has no verified p2tr bundle',
      { hint: 'Rebuild the vault via createVault or recoverVaults' },
    );
  }
  return Buffer.from(vault.p2tr.output).toString('hex');
}

function wrapSdk(err: unknown): RipcordError {
  if (err instanceof RipcordError) return err;
  return mapDaemonError(err);
}

interface FinalizedExit {
  readonly hex: string;
  readonly sequence: number;
  readonly decoded: DecodedTx;
}

async function buildSignFinalize(params: {
  vault: VaultRecord;
  signer: TaprootSigner;
  destAddress: string;
  feeSats: bigint;
  baseUrl: string;
}): Promise<FinalizedExit> {
  const funding = params.vault.funding;
  if (!funding) {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      'Vault has no funding outpoint',
      { hint: 'Deposit to the vault and persist funding.txid / vout / valueSats' },
    );
  }
  if (!isDisplayTxid(funding.txid)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'funding.txid must be a 64-character display-order hex txid',
    );
  }
  if (!Number.isInteger(funding.vout) || funding.vout < 0) {
    throw new RipcordError(RipcordCode.INVALID_FORMAT, 'funding.vout must be a non-negative integer');
  }
  if (typeof funding.valueSats !== 'bigint' || funding.valueSats <= 0n) {
    throw new RipcordError(RipcordCode.INVALID_FORMAT, 'funding.valueSats must be a positive bigint');
  }
  if (funding.valueSats <= params.feeSats) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Exit fee ${params.feeSats} leaves no payout from ${funding.valueSats}`,
    );
  }

  const dest = requireDest(params.destAddress, params.vault.address);
  const sdkVault = toSdkVault(params.vault);
  const scriptPubKey = vaultScriptHex(params.vault);
  const expectedUserKey = Buffer.from(params.vault.userKeyDescriptor.publicKey.slice(2), 'hex');
  const signerPublicKey = Buffer.from(params.signer.publicKey);
  const signerXOnly = signerPublicKey.length === 33 ? signerPublicKey.subarray(1) : signerPublicKey;
  if (signerXOnly.length !== 32 || !bytesEqual(expectedUserKey, signerXOnly)) {
    throw new RipcordError(
      RipcordCode.NOT_OWNER,
      'Exit signer does not match the vault user key',
      { hint: 'Use the signer derived from the vault userKeyIndex' },
    );
  }
  if (!bytesEqual(expectedUserKey, Buffer.from(sdkVault.userKey.xOnly))) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Vault user key descriptor does not match the verified SDK vault user key',
      { hint: 'Rebuild the VaultRecord from the same user key descriptor used to derive the vault' },
    );
  }
  const vopts = {
    maxFeeSats: params.feeSats,
    expectedUserKey: sdkVault.userKey.xOnly,
    minCsvBlocks: params.vault.csvBlocks,
  };

  let built;
  try {
    built = buildUnilateralExitPsbt({
      vault: sdkVault,
      funding: {
        txid: funding.txid,
        vout: funding.vout,
        valueSats: funding.valueSats,
        scriptPubKey,
      },
      outputs: [{ address: dest, valueSats: funding.valueSats - params.feeSats }],
      feeSats: params.feeSats,
    });
    verifyUnilateralExitPsbt(built.psbt, sdkVault, vopts);
    await signUnilateralExitPsbtAsUser(built.psbt, params.signer, sdkVault, vopts);
  } catch (err) {
    throw wrapSdk(err);
  }

  let hex: string;
  try {
    const finalized = finalizeUnilateralExitPsbt(built.psbt, sdkVault, vopts);
    // Live-probed 2026-08-22: current SDK returns hex string. Older notes said Buffer.
    hex = typeof finalized === 'string' ? finalized : Buffer.from(finalized).toString('hex');
  } catch (err) {
    throw wrapSdk(err);
  }

  const decodedRpc = await bitcoinRpc(params.baseUrl, 'decoderawtransaction', [hex]);
  if (decodedRpc.error || !decodedRpc.result || typeof decodedRpc.result !== 'object') {
    throw mapDaemonError(decodedRpc.error ?? { message: 'decoderawtransaction returned no result' });
  }
  const decoded = decodedRpc.result as DecodedTx;
  if (typeof decoded.txid !== 'string' || typeof decoded.vsize !== 'number') {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'decoderawtransaction missing txid or vsize',
    );
  }
  return { hex, sequence: built.sequence, decoded };
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

/**
 * Test-pull: build, verify, sign, finalize, decode. Never broadcasts.
 * Status comes from live `gettxout` confirmations vs `vault.csvBlocks`.
 */
export async function assessExit(params: AssessExitParams): Promise<ExitReadiness> {
  const feeSats = requireFee(params.feeSats ?? DEFAULT_EXIT_FEE_SATS);
  const destAddress = requireDest(
    params.destAddress ?? params.identity.l1Address,
    params.vault.address,
  );
  const required = params.vault.csvBlocks;
  if (!Number.isInteger(required) || required < 1) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `csvBlocks must be a positive integer, got ${required}`,
    );
  }

  const fundingState = await inspectFunding(params.vault, params.baseUrl);
  if (fundingState.status === 'unfunded') {
    return {
      status: 'unfunded',
      confirmations: 0,
      requiredConfirmations: required,
      confirmationsRemaining: required,
      reason: 'Vault has no funding outpoint on L1',
    };
  }
  if (fundingState.status === 'spent') {
    return {
      status: 'spent',
      confirmations: 0,
      requiredConfirmations: required,
      confirmationsRemaining: 0,
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
  const signer = makeSigner(params.identity.mnemonic, 'regtest', params.vault.userKeyIndex);

  const finalized = await buildSignFinalize({
    vault: params.vault,
    signer,
    destAddress,
    feeSats,
    baseUrl: params.baseUrl,
  });

  const confirmations = fundingState.confirmations;
  const remaining = Math.max(0, required - confirmations);
  const live = confirmations >= required;
  const dryRun = {
    txid: asDisplayTxid(finalized.decoded.txid),
    vsize: finalized.decoded.vsize,
    sequence: finalized.decoded.vin?.[0]?.sequence ?? finalized.sequence,
    rawHex: finalized.hex,
  };

  if (live) {
    return {
      status: 'live',
      confirmations,
      requiredConfirmations: required,
      confirmationsRemaining: 0,
      dryRun,
    };
  }
  return {
    status: 'maturing',
    confirmations,
    requiredConfirmations: required,
    confirmationsRemaining: remaining,
    dryRun,
    reason: 'non-BIP68-final',
  };
}

/**
 * Broadcast a unilateral exit to Bitcoin L1 via `sendrawtransaction`.
 * Immature exits surface as `EXIT_IMMATURE` (non-BIP68-final).
 */
export async function executeExit(params: ExecuteExitParams): Promise<{ txid: DisplayTxid }> {
  const feeSats = requireFee(params.feeSats ?? DEFAULT_EXIT_FEE_SATS);
  const destAddress = requireDest(params.destAddress, params.vault.address);

  const fundingState = await inspectFunding(params.vault, params.baseUrl);
  if (fundingState.status === 'unfunded') {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      'Vault has no funding outpoint on L1',
    );
  }
  if (fundingState.status === 'spent') {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      'Funding outpoint is already spent',
    );
  }

  const finalized = await buildSignFinalize({
    vault: params.vault,
    signer: params.signer,
    destAddress,
    feeSats,
    baseUrl: params.baseUrl,
  });

  const sent = await bitcoinRpc(params.baseUrl, 'sendrawtransaction', [finalized.hex]);
  if (sent.error) {
    throw mapDaemonError(sent.error);
  }
  if (typeof sent.result !== 'string' || !isDisplayTxid(sent.result)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'sendrawtransaction did not return a display-order txid',
    );
  }
  return { txid: asDisplayTxid(sent.result) };
}
