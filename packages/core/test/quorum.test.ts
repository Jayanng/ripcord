import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getQuorum, getQuorumWithCache, clearQuorumCache } from '../src/quorum.js';
import { RipcordError, RipcordCode } from '../src/errors.js';

const DAEMON_URL = 'https://rpc-regtest.tachibtc.com';

describe('quorum.ts', () => {
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

      const sorted = [...quorum.nodePubkeys].sort();
      const joined = sorted.join(':');
      const crypto = await import('node:crypto');
      const expectedFingerprint = crypto.createHash('sha256').update(joined).digest('hex');

      expect(quorum.fingerprint).toBe(expectedFingerprint);
    });
  });
});