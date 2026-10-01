/**
 * Unit formatting for the sats ⇄ BTC display toggle (Bounty #1, Phase 4).
 * Pure; the wallet decides when to swap the unit.
 */

/** BTC string for a sat value, exactly 8 decimals (1 BTC = 100,000,000 sats). */
export function satsToBtcString(valueSats: bigint): string {
  const negative = valueSats < 0n;
  const abs = negative ? -valueSats : valueSats;
  const whole = abs / 100_000_000n;
  const frac = (abs % 100_000_000n).toString().padStart(8, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

export type DisplayUnit = 'sats' | 'btc';

/** Format a sat value in the requested display unit. */
export function formatUnit(valueSats: bigint, unit: DisplayUnit): string {
  return unit === 'btc' ? `${satsToBtcString(valueSats)} BTC` : `${valueSats.toString()} sats`;
}
