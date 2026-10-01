/**
 * Spend Conscience (Bounty #1 build, Phase 3).
 *
 * A calm pre-send checklist, not a nanny: the user sets their own limits and
 * sees every rule in plain English before money moves. Rules are advisory by
 * design ("Looks right, send" / "Cancel"): the user stays in charge, but a
 * bad send has to get past their own rules first. Everything is public data.
 *
 * Pure data in, pure data out: no network, no side effects, never throws.
 */

export interface ConscienceSettings {
  /** Warn when a single send exceeds this (null = rule off). */
  readonly perTxLimitSats: bigint | null;
  /** Warn when sends in a rolling 24h window exceed this (null = rule off). */
  readonly dailyLimitSats: bigint | null;
  /** Warn when the recipient is not in the saved list (default off). */
  readonly newRecipientWarn: boolean;
  /** Warn when a send is a large share of the spendable balance (default off). */
  readonly largeFractionWarn: boolean;
  /** Percentage of spendable balance treated as "large" (default 50). */
  readonly largeFractionPct: number;
}

export interface SpendState {
  readonly spendableSats: bigint;
  /** Recipient addresses the user has saved or sent to before (any case). */
  readonly savedRecipients: readonly string[];
  /** Sats sent in the rolling 24h window, from the local send log. */
  readonly sentLast24hSats: bigint;
}

export interface ConscienceCheck {
  readonly rule: 'per-tx' | 'daily' | 'new-recipient' | 'large-fraction';
  readonly label: string;
  readonly pass: boolean;
  readonly detail: string;
}

export const DEFAULT_CONSCIENCE_SETTINGS: ConscienceSettings = {
  perTxLimitSats: null,
  dailyLimitSats: null,
  newRecipientWarn: false,
  largeFractionWarn: false,
  largeFractionPct: 50,
};

export function hasActiveRules(settings: ConscienceSettings): boolean {
  return settings.perTxLimitSats !== null
    || settings.dailyLimitSats !== null
    || settings.newRecipientWarn
    || settings.largeFractionWarn;
}

function sats(value: bigint): string {
  return `${value.toString()} sats`;
}

export function evaluateSpend(
  amountSats: bigint,
  recipient: string,
  settings: ConscienceSettings,
  state: SpendState,
): ConscienceCheck[] {
  const checks: ConscienceCheck[] = [];
  const recipientKey = recipient.trim().toLowerCase();

  if (settings.perTxLimitSats !== null) {
    const limit = settings.perTxLimitSats;
    const pass = limit > 0n && amountSats <= limit;
    checks.push({
      rule: 'per-tx',
      label: 'Under your per-send limit',
      pass,
      detail: pass
        ? `${sats(amountSats)} of your ${sats(limit)} per-send limit.`
        : `This send of ${sats(amountSats)} is over your ${sats(limit)} per-send limit.`,
    });
  }

  if (settings.dailyLimitSats !== null) {
    const limit = settings.dailyLimitSats;
    const projected = state.sentLast24hSats + amountSats;
    const pass = limit > 0n && projected <= limit;
    checks.push({
      rule: 'daily',
      label: 'Under your 24-hour limit',
      pass,
      detail: pass
        ? `${sats(state.sentLast24hSats)} sent in the last 24 hours plus this ${sats(amountSats)} send stays within ${sats(limit)}.`
        : `${sats(state.sentLast24hSats)} sent in the last 24 hours plus this ${sats(amountSats)} send goes over your ${sats(limit)} limit.`,
    });
  }

  if (settings.newRecipientWarn) {
    const known = state.savedRecipients.some(r => r.trim().toLowerCase() === recipientKey);
    checks.push({
      rule: 'new-recipient',
      label: known ? 'Recipient is someone you know' : 'New recipient',
      pass: known,
      detail: known
        ? 'This address is in your saved recipients.'
        : 'You have not sent to this address before. Check it character by character.',
    });
  }

  if (settings.largeFractionWarn) {
    const pct = BigInt(Math.round(settings.largeFractionPct));
    // Exact comparison (cross-multiplied): integer truncation would let a
    // send one sat over the threshold slip through as "50%".
    const pass = state.spendableSats > 0n && amountSats * 100n <= pct * state.spendableSats;
    const shareText = state.spendableSats > 0n
      ? (Number((amountSats * 1000n) / state.spendableSats) / 10).toFixed(1)
      : '100.0';
    checks.push({
      rule: 'large-fraction',
      label: pass ? 'A normal slice of your balance' : 'This is most of your balance',
      pass,
      detail: pass
        ? `This send is ${shareText}% of your spendable balance (your threshold is ${pct}%).`
        : `This send is ${shareText}% of your spendable balance, above your ${pct}% threshold.`,
    });
  }

  return checks;
}

/** Rolling 24h sent total from the local send log. */
export function rolling24hSentSats(
  entries: readonly { amountSats: bigint; at: number }[],
  now: number,
): bigint {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return entries.reduce((sum, e) => (e.at >= cutoff && e.at <= now ? sum + e.amountSats : sum), 0n);
}
