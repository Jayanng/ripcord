/**
 * Deposit confirmation waiter (2026-10-16): the user watched "0 of 1
 * confirmations" for 18 minutes with no way to tell a slow block from a lost
 * transaction. waitForBitcoinConfirmation swallowed "no such mempool"
 * forever. These tests pin: a deposit that disappears from the node's mempool
 * fails HONESTLY after a grace window (so the flow offers Retry/rebroadcast),
 * transient RPC hiccups keep waiting, and any other RPC error fails closed at
 * once. Pure: fetchImpl is the seam; no daemon.
 */
import { describe, expect, it } from 'vitest';
import { waitForBitcoinConfirmation } from '../src/lifecycle.js';

interface FetchCall {
  count: number;
}

function fakeFetch(responder: (call: number) => { status?: number; body: unknown }): (url: unknown, init?: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const calls: FetchCall = { count: 0 };
  const fn = async () => {
    calls.count += 1;
    const r = responder(calls.count);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
  (fn as unknown as { calls: FetchCall }).calls = calls;
  return fn as never;
}

const MEMPOOL_GONE = {
  result: null,
  error: { code: -5, message: 'No such mempool or blockchain transaction' },
};

describe('waitForBitcoinConfirmation', () => {
  it('resolves and reports progress once the deposit confirms', async () => {
    const seen: number[] = [];
    const fetchImpl = fakeFetch(call => {
      if (call < 3) return { body: { result: {} } }; // mempool: no confirmations field
      return { body: { result: { confirmations: 1 } } };
    });
    await waitForBitcoinConfirmation('http://node', 'ab'.repeat(32), 1, c => seen.push(c), fetchImpl as never);
    expect(seen).toEqual([0, 0, 1]);
  });

  it('fails honestly when the deposit is gone from the mempool for the whole grace window', async () => {
    const fetchImpl = fakeFetch(() => ({ body: MEMPOOL_GONE }));
    await expect(
      waitForBitcoinConfirmation('http://node', 'ab'.repeat(32), 1, undefined, fetchImpl as never),
    ).rejects.toThrow(/no longer in the node's mempool/i);
    expect((fetchImpl as unknown as { calls: FetchCall }).calls.count).toBeGreaterThanOrEqual(12);
  });

  it('tolerates a brief disappearance (node blip) and resolves when it reappears', async () => {
    const fetchImpl = fakeFetch(call => {
      if (call <= 3) return { body: MEMPOOL_GONE };
      return { body: { result: { confirmations: 1 } } };
    });
    await waitForBitcoinConfirmation('http://node', 'ab'.repeat(32), 1, undefined, fetchImpl as never);
    expect((fetchImpl as unknown as { calls: FetchCall }).calls.count).toBe(4);
  });

  it('keeps waiting through transient proxy hiccups (502), then resolves', async () => {
    const fetchImpl = fakeFetch(call => {
      if (call === 1) return { status: 502, body: {} };
      return { body: { result: { confirmations: 2 } } };
    });
    await waitForBitcoinConfirmation('http://node', 'ab'.repeat(32), 1, undefined, fetchImpl as never);
  });

  it('fails closed on any other RPC error, immediately (no retry)', async () => {
    const fetchImpl = fakeFetch(() => ({ body: { result: null, error: { code: -8, message: 'bitcoin rpc error -8: Block height out of range' } } }));
    await expect(
      waitForBitcoinConfirmation('http://node', 'ab'.repeat(32), 1, undefined, fetchImpl as never),
    ).rejects.toThrow(/Block height out of range/);
    expect((fetchImpl as unknown as { calls: FetchCall }).calls.count).toBe(1);
  });
});
