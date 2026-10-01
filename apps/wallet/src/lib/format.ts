/**
 * Format a satoshi amount or integer with comma-separated thousands and 'sats' unit.
 * Standardized across the RIPCORD wallet UI.
 *
 * Phase 4: the header's unit pill switches the display unit to BTC globally.
 * Default stays 'sats' (identical behavior). The unit is display-only: data
 * is always stored and sent in sats.
 */

import { satsToBtcString } from '@ripcord/core/units';

export type DisplayUnit = 'sats' | 'btc';

const UNIT_KEY = 'ripcord:display-unit';
let displayUnit: DisplayUnit = (() => {
  try {
    return localStorage.getItem(UNIT_KEY) === 'btc' ? 'btc' : 'sats';
  } catch {
    return 'sats';
  }
})();

export function getDisplayUnit(): DisplayUnit {
  return displayUnit;
}

export function setDisplayUnit(unit: DisplayUnit): void {
  displayUnit = unit;
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    // best effort
  }
  // Screens re-render via Layout's listener on this event.
  window.dispatchEvent(new CustomEvent('ripcord:unit-changed'));
}

export function formatSats(value: bigint | number): string {
  const isNegative = value < 0;
  const abs = typeof value === 'bigint' ? (value < 0n ? -value : value) : Math.abs(Math.trunc(value));
  if (displayUnit === 'btc') {
    return satsToBtcString(typeof abs === 'bigint' ? abs : BigInt(abs));
  }
  const str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${isNegative ? '-' : ''}${str} sats`;
}

/**
 * Format a numeric amount with comma-separated thousands (without unit).
 */
export function formatAmount(value: bigint | number): string {
  const isNegative = value < 0;
  const abs = typeof value === 'bigint' ? (value < 0n ? -value : value) : Math.abs(Math.trunc(value));
  const str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${isNegative ? '-' : ''}${str}`;
}

/**
 * Format a BTC amount with comma-separated thousands and 'BTC' unit.
 */
export function formatBtc(value: number | string): string {
  const [intPart, decPart] = String(value).split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${formattedInt}.${decPart} BTC` : `${formattedInt} BTC`;
}
