import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getQuorum,
  getQuorumWithCache,
  clearQuorumCache,
  computeFingerprint,
  assertDistinctPubkeys,
} from '../src/quorum.js';
import { asCompressedHex } from '../src/types.js';
import { RipcordError, RipcordCode } from '../src/errors.js';

const DAEMON_URL = 'https://rpc-regtest.tachibtc.com';

describe('quorum.ts', { timeout: 30000 }, () => {
  beforeAll(() => {
    clearQuorumCache();
  });

  afterAll(() => {
    clearQuorumCache();
  });

  describe('getQuorum', () => {
    it('fetches quorum from live daemon and validates threshold=5, 7 pubkeys', async () => {
      const quorum = await getQuorum(DAEMON_URL);

      expect(quorum.threshold).toBe(5);
      expect(quorum.nodePubkeys).toHaveLength(7);
      expect(quorum.fingerprint).toBeDefined();
      expect(quorum.fingerprint.length).toBe(64);
      expect(quorum.fingerprint).toMatch(/^[0-9a-f]{64}$/i);
      expect(quorum.source).toBeDefined();
      expect(typeof quorum.source).toBe('string');

      for (const pk of quorum.nodePubkeys) {
        expect(pk.length).toBe(66);
        expect(pk).toMatch(/^0[23][0-9a-f]{64}$/i);
      }
    });
  });

  describe('getQuorumWithCache', () => {
    it('returns same result as getQuorum on first call', async () => {
      const quorum1 = await getQuorum(DAEMON_URL);
      const quorum2 = await getQuorumWithCache(DAEMON_URL);

      expect(quorum2.threshold).toBe(quorum1.threshold);
      expect(quorum2.nodePubkeys).toEqual(quorum1.nodePubkeys);
      expect(quorum2.fingerprint).toBe(quorum1.fingerprint);
      expect(quorum2.source).toBe(quorum1.source);
    });

    it('hits cache on second call (no refetch)', async () => {
      clearQuorumCache();

      const quorum1 = await getQuorumWithCache(DAEMON_URL);
      const quorum2 = await getQuorumWithCache(DAEMON_URL);

      expect(quorum2).toBe(quorum1);
    });

    it('produces deterministic fingerprint for sorted pubkeys', async () => {
      const quorum = await getQuorum(DAEMON_URL);
      expect(quorum.fingerprint).toBe(computeFingerprint(quorum.nodePubkeys, quorum.threshold));
    });
  });

  /**
   * AUDIT (2026-08-23). A `VaultRecord` stores `quorumFingerprint` so a later
   * quorum change is detectable rather than silently producing a different vault
   * address. Three defects broke that guarantee, all live-proven:
   *
   * 1. The preimage was the raw key strings, but `isCompressedHex` accepts
   *    uppercase hex, so the same 7-node quorum in a different case produced a
   *    different fingerprint and would have looked like a rotation.
   * 2. The threshold was NOT covered. `sha256(sorted keys)` is identical for a
   *    3-of-7 and a 5-of-7 quorum over the same nodes, yet the threshold changes
   *    the cooperative leaf and therefore the vault address.
   * 3. `vault.ts` hand-rolled a SECOND fingerprint definition, so a vault created
   *    via `createVault` could never match the quorum it was built against.
   *    (Covered in vault.test.ts.)
   */
  describe('fingerprint correctness (audit 2026-08-23)', () => {
    it('is stable across hex case (the same quorum is not a rotation)', async () => {
      const quorum = await getQuorum(DAEMON_URL);
      const upper = quorum.nodePubkeys.map(k => k.toUpperCase() as typeof k);
      expect(computeFingerprint(upper, quorum.threshold)).toBe(quorum.fingerprint);
    });

    it('covers the threshold: 3-of-7 and 5-of-7 over the same nodes differ', async () => {
      const quorum = await getQuorum(DAEMON_URL);
      expect(computeFingerprint(quorum.nodePubkeys, 3)).not.toBe(
        computeFingerprint(quorum.nodePubkeys, 5)
      );
    });

    it('changes when the node set changes', async () => {
      const quorum = await getQuorum(DAEMON_URL);
      const swapped = [...quorum.nodePubkeys.slice(1), asCompressedHex('02' + 'ab'.repeat(32))];
      expect(computeFingerprint(swapped, quorum.threshold)).not.toBe(quorum.fingerprint);
    });

    it('is independent of key order', async () => {
      const quorum = await getQuorum(DAEMON_URL);
      const reversed = [...quorum.nodePubkeys].reverse();
      expect(computeFingerprint(reversed, quorum.threshold)).toBe(quorum.fingerprint);
    });

    it('is domain-separated, not a bare sha256 of the joined keys', async () => {
      const quorum = await getQuorum(DAEMON_URL);
      // This deliberately uses bitcoinjs-lib too, matching the browser-safe
      // implementation without importing node:crypto in the test.
      const { crypto: btcCrypto } = await import('bitcoinjs-lib');
      const bare = Buffer.from(
        btcCrypto.sha256(Buffer.from([...quorum.nodePubkeys].sort().join(':'), 'utf8'))
      ).toString('hex');
      expect(quorum.fingerprint).not.toBe(bare);
    });
  });

  /**
   * AUDIT (2026-08-23). Validation checked length 7 and per-key format but never
   * uniqueness. A keyset with a repeated node key still has length 7 and passes
   * every format check, but the duplicated node can satisfy two of the five
   * required cooperative signatures, so it is not a real 5-of-7.
   */
  describe('duplicate node keys (audit 2026-08-23)', () => {
    it('rejects a repeated key', () => {
      const k = asCompressedHex('02' + 'aa'.repeat(32));
      const other = asCompressedHex('03' + 'bb'.repeat(32));
      expect(() => assertDistinctPubkeys([k, k, other])).toThrow(RipcordError);
      expect(() => assertDistinctPubkeys([k, k, other])).toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });

    it('treats a case-variant of the same key as a duplicate', () => {
      const lower = asCompressedHex('02' + 'aa'.repeat(32));
      const upper = asCompressedHex('02' + 'AA'.repeat(32));
      expect(() => assertDistinctPubkeys([lower, upper])).toThrow(RipcordError);
    });

    it('accepts the real live quorum (7 distinct keys)', async () => {
      const quorum = await getQuorum(DAEMON_URL);
      expect(() => assertDistinctPubkeys(quorum.nodePubkeys)).not.toThrow();
    });
  });

  /**
   * AUDIT (2026-08-23). `getQuorumWithCache` returned the cached object by
   * reference, so a caller could set `threshold = 1` or push an eighth key and
   * every later consumer of the shared cache saw the poisoned value, with the
   * 5-of-7 validation having already run. Live-proven before the fix: the cache
   * returned threshold=1 with 8 keys.
   */
  describe('cache cannot be poisoned (audit 2026-08-23)', () => {
    it('returns a frozen QuorumInfo with a frozen key array', async () => {
      clearQuorumCache();
      const quorum = await getQuorumWithCache(DAEMON_URL);
      expect(Object.isFrozen(quorum)).toBe(true);
      expect(Object.isFrozen(quorum.nodePubkeys)).toBe(true);
    });

    it('survives a caller attempting to mutate threshold and keys', async () => {
      clearQuorumCache();
      const first = await getQuorumWithCache(DAEMON_URL);
      // Frozen objects throw on write in ESM strict mode; either way the cache
      // must be intact afterwards.
      expect(() => {
        (first as { threshold: number }).threshold = 1;
      }).toThrow();
      expect(() => first.nodePubkeys.push(asCompressedHex('02' + 'de'.repeat(32)))).toThrow();

      const second = await getQuorumWithCache(DAEMON_URL);
      expect(second.threshold).toBe(5);
      expect(second.nodePubkeys).toHaveLength(7);
      clearQuorumCache();
    });
  });
});
