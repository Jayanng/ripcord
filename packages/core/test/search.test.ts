import { describe, it, expect } from 'vitest';
import { searchChain, type ChainSearchResult } from '../src/search.js';
import { withTransportRetry } from './live-fixtures.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';

/**
 * Live protocol search against the regtest daemon (Rule 1: live-is-truth).
 * Shapes pinned 2026-09-28: block/tx/vtxo/address JSON envelopes,
 * `not found: <q>` as plain text on a miss.
 */
describe('searchChain (live daemon)', { timeout: 60_000 }, () => {
  it('finds a block by height', async () => {
    const result = await withTransportRetry(() => searchChain(DAEMON, '14360'));
    expect(result.kind).toBe('block');
    if (result.kind !== 'block') return;
    expect(result.height).toBe(14360);
    expect(result.hash).toMatch(/^[0-9a-fA-F]{64}$/);
  });

  it('finds a vtxo by id and decodes the Go byte-array ID to hex', async () => {
    const result = await withTransportRetry(() =>
      searchChain(DAEMON, 'fe9286778eecfd8a75c8d0b10f885b4b6bb220e42f9778cf61951e0994984b90'),
    );
    expect(result.kind).toBe('vtxo');
    if (result.kind !== 'vtxo') return;
    expect(result.amountSats).toBe(1000n);
    expect(result.idHex).toBe('fe9286778eecfd8a75c8d0b10f885b4b6bb220e42f9778cf61951e0994984b90');
  });

  it('finds an address by x-only pubkey with live balance', async () => {
    const result = await withTransportRetry(() =>
      searchChain(DAEMON, 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319'),
    );
    expect(result.kind).toBe('address');
    if (result.kind !== 'address') return;
    expect(result.pubkey).toBe('e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319');
    expect(result.vtxoCount).toBeGreaterThan(0);
  });

  it('returns a not-found result (not an error) for a miss', async () => {
    const result: ChainSearchResult = await withTransportRetry(() => searchChain(DAEMON, 'zzzz-not-a-real-query'));
    expect(result.kind).toBe('not-found');
    if (result.kind !== 'not-found') return;
    expect(result.query).toBe('zzzz-not-a-real-query');
  });

  it('returns not-found for an empty query without hitting the network', async () => {
    const result = await searchChain(DAEMON, '   ');
    expect(result.kind).toBe('not-found');
  });
});
