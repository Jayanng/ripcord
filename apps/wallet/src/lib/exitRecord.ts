/**
 * Persistent local record of a vault's completed exit (public data only).
 *
 * The exit transaction is remembered here at broadcast time and re-derived
 * from the chain when needed, so Activity can show "Exited to Bitcoin L1"
 * across reloads. Mirrors the `ripcord:faucet:<address>` pattern.
 */

export interface ExitRecord {
  /** The exit transaction id. */
  txid: string;
  /** Sats that arrived at the settlement address, as a decimal string. */
  amountSats: string;
  createdAt: number;
}

export function readExitRecord(vaultKey: string): ExitRecord | null {
  try {
    const raw = window.localStorage.getItem(`ripcord:exit:${vaultKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExitRecord;
    return parsed && /^[0-9a-f]{64}$/i.test(parsed.txid) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeExitRecord(vaultKey: string, record: ExitRecord): void {
  try {
    window.localStorage.setItem(`ripcord:exit:${vaultKey}`, JSON.stringify(record));
  } catch {
    // best effort: the row is a convenience, never a safety property
  }
}
