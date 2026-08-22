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
export class MemoryStore implements RipcordStore {
  private readonly vaults = new Map<string, VaultRecord>();
  private readonly receipts = new Map<string, PaymentReceipt>();

  async getVaults(): Promise<VaultRecord[]> {
    return [...this.vaults.values()];
  }

  async saveVault(vault: VaultRecord): Promise<void> {
    this.vaults.set(vault.address, vault);
  }

  async getReceipts(): Promise<PaymentReceipt[]> {
    return [...this.receipts.values()];
  }

  async saveReceipt(receipt: PaymentReceipt): Promise<void> {
    // txHash case is inconsistent across the daemon (WSS lowercase, REST
    // uppercase); key lowercased so a re-save cannot mint a duplicate.
    this.receipts.set(receipt.txHash.toLowerCase(), receipt);
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
      store.vaults.set(vault.address, vault);
    }
    for (const receipt of data.receipts) {
      store.receipts.set(receipt.txHash.toLowerCase(), receipt);
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
  put(value: unknown): IdbRequestLike;
  getAll(): IdbRequestLike;
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
  transaction(storeNames: string | string[], mode: string): IdbTransactionLike;
  close(): void;
}

interface IdbOpenDbRequestLike {
  readonly result: IdbDatabaseLike;
  onupgradeneeded: ((event: unknown) => void) | null;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenDbRequestLike;
}

const VAULT_STORE = 'vaults';
const RECEIPT_STORE = 'receipts';
const DB_VERSION = 1;

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
        if (!db.objectStoreNames.contains(VAULT_STORE)) {
          db.createObjectStore(VAULT_STORE, { keyPath: 'address' });
        }
        if (!db.objectStoreNames.contains(RECEIPT_STORE)) {
          db.createObjectStore(RECEIPT_STORE, { keyPath: 'txHash' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(toError(req, 'open'));
    });
    return this.dbPromise;
  }

  async getVaults(): Promise<VaultRecord[]> {
    const db = await this.openDb();
    return this.readAll<VaultRecord>(db, VAULT_STORE);
  }

  async saveVault(vault: VaultRecord): Promise<void> {
    const db = await this.openDb();
    await this.write(db, VAULT_STORE, vault);
  }

  async getReceipts(): Promise<PaymentReceipt[]> {
    const db = await this.openDb();
    return this.readAll<PaymentReceipt>(db, RECEIPT_STORE);
  }

  async saveReceipt(receipt: PaymentReceipt): Promise<void> {
    const db = await this.openDb();
    // Normalize the key to lowercase so case drift across the daemon's two
    // delivery paths (WSS vs REST) cannot produce a duplicate row.
    await this.write(db, RECEIPT_STORE, { ...receipt, txHash: receipt.txHash.toLowerCase() });
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    await this.clearStore(db, VAULT_STORE);
    await this.clearStore(db, RECEIPT_STORE);
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
