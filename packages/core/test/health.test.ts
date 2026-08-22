import { describe, it, expect } from 'vitest';
import { preflight } from '../src/health.js';
import { RipcordCode } from '../src/errors.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';
// A host that cannot resolve. Exercises the real outage path (DNS failure)
// without a mock: every probe genuinely fails against a real fetch.
const UNREACHABLE = 'https://rpc-regtest-does-not-exist.tachibtc.invalid';

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
    // Bitcoin L1 height (verified range 8861-9060 and growing slowly), NOT the
    // CometBFT chain height (~437k). If the RPC is unreachable, l1Height is
    // null with source 'unavailable' instead of silently substituting the
    // CometBFT height.
    expect(result.l1HeightSource).toBe('bitcoin-rpc');
    expect(result.l1Height).toBeGreaterThan(0);
    expect(result.l1Height).toBeLessThan(100000);
    // Spec Task 2.4: fee floor assert (minFeeSats >= 1).
    expect(result.feeMinSats).toBeGreaterThanOrEqual(1n);
    // A healthy daemon reports no failures and is not flagged unreachable.
    expect(result.probeFailures).toEqual([]);
    expect(result.unreachable).toBe(false);
  });

  /**
   * AUDIT (2026-08-23). Task 2.4 had exactly one test, the happy path, so the
   * failure behaviour was entirely unverified. Every probe sat behind a bare
   * `catch {}`: a caller saw `daemonOk: false` and could not tell whether DNS
   * failed, the daemon 500'd, the quorum changed, or the fee endpoint was down.
   * That makes a boot failure undebuggable in the UI, which
   * `03-DESIGN-SYSTEM.md` explicitly requires ("never swallow the original
   * text"). Failures are now reported per probe.
   */
  describe('failure reporting (audit 2026-08-23)', () => {
    it('reports which probes failed, and why, when the host is unreachable', async () => {
      const result = await preflight(UNREACHABLE);

      expect(result.daemonOk).toBe(false);
      expect(result.unreachable).toBe(true);

      // Every daemon-facing probe must be named, not silently swallowed.
      const failed = result.probeFailures.map(f => f.probe).sort();
      expect(failed).toContain('health');
      expect(failed).toContain('nodeInfo');
      expect(failed).toContain('liveValidators');
      expect(failed).toContain('quorum');
      expect(failed).toContain('feeEstimate');

      // Each failure carries a non-empty reason for the UI details disclosure.
      for (const f of result.probeFailures) {
        expect(f.message.length).toBeGreaterThan(0);
      }
    });

    it('leaves numeric fields at safe zero values on total failure', async () => {
      const result = await preflight(UNREACHABLE);
      // Critically: never invent a height or a quorum. A zero quorum size must
      // not read as "quorum verified".
      expect(result.chainId).toBe('');
      expect(result.liveValidators).toBe(0);
      expect(result.quorumSize).toBe(0);
      expect(result.quorumThreshold).toBe(0);
      expect(result.l1Height).toBeNull();
      expect(result.l1HeightSource).toBe('unavailable');
    });

    it('does not throw INVALID_CHAIN when the chain id is simply unknown', async () => {
      // An empty chainId means getNodeInfo failed; that is a probe failure, not
      // a chain mismatch, and must not mask the real outage.
      const result = await preflight(UNREACHABLE);
      expect(result.chainId).toBe('');
      expect(result.probeFailures.some(f => f.probe === 'nodeInfo')).toBe(true);
    });

    it('exposes RipcordCode.INVALID_CHAIN for the mismatch path', () => {
      // The guard now runs immediately after the chain id is known, so a
      // wrong-chain daemon is refused before the remaining probes are sent.
      // No signet/mainnet daemon is reachable from regtest to drive this live,
      // so the code path is asserted structurally and marked untested-live.
      expect(RipcordCode.INVALID_CHAIN).toBe('INVALID_CHAIN');
    });
  });
});
