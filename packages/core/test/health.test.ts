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
    expect(typeof result.l1Height).toBe('number');
    // Bitcoin L1 height (verified range: 8861-8881 growing slowly), NOT the
    // CometBFT chain height (~418k). This assertion proves the distinction.
    expect(result.l1Height).toBeGreaterThan(0);
    expect(result.l1Height).toBeLessThan(100000);
  });
});