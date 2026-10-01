/**
 * Idle auto-lock timer (Bounty #1, Phase 4).
 *
 * Pure timer logic: arm it, reset it on interaction, dispose it on unmount.
 * The wallet layer decides what "lock" means (clearing keys from memory so
 * "keys never stored" stays perfectly true).
 */

export interface IdleTimer {
  /** Call on any user interaction: restarts the countdown. */
  reset(): void;
  /** Stop the timer (component unmount). */
  dispose(): void;
  /** Milliseconds until the next idle fire (for tests and debugging). */
  remaining(now?: number): number;
}

export interface IdleTimerOptions {
  timeoutMs: number;
  onIdle: () => void;
  /** Injectable for tests. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const IDLE_CHOICES_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000] as const;
export const IDLE_DEFAULT_MS = 5 * 60_000;

export function createIdleTimer(options: IdleTimerOptions): IdleTimer {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const timeoutMs = Math.max(1000, options.timeoutMs);

  let handle: unknown = null;
  let armedAt = now();

  const arm = () => {
    if (handle !== null) clearTimer(handle);
    armedAt = now();
    handle = setTimer(() => {
      handle = null;
      options.onIdle();
    }, timeoutMs);
  };

  arm();

  return {
    reset: arm,
    dispose: () => {
      if (handle !== null) clearTimer(handle);
      handle = null;
    },
    remaining: (at?: number) => {
      const point = at ?? now();
      return Math.max(0, armedAt + timeoutMs - point);
    },
  };
}
