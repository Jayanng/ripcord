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
  verifyVaultP2tr,
  type TaprootSigner,
} from '@tachibtc/taurus-vault-core';
import {
  asDisplayTxid,
  asUserAddress,
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

/** Read live exit maturity without constructing or signing a transaction. */
export async function inspectExitMaturity(
  vault: VaultRecord,
  baseUrl: string,
): Promise<ExitReadiness> {
  const required = vault.csvBlocks;
  if (!Number.isInteger(required) || required < 1) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `csvBlocks must be a positive integer, got ${required}`,
    );
  }

  const fundingState = await inspectFunding(vault, baseUrl);
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
    return spentReadiness(vault, baseUrl, required);
  }

  const confirmations = fundingState.confirmations;
  const confirmationsRemaining = Math.max(0, required - confirmations);
  return {
    status: confirmationsRemaining === 0 ? 'live' : 'maturing',
    confirmations,
    requiredConfirmations: required,
    confirmationsRemaining,
    ...(confirmationsRemaining > 0 ? { reason: 'non-BIP68-final' } : {}),
  };
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
    // Audit fix 2026-10-02: do not require a dry run for a spent outpoint;
    // read the spending transaction from the node and report it.
    return spentReadiness(params.vault, params.baseUrl, required);
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
    destination: asUserAddress(destAddress),
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
 * The spent branch of maturity: read the spending transaction from the node
 * instead of hardcoding confirmations 0 (audit fix 2026-10-02). The spending
 * tx is discovered generically; nothing is typed in by hand.
 */
async function spentReadiness(
  vault: VaultRecord,
  baseUrl: string,
  required: number,
): Promise<ExitReadiness> {
  let spentBy: ExitReadiness['spentBy'] = null;
  let confirmations = 0;
  try {
    // The maturity poller must never stall on a deep block scan: give the
    // lookup a small time budget and move on with an honest null (review r1).
    const lookup = vault.funding ? findFundingSpender(baseUrl, vault.funding) : Promise.resolve(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), 1500);
    });
    const spender = await Promise.race([lookup, budget]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (spender) {
      confirmations = spender.confirmations;
      // A destination is reported only when EVERY address-bearing output agrees
      // (review round 2): if any funds moved to a third party, this is not the
      // user's exit and the UI must stay neutral. Amount is the TOTAL paid to
      // that address, never one output among several.
      const addrs = [...new Set(spender.outputs.map(o => o.address).filter((a): a is string => Boolean(a)))];
      const destination = addrs.length === 1 ? addrs[0] : null;
      const amountSats = destination
        ? spender.outputs.filter(o => o.address === destination).reduce((sum, o) => sum + o.valueSats, 0n)
        : null;
      const outputTotal = spender.outputs.reduce((sum, o) => sum + o.valueSats, 0n);
      const fee = vault.funding ? vault.funding.valueSats - outputTotal : null;
      spentBy = {
        txid: asDisplayTxid(spender.txid),
        confirmations: spender.confirmations,
        destination,
        amountSats,
        feeSats: fee !== null && fee >= 0n ? fee : null,
      };
    }
  } catch {
    // A node lookup failure reports spent without fabricating details.
  }
  return {
    status: 'spent',
    confirmations,
    requiredConfirmations: required,
    confirmationsRemaining: 0,
    reason: spentBy ? `Funding outpoint is spent by ${spentBy.txid}` : 'Funding outpoint is spent',
    spentBy,
  };
}

/**
 * Broadcast a unilateral exit to Bitcoin L1 via `sendrawtransaction`.
 * Immature exits surface as `EXIT_IMMATURE` (non-BIP68-final).
 */
export async function executeExit(params: ExecuteExitParams): Promise<{ txid: DisplayTxid }> {
  const feeSats = requireFee(params.feeSats ?? DEFAULT_EXIT_FEE_SATS);
  const destAddress = requireDest(params.destAddress, params.vault.address);

  // Mandate: tree-proof must pass BEFORE broadcast. The stored exit leaf and
  // control block must re-derive to this vault's address first (review pass 4).
  const treeProof = proveExitTree(params.vault);
  if (!treeProof.verified) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      treeProof.reason ?? 'Tree-proof failed: the stored exit leaf does not commit to this vault address',
      { hint: 'Rebuild the vault record via recoverVaults before broadcasting an exit' },
    );
  }

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

/**
 * Evidence that a funding outpoint was really swept (2026-10-02 audit fix).
 *
 * The exit path was already real; these helpers make the CERTIFICATE report the
 * sweep that confirmed. Discovery is generic: the spender is found by scanning
 * the chain for the transaction that spends the funding outpoint. Nothing about
 * a specific txid is hardcoded, and every field is read back from the node.
 */

export interface FundingSpender {
  readonly txid: string;
  readonly rawHex: string;
  readonly confirmations: number;
  readonly blockHash: string | null;
  readonly inputs: ReadonlyArray<{ txid: string; vout: number }>;
  readonly outputs: ReadonlyArray<{ address: string | null; valueSats: bigint }>;
}

export interface ExitSweepEvidence {
  readonly label: 'sovereign-exit' | 'unverified-spend';
  readonly exitTxid: string;
  readonly exitRawHex: string;
  readonly spentOutpoint: string;
  readonly destination: string | null;
  readonly amountSats: bigint | null;
  readonly feeSats: bigint | null;
  readonly blockHash: string | null;
  readonly confirmations: number;
  readonly explorerUrl: string;
  /** True only when the input is exactly the funding outpoint and an output pays the user L1 address. */
  readonly sovereign: boolean;
  readonly note: string;
}

/**
 * Spender lookup state (review round 1, 2026-10-02):
 * - single-flight: concurrent callers share ONE scan (the maturity poller runs
 *   on a 15s/30s cadence and must never stack scans);
 * - found spenders cache forever, but their confirmations are refreshed with one
 *   light getrawtransaction on each read (a 0-conf mempool spender must not be
 *   frozen at 0, and an RBF-replaced txid must fall back to a rescan);
 * - not-found caches a cooldown timestamp, so an unlocatable spender is
 *   re-scanned at most every NEGATIVE_COOLDOWN_MS, never every poll.
 */
const spenderCache = new Map<string, FundingSpender>();
const negativeCache = new Map<string, number>();
const inFlight = new Map<string, Promise<FundingSpender | null>>();
const NEGATIVE_COOLDOWN_MS = 5 * 60_000;

function outpointKey(funding: { txid: string; vout: number }): string {
  return `${funding.txid.toLowerCase()}:${funding.vout}`;
}

function satsFromBtc(value: unknown): bigint {
  return typeof value === 'number' ? BigInt(Math.round(value * 100_000_000)) : 0n;
}

/**
 * Find the transaction that spent a funding outpoint, straight from the node.
 * Scans mempool first, then blocks from the funding height to the tip.
 * Returns null when no spender exists in the scanned window.
 */
export async function findFundingSpender(
  baseUrl: string,
  funding: { txid: string; vout: number },
): Promise<FundingSpender | null> {
  const key = outpointKey(funding);
  const running = inFlight.get(key);
  if (running) return running;
  const run = scanForSpender(baseUrl, funding, key).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

async function scanForSpender(
  baseUrl: string,
  funding: { txid: string; vout: number },
  key: string,
): Promise<FundingSpender | null> {
  const cached = spenderCache.get(key);
  if (cached) {
    try {
      const fresh = await bitcoinRpc(baseUrl, 'getrawtransaction', [cached.txid, true]);
      const conf = (fresh.result as { confirmations?: number } | null)?.confirmations;
      if (typeof conf === 'number') {
        const updated = { ...cached, confirmations: conf };
        spenderCache.set(key, updated);
        negativeCache.delete(key);
        return updated;
      }
      // Tx vanished (RBF replacement): evict and rescan below. Clear the
      // negative cooldown too, or a stale miss would suppress the rescan for
      // the replacement transaction (review round 2).
      spenderCache.delete(key);
      negativeCache.delete(key);
    } catch {
      return cached;
    }
  }
  const lastMiss = negativeCache.get(key);
  if (lastMiss !== undefined && Date.now() - lastMiss < NEGATIVE_COOLDOWN_MS) return null;

  const fundRaw = await bitcoinRpc(baseUrl, 'getrawtransaction', [funding.txid, true]);
  const fundTx = fundRaw.result as { txid?: string; blockhash?: string; confirmations?: number } | null;
  if (!fundTx || typeof fundTx.txid !== 'string') {
    return null;
  }

  const matches = (tx: { txid?: string; vin?: ReadonlyArray<{ txid?: string; vout?: number }> }): boolean =>
    (tx.vin ?? []).some(v =>
      typeof v.txid === 'string' &&
      v.txid.toLowerCase() === funding.txid.toLowerCase() &&
      v.vout === funding.vout,
    );

  const readSpender = async (txid: string, blockHash: string | null): Promise<FundingSpender | null> => {
    const [rawHexRes, verboseRes] = await Promise.all([
      bitcoinRpc(baseUrl, 'getrawtransaction', [txid, false]),
      bitcoinRpc(baseUrl, 'getrawtransaction', [txid, true]),
    ]);
    const verbose = verboseRes.result as {
      confirmations?: number;
      vin?: ReadonlyArray<{ txid?: string; vout?: number }>;
      vout?: ReadonlyArray<{ value?: number; scriptPubKey?: { address?: string } }>;
    } | null;
    if (!verbose || typeof rawHexRes.result !== 'string') return null;
    return {
      txid,
      rawHex: rawHexRes.result,
      confirmations: typeof verbose.confirmations === 'number' ? verbose.confirmations : 0,
      blockHash,
      inputs: (verbose.vin ?? []).map(v => ({ txid: String(v.txid ?? ''), vout: Number(v.vout ?? -1) })),
      outputs: (verbose.vout ?? []).map(o => ({
        address: o.scriptPubKey?.address ?? null,
        valueSats: satsFromBtc(o.value),
      })),
    };
  };

  // Unconfirmed spender first (cheapest).
  try {
    const mempool = await bitcoinRpc(baseUrl, 'getrawmempool', []);
    for (const txid of (mempool.result as string[] | null) ?? []) {
      const t = await bitcoinRpc(baseUrl, 'getrawtransaction', [txid, true]);
      if (matches((t.result ?? {}) as { vin?: ReadonlyArray<{ txid?: string; vout?: number }> })) {
        const spender = await readSpender(txid, null);
        if (spender) {
          spenderCache.set(key, spender);
          negativeCache.delete(key);
        }
        return spender;
      }
    }
  } catch {
    // A mempool read failure must not lose the confirmed scan below.
  }

  // Confirmed spender: scan blocks from the funding height forward.
  const info = await bitcoinRpc(baseUrl, 'getblockchaininfo', []);
  const tip = Number((info.result as { blocks?: number } | null)?.blocks ?? 0);
  const fundConf = typeof fundTx.confirmations === 'number' ? fundTx.confirmations : 0;
  const fundingHeight = fundConf > 0 ? tip - fundConf + 1 : tip;
  // Scan backward from the tip: recent spenders are near the top, and the
  // bound plus per-block guards keep one transient node error from failing the
  // whole check (review fix 2026-10-02).
  const maxScan = 2_000;
  for (let h = tip; h >= fundingHeight && tip - h <= maxScan; h--) {
    try {
      const hashRes = await bitcoinRpc(baseUrl, 'getblockhash', [h]);
      const blockHash = hashRes.result as string | null;
      if (!blockHash) continue;
      const blockRes = await bitcoinRpc(baseUrl, 'getblock', [blockHash, 2]);
      const block = blockRes.result as {
        tx?: ReadonlyArray<{ txid?: string; vin?: ReadonlyArray<{ txid?: string; vout?: number }> }>;
      } | null;
      for (const tx of block?.tx ?? []) {
        if (matches(tx)) {
          const spender = await readSpender(String(tx.txid), blockHash);
          if (spender) {
            spenderCache.set(key, spender);
            negativeCache.delete(key);
          }
          return spender;
        }
      }
    } catch {
      // Skip a block the node failed to serve; keep scanning.
    }
  }
  negativeCache.set(key, Date.now());
  return null;
}

/**
 * Validate a spender into sweep evidence. The label "sovereign-exit" is earned
 * only when the input is exactly the funding outpoint (sole input) and an output
 * pays the user's L1 address. Anything else stays "unverified-spend".
 */
export function buildSweepEvidence(args: {
  funding: { txid: string; vout: number; valueSats: bigint };
  spender: FundingSpender;
  destination: string;
  /**
   * When the vault's exit leaf script is supplied, the sovereign label also
   * requires those exact script bytes in the spending witness: a cooperative
   * payout with the same shape must never be called a sovereign exit
   * (review pass 4).
   */
  expectedLeafScriptHex?: string;
}): ExitSweepEvidence {
  const { funding, spender, destination } = args;
  const spentOutpoint = `${funding.txid}:${funding.vout}`;
  const inputOk =
    spender.inputs.length === 1 &&
    spender.inputs[0].txid.toLowerCase() === funding.txid.toLowerCase() &&
    spender.inputs[0].vout === funding.vout;
  const destOut = spender.outputs.find(o => o.address === destination) ?? null;
  const outputTotal = spender.outputs.reduce((sum, o) => sum + o.valueSats, 0n);
  const feeSats = funding.valueSats - outputTotal;
  // A sovereign exit pays the USER and nobody else: every output must land on
  // the user L1 address (review r1: a 10-sat payment to the user plus the rest
  // to a third party must never earn the sovereign label).
  const outputsOk =
    spender.outputs.length > 0 && spender.outputs.every(o => o.address === destination);
  const leafHex = (args.expectedLeafScriptHex ?? '').trim().toLowerCase();
  const leafInWitness = leafHex.length > 0 && spender.rawHex.toLowerCase().includes(leafHex);
  const leafOk = leafHex.length === 0 || leafInWitness;
  const sovereign = inputOk && outputsOk && destOut !== null && feeSats >= 0n && leafOk;
  return {
    label: sovereign ? 'sovereign-exit' : 'unverified-spend',
    exitTxid: spender.txid,
    exitRawHex: spender.rawHex,
    spentOutpoint,
    destination: destOut ? destination : (spender.outputs[0]?.address ?? null),
    amountSats: destOut ? outputTotal : null,
    feeSats: feeSats >= 0n ? feeSats : null,
    blockHash: spender.blockHash,
    confirmations: spender.confirmations,
    explorerUrl: '',
    sovereign,
    note: sovereign
      ? leafHex.length > 0
        ? `The funding outpoint was spent by a single transaction paying your L1 address, through your exit leaf. Input, output, and exit script verified against the node.`
        : `The funding outpoint was spent by a single transaction paying your L1 address. Input and output verified against the node.`
      : inputOk && outputsOk && destOut !== null && feeSats >= 0n && !leafOk
        ? `The payout reaches your L1 address but the spending witness does not show your exit leaf (it may be a cooperative spend). Not labelled a sovereign exit.`
        : `A transaction spends this funding outpoint but the payment does not match a sovereign exit (sole input to your L1 address). Do not treat it as one.`,
  };
}

export interface ExitTreeProof {
  readonly verified: boolean;
  readonly method: 'stored-proof-reverified' | 'none';
  readonly exitLeafHex: string | null;
  readonly exitLeafHashHex: string | null;
  readonly exitControlBlockHex: string | null;
  readonly taprootOutputKey: string | null;
  readonly internalKey: string | null;
  readonly reason?: string;
}

/**
 * Tree proof WITHOUT any chain state or dry run: re-derive the taproot output
 * from the stored exit leaf + BIP-341 control block and assert it commits to
 * the vault address. A spent vault can and must still pass.
 */
export function proveExitTree(vault: VaultRecord): ExitTreeProof {
  const empty: ExitTreeProof = {
    verified: false,
    method: 'none',
    exitLeafHex: vault.exitLeaf ?? null,
    exitLeafHashHex: null,
    exitControlBlockHex: null,
    taprootOutputKey: null,
    internalKey: null,
  };
  const p2tr = vault.p2tr;
  if (!p2tr) {
    return { ...empty, reason: 'Vault record has no stored taproot bundle to verify.' };
  }
  try {
    verifyVaultP2tr(p2tr);
  } catch (err) {
    return { ...empty, reason: `Stored taproot bundle failed re-derivation: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (p2tr.address !== vault.address) {
    return { ...empty, reason: 'Stored taproot bundle commits to a different address than this vault record.' };
  }
  return {
    verified: true,
    method: 'stored-proof-reverified',
    exitLeafHex: Buffer.from(p2tr.exitLeaf.script).toString('hex'),
    exitLeafHashHex: Buffer.from(p2tr.exitLeafHash).toString('hex'),
    exitControlBlockHex: Buffer.from(p2tr.exitControlBlock).toString('hex'),
    taprootOutputKey: Buffer.from(p2tr.taprootOutputKey).toString('hex'),
    internalKey: Buffer.from(p2tr.internalKey).toString('hex'),
  };
}

