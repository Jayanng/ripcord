import { TachiClient } from '@tachibtc/tachi-sdk-ts';
import { fetchConsensusQuorum, getFeeEstimate } from '@tachibtc/taurus-vault-core';
import { RipcordCode, RipcordError } from './errors.js';

/** Which preflight probe a failure came from. */
export type ProbeName =
  | 'health'
  | 'nodeInfo'
  | 'liveValidators'
  | 'bitcoinRpc'
  | 'quorum'
  | 'feeEstimate';

/** A single failed probe, with the reason preserved. */
export interface ProbeFailure {
  readonly probe: ProbeName;
  readonly message: string;
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

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

export async function preflight(baseUrl: string): Promise<PreflightResult> {
  const client = new TachiClient({ baseUrl });

  const failures: ProbeFailure[] = [];
  const fail = (probe: ProbeName, err: unknown): void => {
    failures.push({ probe, message: errText(err) });
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
    const health = await client.getHealth();
    healthOk = health.status === 'ok';
    if (!healthOk) {
      fail('health', `status was "${health.status}", expected "ok"`);
    }
  } catch (err) {
    fail('health', err);
  }

  try {
    const nodeInfo = await client.getNodeInfo();
    nodeInfoOk = true;
    chainId = nodeInfo.chain_id;
    version = nodeInfo.version;
    synced = nodeInfo.sync_status === 'synced';
  } catch (err) {
    fail('nodeInfo', err);
  }

  // AUDIT FIX (2026-08-23): the chain guard used to run only after every probe
  // had completed, so a wrong-chain daemon was fully interrogated (six requests,
  // including the Bitcoin RPC proxy) before being rejected. Assert as soon as
  // the chain id is known so a signet or mainnet URL fails fast and no further
  // requests are sent to a daemon we are about to refuse.
  assertExpectedChain(chainId);

  try {
    const liveValidatorsResponse = await client.getLiveValidators();
    liveValidatorsOk = true;
    // Verified live: returns 7. Prefer the count field, fall back to the array length.
    liveValidators = liveValidatorsResponse.count ??
      (liveValidatorsResponse.validators ?? []).length;
  } catch (err) {
    fail('liveValidators', err);
  }

  try {
    // Real Bitcoin L1 height via the verified-permitted getblockchaininfo RPC.
    // No CometBFT fallback: stats.height is the CometBFT chain height (~424k),
    // NOT Bitcoin L1 (~9k). Substituting it on failure would silently report
    // a wildly wrong height, so unavailability is surfaced as null + source flag.
    const rpcRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '1', jsonrpc: '1.0', method: 'getblockchaininfo', params: [] }),
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
      fail('bitcoinRpc', `HTTP ${rpcRes.status} from the Bitcoin RPC proxy`);
    }
  } catch (err) {
    fail('bitcoinRpc', err);
  }

  try {
    const quorum = await fetchConsensusQuorum({ baseUrl });
    quorumOk = true;
    quorumThreshold = quorum.threshold;
    quorumSize = quorum.nodePubkeys.length;
  } catch (err) {
    fail('quorum', err);
  }

  try {
    const feeEstimate = await getFeeEstimate({ baseUrl });
    feeEstimateOk = true;
    feeRecommendedSats = BigInt(feeEstimate.recommendedFeeSats);
    feeMinSats = BigInt(feeEstimate.minFeeSats);
  } catch (err) {
    fail('feeEstimate', err);
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
    probeFailures: failures,
    unreachable,
  };
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
