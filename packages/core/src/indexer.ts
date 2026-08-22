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

/** A typed event emitted by the indexer. */
export type IndexerEvent = IndexerTxEvent | IndexerBlockEvent;

/**
 * Map a decoded SDK `VaultEvent` to a typed `IndexerEvent`.
 * Returns null for `validator` and `breach` frames, which are out of scope
 * for the Phase 7 indexer (they are not silently coerced; the caller simply
 * does not receive them).
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
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

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

  /** True once the socket has connected at least once. */
  get isConnected(): boolean {
    return this.started && this.sub !== undefined && !this.manuallyClosed;
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
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    try {
      this.sub?.close();
    } catch {
      /* already closed */
    }
    this.sub = undefined;
    this.emitStatus({ state: 'closed', reason: 'closed by caller' });
  }

  private open(): void {
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
        onEvent: raw => this.handleEvent(raw),
        onError: err => this.handleError(err),
        onClose: () => this.handleClose(),
      });
    } catch (err) {
      this.handleError(err);
      this.scheduleReconnect('subscribeVaultEvents threw');
      return;
    }
    this.sub = sub;
    this.reconnectAttempt = 0;
    this.bindOpenSignal(sub.socket);
  }

  /**
   * The SDK hands back the raw socket; emit 'connected' only once the WS
   * handshake actually completes (the push-only stream replays nothing, so a
   * caller must know it is safe to broadcast only after this fires).
   */
  private bindOpenSignal(socket: VaultEventSubscription['socket']): void {
    const onOpen = () => {
      if (!this.manuallyClosed) {
        this.emitStatus({ state: 'connected' });
      }
    };
    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('open', onOpen);
    } else if (typeof socket.on === 'function') {
      socket.on('open', onOpen);
    } else {
      onOpen();
    }
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
      this.close();
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
    this.options.onError?.(ripcordErr);
  }

  private handleClose(): void {
    if (this.manuallyClosed) {
      this.sub = undefined;
      this.emitStatus({ state: 'closed', reason: 'closed by caller' });
      return;
    }
    this.sub = undefined;
    this.scheduleReconnect('socket closed');
  }

  private scheduleReconnect(reason: string): void {
    if (this.manuallyClosed) {
      return;
    }
    const attempt = ++this.reconnectAttempt;
    const delayMs = this.computeBackoff(attempt);
    this.emitStatus({ state: 'reconnecting', attempt, delayMs, reason });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
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
