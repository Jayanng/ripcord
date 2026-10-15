/**
 * Restored-wallet credit rows (activity polish 2026-10-16).
 *
 * The daemon indexes no tx history by address and no VTXO->tx link, so a
 * wallet restored on a clean device cannot recover historical credit tx
 * hashes. The journal therefore derives neutral "VTXO credited" rows from
 * VTXO history (keyed by VTXO id, exactly like the existing vtxo:spent rows)
 * and suppresses any credit the live pipeline already journaled. The link
 * key is (height, amount) — the same vtxo<->receipt link provenance.ts uses.
 * Pure logic only; no daemon (AGENTS.md Rule 2 applies to live suites).
 */
import { describe, expect, it } from 'vitest';
import { buildCreditedVtxoRows, alignSpentVtxoTimes } from '../src/lifecycle.js';

const US = 'aa'.repeat(32);
const PEER = 'bb'.repeat(32);

const vtxo = (id: string, amountSats: bigint, height: number, owner = US) => ({
  id,
  amountSats,
  height,
  owner,
  spent: false,
});

describe('buildCreditedVtxoRows (restored-wallet journal backfill)', () => {
  it('emits one row per history credit when nothing else is journaled', () => {
    const rows = buildCreditedVtxoRows(
      [vtxo('v1', 10_000n, 1167861), vtxo('v2', 461n, 1154761)],
      [],
      [US],
    );
    expect(rows).toEqual([
      { kind: 'vtxo:credited', id: 'v1', amountSats: 10_000n, height: 1167861, owner: US },
      { kind: 'vtxo:credited', id: 'v2', amountSats: 461n, height: 1154761, owner: US },
    ]);
  });

  it('covers credits by OUR outputs only, not by every amount on the tx', () => {
    const event = {
      kind: 'tx:committed',
      txHash: 'ab'.repeat(32),
      type: 'transfer',
      height: 1167861,
      vout: [
        { owner: PEER, amountSats: 10_000n, script: '' },
        { owner: US, amountSats: 29_997n, script: '' },
      ],
    };
    const rows = buildCreditedVtxoRows(
      [vtxo('change', 29_997n, 1167861), vtxo('incoming', 10_000n, 1167861)],
      [event],
      [US],
    );
    // Our change output covers the change credit; the 10,000 on the tx went
    // to the peer, so a 10,000 credit of ours at the same height still shows.
    expect(rows.map(r => r.id)).toEqual(['incoming']);
  });

  it('consumes coverage as a multiset: a second same-amount credit in the same block still shows', () => {
    const event = {
      kind: 'tx:committed',
      txHash: 'ab'.repeat(32),
      type: 'transfer',
      height: 1167861,
      vout: [{ owner: US, amountSats: 1_000n, script: '' }],
    };
    const rows = buildCreditedVtxoRows(
      [vtxo('v1', 1_000n, 1167861), vtxo('v2', 1_000n, 1167861)],
      [event],
      [US],
    );
    expect(rows.map(r => r.id)).toEqual(['v2']);
  });

  it('incoming receipts cover their credit; send receipts to others never do', () => {
    const incoming = {
      kind: 'receipt',
      txHash: 'cd'.repeat(32),
      epoch: 1167861,
      fromXOnly: PEER,
      toXOnly: US,
      amountSats: 10_000n,
    };
    const sent = {
      kind: 'receipt',
      txHash: 'ef'.repeat(32),
      epoch: 1167855,
      fromXOnly: US,
      toXOnly: PEER,
      amountSats: 39_998n,
    };
    const rows = buildCreditedVtxoRows(
      [vtxo('v1', 10_000n, 1167861), vtxo('v2', 39_998n, 1167855)],
      [incoming, sent],
      [US],
    );
    expect(rows.map(r => r.id)).toEqual(['v2']);
  });

  it('self-receipts cover their credit (a move to our own key is journaled by the receipt)', () => {
    const self = {
      kind: 'receipt',
      txHash: 'cd'.repeat(32),
      epoch: 920953,
      fromXOnly: US,
      toXOnly: US,
      amountSats: 1_000n,
    };
    const rows = buildCreditedVtxoRows([vtxo('v1', 1_000n, 920953)], [self], [US]);
    expect(rows).toEqual([]);
  });

  it('L1-layer rows (deposit rows have no epoch and no vout) never suppress a mint credit', () => {
    const depositRow = {
      kind: 'tx:deposit',
      txHash: 'cd'.repeat(32),
      amountSats: 40_000n,
      vout: 0,
      committed: true,
      createdAt: 1,
    };
    const rows = buildCreditedVtxoRows([vtxo('mint', 39_998n, 1167855)], [depositRow], [US]);
    expect(rows.map(r => r.id)).toEqual(['mint']);
  });

  it('matches compressed 02/03 owner keys to the x-only identity', () => {
    const event = {
      kind: 'tx:committed',
      txHash: 'ab'.repeat(32),
      type: 'transfer',
      height: 1167861,
      vout: [{ owner: `02${US}`, amountSats: 500n, script: '' }],
    };
    const rows = buildCreditedVtxoRows([vtxo('v1', 500n, 1167861)], [event], [US]);
    expect(rows).toEqual([]);
  });

  it('emits rows for spent credits too (history is the only journal a restored wallet has)', () => {
    const rows = buildCreditedVtxoRows(
      [{ id: 'spent1', amountSats: 2_000n, height: 883261, owner: US, spent: true }],
      [],
      [US],
    );
    expect(rows.map(r => r.id)).toEqual(['spent1']);
  });

  it('ignores pending events (height 0) as coverage: no history VTXO can be explained by them', () => {
    const pending = {
      kind: 'tx:pending',
      txHash: 'ab'.repeat(32),
      type: 'transfer',
      height: 0,
      vout: [{ owner: US, amountSats: 10_000n, script: '' }],
    };
    const rows = buildCreditedVtxoRows([vtxo('v1', 10_000n, 1167861)], [pending], [US]);
    expect(rows.map(r => r.id)).toEqual(['v1']);
  });

  it('credited rows borrow their block timestamp like spent rows (alignSpentVtxoTimes)', () => {
    const rows = alignSpentVtxoTimes([
      { kind: 'block:new', height: 1167861, receivedAt: 1_760_000_000_000 },
      { kind: 'vtxo:credited', id: 'v1', amountSats: 10_000n, height: 1167861 },
    ]);
    expect((rows[1] as { receivedAt?: number }).receivedAt).toBe(1_760_000_000_000);
  });
});
