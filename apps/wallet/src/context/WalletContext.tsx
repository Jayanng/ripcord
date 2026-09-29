import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const [store, setStore] = useState<RipcordStore | null>(null);
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

  useEffect(() => { setStore(new IndexedDbStore({ dbName: 'ripcord-public-v1' })); }, []);

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

  const vaults = useMemo(() => vaultsForIdentity(storedVaults, identity), [identity, storedVaults]);
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

  const runPreflight = useCallback(async (quiet = false) => {
    if (!quiet) setBootState('checking');
    try {
      // Capture the state generation BEFORE the store reads begin; if a
      // mutation lands while the reads are in flight, its handler already
      // applied fresher state and this stale read must not replace it.
      const readGen = stateGen.current;
      const [nextHealth, nextVaults, nextReceipts, wtStatus, wtReceipts] = await Promise.all([
        import('@ripcord/core/health').then(({ preflight }) => preflight(DEFAULT_DAEMON, {
          allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL,
          bitcoinRpcBaseUrl: BITCOIN_RPC_BASE,
        })),
        store?.getVaults() ?? Promise.resolve([]),
        store?.getReceipts() ?? Promise.resolve([]),
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
      if (stateGen.current === readGen) {
        setStoredVaults(nextVaults);
        setReceipts(nextReceipts);
      }
      setWatchtowerStatus(wtStatus ?? nextHealth.watchtower ?? null);
      setVaultBreachReceipts(wtReceipts);
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

      if (!quiet) setBootState('unreachable');
      setLastRefreshedAt(Date.now());
    }
  }, [store, activeVault?.vaultIdHex, identity, liveVtxos]);

  const refresh = useCallback(() => runPreflight(false), [runPreflight]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => void runPreflight(true), 30_000);
    return () => window.clearInterval(timer);
  }, [runPreflight]);

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
    baseUrl: BITCOIN_RPC_BASE, daemonUrl: DEFAULT_DAEMON, bootState, health, identity, vaults, activeVault, receipts,
    liveVtxos, spentVtxos, lockedVtxos, pendingIncomingSats, balanceCrossCheck, watchtowerStatus, vaultBreachReceipts, sentinelAlert, dismissSentinel, lastRefreshedAt, vtxoSnapshotLoaded, claimedOutpointsFor,
    activity, indexerStatus, exitReadiness, store, txQueue: walletTxQueue, selectVault: setSelectedVaultKey, refresh, setIdentity, setExitReadiness, waitForIndexerReady,
    addVault, updateVault, saveReceipt, recordActivity, setIndexerStatus,
  }), [activeVault, activity, addVault, balanceCrossCheck, bootState, claimedOutpointsFor, dismissSentinel, exitReadiness, health, identity, indexerStatus, lastRefreshedAt, vtxoSnapshotLoaded,
      liveVtxos, lockedVtxos, pendingIncomingSats, receipts, refresh, saveReceipt, sentinelAlert, setExitReadiness, spentVtxos,
      store, vaults, vaultBreachReceipts, waitForIndexerReady, watchtowerStatus]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
