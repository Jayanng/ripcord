import { TachiClient } from '@tachibtc/tachi-sdk-ts';
import { fetchConsensusQuorum, getFeeEstimate } from '@tachibtc/taurus-vault-core';
import { RipcordCode, RipcordError } from './errors.js';

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
}

export async function preflight(baseUrl: string): Promise<PreflightResult> {
  const client = new TachiClient({ baseUrl });

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
  } catch {}

  try {
    const nodeInfo = await client.getNodeInfo();
    nodeInfoOk = true;
    chainId = nodeInfo.chain_id;
    version = nodeInfo.version;
    synced = nodeInfo.sync_status === 'synced';
  } catch {}

  try {
    const liveValidatorsResponse = await client.getLiveValidators();
    liveValidatorsOk = true;
    // Verified live: returns 7. Prefer the count field, fall back to the array length.
    liveValidators = liveValidatorsResponse.count ??
      (liveValidatorsResponse.validators ?? []).length;
  } catch {}

  try {
    // Real Bitcoin L1 height via the verified-permitted getblockchaininfo RPC.
    // No CometBFT fallback: stats.height is the CometBFT chain height (~424k),
    // NOT Bitcoin L1 (~8.9k). Substituting it on failure would silently report
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
      }
    }
  } catch {}

  try {
    const quorum = await fetchConsensusQuorum({ baseUrl });
    quorumOk = true;
    quorumThreshold = quorum.threshold;
    quorumSize = quorum.nodePubkeys.length;
  } catch {}

  try {
    const feeEstimate = await getFeeEstimate({ baseUrl });
    feeEstimateOk = true;
    feeRecommendedSats = BigInt(feeEstimate.recommendedFeeSats);
    feeMinSats = BigInt(feeEstimate.minFeeSats);
  } catch {}

  const daemonOk = healthOk && nodeInfoOk && liveValidatorsOk && quorumOk && feeEstimateOk;

  if (chainId && chainId !== 'tachi-regtest-1') {
    throw new RipcordError(
      RipcordCode.INVALID_CHAIN,
      `Expected chain "tachi-regtest-1", got "${chainId}"`,
      { hint: 'Daemon is running on a different chain than expected.' }
    );
  }

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
  };
}
