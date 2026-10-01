import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { purgeServiceWorkersAndCaches } from '../lib/selfHeal';
import { readExitRecord, writeExitRecord } from '../lib/exitRecord';
import { getDisplayUnit, setDisplayUnit as setDisplayUnitModule, type DisplayUnit } from '../lib/format';
import { IndexedDbStore, vaultStoreKey, type RipcordStore } from '@ripcord/core/store';
import { TxQueue } from '@ripcord/core';
import { deriveIdentity } from '@ripcord/core/keys';
import {
  vaultsForIdentity,
  type ExitReadiness,
  type Identity,
  type PaymentReceipt,
  type VaultRecord,
  type WatchtowerStatus,
  type WatchtowerBreachReceipt,
  type BalanceCrossCheckResult,
} from '@ripcord/core/types';
import type { PreflightResult } from '@ripcord/core/health';
import {
  dedupeReceiptList,
  isIncomingPayment,
  synthesizeIncomingReceipt,
  classifyCredit,
  lookupTachiTx,
  saveReceiptMerged,
  type IndexerEvent,
  type IndexerStatus,
} from '@ripcord/core/indexer';
import { describeDaemonFailure, joinDaemonUrl } from '@ripcord/core/net';

// Browser calls use the same-origin dev proxy because the public daemon does
// not opt into CORS. Production should provide an equivalent backend proxy.
const LOCAL_DAEMON = window.location.origin;
const DEFAULT_DAEMON = import.meta.env.VITE_DAEMON_URL ?? LOCAL_DAEMON;
const BITCOIN_RPC_BASE = import.meta.env.VITE_BITCOIN_RPC_URL
  ?? joinDaemonUrl(window.location.origin, 'rpc');

type BootState = 'checking' | 'ready' | 'degraded' | 'unreachable';

import type { VtxoRecordItem } from '../lib/provenance';
export type { VtxoRecordItem };

interface WalletContextValue {
  baseUrl: string;
  daemonUrl: string;
  bootState: BootState;
  health: PreflightResult | null;
  identity: Identity | null;
  vaults: VaultRecord[];
  activeVault: VaultRecord | null;
  /** True when the wallet state has at least one vault record (single source of truth for nav gating). */
  hasVault: boolean;
  receipts: PaymentReceipt[];
  liveVtxos: VtxoRecordItem[];
  spentVtxos: VtxoRecordItem[];
  lockedVtxos: VtxoRecordItem[];
  pendingIncomingSats: bigint;
  balanceCrossCheck: BalanceCrossCheckResult | null;
  watchtowerStatus: WatchtowerStatus | null;
  vaultBreachReceipts: WatchtowerBreachReceipt[];
  /** Latest watchtower breach alert pushed over WS (Phase 7 sentinel). */
  sentinelAlert: SentinelAlert | null;
  dismissSentinel: () => void;
  /** Wall-clock ms of the last completed preflight (Phase 9, #23). */
  lastRefreshedAt: number | null;
  /** True when this device's saved records could not be read at all. */
  storeReadFailed: boolean;
  /** Verified Bitcoin balance at the user's L1 settlement address (null until known). */
  l1BalanceSats: bigint | null;
  /** Display unit for amounts (sats or BTC). Display-only; data stays in sats. */
  displayUnit: DisplayUnit;
  setDisplayUnit: (unit: DisplayUnit) => void;
  /** False until the first VTXO snapshot lands (Phase 9, #22 skeleton gate). */
  vtxoSnapshotLoaded: boolean;
  /**
   * Funding outpoints (`txid:vout`) claimed by OTHER records at the same
   * address. Funding scans must exclude them (audit fix: sibling funding
   * records share one address and must never adopt each other's outpoint).
   */
  claimedOutpointsFor: (vault: VaultRecord) => string[];
  activity: IndexerEvent[];
  indexerStatus: IndexerStatus;
  exitReadiness: ExitReadiness | null;
  store: RipcordStore | null;
  txQueue: TxQueue;
  selectVault: (vaultKey: string | null) => void;
  refresh: () => Promise<void>;
  setIdentity: (identity: Identity | null) => void;
  addVault: (vault: VaultRecord) => Promise<void>;
  updateVault: (vault: VaultRecord) => Promise<void>;
  saveReceipt: (receipt: PaymentReceipt) => Promise<void>;
  setExitReadiness: (vaultKey: string, readiness: ExitReadiness | null) => void;
  recordActivity: (event: IndexerEvent) => void;
  setIndexerStatus: (status: IndexerStatus) => void;
  waitForIndexerReady: (timeoutMs?: number) => Promise<void>;
}

export const walletTxQueue = new TxQueue();

/** A watchtower breach alert surfaced by the WS sentinel (Phase 7). */
export interface SentinelAlert {
  readonly classification: string;
  readonly spendTxid: string;
  readonly detectedHeight: number;
  readonly at: number;
}

/**
 * Stable per-record key: vaultIdHex is unique per funding outpoint.
 * Delegates to the store's canonical vaultStoreKey so persistence and UI
 * state can never disagree on record identity (audit fix).
 */
export function vaultRecordKey(vault: VaultRecord): string {
  return vaultStoreKey(vault);
}

/**
 * The identity a vault's money operations must act with. Core requires
 * identity.userKeyDescriptor.index === vault.userKeyIndex (refund.ts guard), so
 * for a vault created at a different key index we re-derive the matching
 * identity from the in-memory mnemonic. Pure derivation; nothing is stored.
 */
export function identityForVault(identity: Identity | null, vault: VaultRecord | null): Identity | null {
  if (!identity || !vault) return identity;
  if (identity.userKeyDescriptor.index === vault.userKeyIndex) return identity;
  return deriveIdentity(identity.mnemonic, 'regtest', vault.userKeyIndex);
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<RipcordStore | null>(() => {
    if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      try {
        return new IndexedDbStore({ dbName: 'ripcord-public-v1' });
      } catch {
        return null;
      }
    }
    return null;
  });
  const [health, setHealth] = useState<PreflightResult | null>(null);
  const [bootState, setBootState] = useState<BootState>('checking');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [storedVaults, setStoredVaults] = useState<VaultRecord[]>([]);
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [liveVtxos, setLiveVtxos] = useState<VtxoRecordItem[]>([]);
  const [spentVtxos, setSpentVtxos] = useState<VtxoRecordItem[]>([]);
  const [lockedVtxos, setLockedVtxos] = useState<VtxoRecordItem[]>([]);
  const [pendingCredits, setPendingCredits] = useState<Map<string, { amountSats: bigint; addedAt: number }>>(new Map());
  const [balanceCrossCheck, setBalanceCrossCheck] = useState<BalanceCrossCheckResult | null>(null);
  const [watchtowerStatus, setWatchtowerStatus] = useState<WatchtowerStatus | null>(null);
  const [vaultBreachReceipts, setVaultBreachReceipts] = useState<WatchtowerBreachReceipt[]>([]);
  const [sentinelAlert, setSentinelAlert] = useState<SentinelAlert | null>(null);
  const dismissSentinel = useCallback(() => setSentinelAlert(null), []);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [vtxoSnapshotLoaded, setVtxoSnapshotLoaded] = useState(false);
  const [activity, setActivity] = useState<IndexerEvent[]>([]);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus>({ state: 'closed', reason: 'No wallet address loaded' });
  const [readinessRecord, setReadinessRecord] = useState<{ vaultKey: string; readiness: ExitReadiness } | null>(null);
  // Audit 3 fix: state-refresh guard. runPreflight re-reads the store every 30s
  // and REPLACES the in-memory lists. If that read started before a just-landed
  // mutation (addVault / saveReceipt), the stale read would clobber the new
  // record out of the UI and silently switch activeVault. Every mutation bumps
  // this generation first; preflight only applies its read when no mutation
  // landed while the read was in flight (the mutation handlers already applied
  // the fresher state).
  const stateGen = useRef(0);
  const indexerStatusRef = useRef(indexerStatus);
  const indexerWaiters = useRef<Array<{ resolve: () => void; reject: (error: Error) => void; timer: number }>>([]);
  useEffect(() => { indexerStatusRef.current = indexerStatus; if (indexerStatus.state === 'connected') { for (const waiter of indexerWaiters.current) { window.clearTimeout(waiter.timer); waiter.resolve(); } indexerWaiters.current = []; } }, [indexerStatus]);

  useEffect(() => {
    if (!store && typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      try {
        setStore(new IndexedDbStore({ dbName: 'ripcord-public-v1' }));
      } catch {
        // ignore
      }
    }
  }, [store]);

  // Compute pending incoming sats total with a 10-minute drop policy
  const pendingIncomingSats = useMemo(() => {
    const now = Date.now();
    const TTL_MS = 600_000;
    let sum = 0n;
    for (const item of pendingCredits.values()) {
      if (now - item.addedAt < TTL_MS) {
        sum += item.amountSats;
      }
    }
    return sum;
  }, [pendingCredits]);

  const vaults = useMemo(() => (identity ? vaultsForIdentity(storedVaults, identity) : storedVaults), [identity, storedVaults]);
  const hasVault = vaults.length > 0;
  // Explicit vault selection (Phase 5 multi-vault): the user's pick wins, the
  // scored heuristic stays as the default when nothing is selected. Vault
  // records are keyed by vaultIdHex (unique per funding outpoint - addresses
  // can repeat across records for the same derived vault).
  const [selectedVaultKey, setSelectedVaultKey] = useState<string | null>(null);
  const activeVault = useMemo(() => {
    const selected = selectedVaultKey ? vaults.find(v => vaultRecordKey(v) === selectedVaultKey) : undefined;
    if (selected) return selected;
    return [...vaults].sort((a, b) => {
      const aScore = (a.funding ? 4 : 0) + (a.registered ? 2 : 0) + (a.p2tr ? 1 : 0);
      const bScore = (b.funding ? 4 : 0) + (b.registered ? 2 : 0) + (b.p2tr ? 1 : 0);
      return bScore - aScore || b.createdAt - a.createdAt;
    })[0] ?? null;
  }, [vaults, selectedVaultKey]);

  // Flicker fix: tracks whether any preflight has completed. The boot
  // skeleton is shown ONLY before the first completed load; later
  // refreshes must update in place without blanking the UI.
  const hasLoadedOnce = useRef(false);
  // True when the device database could not be read at all: the user must not
  // be shown a silent "new user" experience in that case.
  const [storeReadFailed, setStoreReadFailed] = useState(false);
  // Real Bitcoin balance at the user's L1 settlement address (verified live).
  const [l1BalanceSats, setL1BalanceSats] = useState<bigint | null>(null);
  const [displayUnit, setDisplayUnitState] = useState<DisplayUnit>(() => getDisplayUnit());
  const setDisplayUnit = useCallback((unit: DisplayUnit) => {
    setDisplayUnitModule(unit);
    setDisplayUnitState(unit);
  }, []);
  // Keep the context mirror in sync even when the module is updated elsewhere.
  useEffect(() => {
    const sync = () => setDisplayUnitState(getDisplayUnit());
    window.addEventListener('ripcord:unit-changed', sync);
    return () => window.removeEventListener('ripcord:unit-changed', sync);
  }, []);

  const runPreflight = useCallback(async (quiet = false) => {
    if (!quiet && !hasLoadedOnce.current) setBootState('checking');
    try {
      // Capture the state generation BEFORE the store reads begin; if a
      // mutation lands while the reads are in flight, its handler already
      // applied fresher state and this stale read must not replace it.
      const readGen = stateGen.current;

      // Read local store first so stored vaults are restored immediately and independently of daemon health.
      const currentStore = store ?? (typeof window !== 'undefined' && typeof indexedDB !== 'undefined' ? new IndexedDbStore({ dbName: 'ripcord-public-v1' }) : null);
      if (currentStore) {
        const readStoreBounded = async () => {
          const storeRead = Promise.all([
            currentStore.getVaults(),
            currentStore.getReceipts(),
          ]);
          const storeTimeout = new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error('store read timed out')), 5000),
          );
          return Promise.race([storeRead, storeTimeout]);
        };
        try {
          // Stuck-storage guard: profiles carrying an older database can
          // deadlock the read (stale holder keeps an IndexedDB connection /
          // versionchange lock). Never let storage hang the boot forever.
          let next: [Awaited<ReturnType<typeof currentStore.getVaults>>, Awaited<ReturnType<typeof currentStore.getReceipts>>];
          try {
            next = await readStoreBounded();
          } catch (storeError) {
            // Break the jam: a stale service worker from an older build may
            // be holding the database. Unregister it and retry once so the
            // user's stored wallets come back instead of being hidden.
            console.warn('[boot] store read failed, releasing stale holders and retrying:', storeError);
            await purgeServiceWorkersAndCaches().catch(() => {});
            await new Promise(resolve => window.setTimeout(resolve, 400));
            next = await readStoreBounded();
          }
          const [nextVaults, nextReceipts] = next;
          if (stateGen.current === readGen) {
            // A transient empty read must NEVER eject a known wallet to the
            // setup gate mid-session (the unlock-eject bug): the lock screen
            // proves the rows exist, so keep known state over an empty read.
            setStoredVaults(current => {
              if (nextVaults.length === 0 && current.length > 0) {
                console.warn('[boot] store read returned no vaults while a wallet is known; keeping current state');
                return current;
              }
              return nextVaults;
            });
            setReceipts(nextReceipts);
          }
          setStoreReadFailed(false);
        } catch (storeError) {
          console.error('Failed to read from local store:', storeError);
          setStoreReadFailed(true);
          hasLoadedOnce.current = true;
        }
      }

      const [nextHealth, wtStatus, wtReceipts] = await Promise.all([
        import('@ripcord/core/health').then(({ preflight }) => preflight(DEFAULT_DAEMON, {
          allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL,
          bitcoinRpcBaseUrl: BITCOIN_RPC_BASE,
        })),
        import('@ripcord/core/health').then(({ fetchWatchtowerStatus }) =>
          fetchWatchtowerStatus(DEFAULT_DAEMON, { allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL })
        ).catch(() => null),
        activeVault?.vaultIdHex
          ? import('@ripcord/core/health').then(({ fetchWatchtowerReceipts }) =>
              fetchWatchtowerReceipts(DEFAULT_DAEMON, activeVault.vaultIdHex, { allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL })
            ).catch(() => [])
          : Promise.resolve([]),
      ]);
      setHealth(nextHealth);
      setWatchtowerStatus(wtStatus ?? nextHealth.watchtower ?? null);
      setVaultBreachReceipts(wtReceipts);
      hasLoadedOnce.current = true;
      setBootState(nextHealth.daemonOk ? 'ready' : nextHealth.unreachable ? 'unreachable' : 'degraded');
      setLastRefreshedAt(Date.now());


      // Balance cross-check (Deliverable 3)
      if (identity) {
        const snapshotSats = liveVtxos.filter(v => !v.spent && !v.locked).reduce((sum, v) => sum + v.amountSats, 0n);
        void import('@ripcord/core/health').then(({ crossCheckBalance }) =>
          crossCheckBalance({
            snapshotSats,
            ownerXOnly: identity.xOnly,
            baseUrl: DEFAULT_DAEMON,
            allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL,
          })
        ).then(result => setBalanceCrossCheck(result)).catch(() => {});
      }
    } catch (error) {
      const message = describeDaemonFailure(error);
      setHealth({
        daemonOk: false, chainId: '', version: '', synced: false,
        liveValidators: 0, quorumThreshold: 0, quorumSize: 0,
        feeRecommendedSats: 0n, feeMinSats: 0n, l1Height: null,
        l1HeightSource: 'unavailable',
        probeFailures: [{ probe: 'health', message }],
        unreachable: true,
      });

      hasLoadedOnce.current = true;
      if (!quiet) setBootState('unreachable');
      setLastRefreshedAt(Date.now());
    }
  }, [store, activeVault?.vaultIdHex, identity, liveVtxos]);

  const refresh = useCallback(() => runPreflight(false), [runPreflight]);

  // Flicker fix: kick exactly ONE boot preflight when the app mounts.
  // Depending on `refresh` re-ran a full 'checking' preflight (whole-UI
  // skeleton) on every data update, which the user saw as constant flicker.
  const runPreflightRef = useRef(runPreflight);
  runPreflightRef.current = runPreflight;
  useEffect(() => { void runPreflightRef.current(false); }, []);

  // Exit visibility (2026-10-02, user-reported): exit maturity must be known
  // on every screen, not only the Exit tab, or a cold start on the wallet
  // screen shows stale pre-exit balances for a spent vault. Dedicated effect
  // (not preflight-embedded): the preflight closure sees the pre-store-load
  // vault list on its first run and would skip. Watches the active funded
  // vault and re-checks every 30s.
  useEffect(() => {
    const vault = activeVault;
    if (!vault?.funding) return;
    let cancelled = false;
    const check = async () => {
      try {
        const { inspectExitMaturity } = await import('@ripcord/core/exit');
        const maturity = await inspectExitMaturity(vault, BITCOIN_RPC_BASE);
        if (!cancelled) setExitReadiness(vaultRecordKey(vault), maturity);
      } catch {
        // Maturity polling must never break the UI.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeVault?.address, activeVault?.funding?.txid, activeVault?.funding?.vout]);

  // L1 settlement visibility (2026-10-02, user-reported): show the real
  // Bitcoin balance at the settlement address (deposit change + exit
  // proceeds live there). One scan also identifies the exact exit
  // transaction (the unspent spending the funding outpoint is the exit:
  // a funding output can be spent only once), so Activity can show the exit
  // even for exits that predate any local record.
  useEffect(() => {
    const address = identity?.l1Address;
    if (!address) {
      setL1BalanceSats(null);
      return;
    }
    let cancelled = false;
    const scan = async () => {
      try {
        const { scanL1Settlement } = await import('../lib/l1');
        const funding = activeVault?.funding;
        const found = await scanL1Settlement({
          address,
          baseUrl: BITCOIN_RPC_BASE,
          funding: funding ? { txid: funding.txid, vout: funding.vout } : undefined,
        });
        if (cancelled) return;
        setL1BalanceSats(found.balanceSats);
        if (found.exitTxid && activeVault) {
          const key = vaultRecordKey(activeVault);
          if (!readExitRecord(key)) {
            writeExitRecord(key, {
              txid: found.exitTxid,
              amountSats: String(found.exitSats ?? 0n),
              createdAt: Date.now(),
            });
          }
        }
      } catch {
        // L1 visibility is a convenience; never break the UI for it.
      }
    };
    void scan();
    const timer = window.setInterval(() => void scan(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [identity?.l1Address, activeVault?.funding?.txid, activeVault?.funding?.vout]);

  useEffect(() => {
    const timer = window.setInterval(() => void runPreflight(true), 30_000);
    return () => window.clearInterval(timer);
  }, [runPreflight]);

  // Boot watchdog: if any part of the boot chain hangs (stuck storage,
  // stalled network), never leave the user staring at the skeleton. After
  // 8s the shell renders in degraded state; a late preflight self-corrects.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBootState(prev => (prev === 'checking' ? 'degraded' : prev));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  const recordActivity = useCallback((event: IndexerEvent) => {
    setActivity(current => [event, ...current].slice(0, 200));
  }, []);
  const waitForIndexerReady = useCallback((timeoutMs = 15_000) => {
    if (indexerStatusRef.current.state === 'connected') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { indexerWaiters.current = indexerWaiters.current.filter(item => item.timer !== timer); reject(new Error('WSS indexer did not reach open state during recovery')); }, timeoutMs);
      indexerWaiters.current.push({ resolve, reject, timer });
    });
  }, []);
  const claimedOutpointsFor = useCallback((vault: VaultRecord): string[] => {
    const selfKey = vaultRecordKey(vault);
    return storedVaults
      .filter(item => item.funding && vaultRecordKey(item) !== selfKey && item.address === vault.address)
      .map(item => `${item.funding!.txid.toLowerCase()}:${item.funding!.vout}`);
  }, [storedVaults]);

  const addVault = useCallback(async (vault: VaultRecord) => {
    if (!store) throw new Error('Public store is not ready');
    // Invalidate any in-flight preflight store read (see stateGen above).
    stateGen.current += 1;
    // Record-keyed merge (audit fix): funding records are unique per funding
    // outpoint and MAY share an address. Merging by address silently destroyed
    // sibling funding records (the real-world shape: N records, one address).
    const key = vaultRecordKey(vault);
    const existing = storedVaults.find(item => vaultRecordKey(item) === key);
    const merged: VaultRecord = existing ? {
      ...existing,
      ...vault,
      // A funding binding with an EMPTY txid is a placeholder (a flow that knew
      // the vaultId but not the outpoint), never real evidence. Treating it as
      // absent keeps it from displacing a real binding, and heals rows already
      // carrying one (the pre-audit code=17 catch wrote `funding: { txid: '' }`).
      funding: vault.funding?.txid ? vault.funding : (existing.funding?.txid ? existing.funding : undefined),
      registered: vault.registered || existing.registered,
      registrationTxHash: vault.registrationTxHash ?? existing.registrationTxHash,
      createdAt: existing.createdAt,
    } : vault;
    await store.saveVault(merged);
    const mergedKey = vaultRecordKey(merged);
    const preFundingKey = merged.vaultIdHex ? `${merged.address}:${merged.createdAt}` : null;
    setStoredVaults(current => [merged, ...current.filter(item => {
      const itemKey = vaultRecordKey(item);
      // Drop only this record's own old incarnation (address:createdAt ->
      // vaultIdHex transition). Sibling records at the same address survive.
      return itemKey !== mergedKey && itemKey !== preFundingKey;
    })]);
  }, [store, storedVaults]);
  const updateVault = addVault;

  const saveReceipt = useCallback(async (receipt: PaymentReceipt) => {
    if (!store) throw new Error('Public store is not ready');
    // Invalidate any in-flight preflight store read (see stateGen above).
    stateGen.current += 1;
    // DEFECT 1: Merge before persisting in store to never clobber richer receipts
    const merged = await saveReceiptMerged(store, receipt);
    setReceipts(current => dedupeReceiptList(current, merged));
    if (merged.epoch > 0) {
      setPendingCredits(prev => {
        const hash = merged.txHash.toLowerCase();
        if (!prev.has(hash)) return prev;
        const next = new Map(prev);
        next.delete(hash);
        return next;
      });
    }
  }, [store]);

  // Audit fix: readiness is per funding outpoint (record), not per address -
  // sibling records at one address mature independently.
  const exitReadiness = readinessRecord && activeVault && readinessRecord.vaultKey === vaultRecordKey(activeVault) ? readinessRecord.readiness : null;
  const setExitReadiness = useCallback((vaultKey: string, readiness: ExitReadiness | null) => {
    setReadinessRecord(prev => {
      if (!readiness) return null;
      // AUDIT FIX (2026-09-29): never let a refresh silently drop a computed
      // dry-run report. If a caller writes a dry-run-less result for the same
      // vault while the exit is still open, keep the existing dryRun attached.
      if (!readiness.dryRun && prev?.vaultKey === vaultKey && prev.readiness.dryRun
        && (readiness.status === 'live' || readiness.status === 'maturing')) {
        return { vaultKey, readiness: { ...readiness, dryRun: prev.readiness.dryRun } };
      }
      return { vaultKey, readiness };
    });
  }, []);

  useEffect(() => {
    if (!identity) { setLiveVtxos([]); setSpentVtxos([]); setLockedVtxos([]); setIndexerStatus({ state: 'closed', reason: 'No wallet address loaded' }); return; }
    let indexer: import('@ripcord/core/indexer').VaultIndexer | undefined;
    let cancelled = false;
    void import('@ripcord/core/indexer').then(({ VaultIndexer }) => {
      if (cancelled) return;
      const configured = import.meta.env.VITE_INDEXER_URL as string | undefined;
      const url = configured ?? 'wss://rpc-regtest.tachibtc.com/tachi_ws';
      indexer = new VaultIndexer({
        url,
        address: identity.xOnly,
        // Phase 7: watch this vault's address for lockups and its vaultId for
        // watchtower breach receipts (push, not just polling).
        ...(activeVault?.address ? { vault: activeVault.address } : {}),
        ...(activeVault?.vaultIdHex ? { vaultId: activeVault.vaultIdHex } : {}),
        blocks: true,
        onEvent: event => {
          if (event.kind === 'vault:breach') {
            // Sentinel: a watchtower breach receipt arrived over WS. Merge it
            // into the breach list (dedupe on spend txid) and alert.
            setVaultBreachReceipts(current => {
              const exists = current.some(r => r.spendTxid === event.spendTxid && r.vaultId === event.vaultId);
              return exists ? current : [{
                vaultId: event.vaultId,
                broadcastState: event.broadcastState,
                latestState: event.latestState,
                classification: event.classification,
                spendTxid: event.spendTxid,
                spendVout: event.spendVout,
                detectedHeight: event.detectedHeight,
                detectedAt: event.detectedAt,
              }, ...current];
            });
            setSentinelAlert({
              classification: event.classification,
              spendTxid: event.spendTxid,
              detectedHeight: event.detectedHeight,
              at: Date.now(),
            });
            return;
          }
          if (event.kind === 'block:new' && event.txCount === 0) return;

          setActivity(current => {
            const activityKey = (item: import('@ripcord/core/indexer').IndexerEvent) =>
              'txHash' in item
                ? `tx:${item.txHash.toLowerCase()}:${item.kind}`
                : item.kind === 'block:new'
                ? `block:${item.height}`
                : `breach:${item.spendTxid}:${item.detectedHeight}`;
            const key = activityKey(event);
            const seen = current.some(item => activityKey(item) === key);
            return seen ? current : [event, ...current].slice(0, 200);
          });

          // Deliverable 1 & 2: Incoming receipt synthesis and pending tracking with self-credit discrimination
          if (event.kind === 'tx:pending' || event.kind === 'tx:committed') {
            void (async () => {
              let lookup: import('@ripcord/core/types').TxLookupResult | null = null;
              if (event.type === 'transfer') {
                try {
                  lookup = await lookupTachiTx(event.txHash, DEFAULT_DAEMON);
                } catch {
                  lookup = null;
                }
              }

              const classification = classifyCredit(event, lookup, identity.xOnly);
              const hash = event.txHash.toLowerCase();

              if (classification === 'incoming') {
                const receipt = synthesizeIncomingReceipt(event, identity.xOnly);
                if (receipt) {
                  // NIT 4: Attach .catch (log once, never crash the event handler)
                  saveReceipt(receipt).catch(err => {
                    console.error('Failed to persist synthesized receipt:', err);
                  });
                  if (event.kind === 'tx:pending') {
                    setPendingCredits(prev => {
                      const next = new Map(prev);
                      next.set(hash, { amountSats: receipt.amountSats, addedAt: Date.now() });
                      return next;
                    });
                  } else {
                    setPendingCredits(prev => {
                      if (!prev.has(hash)) return prev;
                      const next = new Map(prev);
                      next.delete(hash);
                      return next;
                    });
                  }
                }
              } else if (classification === 'self_move' || classification === 'skip') {
                // DEFECT 2: Discriminate self-credits (no incoming receipt, no pendingIncoming count).
                // POLICY: If lookup failed on transfer, FAIL CLOSED: skip synthesis and pending count.
                if (event.kind === 'tx:committed') {
                  setPendingCredits(prev => {
                    if (!prev.has(hash)) return prev;
                    const next = new Map(prev);
                    next.delete(hash);
                    return next;
                  });
                }
              }
            })();
          }
        },
        onStatus: setIndexerStatus,
        onError: error => setIndexerStatus({ state: 'closed', reason: error.message }),
      });
      indexer.start();
    }).catch(error => { if (!cancelled) setIndexerStatus({ state: 'closed', reason: describeDaemonFailure(error) }); });
    return () => { cancelled = true; indexer?.close(); };
  }, [identity, saveReceipt, activeVault?.address, activeVault?.vaultIdHex]);

  // VTXO visibility loader: full history via include_spent=true and locked VTXOs (Deliverable 4)
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { getAddressVtxosHistory, getLockedVaultVtxos } = await import('@ripcord/core/lifecycle');
        const [history, locked] = await Promise.all([
          getAddressVtxosHistory(identity.xOnly, DEFAULT_DAEMON),
          activeVault?.address ? getLockedVaultVtxos(activeVault.address, DEFAULT_DAEMON).catch(() => []) : Promise.resolve([]),
        ]);
        if (!cancelled) {
          const unspent = history.filter(item => !item.spent);
          setLiveVtxos(unspent);
          setSpentVtxos(history.filter(item => item.spent));
          setLockedVtxos(locked);

          const snapshotSats = unspent.filter(v => !v.locked).reduce((sum, v) => sum + v.amountSats, 0n);
          void import('@ripcord/core/health').then(({ crossCheckBalance }) =>
            crossCheckBalance({
              snapshotSats,
              ownerXOnly: identity.xOnly,
              baseUrl: DEFAULT_DAEMON,
              allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL,
            })
          ).then(result => {
            if (!cancelled) setBalanceCrossCheck(result);
          }).catch(() => {});
        }
      } catch {
        if (!cancelled) {
          try {
            const { getLiveVtxos } = await import('@ripcord/core/lifecycle');
            const result = await getLiveVtxos(identity.xOnly, DEFAULT_DAEMON);
            if (!cancelled) setLiveVtxos(result);
          } catch {
            if (!cancelled) setLiveVtxos([]);
          }
        }
      }
    };
    void load().finally(() => {
      // Phase 9 (#22): first snapshot has landed (or failed); skeletons end.
      if (!cancelled) setVtxoSnapshotLoaded(true);
    });
    const timer = setInterval(() => void load(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [identity, activeVault?.address]);

  const value = useMemo<WalletContextValue>(() => ({
    baseUrl: BITCOIN_RPC_BASE, daemonUrl: DEFAULT_DAEMON, bootState, health, identity, vaults, activeVault, hasVault, receipts,
    liveVtxos, spentVtxos, lockedVtxos, pendingIncomingSats, balanceCrossCheck, watchtowerStatus, vaultBreachReceipts, sentinelAlert, dismissSentinel, lastRefreshedAt, storeReadFailed, l1BalanceSats, displayUnit, setDisplayUnit, vtxoSnapshotLoaded, claimedOutpointsFor,
    activity, indexerStatus, exitReadiness, store, txQueue: walletTxQueue, selectVault: setSelectedVaultKey, refresh, setIdentity, setExitReadiness, waitForIndexerReady,
    addVault, updateVault, saveReceipt, recordActivity, setIndexerStatus,
  }), [activeVault, activity, addVault, balanceCrossCheck, bootState, claimedOutpointsFor, dismissSentinel, exitReadiness, hasVault, health, identity, indexerStatus, lastRefreshedAt, storeReadFailed, l1BalanceSats, displayUnit, setDisplayUnit, vtxoSnapshotLoaded,
      liveVtxos, lockedVtxos, pendingIncomingSats, receipts, refresh, saveReceipt, sentinelAlert, setExitReadiness, spentVtxos,
      store, vaults, vaultBreachReceipts, waitForIndexerReady, watchtowerStatus]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
