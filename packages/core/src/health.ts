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
  l1Height: number;
  feeRecommendedSats: bigint;
}

export async function preflight(baseUrl: string): Promise<PreflightResult> {
  const client = new TachiClient({ baseUrl });

  let healthOk = false;
  let nodeInfoOk = false;
  let liveValidatorsOk = false;
  let statsOk = false;
  let quorumOk = false;
  let feeEstimateOk = false;

  let healthValidators = 0;
  let chainId = '';
  let version = '';
  let synced = false;
  let liveValidators = 0;
  let quorumThreshold = 0;
  let quorumSize = 0;
  let l1Height = 0;
  let feeRecommendedSats = 0n;

  try {
    const health = await client.getHealth();
    healthOk = health.status === 'ok';
    healthValidators = health.validators;
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
    const stats = await client.getStats();
    statsOk = true;
    // CometBFT chain height, NOT Bitcoin L1. Used only as a fallback below.
    const chainHeight = stats.height;
    // Real Bitcoin L1 height via the verified-permitted getblockchaininfo RPC.
    const rpcRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '1', jsonrpc: '1.0', method: 'getblockchaininfo', params: [] }),
    });
    const rpcJson = (await rpcRes.json()) as { result?: { blocks?: number } };
    l1Height = rpcJson?.result?.blocks ?? chainHeight;
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
  } catch {}

  const daemonOk = healthOk && nodeInfoOk && liveValidatorsOk && statsOk && quorumOk && feeEstimateOk;

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
    l1Height,
    feeRecommendedSats,
  };
}