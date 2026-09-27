import { fetchConsensusQuorum, getFeeEstimate } from '@tachibtc/taurus-vault-core';
import { RipcordCode, RipcordError } from './errors.js';
import { describeDaemonFailure, joinDaemonUrl } from './net.js';
import type {
  WatchtowerStatus,
  WatchtowerBreachReceipt,
  BalanceCrossCheckParams,
  BalanceCrossCheckResult,
} from './types.js';

/**
 * Daemon preflight probes.
 *
 * AUDIT FIX (2026-09-27): the three daemon REST probes used
 * `@tachibtc/tachi-sdk-ts`'s `TachiClient`, which resolves absolute paths
 * with `new URL` against `baseUrl`. On a base WITH a path prefix (a subpath
 * deployment, e.g. https://host/proxy) that silently drops the prefix, the
 * probe 404s against the host's root, `fetch` RESOLVES on 404, and preflight
 * reports an undebuggable failure. ripcord joins daemon URLs exactly one way
 * (string concat via `joinDaemonUrl`, same as every other call site), so any
 * base works and every probe failure now carries its likely cause and fix via
 * `describeDaemonFailure` (see `docs/DEPLOYMENT.md`).
 */

/** Which preflight probe a failure came from. */
export type ProbeName =
  | 'health'
  | 'nodeInfo'
  | 'liveValidators'
  | 'bitcoinRpc'
  | 'quorum'
  | 'feeEstimate'
  | 'watchtower';

/** A single failed probe, with the reason preserved. */
export interface ProbeFailure {
  readonly probe: ProbeName;
  readonly message: string;
}

export interface PreflightOptions {
  readonly allowInsecureHttp?: boolean;
  readonly bitcoinRpcBaseUrl?: string;
  readonly balanceCheck?: {
    readonly ownerXOnly: string;
    readonly snapshotSats: bigint;
  };
}

export interface PreflightResult {
  daemonOk: boolean;
  chainId: string;
  version: string;
  synced: boolean;
  liveValidators: number;
  quorumThreshold: number;
  quorumSize: number;
  feeRecommendedSats: bigint;
  feeMinSats: bigint;
  l1Height: number | null;
  l1HeightSource: 'bitcoin-rpc' | 'unavailable';
  watchtower?: WatchtowerStatus | null;
  balanceCrossCheck?: BalanceCrossCheckResult | null;
  /**
   * Which probes failed and why. Empty when `daemonOk` is true.
   *
   * AUDIT FIX (2026-08-23): every probe sat behind a bare `catch {}`, so a
   * caller saw `daemonOk: false` with no way to tell WHICH probe failed or why.
   * A DNS failure, a 500, a quorum change, and a fee-endpoint outage were all
   * indistinguishable, which makes a boot failure undebuggable in the UI. The
   * reason is now captured per probe.
   */
  probeFailures: ProbeFailure[];
  /**
   * True when no probe reached the daemon at all (every probe failed). Lets a
   * caller distinguish "daemon is down" from "daemon is up but degraded".
   */
  unreachable: boolean;
}

const PROBE_TIMEOUT_MS = 30_000;

/** Probe response shapes (live-verified 2026-09-27 against rpc-regtest). */
interface HealthProbe {
  status: string;
}
interface NodeInfoProbe {
  chain_id: string;
  version: string;
  sync_status: string;
}
interface LiveValidatorsProbe {
  count?: number;
  validators?: unknown[];
}

/**
 * GET a daemon REST path and parse JSON. Joins by string concat so a
 * path-prefixed base survives (see ../src/net.ts for why that matters).
 */
async function daemonGetJson<T>(baseUrl: string, path: string): Promise<T> {
  const url = joinDaemonUrl(baseUrl, path);
  const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

export async function preflight(baseUrl: string, options: PreflightOptions = {}): Promise<PreflightResult> {
  const failures: ProbeFailure[] = [];
  const fail = (probe: ProbeName, err: unknown, context?: { url?: string; method?: string }): void => {
    failures.push({ probe, message: describeDaemonFailure(err, context) });
  };

  let healthOk = false;
  let nodeInfoOk = false;
  let liveValidatorsOk = false;
  let quorumOk = false;
  let feeEstimateOk = false;

  let chainId = '';
  let version = '';
  let synced = false;
  let liveValidators = 0;
  let quorumThreshold = 0;
  let quorumSize = 0;
  let feeRecommendedSats = 0n;
  let feeMinSats = 0n;
  let l1Height: number | null = null;
  let l1HeightSource: 'bitcoin-rpc' | 'unavailable' = 'unavailable';

  try {
    const health = await daemonGetJson<HealthProbe>(baseUrl, 'health');
    healthOk = health.status === 'ok';
    if (!healthOk) {
      fail('health', `status was "${health.status}", expected "ok"`);
    }
  } catch (err) {
    fail('health', err, { url: joinDaemonUrl(baseUrl, 'health'), method: 'GET' });
  }

  try {
    const nodeInfo = await daemonGetJson<NodeInfoProbe>(baseUrl, 'tachi_nodeInfo');
    nodeInfoOk = true;
    chainId = nodeInfo.chain_id;
    version = nodeInfo.version;
    synced = nodeInfo.sync_status === 'synced';
  } catch (err) {
    fail('nodeInfo', err, { url: joinDaemonUrl(baseUrl, 'tachi_nodeInfo'), method: 'GET' });
  }

  // AUDIT FIX (2026-08-23): the chain guard used to run only after every probe
  // had completed, so a wrong-chain daemon was fully interrogated (six requests,
  // including the Bitcoin RPC proxy) before being rejected. Assert as soon as
  // the chain id is known so a signet or mainnet URL fails fast and no further
  // requests are sent to a daemon we are about to refuse.
  assertExpectedChain(chainId);

  try {
    const liveValidatorsResponse = await daemonGetJson<LiveValidatorsProbe>(baseUrl, 'tachi_validators/live');
    liveValidatorsOk = true;
    // Verified live: returns 7. Prefer the count field, fall back to the array length.
    liveValidators = liveValidatorsResponse.count ??
      (liveValidatorsResponse.validators ?? []).length;
  } catch (err) {
    fail('liveValidators', err, { url: joinDaemonUrl(baseUrl, 'tachi_validators/live'), method: 'GET' });
  }

  try {
    // Real Bitcoin L1 height via the verified-permitted getblockchaininfo RPC.
    // No CometBFT fallback: stats.height is the CometBFT chain height (~424k),
    // NOT Bitcoin L1 (~9k). Substituting it on failure would silently report
    // a wildly wrong height, so unavailability is surfaced as null + source flag.
    const bitcoinRpcBaseUrl = options.bitcoinRpcBaseUrl ?? baseUrl;
    const rpcUrl = joinDaemonUrl(bitcoinRpcBaseUrl, '');
    const rpcRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '1', jsonrpc: '1.0', method: 'getblockchaininfo', params: [] }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (rpcRes.ok) {
      const rpcJson = (await rpcRes.json()) as { result?: { blocks?: number } };
      const blocks = rpcJson?.result?.blocks;
      if (typeof blocks === 'number') {
        l1Height = blocks;
        l1HeightSource = 'bitcoin-rpc';
      } else {
        fail('bitcoinRpc', 'getblockchaininfo returned no numeric "blocks" field');
      }
    } else {
      fail('bitcoinRpc', `HTTP ${rpcRes.status} from the Bitcoin RPC proxy`, { url: rpcUrl, method: 'POST' });
    }
  } catch (err) {
    fail('bitcoinRpc', err, { url: joinDaemonUrl(options.bitcoinRpcBaseUrl ?? baseUrl, ''), method: 'POST' });
  }

  try {
    const quorum = await fetchConsensusQuorum({ baseUrl, ...(options.allowInsecureHttp ? { allowInsecureHttp: true } : {}) });
    quorumOk = true;
    quorumThreshold = quorum.threshold;
    quorumSize = quorum.nodePubkeys.length;
  } catch (err) {
    fail('quorum', err, { method: 'GET' });
  }

  try {
    const feeEstimate = await getFeeEstimate({ baseUrl, ...(options.allowInsecureHttp ? { allowInsecureHttp: true } : {}) });
    feeEstimateOk = true;
    feeRecommendedSats = BigInt(feeEstimate.recommendedFeeSats);
    feeMinSats = BigInt(feeEstimate.minFeeSats);
  } catch (err) {
    fail('feeEstimate', err, { method: 'GET' });
  }

  let watchtower: WatchtowerStatus | null = null;
  try {
    watchtower = await fetchWatchtowerStatus(baseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch (err) {
    fail('watchtower', err, { url: joinDaemonUrl(baseUrl, 'tachi_watchtower/status'), method: 'GET' });
  }

  let balanceCrossCheck: BalanceCrossCheckResult | null = null;
  if (options.balanceCheck) {
    try {
      balanceCrossCheck = await crossCheckBalance({
        baseUrl,
        ownerXOnly: options.balanceCheck.ownerXOnly,
        snapshotSats: options.balanceCheck.snapshotSats,
        allowInsecureHttp: options.allowInsecureHttp,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    } catch {
      /* Non-fatal: balance cross-check is informational */
    }
  }

  const daemonOk = healthOk && nodeInfoOk && liveValidatorsOk && quorumOk && feeEstimateOk;
  // Every daemon-facing probe failed: nothing answered, so this is an outage
  // rather than a degraded daemon. The Bitcoin RPC proxy is excluded because it
  // is a separate service behind the same host.
  const unreachable = !healthOk && !nodeInfoOk && !liveValidatorsOk && !quorumOk && !feeEstimateOk;

  return {
    daemonOk,
    chainId,
    version,
    synced,
    liveValidators,
    quorumThreshold,
    quorumSize,
    feeRecommendedSats,
    feeMinSats,
    l1Height,
    l1HeightSource,
    watchtower,
    balanceCrossCheck,
    probeFailures: failures,
    unreachable,
  };
}

/**
 * Cross-check the wallet's VTXO snapshot sum against live chain state.
 *
 * Reads:
 *   - GET /tachi_balance?address=<ownerXOnly>  -> total unspent balance sats
 *   - GET /tachi_address?address=<ownerXOnly>  -> balance, nonce, vtxo_count
 *
 * Returns both numbers plus a boolean matches flag.
 * Does NOT alter or mutate any wallet state.
 */
export async function crossCheckBalance(params: BalanceCrossCheckParams): Promise<BalanceCrossCheckResult> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const timeoutMs = params.timeoutMs ?? 15_000;
  const signal = AbortSignal.timeout(timeoutMs);

  const balanceUrl = joinDaemonUrl(params.baseUrl, `tachi_balance?address=${encodeURIComponent(params.ownerXOnly)}`);
  const addressUrl = joinDaemonUrl(params.baseUrl, `tachi_address?address=${encodeURIComponent(params.ownerXOnly)}`);

  const [balanceRes, addressRes] = await Promise.all([
    fetchImpl(balanceUrl, { signal }).catch(() => null),
    fetchImpl(addressUrl, { signal }).catch(() => null),
  ]);

  let chainBalanceSats = 0n;
  let chainVtxoCount = 0;
  let balanceAnswered = false;
  let addressAnswered = false;

  if (balanceRes && balanceRes.ok) {
    const data = (await balanceRes.json().catch(() => ({}))) as { balance_sat?: number };
    if (typeof data.balance_sat === 'number') {
      chainBalanceSats = BigInt(data.balance_sat);
      balanceAnswered = true;
    }
  }

  if (addressRes && addressRes.ok) {
    const data = (await addressRes.json().catch(() => ({}))) as { balance_sat?: number; vtxo_count?: number };
    if (typeof data.balance_sat === 'number' && !balanceAnswered) {
      chainBalanceSats = BigInt(data.balance_sat);
    }
    if (typeof data.vtxo_count === 'number') {
      chainVtxoCount = data.vtxo_count;
    }
    if (typeof data.balance_sat === 'number' || typeof data.vtxo_count === 'number') {
      addressAnswered = true;
    }
  }

  // Reachability signal (Defect 3): true only when at least one endpoint answered ok with parseable JSON.
  // When chain is unreachable, matches is null (tri-state) so caller/TruthRail never reports false match/mismatch.
  const chainReachable = balanceAnswered || addressAnswered;
  const matches = chainReachable ? params.snapshotSats === chainBalanceSats : null;

  return {
    snapshotSats: params.snapshotSats,
    chainBalanceSats,
    chainVtxoCount,
    matches,
    chainReachable,
  };
}

/**
 * Fetch watchtower status from the live daemon.
 * Endpoint: GET /tachi_watchtower/status
 */
export async function fetchWatchtowerStatus(
  baseUrl: string,
  options?: { allowInsecureHttp?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<WatchtowerStatus | null> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const url = joinDaemonUrl(baseUrl, 'tachi_watchtower/status');
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      mode?: string;
      last_scanned_height?: number;
      receipt_count?: number;
      sweep_threshold?: number;
      bounty_configured?: boolean;
    };
    return {
      mode: json.mode ?? 'unknown',
      lastScannedHeight: json.last_scanned_height ?? 0,
      receiptCount: json.receipt_count ?? 0,
      sweepThreshold: json.sweep_threshold ?? 0,
      bountyConfigured: Boolean(json.bounty_configured),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch watchtower breach receipts from the live daemon.
 * Endpoint: GET /tachi_watchtower/receipts
 * Note: Daemon expects 64-hex vault_id for the ?vault= parameter.
 * Bech32m address returns HTTP 400 "invalid vault id".
 */
export async function fetchWatchtowerReceipts(
  baseUrl: string,
  vaultIdHex?: string,
  options?: { allowInsecureHttp?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<WatchtowerBreachReceipt[]> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const is64Hex = vaultIdHex && /^[0-9a-f]{64}$/i.test(vaultIdHex);
  const path = is64Hex
    ? `tachi_watchtower/receipts?vault=${encodeURIComponent(vaultIdHex)}`
    : 'tachi_watchtower/receipts';
  const url = joinDaemonUrl(baseUrl, path);
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      receipts?: Array<{
        vault_id?: string;
        broadcast_state?: number;
        latest_state?: number;
        classification?: string;
        spend_txid?: string;
        spend_vout?: number;
        detected_height?: number;
        detected_at?: number;
      }>;
    };
    const receipts = (json.receipts ?? []).map(r => ({
      vaultId: r.vault_id ?? '',
      broadcastState: r.broadcast_state ?? 0,
      latestState: r.latest_state ?? 0,
      classification: r.classification ?? 'unknown',
      spendTxid: r.spend_txid ?? '',
      spendVout: r.spend_vout ?? 0,
      detectedHeight: r.detected_height ?? 0,
      detectedAt: r.detected_at ?? 0,
    }));
    if (vaultIdHex) {
      const target = vaultIdHex.toLowerCase();
      return receipts.filter(r => r.vaultId.toLowerCase() === target);
    }
    return receipts;
  } catch {
    return [];
  }
}

/**
 * Refuse to proceed against a daemon on a different chain. An empty chain id
 * means `getNodeInfo` failed, which is reported through `probeFailures` rather
 * than treated as a mismatch.
 */
function assertExpectedChain(chainId: string): void {
  if (chainId && chainId !== 'tachi-regtest-1') {
    throw new RipcordError(
      RipcordCode.INVALID_CHAIN,
      `Expected chain "tachi-regtest-1", got "${chainId}"`,
      { hint: 'Daemon is running on a different chain than expected.' }
    );
  }
}

