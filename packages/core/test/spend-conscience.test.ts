import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONSCIENCE_SETTINGS,
  evaluateSpend,
  hasActiveRules,
  rolling24hSentSats,
  type ConscienceSettings,
  type SpendState,
} from '../src/spendConscience.js';

const settings = (over: Partial<ConscienceSettings> = {}): ConscienceSettings => ({
  ...DEFAULT_CONSCIENCE_SETTINGS,
  ...over,
});

const state = (over: Partial<SpendState> = {}): SpendState => ({
  spendableSats: 100_000n,
  savedRecipients: ['BCRT1PSAVED'],
  sentLast24hSats: 0n,
  ...over,
});

describe('spendConscience: defaults', () => {
  it('ships with every rule off (no behavior change until opted in)', () => {
    expect(hasActiveRules(DEFAULT_CONSCIENCE_SETTINGS)).toBe(false);
    expect(evaluateSpend(999_999n, 'bcrt1punknown', DEFAULT_CONSCIENCE_SETTINGS, state())).toEqual([]);
  });
});

describe('spendConscience: per-send limit', () => {
  it('passes under the limit and says so in plain numbers', () => {
    const checks = evaluateSpend(25_000n, 'bcrt1px', settings({ perTxLimitSats: 100_000n }), state());
    expect(checks).toHaveLength(1);
    expect(checks[0].pass).toBe(true);
    expect(checks[0].detail).toContain('25000 sats');
    expect(checks[0].detail).toContain('100000 sats');
  });

  it('fails exactly one sat over the limit', () => {
    const checks = evaluateSpend(100_001n, 'bcrt1px', settings({ perTxLimitSats: 100_000n }), state());
    expect(checks[0].pass).toBe(false);
    expect(checks[0].detail).toContain('over your');
  });

  it('passes exactly at the limit (boundary)', () => {
    const checks = evaluateSpend(100_000n, 'bcrt1px', settings({ perTxLimitSats: 100_000n }), state());
    expect(checks[0].pass).toBe(true);
  });
});

describe('spendConscience: 24-hour limit', () => {
  it('counts the rolling window against the new send', () => {
    const checks = evaluateSpend(
      30_000n,
      'bcrt1px',
      settings({ dailyLimitSats: 50_000n }),
      state({ sentLast24hSats: 25_000n }),
    );
    expect(checks[0].pass).toBe(false);
    expect(checks[0].detail).toContain('goes over');
  });

  it('passes when the projection stays inside the limit', () => {
    const checks = evaluateSpend(
      20_000n,
      'bcrt1px',
      settings({ dailyLimitSats: 50_000n }),
      state({ sentLast24hSats: 25_000n }),
    );
    expect(checks[0].pass).toBe(true);
  });

  it('rolling24hSentSats ignores entries outside the window', () => {
    const now = 1_700_000_000_000;
    const total = rolling24hSentSats(
      [
        { amountSats: 10n, at: now - 60_000 },
        { amountSats: 20n, at: now - 25 * 60 * 60 * 1000 },
        { amountSats: 40n, at: now + 1 },
      ],
      now,
    );
    expect(total).toBe(10n);
  });
});

describe('spendConscience: new recipient', () => {
  it('passes for saved recipients regardless of case', () => {
    const checks = evaluateSpend(1n, 'bcrt1psaved', settings({ newRecipientWarn: true }), state());
    expect(checks[0].pass).toBe(true);
    expect(checks[0].rule).toBe('new-recipient');
  });

  it('warns for unknown recipients', () => {
    const checks = evaluateSpend(1n, 'bcrt1pstranger', settings({ newRecipientWarn: true }), state());
    expect(checks[0].pass).toBe(false);
    expect(checks[0].detail).toContain('character by character');
  });
});

describe('spendConscience: large fraction', () => {
  it('passes at or under the percentage threshold', () => {
    const checks = evaluateSpend(
      50_000n,
      'bcrt1px',
      settings({ largeFractionWarn: true, largeFractionPct: 50 }),
      state(),
    );
    expect(checks[0].pass).toBe(true);
    expect(checks[0].detail).toContain('50%');
  });

  it('fails above the threshold', () => {
    const checks = evaluateSpend(
      50_001n,
      'bcrt1px',
      settings({ largeFractionWarn: true, largeFractionPct: 50 }),
      state(),
    );
    expect(checks[0].pass).toBe(false);
    expect(checks[0].label).toContain('most of your balance');
  });

  it('treats an empty balance as everything being large', () => {
    const checks = evaluateSpend(
      1n,
      'bcrt1px',
      settings({ largeFractionWarn: true }),
      state({ spendableSats: 0n }),
    );
    expect(checks[0].pass).toBe(false);
  });
});

describe('spendConscience: combined', () => {
  it('runs every active rule and keeps them independent', () => {
    const checks = evaluateSpend(
      60_000n,
      'bcrt1pstranger',
      settings({
        perTxLimitSats: 100_000n,
        dailyLimitSats: 200_000n,
        newRecipientWarn: true,
        largeFractionWarn: true,
      }),
      state({ sentLast24hSats: 10_000n }),
    );
    expect(checks.map(c => c.rule)).toEqual(['per-tx', 'daily', 'new-recipient', 'large-fraction']);
    expect(checks.map(c => c.pass)).toEqual([true, true, false, false]);
    expect(hasActiveRules(settings({ perTxLimitSats: 1n }))).toBe(true);
    expect(hasActiveRules(settings({ perTxLimitSats: null }))).toBe(false);
  });
});
