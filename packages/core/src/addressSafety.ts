/**
 * Address safety helpers (Bounty #1, Phase 4): pure parsing and comparison
 * used by the send form's paste handling. No network, no side effects.
 */

/** First 6 and last 6 characters for highlight rendering (the middle is the risk zone). */
export function parseAddressHighlight(address: string): { head: string; mid: string; tail: string } {
  const value = address.trim();
  if (value.length <= 12) {
    return { head: value, mid: '', tail: '' };
  }
  return {
    head: value.slice(0, 6),
    mid: value.slice(6, value.length - 6),
    tail: value.slice(value.length - 6),
  };
}

/**
 * Two addresses match only by case/format drift (e.g. a pasted uppercase
 * variant of a saved address). Same ignoring case, but not identical as typed.
 */
export function differsOnlyByCase(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  return left.toLowerCase() === right.toLowerCase() && left !== right;
}

/**
 * Find a saved address this input could be a mangled copy of (case or
 * surrounding whitespace drift). Returns the saved address to warn about,
 * or null when there is nothing suspicious. Exact matches are never a warning.
 */
export function findSuspiciousVariant(
  input: string,
  savedRecipients: readonly string[],
): string | null {
  const value = input.trim();
  if (!value) return null;
  // BIP-173: an all-uppercase address is valid (common from QR codes), so it
  // is never a suspicious variant. Only mixed-case input (which is invalid
  // and smells like a mangled paste) earns a warning.
  const mixedCase = value !== value.toLowerCase() && value !== value.toUpperCase();
  if (!mixedCase) return null;
  for (const saved of savedRecipients) {
    if (differsOnlyByCase(value, saved)) return saved.trim();
  }
  return null;
}
