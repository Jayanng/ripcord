/**
 * Public-data persistence store.
 *
 * `RipcordStore` is the interface the wallet layers on top of to cache vault
 * records, payment receipts, and (future) VTXO snapshots. It stores ONLY
 * public data: a `VaultRecord` carries public keys, tapscript leaves, control
 * blocks, and funding outpoints; a `PaymentReceipt` carries tx hashes and
 * proof commitments. No mnemonic, seed, or private key ever enters a store —
 * those live in memory only (see `keys.ts` / the signer).
 *
 * Two implementations:
 *   - `MemoryStore` for Node and tests, with `exportSnapshot` /
 *     `fromSnapshot` so a real reboot (or a test-simulated one) round-trips
 *     through `serializeJson` / `deserializeJson` (bigint-safe, `bytes.ts`).
 *   - `IndexedDbStore` for the browser, persisted natively by IndexedDB.
 */

import type { VaultRecord, PaymentReceipt } from './types.js';
import { serializeJson, deserializeJson } from './bytes.js';

/**
 * Canonical vault record key: the funding identity (`vaultIdHex`, unique per
 * funding outpoint) when funded, else `address:createdAt` for a derived
 * record. Multiple funding records MAY share one address (they are distinct
 * vault ids), so the store must never key by address alone.
 */
export function vaultStoreKey(vault: VaultRecord): string {
  if (!vault || typeof vault !== 'object') return 'corrupt-row';
  return vault.vaultIdHex || `${vault.address}:${vault.createdAt}`;
}

/** The key a record had BEFORE funding assigned it a vault id. */
function preFundingStoreKey(vault: VaultRecord): string {
  return `${vault.address}:${vault.createdAt}`;
}

/** Persistence contract: public data only, never secret keys. */
export interface RipcordStore {
  getVaults(): Promise<VaultRecord[]>;
  saveVault(vault: VaultRecord): Promise<void>;
  getReceipts(): Promise<PaymentReceipt[]>;
  saveReceipt(receipt: PaymentReceipt): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory store for Node and tests. Persistence is explicit: capture the
 * snapshot string, then rebuild with `MemoryStore.fromSnapshot`.
 */
function clonePublic<T>(value: T): T {
  // Use the same lossless path as reboot snapshots. MemoryStore must not expose
  // its internal mutable objects to callers, especially because VaultRecord.p2tr
  // contains nested Buffer fields and receipts contain bigint values.
  return deserializeJson<T>(serializeJson(value));
}

export class MemoryStore implements RipcordStore {
  private readonly vaults = new Map<string, VaultRecord>();
  private readonly receipts = new Map<string, PaymentReceipt>();

  async getVaults(): Promise<VaultRecord[]> {
    return [...this.vaults.values()].map(vault => clonePublic(vault));
  }

  async saveVault(vault: VaultRecord): Promise<void> {
    const stored = clonePublic(vault);
    const key = vaultStoreKey(stored);
    // A record that just gained its vaultId changes keys (address:createdAt ->
    // vaultIdHex). Drop the pre-funding row so the same record cannot appear
    // twice after funding.
    if (stored.vaultIdHex) {
      this.vaults.delete(preFundingStoreKey(stored));
    }
    this.vaults.set(key, stored);
  }

  async getReceipts(): Promise<PaymentReceipt[]> {
    return [...this.receipts.values()].map(receipt => clonePublic(receipt));
  }

  async saveReceipt(receipt: PaymentReceipt): Promise<void> {
    // txHash case is inconsistent across the daemon (WSS lowercase, REST
    // uppercase); canonicalise to lowercase so the key is stable and a re-save
    // cannot mint a duplicate. Matches IndexedDbStore, which keys on txHash.
    const normalized = clonePublic({ ...receipt, txHash: receipt.txHash.toLowerCase() });
    this.receipts.set(normalized.txHash, normalized);
  }

  async clear(): Promise<void> {
    this.vaults.clear();
    this.receipts.clear();
  }

  /** Bigint-safe serialization of the whole store (reboot persistence). */
  exportSnapshot(): string {
    return serializeJson({
      vaults: [...this.vaults.values()],
      receipts: [...this.receipts.values()],
    });
  }

  static fromSnapshot(json: string): MemoryStore {
    const store = new MemoryStore();
    const data = deserializeJson<{ vaults: VaultRecord[]; receipts: PaymentReceipt[] }>(json);
    for (const vault of data.vaults) {
      const stored = clonePublic(vault);
      store.vaults.set(vaultStoreKey(stored), stored);
    }
    // Same transition rule as saveVault: a funded record must not coexist with
    // its own pre-funding incarnation (a snapshot written by older code could
    // contain both rows for one record). Applied after the inserts so the array
    // order of the two incarnations cannot matter.
    for (const stored of store.vaults.values()) {
      if (stored.vaultIdHex) {
        store.vaults.delete(preFundingStoreKey(stored));
      }
    }
    for (const receipt of data.receipts) {
      const stored = clonePublic({ ...receipt, txHash: receipt.txHash.toLowerCase() });
      store.receipts.set(stored.txHash, stored);
    }
    return store;
  }
}

/*
 * Minimal structural IndexedDB surface. Declared locally (rather than pulling
 * in the DOM lib) so the shared core still typechecks against @types/node in
 * the Node build; the browser supplies the real `indexedDB` at runtime.
 */
interface IdbRequestLike {
  readonly result: unknown;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

interface IdbObjectStoreLike {
  /** Out-of-line keys pass `key`; keyPath stores omit it. */
  put(value: unknown, key?: string): IdbRequestLike;
  get(key: string): IdbRequestLike;
  getAll(): IdbRequestLike;
  getAllKeys(): IdbRequestLike;
  delete(key: string): IdbRequestLike;
  clear(): IdbRequestLike;
}

interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike;
  oncomplete: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
}

interface IdbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: { keyPath?: string }): IdbObjectStoreLike;
  deleteObjectStore(name: string): void;
  transaction(storeNames: string | string[], mode: string): IdbTransactionLike;
  close(): void;
  onversionchange: (() => void) | null;
}

interface IdbOpenDbRequestLike {
  readonly result: IdbDatabaseLike;
  readonly transaction: IdbTransactionLike | null;
  onupgradeneeded: ((event: unknown) => void) | null;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenDbRequestLike;
}

const VAULT_STORE = 'vaults';
const RECEIPT_STORE = 'receipts';
// v2: vault rows re-keyed by funding identity (vaultStoreKey) instead of
// address. v1 keyed by `address`, which collapsed sibling funding records
// sharing one address into a single row (silent record loss).
const DB_VERSION = 2;

function resolveIdbFactory(): IdbFactoryLike {
  const g = globalThis as unknown as { indexedDB?: IdbFactoryLike };
  if (!g.indexedDB) {
    throw new Error('IndexedDbStore requires an IndexedDB implementation (browser environment)');
  }
  return g.indexedDB;
}

/**
 * Browser store backed by IndexedDB. Native persistence across page reloads;
 * no snapshot export needed. Not exercised by the Node vitest run — it is
 * verified in-browser when the wallet app (Phase 10+) loads.
 */
export class IndexedDbStore implements RipcordStore {
  private readonly factory: IdbFactoryLike;
  private readonly dbName: string;
  private dbPromise?: Promise<IdbDatabaseLike>;

  constructor(options?: { dbName?: string }) {
    this.factory = resolveIdbFactory();
    this.dbName = options?.dbName ?? 'ripcord';
  }

  private openDb(): Promise<IdbDatabaseLike> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = new Promise<IdbDatabaseLike>((resolve, reject) => {
      const req = this.factory.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const versionTx = req.transaction;
        if (!db.objectStoreNames.contains(VAULT_STORE)) {
          // Out-of-line keys under vaultStoreKey(record): funding identity,
          // never the address (siblings may share one).
          db.createObjectStore(VAULT_STORE);
        } else if (versionTx) {
          // v1 -> v2 migration: the old store keyed by `address` (IN-LINE
          // keys). An object store's keyPath is immutable, so the store MUST
          // be recreated to re-key rows; an in-place put(row, key) on an
          // in-line store throws DataError and had already deleted the row.
          //
          // Safe sequence (second-eye review 2026-10-02):
          // 1. Read ALL rows first, before anything is deleted.
          // 2. Recreate the store out-of-line.
          // 3. Re-insert each row inside its own try/catch so one bad row
          //    cannot cost the rest (the old loop aborted mid-way on throw).
          // The versionchange transaction is atomic: if this page dies at any
          // point, the whole upgrade aborts and v1 data stays intact.
          const oldStore = versionTx.objectStore(VAULT_STORE);
          const getAll = oldStore.getAll();
          getAll.onsuccess = () => {
            const rows = (getAll.result as unknown[]) ?? [];
            db.deleteObjectStore(VAULT_STORE);
            const fresh = db.createObjectStore(VAULT_STORE);
            for (const row of rows) {
              try {
                fresh.put(row, vaultStoreKey(row as VaultRecord));
              } catch (err) {
                console.error('[store] v1->v2 re-key skipped a row:', err);
              }
            }
          };
        }
        if (!db.objectStoreNames.contains(RECEIPT_STORE)) {
          db.createObjectStore(RECEIPT_STORE, { keyPath: 'txHash' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = undefined;
        };
        resolve(db);
      };
      req.onerror = () => reject(toError(req, 'open'));
    });
    return this.dbPromise;
  }

  async getVaults(): Promise<VaultRecord[]> {
    return this.withReconnect(db => this.readAll<VaultRecord>(db, VAULT_STORE));
  }

  async saveVault(vault: VaultRecord): Promise<void> {
    const key = vaultStoreKey(vault);
    const preFundingKey = vault.vaultIdHex ? preFundingStoreKey(vault) : null;
    await this.withReconnect(db => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE, 'readwrite');
      const store = tx.objectStore(VAULT_STORE);
      if (preFundingKey && preFundingKey !== key) {
        // Same record's pre-funding incarnation must not survive funding.
        store.delete(preFundingKey);
      }
      store.put(vault, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(toError(tx, `${VAULT_STORE} put`));
      tx.onabort = () => reject(new Error(`IndexedDB ${VAULT_STORE} transaction aborted`));
    }));
  }

  async getReceipts(): Promise<PaymentReceipt[]> {
    return this.withReconnect(db => this.readAll<PaymentReceipt>(db, RECEIPT_STORE));
  }

  async saveReceipt(receipt: PaymentReceipt): Promise<void> {
    // Normalize the key to lowercase so case drift across the daemon's two
    // delivery paths (WSS vs REST) cannot produce a duplicate row.
    await this.withReconnect(db => this.write(db, RECEIPT_STORE, { ...receipt, txHash: receipt.txHash.toLowerCase() }));
  }

  async clear(): Promise<void> {
    await this.withReconnect(async db => {
      await this.clearStore(db, VAULT_STORE);
      await this.clearStore(db, RECEIPT_STORE);
    });
  }

  private async withReconnect<T>(operation: (db: IdbDatabaseLike) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await operation(await this.openDb());
      } catch (error) {
        lastError = error;
        this.dbPromise = undefined;
        if (attempt === 0 && /closing|closed|invalid state/i.test(error instanceof Error ? error.message : String(error))) continue;
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private readAll<T>(db: IdbDatabaseLike, storeName: string): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(toError(req, `${storeName} getAll`));
    });
  }

  private write(db: IdbDatabaseLike, storeName: string, value: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(toError(tx, `${storeName} put`));
      tx.onabort = () => reject(new Error(`IndexedDB ${storeName} transaction aborted`));
    });
  }

  private clearStore(db: IdbDatabaseLike, storeName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(toError(tx, `${storeName} clear`));
      tx.onabort = () => reject(new Error(`IndexedDB ${storeName} transaction aborted`));
    });
  }
}

function toError(source: { readonly result?: unknown } | unknown, op: string): Error {
  const err = (source as { error?: unknown })?.error;
  return new Error(`IndexedDB ${op} failed: ${err instanceof Error ? err.message : String(err ?? 'unknown error')}`);
}
