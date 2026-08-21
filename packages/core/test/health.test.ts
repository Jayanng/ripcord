import { describe, it, expect } from 'vitest';
import { preflight } from '../src/health.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';

describe('preflight', { timeout: 30000 }, () => {
  it('returns valid PreflightResult against live daemon', async () => {
    const result = await preflight(DAEMON);

    expect(result.daemonOk).toBe(true);
    expect(result.chainId).toBe('tachi-regtest-1');
    expect(result.liveValidators).toBe(7);
    expect(result.quorumThreshold).toBe(5);
    expect(result.quorumSize).toBe(7);
    expect(result.feeRecommendedSats).toBeGreaterThanOrEqual(1n);
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
    expect(typeof result.synced).toBe('boolean');
    // Bitcoin L1 height (verified range 8861-8939 and growing slowly), NOT the
    // CometBFT chain height (~424k). If the RPC is unreachable, l1Height is
    // null with source 'unavailable' instead of silently substituting the
    // CometBFT height.
    expect(result.l1HeightSource).toBe('bitcoin-rpc');
    expect(result.l1Height).toBeGreaterThan(0);
    expect(result.l1Height).toBeLessThan(100000);
    // Spec Task 2.4: fee floor assert (minFeeSats >= 1).
    expect(result.feeMinSats).toBeGreaterThanOrEqual(1n);
  });
});