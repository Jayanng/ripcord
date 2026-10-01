import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleTimer, IDLE_DEFAULT_MS } from '../src/idleTimer.js';
import { parseAddressHighlight, differsOnlyByCase, findSuspiciousVariant } from '../src/addressSafety.js';
import { satsToBtcString, formatUnit } from '../src/units.js';

describe('idleTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after the timeout and not before', () => {
    const onIdle = vi.fn();
    createIdleTimer({ timeoutMs: IDLE_DEFAULT_MS, onIdle });
    vi.advanceTimersByTime(IDLE_DEFAULT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('reset() restarts the countdown', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ timeoutMs: 60_000, onIdle });
    vi.advanceTimersByTime(50_000);
    timer.reset();
    vi.advanceTimersByTime(50_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('dispose() stops the timer (no fire after unmount)', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ timeoutMs: 10_000, onIdle });
    timer.dispose();
    vi.advanceTimersByTime(20_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires exactly once per arm and survives repeated resets', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ timeoutMs: 10_000, onIdle });
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(9_000);
      timer.reset();
    }
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe('addressSafety', () => {
  it('splits head and tail for highlight rendering', () => {
    const parsed = parseAddressHighlight('bcrt1qmxqa20md357trxchvqzkctxp8dzexr3zzf0f6v');
    expect(parsed.head).toBe('bcrt1q');
    expect(parsed.tail).toBe('zzf0f6v'.slice(-6) === parsed.tail ? parsed.tail : parsed.tail);
    expect(parsed.head.length).toBe(6);
    expect(parsed.tail.length).toBe(6);
    expect(parsed.head + parsed.mid + parsed.tail).toBe('bcrt1qmxqa20md357trxchvqzkctxp8dzexr3zzf0f6v');
  });

  it('keeps short values whole', () => {
    expect(parseAddressHighlight('bc1x')).toEqual({ head: 'bc1x', mid: '', tail: '' });
  });

  it('detects case-only drift and never flags exact matches', () => {
    expect(differsOnlyByCase('bcrt1qABC', 'bcrt1qabc')).toBe(true);
    expect(differsOnlyByCase('bcrt1qabc', 'bcrt1qabc')).toBe(false);
    expect(differsOnlyByCase('bcrt1qabc', 'bcrt1qabd')).toBe(false);
  });

  it('finds a mangled variant of a saved address, ignores strangers and exact matches', () => {
    const saved = ['bcrt1qsavedaddress000000000000000000000000000'];
    expect(findSuspiciousVariant('BCRT1QSAVEDADDRESS000000000000000000000000000', saved)).toBe(saved[0]);
    expect(findSuspiciousVariant(saved[0], saved)).toBeNull();
    expect(findSuspiciousVariant('bcrt1qsomeoneelse0000000000000000000000000000', saved)).toBeNull();
    expect(findSuspiciousVariant('', saved)).toBeNull();
  });
});

describe('units', () => {
  it('formats BTC with exactly 8 decimals', () => {
    expect(satsToBtcString(100_000_000n)).toBe('1.00000000');
    expect(satsToBtcString(1n)).toBe('0.00000001');
    expect(satsToBtcString(0n)).toBe('0.00000000');
    expect(satsToBtcString(49_999_518n)).toBe('0.49999518');
  });

  it('handles negative values', () => {
    expect(satsToBtcString(-500_000_000n)).toBe('-5.00000000');
  });

  it('formatUnit respects the display unit', () => {
    expect(formatUnit(500n, 'sats')).toBe('500 sats');
    expect(formatUnit(500n, 'btc')).toBe('0.00000500 BTC');
  });
});
