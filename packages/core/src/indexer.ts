/**
 * Real-time filtered WSS indexer.
 *
 * Wraps the SDK's `subscribeVaultEvents` (which has NO reconnect logic and
 * delivers a flat, decoded `VaultEvent`) with:
 *   - typed lifecycle events: `tx:pending` (height 0), `tx:committed` (height > 0),
 *     and `block:new`
 *   - auto-reconnect with exponential backoff + jitter
 *   - a bounded event queue that throws (surfaced via onError) past the bound
 *     rather than silently dropping events
 *
 * Live-probed 2026-08-22 (scratch/ripcord-probe3.mjs), and confirmed against
 * the SDK `.d.ts`:
 *
 *   - `subscribeVaultEvents` emits a flat VaultEvent. For a transfer the
 *     `type` is "transfer", `vaultAddress` is "" (a plain transfer locks no
 *     vault), and `vout` carries one entry per output with `owner` (hex
 *     pubkey) and `amountSats` (bigint).
 *   - The daemon's `txHash` in the WSS frame is LOWERCASE hex, while
 *     `waitForTachiTxCommit` / `broadcastTachiTx` return UPPERCASE hex. Always
 *     case-normalize before comparing the two.
 *   - `vout[].owner` is NOT a fixed width: Alice's change output came back as
 *     a 64-char x-only key while Bob's received output came back as a 66-char
 *     compressed key. Treat it as an opaque hex pubkey string.
 *   - The `block` event fires for every durably-committed block (observed
 *     roughly every 5 s under live regtest traffic), carrying `txCount` and
 *     the epoch it closed.
 *
 * The SDK drops a slow consumer rather than buffering; the bounded queue here
 * is the client-side guard for a consumer that drains slower than the daemon
 * publishes. `onEvent` may return a promise; events are delivered one at a
 * time in order.
 */

import {
  subscribeVaultEvents,
  type VaultEvent,
  type VaultEventSubscription,
  type WebSocketCtor,
} from '@tachibtc/taurus-vault-core';
import { RipcordError, RipcordCode } from './errors.js';
import type { PaymentReceipt, XOnlyHex, TxLookupResult, CreditClassification } from './types.js';
import type { RipcordStore } from './store.js';
import { joinDaemonUrl } from './net.js';

/** A single VTXO output credited by a `tx` event. */
export interface IndexerVout {
  /**
   * Hex-encoded owner key. NOT a fixed width: observed as both a 64-char
   * x-only key and a 66-char compressed key on the live daemon. Opaque.
   */
  readonly owner: string;
  /** Output value in satoshis. */
  readonly amountSats: bigint;
  /** Hex locking script (empty for the canonical VTXO flow). */
  readonly script: string;
}

/** Shared fields of a `tx` lifecycle event. */
export interface IndexerTxEvent {
  readonly kind: 'tx:pending' | 'tx:committed';
  /** CometBFT tx hash, lowercase hex as the daemon emits it. */
  readonly txHash: string;
  /** Daemon tx type: `transfer`, `deposit`, `vault_open`, ... */
  readonly type: string;
  /** bech32m vault address the tx concerns; "" for a plain transfer. */
  readonly vaultAddress: string;
  /** 0 while pending; the committing block height once committed. */
  readonly height: number;
  /** True only when committed (the terminal success state). */
  readonly committed: boolean;
  /** Outputs credited by this tx; empty for a deposit-style envelope. */
  readonly vout: readonly IndexerVout[];
  /** Local wall-clock (ms epoch) when this event was mapped. */
  readonly receivedAt: number;
}

/** A `block:new` event: one durably-committed block. */
export interface IndexerBlockEvent {
  readonly kind: 'block:new';
  readonly height: number;
  readonly blockHash: string;
  readonly appHash: string;
  readonly txCount: number;
  /** Epoch this block closed; undefined for a block that closed no epoch. */
  readonly epochClosed?: number;
  readonly receivedAt: number;
}

/**
 * A `vault:breach` event pushed over the `vaultId` subscription: the
 * watchtower observed an L1 spend of a vault's funding outpoint.
 * `classification` is `legitimate` | `stale` | `anomalous` per the daemon.
 */
export interface IndexerBreachEvent {
  readonly kind: 'vault:breach';
  readonly vaultId: string;
  readonly broadcastState: number;
  readonly latestState: number;
  readonly classification: string;
  readonly spendTxid: string;
  readonly spendVout: number;
  readonly detectedHeight: number;
  readonly detectedAt: number;
  readonly receivedAt: number;
}

/** A typed event emitted by the indexer. */
export type IndexerEvent = IndexerTxEvent | IndexerBlockEvent | IndexerBreachEvent;

/**
 * Map a decoded SDK `VaultEvent` to a typed `IndexerEvent`.
 * Returns null for `validator` frames, which are out of scope
 * (they are not silently coerced; the caller simply does not receive them).
 * `breach` frames map to `vault:breach` events (watchtower breach receipts).
 */
export function mapVaultEvent(raw: VaultEvent): IndexerEvent | null {
  if (raw.event === 'block' && raw.block) {
    return {
      kind: 'block:new',
      height: raw.block.height,
      blockHash: raw.block.blockHash,
      appHash: raw.block.appHash,
      txCount: raw.block.txCount,
      ...(raw.block.epochClosed !== undefined ? { epochClosed: raw.block.epochClosed } : {}),
      receivedAt: Date.now(),
    };
  }

  if (raw.event === 'breach' && raw.breach) {
    return {
      kind: 'vault:breach',
      vaultId: raw.breach.vaultId,
      broadcastState: Number(raw.breach.broadcastState),
      latestState: Number(raw.breach.latestState),
      classification: raw.breach.classification,
      spendTxid: raw.breach.spendTxid,
      spendVout: raw.breach.spendVout,
      detectedHeight: raw.breach.detectedHeight,
      detectedAt: raw.breach.detectedAt,
      receivedAt: Date.now(),
    };
  }

  if (raw.event === 'tx' || raw.state === 'pending' || raw.state === 'committed') {
    const kind: 'tx:pending' | 'tx:committed' =
      raw.state === 'committed' ? 'tx:committed' : 'tx:pending';
    return {
      kind,
      txHash: raw.txHash,
      type: raw.type,
      vaultAddress: raw.vaultAddress,
      height: raw.height,
      committed: raw.committed,
      vout: raw.vout.map(v => ({
        owner: v.owner,
        amountSats: v.amountSats,
        script: v.script,
      })),
      receivedAt: Date.now(),
    };
  }

  return null;
}

/**
 * Check if a VTXO output owner matches an identity's x-only key.
 * Handles both 64-char x-only keys and 66-char compressed keys (02/03 prefix).
 */
export function isOutputForXOnly(owner: string, identityXOnly: string): boolean {
  const normOwner = owner.toLowerCase().trim();
  const normXOnly = identityXOnly.toLowerCase().trim();
  if (normOwner === normXOnly) return true;
  if (normOwner.length === 66 && (normOwner.startsWith('02') || normOwner.startsWith('03'))) {
    return normOwner.slice(2) === normXOnly;
  }
  return false;
}

/**
 * Calculate the total satoshis credited to identityXOnly in this event's outputs.
 */
export function getIncomingAmountSats(event: IndexerTxEvent, identityXOnly: string): bigint {
  let total = 0n;
  for (const out of event.vout) {
    if (isOutputForXOnly(out.owner, identityXOnly)) {
      total += out.amountSats;
    }
  }
  return total;
}

/**
 * Check if an IndexerTxEvent credits the identity's x-only address.
 */
export function isIncomingPayment(event: IndexerTxEvent, identityXOnly: string): boolean {
  return getIncomingAmountSats(event, identityXOnly) > 0n;
}

/** Documented neutral 32-byte zero key for unspecified/external senders. */
export const NEUTRAL_FROM_XONLY = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Extra metadata that can enrich a synthesized receipt if sourced from real data
 * (e.g. /tachi_tx or /tachi_txDecode lookup).
 */
export interface SynthesizeReceiptExtra {
  readonly epoch?: number;
  readonly code?: number;
  readonly fromXOnly?: string;
  readonly feeSats?: bigint;
}

/**
 * Synthesize a PaymentReceipt from an incoming IndexerTxEvent.
 * Returns null if the event does not credit the given identity.
 *
 * RECEIPT MAPPING TABLE (CONSERVATIVE GROUND TRUTH):
 * - txHash:     event.txHash.toLowerCase() — Sourced from CometBFT event payload (case-normalized)
 * - toXOnly:    identityXOnly.toLowerCase() — Sourced from matched identity's x-only pubkey
 * - amountSats: Sum of event.vout outputs crediting toXOnly
 * - epoch:      extra?.epoch ?? (event.kind === 'tx:committed' && event.height > 0 ? event.height : 0)
 *               0 for pending transactions; block height or confirmed epoch once committed
 * - code:       extra?.code ?? 0 — Documented neutral ABCI execution code (0 = success)
 * - fromXOnly:  extra?.fromXOnly ? lower : NEUTRAL_FROM_XONLY (64-char zero hex)
 *               Incoming alerts do not carry sender inputs; external sender is neutral unless enriched
 * - feeSats:    extra?.feeSats ?? 0n — Documented neutral value (recipient pays 0 fee for incoming payment)
 * - hat / rip:  OMITTED (undefined) — Off-chain sender attestation protocol owns HAT/RIP proofs.
 *               NEVER fabricate cryptographic attestation data.
 */
export function synthesizeIncomingReceipt(
  event: IndexerTxEvent,
  identityXOnly: string,
  extra?: SynthesizeReceiptExtra,
): PaymentReceipt | null {
  const amountSats = getIncomingAmountSats(event, identityXOnly);
  if (amountSats <= 0n) return null;

  const txHash = event.txHash.toLowerCase();
  const toXOnly = identityXOnly.toLowerCase() as XOnlyHex;

  const epoch = extra?.epoch !== undefined
    ? extra.epoch
    : event.kind === 'tx:committed' && event.height > 0
    ? event.height
    : 0;

  const code = extra?.code ?? 0;
  const fromXOnly = (extra?.fromXOnly ? extra.fromXOnly.toLowerCase() : NEUTRAL_FROM_XONLY) as XOnlyHex;
  const feeSats = extra?.feeSats ?? 0n;

  return {
    txHash,
    epoch,
    code,
    fromXOnly,
    toXOnly,
    amountSats,
    feeSats,
  };
}

/**
 * Merge an existing PaymentReceipt with an updated (or incoming) PaymentReceipt.
 * Ensures:
 * - tx:pending does NOT downgrade a committed receipt
 * - tx:committed updates height/epoch and code
 * - Existing proofs (hat, rip) are preserved
 * - fromXOnly is updated if previously neutral
 * - Never double-counts or corrupts state
 */
export function mergePaymentReceipt(existing: PaymentReceipt, update: PaymentReceipt): PaymentReceipt {
  const txHash = existing.txHash.toLowerCase();
  const epoch = update.epoch > 0 ? update.epoch : existing.epoch;
  const code = update.code !== 0 ? update.code : existing.code;
  const fromXOnly = (existing.fromXOnly !== NEUTRAL_FROM_XONLY ? existing.fromXOnly : update.fromXOnly) as XOnlyHex;
  // If existing is a rich send receipt (non-neutral fromXOnly with positive amount), preserve original counterpart amounts
  const amountSats = (existing.fromXOnly !== NEUTRAL_FROM_XONLY && existing.amountSats > 0n)
    ? existing.amountSats
    : (update.amountSats > 0n ? update.amountSats : existing.amountSats);
  const feeSats = existing.feeSats > 0n ? existing.feeSats : (update.feeSats > 0n ? update.feeSats : existing.feeSats);
  const hat = existing.hat ?? update.hat;
  const rip = existing.rip ?? update.rip;

  return {
    txHash,
    epoch,
    code,
    fromXOnly,
    toXOnly: existing.toXOnly || update.toXOnly,
    amountSats,
    feeSats,
    ...(hat ? { hat } : {}),
    ...(rip ? { rip } : {}),
  };
}

/**
 * Persist a receipt to a store, merging with any existing record for that txHash.
 * Guarantees synthesized incoming receipts do not clobber richer stored records
 * (e.g. send receipts containing hat/rip attestation or recipient details).
 */
export async function saveReceiptMerged(
  store: RipcordStore,
  receipt: PaymentReceipt,
): Promise<PaymentReceipt> {
  const existingList = await store.getReceipts();
  const existing = existingList.find(r => r.txHash.toLowerCase() === receipt.txHash.toLowerCase());
  const merged = existing ? mergePaymentReceipt(existing, receipt) : receipt;
  await store.saveReceipt(merged);
  return merged;
}

/**
 * Deduplicate a receipt list against an incoming receipt by txHash (case-insensitive).
 * Updates an existing entry in-place or prepends the new receipt.
 */
export function dedupeReceiptList(receipts: readonly PaymentReceipt[], incoming: PaymentReceipt): PaymentReceipt[] {
  const incomingHash = incoming.txHash.toLowerCase();
  const index = receipts.findIndex(r => r.txHash.toLowerCase() === incomingHash);
  if (index >= 0) {
    const merged = mergePaymentReceipt(receipts[index], incoming);
    const updated = [...receipts];
    updated[index] = merged;
    return updated;
  }
  return [incoming, ...receipts];
}

/**
 * Extract the 32-byte sender x-only pubkey (hex) from a raw TachiTx wire hex string.
 *
 * Wire layout (see encodeTachiTx / TachiTx specification):
 * - version: 1 byte
 * - type: 1 byte
 * - inputsCount: 2 bytes (uint16BE)
 *   - for each input:
 *       32 bytes vtxoId + 32 bytes txid + 4 bytes vout + 8 bytes valueSats
 *       + 2 bytes sigScriptLen + sigScriptLen bytes
 * - outputsCount: 2 bytes (uint16BE)
 *   - for each output:
 *       2 bytes ownerLen + ownerLen bytes + 8 bytes amount
 *       + 2 bytes scriptLen + scriptLen bytes
 * - fee: 8 bytes
 * - nonce: 8 bytes
 * - pubKeyLen: 2 bytes (uint16BE)
 * - pubKey: pubKeyLen bytes (32 bytes)
 */
export function extractSenderPubkeyFromTachiHex(hex: string): string {
  const cleanHex = hex.trim().toLowerCase();
  if (cleanHex.length < 8) throw new Error('Hex too short for TachiTx');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 2; // version (1) + type (1)
  if (offset + 2 > bytes.length) throw new Error('Truncated inputs count');
  const inCount = view.getUint16(offset, false);
  offset += 2;

  for (let i = 0; i < inCount; i++) {
    offset += 76; // 32 (vtxoId) + 32 (txid) + 4 (vout) + 8 (valueSats)
    if (offset + 2 > bytes.length) throw new Error('Truncated input sigScript length');
    const sigLen = view.getUint16(offset, false);
    offset += 2 + sigLen;
    if (offset > bytes.length) throw new Error('Truncated input sigScript');
  }

  if (offset + 2 > bytes.length) throw new Error('Truncated outputs count');
  const outCount = view.getUint16(offset, false);
  offset += 2;

  for (let i = 0; i < outCount; i++) {
    if (offset + 2 > bytes.length) throw new Error('Truncated output owner length');
    const ownerLen = view.getUint16(offset, false);
    offset += 2 + ownerLen + 8; // ownerLen + owner + amount
    if (offset + 2 > bytes.length) throw new Error('Truncated output script length');
    const scriptLen = view.getUint16(offset, false);
    offset += 2 + scriptLen;
    if (offset > bytes.length) throw new Error('Truncated output script');
  }

  offset += 16; // fee (8) + nonce (8)
  if (offset + 2 > bytes.length) throw new Error('Truncated pubKey length');
  const pubKeyLen = view.getUint16(offset, false);
  offset += 2;
  if (offset + pubKeyLen > bytes.length) throw new Error('Truncated pubKey');

  let pubKeyHex = '';
  for (let i = 0; i < pubKeyLen; i++) {
    pubKeyHex += bytes[offset + i].toString(16).padStart(2, '0');
  }
  return pubKeyHex;
}

/**
 * Async transaction lookup helper.
 * Queries /tachi_tx on the daemon using joinDaemonUrl.
 * Extracts the sender public key (from pubkey field or raw hex) and parsed inputs/outputs.
 */
export async function lookupTachiTx(
  txHash: string,
  baseUrl: string,
  options?: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
    readonly allowInsecureHttp?: boolean;
  },
): Promise<TxLookupResult | null> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const signal = AbortSignal.timeout(timeoutMs);

  const url = `${joinDaemonUrl(baseUrl, 'tachi_tx')}?hash=${encodeURIComponent(txHash)}`;

  try {
    const res = await fetchImpl(url, { signal });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as {
      txHash?: string;
      txid?: string;
      type?: string;
      hex?: string;
      pubkey?: string;
      vin?: Array<{ vtxo_id?: string; txid?: string; vout?: number; value_sats?: number; owner?: string }>;
      vout?: Array<{ owner?: string; amount?: number; script?: string }>;
    };

    let senderPubkey = data.pubkey ? data.pubkey.toLowerCase() : '';

    if (!senderPubkey && data.hex && typeof data.hex === 'string') {
      try {
        senderPubkey = extractSenderPubkeyFromTachiHex(data.hex);
      } catch {
        // parsing failed, leave empty
      }
    }

    const vin = (data.vin ?? []).map(input => ({
      vtxoId: input.vtxo_id,
      txid: input.txid,
      vout: input.vout,
      valueSats: typeof input.value_sats === 'number' ? BigInt(input.value_sats) : undefined,
      owner: input.owner,
    }));

    const vout = (data.vout ?? []).map(output => ({
      owner: output.owner ?? '',
      amountSats: typeof output.amount === 'number' ? BigInt(output.amount) : 0n,
      script: output.script ?? '',
    }));

    return {
      txHash: data.txHash || data.txid || txHash,
      type: data.type ?? 'transfer',
      senderPubkey,
      vin,
      vout,
      raw: data,
    };
  } catch {
    return null;
  }
}

/**
 * Pure decision logic to classify transaction credits.
 *
 * POLICY (Defect 2):
 * 1. Events that do not credit the identity's outputs are classified as 'none'.
 * 2. Events whose type cannot be self-funded (e.g. 'deposit' — external L1 funding)
 *    synthesize without requiring a lookup ('incoming').
 * 3. Transfer-type events require transaction lookup to discriminate self-credits:
 *    - When ALL inputs are owned by the identity's x-only key, the credit is treated
 *      as a SELF-MOVE ('self_move'): no incoming receipt is minted, and pendingIncoming
 *      count is not incremented (the activity feed still shows the tx, as today).
 *    - When at least one input is owned by an external key, or the sender pubkey is not
 *      the identity, the credit is classified as 'incoming'.
 *    - When the lookup fails (daemon 502, network failure, timeout, 404, etc.),
 *      the policy FAILS CLOSED for receipt synthesis and pending counting on
 *      'transfer'-type events ('skip'): skip synthesis; the activity event remains visible.
 */
export function classifyCredit(
  event: IndexerTxEvent,
  lookup: TxLookupResult | null | undefined,
  identity: string | { readonly xOnly: string },
): CreditClassification {
  const identityXOnly = (typeof identity === 'string' ? identity : identity.xOnly).toLowerCase().trim();
  if (getIncomingAmountSats(event, identityXOnly) <= 0n) {
    return 'none';
  }

  // Events whose type cannot be self-funded (e.g. 'deposit' — external L1 funding)
  // synthesize without lookup.
  if (event.type === 'deposit') {
    return 'incoming';
  }

  // Transfer events (and potentially self-funded events):
  // When lookup fails, fail closed: skip synthesis and pending counting.
  if (!lookup) {
    return 'skip';
  }

  // If senderPubkey matches the identity, all inputs were owned by identity (Tachi consensus rule:
  // tx.pubKey must own all inputs or daemon rejects with code=6 unauthorized).
  if (lookup.senderPubkey && isOutputForXOnly(lookup.senderPubkey, identityXOnly)) {
    return 'self_move';
  }

  // If vin inputs explicitly specify owner and all match identity:
  if (lookup.vin && lookup.vin.length > 0 && lookup.vin.every(input => input.owner && isOutputForXOnly(input.owner, identityXOnly))) {
    return 'self_move';
  }

  // If senderPubkey is known and belongs to someone else, this is an incoming payment:
  if (lookup.senderPubkey && !isOutputForXOnly(lookup.senderPubkey, identityXOnly)) {
    return 'incoming';
  }

  // If any vin input is owned by someone else:
  if (lookup.vin && lookup.vin.length > 0 && lookup.vin.some(input => input.owner && !isOutputForXOnly(input.owner, identityXOnly))) {
    return 'incoming';
  }

  // Succeeded lookup did not provide conclusive ownership: fail closed
  return 'skip';
}


/**
 * A bounded FIFO event queue. `push` throws a QUEUE_OVERFLOW RipcordError
 * once full rather than silently dropping, so a slow consumer fails loudly
 * instead of losing events.
 */
export class BoundedEventQueue<T> {
  private readonly items: T[] = [];
  readonly maxItems: number;
  private overflowed = false;

  constructor(maxItems: number) {
    if (!Number.isInteger(maxItems) || maxItems <= 0) {
      throw new Error(`maxItems must be a positive integer, got ${maxItems}`);
    }
    this.maxItems = maxItems;
  }

  get size(): number {
    return this.items.length;
  }

  get isFull(): boolean {
    return this.items.length >= this.maxItems;
  }

  get hasOverflowed(): boolean {
    return this.overflowed;
  }

  push(item: T): void {
    if (this.items.length >= this.maxItems) {
      this.overflowed = true;
      throw new RipcordError(
        RipcordCode.QUEUE_OVERFLOW,
        `Event queue overflow: ${this.maxItems} queued events exceeded`,
        { hint: 'The consumer is draining slower than the daemon publishes. Drain and restart.' },
      );
    }
    this.items.push(item);
  }

  shift(): T | undefined {
    return this.items.shift();
  }

  clear(): void {
    this.items.length = 0;
    this.overflowed = false;
  }
}

/** Connection lifecycle status, for observability and test coordination. */
export type IndexerStatus =
  | { readonly state: 'connecting' }
  | { readonly state: 'connected' }
  | { readonly state: 'reconnecting'; readonly attempt: number; readonly delayMs: number; readonly reason: string }
  | { readonly state: 'closed'; readonly reason: string };

export interface VaultIndexerOptions {
  /** Full daemon WSS URL, e.g. `wss://rpc-regtest.tachibtc.com/tachi_ws`. */
  readonly url: string;
  /** Taproot address or x-only pubkey hex to watch for incoming vouts. */
  readonly address?: string;
  /** Vault address to watch for locks and opens. */
  readonly vault?: string;
  /** 64-char hex VaultID to watch for watchtower breach receipts. */
  readonly vaultId?: string;
  /** Subscribe to an event for every committed block (`?blocks=true`). */
  readonly blocks?: boolean;
  /** Subscribe to validator-registration events. */
  readonly validators?: boolean;
  /** Client-side event queue bound. Default 10000. Throws past the bound. */
  readonly maxQueuedEvents?: number;
  /** Base backoff delay for the first reconnect. Default 1000 ms. */
  readonly reconnectBaseDelayMs?: number;
  /** Ceiling on the exponential backoff. Default 30000 ms. */
  readonly reconnectMaxDelayMs?: number;
  /** Jitter the backoff delay. Default true. */
  readonly reconnectJitter?: boolean;
  /** Called for each typed event, one at a time, in order. */
  readonly onEvent?: (event: IndexerEvent) => void | Promise<void>;
  /** Called on socket errors, decode failures, and queue overflow. */
  readonly onError?: (error: RipcordError) => void;
  /** Called on connection lifecycle transitions. */
  readonly onStatus?: (status: IndexerStatus) => void;
  /** WebSocket implementation. Defaults to globalThis.WebSocket (Node >= 22). */
  readonly webSocketImpl?: WebSocketCtor;
  /** Opt-in to plaintext ws:// (local regtest only). */
  readonly allowInsecureHttp?: boolean;
}

const DEFAULT_MAX_QUEUED_EVENTS = 10000;
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30000;

/** The filter params the daemon's `/tachi_ws` recognises (mirrors the SDK). */
const FILTER_PARAMS = ['vault', 'address', 'vaultId', 'blocks', 'validators'] as const;

/** True when the URL query string already carries at least one filter. */
function urlHasFilter(url: string): boolean {
  try {
    const parsed = new URL(url);
    return FILTER_PARAMS.some(p => parsed.searchParams.get(p) !== null);
  } catch {
    return false;
  }
}

/**
 * Live WSS indexer with typed events, exponential-backoff reconnect, and a
 * bounded event queue.
 *
 * The SDK's `subscribeVaultEvents` throws synchronously when no filter is
 * supplied; the indexer enforces the same rule up front so the failure is a
 * clear local error rather than a socket that never opens.
 */
export class VaultIndexer {
  private readonly options: Required<Pick<VaultIndexerOptions,
    'maxQueuedEvents' | 'reconnectBaseDelayMs' | 'reconnectMaxDelayMs' | 'reconnectJitter'>> & VaultIndexerOptions;
  private readonly queue: BoundedEventQueue<IndexerEvent>;
  private sub?: VaultEventSubscription;
  private draining = false;
  private manuallyClosed = false;
  private started = false;
  private connected = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Identifies the active subscription so a stale socket event cannot mutate current state. */
  private subscriptionGeneration = 0;
  /** Prevent duplicate reconnect scheduling from repeated close/error callbacks. */
  private reconnectScheduled = false;

  constructor(options: VaultIndexerOptions) {
    if (!options.url) {
      throw new RipcordError(RipcordCode.INVALID_FORMAT, 'VaultIndexer requires a url');
    }
    if (!options.address && !options.vault && !options.vaultId && !options.blocks && !options.validators && !urlHasFilter(options.url)) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        'At least one filter is required (address, vault, vaultId, blocks, validators, or a filter in the URL query); a filterless connection is rejected by the daemon',
      );
    }
    this.options = {
      maxQueuedEvents: DEFAULT_MAX_QUEUED_EVENTS,
      reconnectBaseDelayMs: DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxDelayMs: DEFAULT_RECONNECT_MAX_MS,
      reconnectJitter: true,
      ...options,
    };
    this.queue = new BoundedEventQueue<IndexerEvent>(this.options.maxQueuedEvents);
  }

  /** Current number of queued, not-yet-delivered events. */
  get queuedCount(): number {
    return this.queue.size;
  }

  /** The underlying socket, for anything this wrapper does not cover. */
  get socket(): VaultEventSubscription['socket'] | undefined {
    return this.sub?.socket;
  }

  /** True once the WebSocket handshake has actually completed. */
  get isConnected(): boolean {
    return this.connected;
  }

  /** Open (or reopen) the subscription. Idempotent. */
  start(): void {
    if (this.started && this.sub !== undefined && !this.manuallyClosed) {
      return;
    }
    this.manuallyClosed = false;
    this.started = true;
    this.open();
  }

  /** Close the socket and stop delivering events. Idempotent; no reconnect. */
  close(): void {
    this.closeWithReason('closed by caller');
  }

  /** Stop the flow and emit a single terminal 'closed' status. */
  private closeWithReason(reason: string): void {
    this.manuallyClosed = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectScheduled = false;
    this.subscriptionGeneration++;
    try {
      this.sub?.close();
    } catch {
      /* already closed */
    }
    this.sub = undefined;
    this.emitStatus({ state: 'closed', reason });
  }

  private open(): void {
    if (this.manuallyClosed) return;
    this.connected = false;
    this.reconnectScheduled = false;
    const generation = ++this.subscriptionGeneration;
    this.emitStatus({ state: 'connecting' });
    let sub: VaultEventSubscription;
    try {
      sub = subscribeVaultEvents({
        url: this.options.url,
        ...(this.options.address ? { address: this.options.address } : {}),
        ...(this.options.vault ? { vault: this.options.vault } : {}),
        ...(this.options.vaultId ? { vaultId: this.options.vaultId } : {}),
        ...(this.options.blocks ? { blocks: this.options.blocks } : {}),
        ...(this.options.validators ? { validators: this.options.validators } : {}),
        ...(this.options.webSocketImpl ? { webSocketImpl: this.options.webSocketImpl } : {}),
        ...(this.options.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
        onEvent: raw => {
          if (generation === this.subscriptionGeneration) this.handleEvent(raw);
        },
        onError: err => {
          if (generation === this.subscriptionGeneration) this.handleError(err);
        },
        onClose: () => {
          if (generation === this.subscriptionGeneration) this.handleClose(generation);
        },
      });
    } catch (err) {
      this.handleError(err);
      this.scheduleReconnect('subscribeVaultEvents threw');
      return;
    }
    this.sub = sub;
    this.bindOpenSignal(sub.socket, generation);
  }

  /**
   * The SDK hands back the raw socket; emit 'connected' only once the WS
   * handshake actually completes (the push-only stream replays nothing, so a
   * caller must know it is safe to broadcast only after this fires).
   */
  private bindOpenSignal(socket: VaultEventSubscription['socket'], generation: number): void {
    const onOpen = () => {
      if (generation === this.subscriptionGeneration) this.onSocketOpen();
    };
    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('open', onOpen);
    } else if (typeof socket.on === 'function') {
      socket.on('open', onOpen);
    } else {
      onOpen();
    }
  }

  /** The socket actually opened: reset backoff and flip the connected flag. */
  private onSocketOpen(): void {
    if (this.manuallyClosed) {
      return;
    }
    this.connected = true;
    // Reset only now, on a real connection. Resetting in open() would keep the
    // backoff pinned at the base delay when the handshake fails repeatedly.
    this.reconnectAttempt = 0;
    this.emitStatus({ state: 'connected' });
  }

  private handleEvent(raw: VaultEvent): void {
    const mapped = mapVaultEvent(raw);
    if (!mapped) {
      return;
    }
    try {
      this.queue.push(mapped);
    } catch (err) {
      // Past the bound: surface loudly and stop the flow. Never silently drop.
      this.handleError(err);
      this.closeWithReason('queue overflow');
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (!this.manuallyClosed && this.queue.size > 0) {
        const event = this.queue.shift()!;
        try {
          await this.options.onEvent?.(event);
        } catch (err) {
          this.handleError(err);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private handleError(err: unknown): void {
    const ripcordErr =
      err instanceof RipcordError ? err : new RipcordError(RipcordCode.UNKNOWN, toMessage(err), { cause: err });
    try {
      this.options.onError?.(ripcordErr);
    } catch {
      // A throwing onError must not break the indexer's own error handling,
      // e.g. the queue-overflow close path that runs immediately after this.
    }
  }

  private handleClose(generation: number): void {
    if (generation !== this.subscriptionGeneration) return;
    this.connected = false;
    if (this.manuallyClosed) {
      this.sub = undefined;
      return; // closeWithReason already emitted the terminal 'closed'
    }
    this.sub = undefined;
    this.scheduleReconnect('socket closed');
  }

  private scheduleReconnect(reason: string): void {
    if (this.manuallyClosed || this.reconnectScheduled) {
      return;
    }
    this.reconnectScheduled = true;
    const attempt = ++this.reconnectAttempt;
    const delayMs = this.computeBackoff(attempt);
    this.emitStatus({ state: 'reconnecting', attempt, delayMs, reason });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectScheduled = false;
      if (!this.manuallyClosed) {
        this.open();
      }
    }, delayMs);
  }

  private computeBackoff(attempt: number): number {
    const base = this.options.reconnectBaseDelayMs;
    const max = this.options.reconnectMaxDelayMs;
    const exp = base * Math.pow(2, attempt - 1);
    const capped = Math.min(max, exp);
    if (!this.options.reconnectJitter) {
      return capped;
    }
    // Full jitter in [0, capped] smooths thundering-herd reconnects.
    return Math.floor(Math.random() * capped);
  }

  private emitStatus(status: IndexerStatus): void {
    this.options.onStatus?.(status);
  }
}

function toMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'Unknown error';
}
