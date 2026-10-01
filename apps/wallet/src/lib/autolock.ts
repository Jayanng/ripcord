/**
 * Auto-lock settings and interaction wiring (Bounty #1, Phase 4).
 *
 * RAM-only by design: "locking" simply stops the timer and lets the wallet
 * clear the in-memory identity, so "keys never stored" stays perfectly true.
 * No PIN, no stored secret. Settings persist; keys never do.
 */
import { IDLE_CHOICES_MS, IDLE_DEFAULT_MS } from '@ripcord/core/idle-timer';

const SETTINGS_KEY = 'ripcord:autolock';

export interface AutoLockSettings {
  /** false = auto-lock off. */
  enabled: boolean;
  /** One of IDLE_CHOICES_MS in minutes. */
  minutes: number;
}

export const AUTOLOCK_CHOICES_MINUTES = [2, 5, 15] as const;

export function loadAutoLockSettings(): AutoLockSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { enabled: true, minutes: IDLE_DEFAULT_MS / 60_000 };
    const parsed = JSON.parse(raw) as Partial<AutoLockSettings>;
    const minutes = typeof parsed.minutes === 'number' && AUTOLOCK_CHOICES_MINUTES.includes(parsed.minutes as 2 | 5 | 15)
      ? parsed.minutes
      : IDLE_DEFAULT_MS / 60_000;
    return { enabled: parsed.enabled !== false, minutes };
  } catch {
    return { enabled: true, minutes: IDLE_DEFAULT_MS / 60_000 };
  }
}

export function saveAutoLockSettings(settings: AutoLockSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // best effort
  }
}

/** Cycle 2 -> 5 -> 15 -> off -> 2 ... for the header pill. */
export function cycleAutoLock(current: AutoLockSettings): AutoLockSettings {
  if (!current.enabled) return { enabled: true, minutes: 2 };
  const index = AUTOLOCK_CHOICES_MINUTES.indexOf(current.minutes as 2 | 5 | 15);
  if (index < AUTOLOCK_CHOICES_MINUTES.length - 1) {
    return { enabled: true, minutes: AUTOLOCK_CHOICES_MINUTES[index + 1] };
  }
  return { enabled: false, minutes: current.minutes };
}

/** Events that count as "the user is here" and reset the idle countdown. */
export const AUTOLOCK_INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export { IDLE_CHOICES_MS, IDLE_DEFAULT_MS };
