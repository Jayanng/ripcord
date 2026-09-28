/**
 * Recipient memory + payment-request helpers for the wallet UI (Phase 6).
 *
 * Recent recipients and saved addresses live in localStorage: they are
 * convenience data only (never keys, never balance state), so a plain
 * browser store is the honest layer. Money state stays in core.
 */

export interface RecipientEntry {
  address: string;
  label?: string;
  lastUsedAt: number;
  useCount: number;
}

const RECENT_KEY = 'ripcord:recent-recipients';
const SAVED_KEY = 'ripcord:saved-addresses';
const RECENT_CAP = 8;

function loadList(key: string): RecipientEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecipientEntry => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return typeof record.address === 'string' && record.address.length > 0;
    });
  } catch {
    return [];
  }
}

function persistList(key: string, entries: RecipientEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: recipient memory is best-effort.
  }
}

export function loadRecentRecipients(): RecipientEntry[] {
  return loadList(RECENT_KEY);
}

export function loadSavedAddresses(): RecipientEntry[] {
  return loadList(SAVED_KEY);
}

/** Record a recipient after a send. Keeps recency + use count, caps the list. */
export function recordRecipient(address: string, label?: string): void {
  const trimmed = address.trim();
  if (!trimmed) return;
  const entries = loadList(RECENT_KEY).filter(item => item.address !== trimmed);
  const previous = loadList(RECENT_KEY).find(item => item.address === trimmed);
  entries.unshift({
    address: trimmed,
    label: label ?? previous?.label,
    lastUsedAt: Date.now(),
    useCount: (previous?.useCount ?? 0) + 1,
  });
  persistList(RECENT_KEY, entries.slice(0, RECENT_CAP));
}

export function saveAddress(address: string, label: string): void {
  const trimmed = address.trim();
  if (!trimmed) return;
  const entries = loadList(SAVED_KEY).filter(item => item.address !== trimmed);
  entries.unshift({ address: trimmed, label: label.trim() || undefined, lastUsedAt: Date.now(), useCount: 0 });
  persistList(SAVED_KEY, entries);
}

export function removeSavedAddress(address: string): void {
  persistList(SAVED_KEY, loadList(SAVED_KEY).filter(item => item.address !== address));
}

export interface AddressClassification {
  /** 'match' when the address belongs to this app's regtest network. */
  network: 'regtest' | 'testnet' | 'mainnet' | 'unknown';
  networkMatches: boolean;
  addressType: 'Taproot (bech32m)' | 'SegWit v0 (bech32)' | 'Legacy' | 'Unknown';
}

/** Classify a recipient address for the pre-send safety card. */
export function classifyAddress(address: string): AddressClassification {
  const value = address.trim().toLowerCase();
  const network: AddressClassification['network'] = value.startsWith('bcrt1')
    ? 'regtest'
    : value.startsWith('tb1')
      ? 'testnet'
      : value.startsWith('bc1')
        ? 'mainnet'
        : /^[mn2][a-km-z1-9]{25,34}$/.test(value) || /^[23][a-km-z1-9]{25,34}$/.test(value)
          ? 'unknown'
          : 'unknown';
  const addressType: AddressClassification['addressType'] = /^bcrt1p|^tb1p|^bc1p/.test(value)
    ? 'Taproot (bech32m)'
    : /^bcrt1q|^tb1q|^bc1q/.test(value)
      ? 'SegWit v0 (bech32)'
      : /^[mn23][a-km-z1-9]{25,34}$/.test(value)
        ? 'Legacy'
        : 'Unknown';
  return { network, networkMatches: network === 'regtest', addressType };
}

const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10;
    return rest === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ONES[rest]}`;
  }
  const rest = n % 100;
  return rest === 0 ? `${ONES[Math.floor(n / 100)]} hundred` : `${ONES[Math.floor(n / 100)]} hundred ${underThousand(rest)}`;
}

/** Exact integer sats in plain English words: 40000 -> "forty thousand sats". */
export function amountInWords(value: bigint | number): string {
  let n = typeof value === 'bigint' ? Number(value) : Math.trunc(value);
  if (!Number.isFinite(n) || n < 0) return `${value} sats`;
  if (n === 0) return 'zero sats';
  const scales: Array<[number, string]> = [[1_000_000_000, 'billion'], [1_000_000, 'million'], [1_000, 'thousand']];
  const parts: string[] = [];
  for (const [size, name] of scales) {
    const count = Math.floor(n / size);
    if (count > 0) {
      parts.push(`${underThousand(count)} ${name}`);
      n -= count * size;
    }
  }
  if (n > 0 || parts.length === 0) parts.push(underThousand(n));
  return `${parts.join(' ')} sats`;
}

/** Sats to an exact BTC decimal string (no float math): 123456789 -> "1.23456789". */
export function satsToBtc(value: bigint | number): string {
  const n = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 100_000_000n;
  const frac = (abs % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${frac ? `.${frac}` : ''}`;
}

/**
 * BIP21 payment-request URI. Amount and memo are optional; the plain
 * address is returned untouched when nothing is requested.
 */
export function buildPaymentUri(address: string, amountSats?: bigint | null, memo?: string): string {
  const params: string[] = [];
  if (amountSats !== undefined && amountSats !== null && amountSats > 0n) {
    params.push(`amount=${satsToBtc(amountSats)}`);
  }
  const trimmedMemo = memo?.trim();
  if (trimmedMemo) params.push(`message=${encodeURIComponent(trimmedMemo)}`);
  return params.length > 0 ? `bitcoin:${address}?${params.join('&')}` : address;
}
