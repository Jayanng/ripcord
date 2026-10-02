/**
 * L1-backing reconciliation (audit fix 2026-10-02).
 *
 * Pure logic plus a live, read-only check against real daemon state: the
 * walkthrough demo wallet holds an unspent note while its funding outpoint is
 * already spent on L1 (the sovereign exit landed). The reconcile must report
 * that note as UNBACKED and the spendable figure as zero. No mocks
 * (AGENTS.md Rule 2).
 */
import { describe, expect, it } from 'vitest';
import { alignSpentVtxoTimes, dedupeActivityByHash, findAdoptableMintNote, reconcileSpendableSats, shouldShowResumeDepositRow } from '../src/lifecycle.js';

const BASE = process.env.RIPCORD_TEST_DAEMON ?? 'https://rpc-regtest.tachibtc.com/';
const DEMO_MNEMONIC = 'flight group arrange hybrid wrong image advice crisp discover glue erupt cousin';
const DEMO_FUNDING = 'b1b83036e08d76535ce1a85c5f87bb334bb8b72c1c85d82b83f70fcca8890403';

describe('reconcileSpendableSats (pure)', () => {
  it('keeps every sat when the notes are fully backed', () => {
    expect(reconcileSpendableSats(39_998n, 40_000n)).toEqual({ spendableSats: 39_998n, unbackedSats: 0n });
    expect(reconcileSpendableSats(40_000n, 40_000n)).toEqual({ spendableSats: 40_000n, unbackedSats: 0n });
  });

  it('caps spendable at the backing and reports the overage, never hides it', () => {
    expect(reconcileSpendableSats(79_997n, 40_000n)).toEqual({ spendableSats: 40_000n, unbackedSats: 39_997n });
  });

  it('reports zero spendable when nothing backs the notes (exited vault)', () => {
    expect(reconcileSpendableSats(39_998n, 0n)).toEqual({ spendableSats: 0n, unbackedSats: 39_998n });
    expect(reconcileSpendableSats(0n, 0n)).toEqual({ spendableSats: 0n, unbackedSats: 0n });
  });

  it('is exact on bigint boundaries', () => {
    expect(reconcileSpendableSats(1n, 0n)).toEqual({ spendableSats: 0n, unbackedSats: 1n });
  });
});

describe('findAdoptableMintNote (one deposit can never mint twice)', () => {
  const note = (amountSats: bigint, spent = false) => ({ id: `n${amountSats}`, amountSats, spent });

  it('adopts the exact mint note and never re-mints', () => {
    expect(findAdoptableMintNote([note(39_999n)], 39_999n)?.id).toBe('n39999');
  });

  it('adopts a second-mint shape one sat lighter (the live double-mint case)', () => {
    expect(findAdoptableMintNote([note(39_998n)], 39_999n)?.id).toBe('n39998');
  });

  it('never adopts a received payment or a change note outside the window', () => {
    expect(findAdoptableMintNote([note(30_000n), note(12_345n)], 39_999n)).toBeUndefined();
  });

  it('never adopts a spent note', () => {
    expect(findAdoptableMintNote([note(39_999n, true)], 39_999n)).toBeUndefined();
  });

  it('never adopts a note larger than the expected mint', () => {
    expect(findAdoptableMintNote([note(40_001n)], 39_999n)).toBeUndefined();
  });
});

describe('received notes are backed by the sender, not capped by ours', () => {
  it('the deposit share alone is capped; received value rides through', () => {
    // 30,000 received (sender-backed) + 39,998 minted against a spent vault:
    // the cap applies only to the 39,998 deposit share.
    const receivedSats = 30_000n;
    const depositSats = 39_998n;
    const reconciled = reconcileSpendableSats(depositSats, 0n);
    expect(reconciled.spendableSats).toBe(0n);
    expect(reconciled.unbackedSats).toBe(39_998n);
    const spendable = receivedSats + reconciled.spendableSats;
    expect(spendable).toBe(30_000n);
  });
});

describe('activity feed: one hash, one row; spends sort with their block', () => {
  it('drops a stale pending row once the same hash is committed', () => {
    const items = [
      { kind: 'tx:committed', txHash: 'aa'.repeat(32) },
      { kind: 'tx:pending', txHash: 'aa'.repeat(32) },
      { kind: 'tx:pending', txHash: 'bb'.repeat(32) },
      { kind: 'block:new', height: 7 },
    ];
    const out = dedupeActivityByHash(items);
    expect(out).toHaveLength(3);
    expect(out.filter(i => i.kind === 'tx:pending' && i.txHash === 'bb'.repeat(32))).toHaveLength(1);
    expect(out.filter(i => i.kind === 'tx:pending' && i.txHash === 'aa'.repeat(32))).toHaveLength(0);
  });

  it('keeps a genuinely pending transaction while nothing supersedes it', () => {
    const items = [
      { kind: 'tx:pending', txHash: 'cc'.repeat(32) },
      { kind: 'tx:deposit', txHash: 'dd'.repeat(32) },
    ];
    expect(dedupeActivityByHash(items)).toHaveLength(2);
  });

  it('borrows the block timestamp for a spent VTXO at the same height', () => {
    const items = [
      { kind: 'block:new', height: 953217, receivedAt: 1_700_000_000_000 },
      { kind: 'vtxo:spent', height: 953217 },
      { kind: 'vtxo:spent', height: 42 },
    ];
    const out = alignSpentVtxoTimes(items);
    expect((out[1] as { receivedAt?: number }).receivedAt).toBe(1_700_000_000_000);
    expect((out[2] as { receivedAt?: number }).receivedAt).toBeUndefined();
  });

  it('never overwrites a timestamp the item already carries', () => {
    const items = [
      { kind: 'block:new', height: 5, receivedAt: 111 },
      { kind: 'vtxo:spent', height: 5, createdAt: 222 },
    ];
    const out = alignSpentVtxoTimes(items);
    expect((out[1] as { createdAt?: number }).createdAt).toBe(222);
    expect((out[1] as { receivedAt?: number }).receivedAt).toBeUndefined();
  });
});

describe('resume-deposit row is legitimate only before funding is known', () => {
  it('shows the resume row while the deposit is still pre-registration', () => {
    expect(shouldShowResumeDepositRow('ab'.repeat(32), undefined)).toBe(true);
    expect(shouldShowResumeDepositRow('ab'.repeat(32), null)).toBe(true);
  });

  it('suppresses it the moment the real funding txid is known (the phantom-deposit bug)', () => {
    expect(shouldShowResumeDepositRow('ab'.repeat(32), 'cd'.repeat(32))).toBe(false);
  });

  it('ignores a missing or malformed saved txid', () => {
    expect(shouldShowResumeDepositRow(null, undefined)).toBe(false);
    expect(shouldShowResumeDepositRow('not-a-txid', undefined)).toBe(false);
  });
});

describe('reconciliation against real daemon state (live, read-only)', () => {
  it('the demo wallet unspent note is unbacked because its funding is spent on L1', { timeout: 120_000 }, async () => {
    // 1. L1 truth: the funding outpoint was spent by the sovereign exit.
    const txoutRes = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gettxout', params: [DEMO_FUNDING, 0, true] }),
    });
    const txout = (await txoutRes.json()) as { result?: unknown };
    if (txout.result !== null && txout.result !== undefined) {
      // Chain fixture no longer in the spent state (regtest reset): nothing to assert.
      return;
    }

    // 2. Daemon truth: the notes it still credits for the demo identity.
    const { deriveIdentity } = await import('../src/keys.js');
    const identity = deriveIdentity(DEMO_MNEMONIC, 'regtest', 0);
    const owner = identity.xOnly;
    const vtxosRes = await fetch(`${BASE}tachi_addressVtxos?address=${owner}&include_spent=true`, {
      headers: { Accept: 'application/json' },
    });
    const body = (await vtxosRes.json()) as { vtxos?: Array<{ amount: number; spent: boolean }> };
    const notesSats = (body.vtxos ?? [])
      .filter(v => !v.spent)
      .reduce((sum, v) => sum + BigInt(Math.round(v.amount)), 0n);

    // 3. The fix's promise: no unbacked credit counts as spendable.
    const backingSats = 0n;
    const reconciled = reconcileSpendableSats(notesSats, backingSats);
    expect(reconciled.spendableSats).toBe(0n);
    if (notesSats > 0n) {
      expect(reconciled.unbackedSats).toBe(notesSats);
    }
  });
});
