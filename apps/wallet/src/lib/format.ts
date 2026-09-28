/**
 * Format a satoshi amount or integer with comma-separated thousands and 'sats' unit.
 * Standardized across the RIPCORD wallet UI.
 */
export function formatSats(value: bigint | number): string {
  const isNegative = value < 0;
  const abs = typeof value === 'bigint' ? (value < 0n ? -value : value) : Math.abs(Math.trunc(value));
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
