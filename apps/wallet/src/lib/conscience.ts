/**
 * Spend Conscience settings and the local send log (public data only).
 *
 * Settings are off by default: until the user opts in, sending behaves
 * exactly as before. The send log (timestamps + amounts) powers the rolling
 * 24-hour limit and the "recent checks" list; it stays on this device.
 */
import {
  DEFAULT_CONSCIENCE_SETTINGS,
  rolling24hSentSats,
  type ConscienceSettings,
} from '@ripcord/core/spend-conscience';

const SETTINGS_KEY = 'ripcord:conscience-settings';
const LOG_KEY = 'ripcord:conscience-log';

interface StoredSettings {
  perTxLimitSats?: string | null;
  dailyLimitSats?: string | null;
  newRecipientWarn?: boolean;
  largeFractionWarn?: boolean;
  largeFractionPct?: number;
}

export interface SpendLogEntry {
  at: number;
  amountSats: string;
  recipient: string;
  /** Whether every conscience rule passed at send time. */
  allPassed: boolean;
  /** How many rules actually ran (0 = no rules were set: not a 'pass'). */
  rulesRun: number;
}

function parseBigOr(value: string | null | undefined, fallback: bigint | null): bigint | null {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return fallback;
  }
}

export function loadConscienceSettings(): ConscienceSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_CONSCIENCE_SETTINGS;
    const parsed = JSON.parse(raw) as StoredSettings;
    return {
      perTxLimitSats: parseBigOr(parsed.perTxLimitSats, null),
      dailyLimitSats: parseBigOr(parsed.dailyLimitSats, null),
      newRecipientWarn: parsed.newRecipientWarn === true,
      largeFractionWarn: parsed.largeFractionWarn === true,
      largeFractionPct:
        typeof parsed.largeFractionPct === 'number' && parsed.largeFractionPct > 0 && parsed.largeFractionPct <= 100
          ? parsed.largeFractionPct
          : DEFAULT_CONSCIENCE_SETTINGS.largeFractionPct,
    };
  } catch {
    return DEFAULT_CONSCIENCE_SETTINGS;
  }
}

export function saveConscienceSettings(settings: ConscienceSettings): void {
  try {
    const stored: StoredSettings = {
      perTxLimitSats: settings.perTxLimitSats !== null ? settings.perTxLimitSats.toString() : null,
      dailyLimitSats: settings.dailyLimitSats !== null ? settings.dailyLimitSats.toString() : null,
      newRecipientWarn: settings.newRecipientWarn,
      largeFractionWarn: settings.largeFractionWarn,
      largeFractionPct: settings.largeFractionPct,
    };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  } catch {
    // best effort
  }
}

export function loadSpendLog(): SpendLogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Per-entry hardening: one corrupted row must never throw here, because
    // this runs inside the send path (second-eye review: a throw here BLOCKS
    // sends until storage is cleared).
    return parsed.filter((e): e is SpendLogEntry => {
      try {
        const row = e as SpendLogEntry;
        return typeof row?.at === 'number' && typeof row?.amountSats === 'string' && /^[0-9]+$/.test(row.amountSats);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Record a send with its check outcome (bounded, newest kept). */
export function recordSpend(entry: SpendLogEntry): void {
  try {
    // 500 entries: the rolling 24h window must not lose sends to a small cap.
    const next = [entry, ...loadSpendLog()].slice(0, 500);
    window.localStorage.setItem(LOG_KEY, JSON.stringify(next));
  } catch {
    // best effort
  }
}

/** Sats sent in the rolling 24h window, from the local send log. */
export function sentLast24hSats(now = Date.now()): bigint {
  // Never throws: worst case the window reports 0 and the rule undercounts.
  try {
    return rolling24hSentSats(
      loadSpendLog().map(e => ({ amountSats: BigInt(e.amountSats), at: e.at })),
      now,
    );
  } catch {
    return 0n;
  }
}
