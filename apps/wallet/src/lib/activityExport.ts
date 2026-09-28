/**
 * Activity evidence export (Phase 8, #15). Serializes the displayed evidence
 * stream to CSV or JSON with no field invention: unknown fields are dropped,
 * bigint amounts become exact decimal strings.
 */

export interface ExportableActivity {
  readonly kind: string;
  readonly when: string;
  readonly reference: string;
  readonly amountSats: string;
  readonly detail: string;
}

function isoOrEmpty(ms: number | undefined): string {
  return ms && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
}

/** Flatten the mixed activity item union into stable export columns. */
export function toExportable(item: unknown): ExportableActivity {
  const record = (item ?? {}) as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind : 'receipt';
  const amount = record.amountSats;
  const amountSats = typeof amount === 'bigint' ? amount.toString() : typeof amount === 'number' ? String(Math.trunc(amount)) : '';
  const reference =
    (typeof record.txHash === 'string' && record.txHash) ||
    (typeof record.spendTxid === 'string' && record.spendTxid) ||
    (typeof record.id === 'string' && record.id) ||
    (typeof record.hash === 'string' && record.hash) ||
    '';
  const when =
    isoOrEmpty(typeof record.receivedAt === 'number' ? record.receivedAt : undefined) ||
    isoOrEmpty(typeof record.createdAt === 'number' ? record.createdAt : undefined) ||
    isoOrEmpty(typeof record.detectedAt === 'number' && record.detectedAt > 1e12 ? record.detectedAt : typeof record.detectedAt === 'number' ? record.detectedAt * 1000 : undefined);
  const detailParts: string[] = [];
  if (typeof record.type === 'string' && record.type) detailParts.push(`type=${record.type}`);
  if (typeof record.state === 'string' && record.state) detailParts.push(`state=${record.state}`);
  if (typeof record.classification === 'string' && record.classification) detailParts.push(`classification=${record.classification}`);
  if (typeof record.height === 'number') detailParts.push(`height=${record.height}`);
  if (typeof record.epoch === 'number') detailParts.push(`epoch=${record.epoch}`);
  return { kind, when, reference, amountSats, detail: detailParts.join(' ') };
}

export function activitiesToJson(items: readonly unknown[]): string {
  return JSON.stringify(items.map(toExportable), null, 2);
}

export function activitiesToCsv(items: readonly unknown[]): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const header = 'kind,when_utc,reference,amount_sats,detail';
  const rows = items.map(item => {
    const row = toExportable(item);
    return [row.kind, row.when, row.reference, row.amountSats, row.detail].map(escape).join(',');
  });
  return [header, ...rows].join('\n');
}

/** Trigger a client-side download of the given text. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
