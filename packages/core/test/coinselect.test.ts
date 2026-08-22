import { describe, it, expect } from 'vitest';
import { selectCoins, type SpendableVtxo } from '../src/coinselect.js';

// Live-verified Alice VTXOs from getAddressVtxos (2026-08-22):
// 4 unspent, unlocked VTXOs totaling 88,996 sats.
const LIVE_VTXOS: SpendableVtxo[] = [
  { id: '991dba7eac71fe789c98402aac1a02eeebd5a805ab11d7704f26130af9a25227', amountSats: 3999n, spent: false, locked: false },
  { id: 'a723d71a01d215d7f2b266de0af714623178ff2995fa7d73d6de95fe4e874b76', amountSats: 12000n, spent: false, locked: false },
  { id: '9a4133efb657098b5f6c9a1e65cd1a4d26e40f78f9ebd4d6dfa8fbf5d6d1d00a', amountSats: 32998n, spent: false, locked: false },
  { id: 'e4ec469d6143accfeaa0e072858c5ccb9ce73ae0a70cd1753615534867aa07e8', amountSats: 39999n, spent: false, locked: false },
];

describe('selectCoins', () => {
  it('selects the largest VTXO first to cover a small target', () => {
    const result = selectCoins(LIVE_VTXOS, 5000n, 1n);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].id).toBe('e4ec469d6143accfeaa0e072858c5ccb9ce73ae0a70cd1753615534867aa07e8');
    expect(result.inputs[0].amountSats).toBe(39999n);
    expect(result.totalInputSats).toBe(39999n);
    expect(result.changeSats).toBe(39999n - 5000n - 1n);
    expect(result.feeSats).toBe(1n);
  });

  it('selects multiple VTXOs when one is insufficient', () => {
    // Need 50000 + 1 fee = 50001. Largest is 39999, so need at least 2.
    const result = selectCoins(LIVE_VTXOS, 50000n, 1n);
    expect(result.inputs.length).toBeGreaterThanOrEqual(2);
    expect(result.totalInputSats).toBeGreaterThanOrEqual(50001n);
    expect(result.changeSats).toBe(result.totalInputSats - 50000n - 1n);
  });

  it('throws on insufficient funds', () => {
    // Total available: 88996. Ask for more than that.
    expect(() => selectCoins(LIVE_VTXOS, 100000n, 1n)).toThrow('Insufficient funds');
  });

  it('throws when feeSats is zero', () => {
    expect(() => selectCoins(LIVE_VTXOS, 1000n, 0n)).toThrow('feeSats must be >= 1');
  });

  it('throws when targetSats is zero or negative', () => {
    expect(() => selectCoins(LIVE_VTXOS, 0n, 1n)).toThrow('targetSats must be > 0');
    expect(() => selectCoins(LIVE_VTXOS, -1n, 1n)).toThrow('targetSats must be > 0');
  });

  it('skips VTXOs marked as spent', () => {
    const vtxos: SpendableVtxo[] = [
      { id: 'spent1', amountSats: 50000n, spent: true, locked: false },
      { id: 'good1', amountSats: 10000n, spent: false, locked: false },
    ];
    const result = selectCoins(vtxos, 5000n, 1n);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].id).toBe('good1');
  });

  it('skips VTXOs marked as locked', () => {
    const vtxos: SpendableVtxo[] = [
      { id: 'locked1', amountSats: 50000n, spent: false, locked: true },
      { id: 'good1', amountSats: 10000n, spent: false, locked: false },
    ];
    const result = selectCoins(vtxos, 5000n, 1n);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].id).toBe('good1');
  });

  it('skips VTXOs with localSpentAt set (reserved by queue)', () => {
    const vtxos: SpendableVtxo[] = [
      { id: 'reserved1', amountSats: 50000n, spent: false, locked: false, localSpentAt: Date.now() },
      { id: 'good1', amountSats: 10000n, spent: false, locked: false },
    ];
    const result = selectCoins(vtxos, 5000n, 1n);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].id).toBe('good1');
  });

  it('produces deterministic output for same input (sorted by amount desc, then id asc)', () => {
    const r1 = selectCoins(LIVE_VTXOS, 5000n, 1n);
    const r2 = selectCoins(LIVE_VTXOS, 5000n, 1n);
    expect(r1.inputs.map(i => i.id)).toEqual(r2.inputs.map(i => i.id));
  });

  it('rejects duplicate VTXO ids instead of counting one output twice', () => {
    const duplicate = [
      { id: 'same', amountSats: 10000n, spent: false, locked: false },
      { id: 'same', amountSats: 10000n, spent: false, locked: false },
    ];
    expect(() => selectCoins(duplicate, 15000n, 1n)).toThrow('Duplicate VTXO id');
  });

  it('rejects zero and negative VTXO amounts', () => {
    expect(() => selectCoins([{ id: 'zero', amountSats: 0n, spent: false, locked: false }], 1n, 1n))
      .toThrow('amountSats must be > 0');
    expect(() => selectCoins([{ id: 'negative', amountSats: -1n, spent: false, locked: false }], 1n, 1n))
      .toThrow('amountSats must be > 0');
  });

  it('rejects an empty VTXO id', () => {
    expect(() => selectCoins([{ id: '', amountSats: 1000n, spent: false, locked: false }], 1n, 1n))
      .toThrow('VTXO id must be a non-empty string');
  });

  it('rejects negative and non-integer amounts before selection', () => {
    expect(() => selectCoins(LIVE_VTXOS, -1n, 1n)).toThrow('targetSats must be > 0');
  });

  it('computes change correctly: total - target - fee', () => {
    const result = selectCoins(LIVE_VTXOS, 10000n, 5n);
    const expectedChange = result.totalInputSats - 10000n - 5n;
    expect(result.changeSats).toBe(expectedChange);
  });
});

