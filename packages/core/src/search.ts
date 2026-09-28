/**
 * In-wallet protocol search over `GET /tachi_search?q=` (Phase 8).
 *
 * Live-probed 2026-09-28 against the regtest daemon:
 *   - `?q=14360`            -> `{"type":"block","result":{"hash":...,"height":14360,"time":...}}`
 *   - `?q=<64hex>` (tx)     -> `{"type":"tx","result":{"txHash":"<UPPER>","txid":"<lower>",
 *                               "type":"vault_open","state":...}}`
 *   - `?q=<vtxoId>`         -> `{"type":"vtxo","result":{"Amount":1000,"Height":...,"ID":[byte,...],
 *                               "Owner":"<base64>","Spent":false,...}}` (Go struct, PascalCase,
 *                               ID serialized as a raw byte array)
 *   - `?q=<64hex xonly>`    -> `{"type":"address","result":{"balance_sat":...,"pubkey":...,
 *                               "vtxo_count":...}}`
 *   - miss                  -> plain text `not found: <q>` (observed with HTTP 404;
 *                              the body discriminates, not the status code)
 *
 * The decoder tolerates unknown result shapes by falling back to a generic
 * `unknown` result carrying the raw JSON - never invent fields.
 */

import { joinDaemonUrl, describeDaemonFailure } from './net.js';

export type ChainSearchKind = 'block' | 'tx' | 'vtxo' | 'address' | 'epoch' | 'not-found' | 'unknown';

export interface ChainSearchBlockResult {
  readonly kind: 'block';
  readonly hash: string;
  readonly height: number;
  readonly time: number;
}

export interface ChainSearchTxResult {
  readonly kind: 'tx';
  readonly txHash: string;
  readonly txid: string;
  readonly type: string;
  readonly state: string;
  readonly height: number;
  readonly raw: Record<string, unknown>;
}

export interface ChainSearchVtxoResult {
  readonly kind: 'vtxo';
  readonly amountSats: bigint;
  readonly height: number;
  readonly owner: string;
  readonly spent: boolean;
  readonly idHex: string;
  readonly raw: Record<string, unknown>;
}

export interface ChainSearchAddressResult {
  readonly kind: 'address';
  readonly pubkey: string;
  readonly balanceSats: bigint;
  readonly vtxoCount: number;
}

export interface ChainSearchNotFound {
  readonly kind: 'not-found';
  readonly query: string;
}

export interface ChainSearchUnknown {
  readonly kind: 'unknown';
  readonly typeLabel: string;
  readonly raw: unknown;
}

export type ChainSearchResult =
  | ChainSearchBlockResult
  | ChainSearchTxResult
  | ChainSearchVtxoResult
  | ChainSearchAddressResult
  | ChainSearchNotFound
  | ChainSearchUnknown;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** vtxo IDs arrive as a raw byte array from the Go struct; expose hex. */
function idArrayToHex(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map(byte => (typeof byte === 'number' ? byte : 0)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeResult(type: string, payload: unknown): ChainSearchResult {
  const record = asRecord(payload);
  if (type === 'block' && record) {
    return {
      kind: 'block',
      hash: asString(record.hash ?? record.Hash),
      height: asNumber(record.height ?? record.Height),
      time: asNumber(record.time ?? record.Time),
    };
  }
  if (type === 'tx' && record) {
    return {
      kind: 'tx',
      txHash: asString(record.txHash ?? record.TxHash ?? record.Hash),
      txid: asString(record.txid ?? record.Txid ?? record.TxID),
      type: asString(record.type ?? record.Type),
      state: asString(record.state ?? record.State),
      height: asNumber(record.height ?? record.Height),
      raw: record,
    };
  }
  if (type === 'vtxo' && record) {
    return {
      kind: 'vtxo',
      amountSats: BigInt(asNumber(record.Amount ?? record.amount ?? record.amountSats)),
      height: asNumber(record.Height ?? record.height),
      owner: asString(record.Owner ?? record.owner),
      spent: Boolean(record.Spent ?? record.spent ?? false),
      idHex: idArrayToHex(record.ID ?? record.id),
      raw: record,
    };
  }
  if (type === 'address' && record) {
    return {
      kind: 'address',
      pubkey: asString(record.pubkey ?? record.Pubkey ?? record.pubKey),
      balanceSats: BigInt(asNumber(record.balance_sat ?? record.balanceSat ?? record.BalanceSat)),
      vtxoCount: asNumber(record.vtxo_count ?? record.vtxoCount ?? record.VTXOCount),
    };
  }
  return { kind: 'unknown', typeLabel: type || '(none)', raw: payload };
}

/**
 * Query the daemon's protocol search. Resolves to a typed result; a miss is
 * a normal `not-found` result, not an error. Transport failures throw.
 */
export async function searchChain(
  baseUrl: string,
  query: string,
  options?: { allowInsecureHttp?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<ChainSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { kind: 'not-found', query: '' };
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const url = joinDaemonUrl(baseUrl, `tachi_search?q=${encodeURIComponent(trimmed)}`);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`Protocol search failed: ${describeDaemonFailure(error)}`);
  }
  const text = (await response.text()).trim();
  // Misses come back as plain text `not found: <q>` (observed with HTTP 404).
  // The body, not the status code, is the discriminator.
  if (!text.startsWith('{')) {
    if (text.toLowerCase().startsWith('not found')) return { kind: 'not-found', query: trimmed };
    if (!response.ok) throw new Error(`Protocol search failed: HTTP ${response.status}`);
    return { kind: 'unknown', typeLabel: '(unparseable)', raw: text };
  }
  if (!response.ok) {
    throw new Error(`Protocol search failed: HTTP ${response.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unknown', typeLabel: '(unparseable)', raw: text };
  }
  const envelope = asRecord(parsed);
  if (!envelope) return { kind: 'unknown', typeLabel: '(malformed)', raw: parsed };
  return decodeResult(asString(envelope.type), envelope.result);
}
