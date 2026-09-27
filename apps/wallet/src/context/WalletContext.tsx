import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IndexedDbStore, type RipcordStore } from '@ripcord/core/store';
import { TxQueue } from '@ripcord/core';
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

interface WalletContextValue {
  baseUrl: string;
  daemonUrl: string;
  bootState: BootState;
  health: PreflightResult | null;
  identity: Identity | null;
  vaults: VaultRecord[];
  activeVault: VaultRecord | null;
  receipts: PaymentReceipt[];
  liveVtxos: { id: string; amountSats: bigint; spent: boolean; locked: boolean; height?: number }[];
  spentVtxos: { id: string; amountSats: bigint; spent: boolean; locked: boolean; height?: number; owner?: string }[];
  lockedVtxos: { id: string; amountSats: bigint; spent: boolean; locked: boolean; height?: number; vaultAddress?: string }[];
  pendingIncomingSats: bigint;
  balanceCrossCheck: BalanceCrossCheckResult | null;
  watchtowerStatus: WatchtowerStatus | null;
  vaultBreachReceipts: WatchtowerBreachReceipt[];
  activity: IndexerEvent[];
  indexerStatus: IndexerStatus;
  exitReadiness: ExitReadiness | null;
  store: RipcordStore | null;
  txQueue: TxQueue;
  refresh: () => Promise<void>;
  setIdentity: (identity: Identity | null) => void;
  addVault: (vault: VaultRecord) => Promise<void>;
  updateVault: (vault: VaultRecord) => Promise<void>;
  saveReceipt: (receipt: PaymentReceipt) => Promise<void>;
  setExitReadiness: (vaultAddress: string, readiness: ExitReadiness | null) => void;
  recordActivity: (event: IndexerEvent) => void;
  setIndexerStatus: (status: IndexerStatus) => void;
  waitForIndexerReady: (timeoutMs?: number) => Promise<void>;
}

export const walletTxQueue = new TxQueue();

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<RipcordStore | null>(null);
  const [health, setHealth] = useState<PreflightResult | null>(null);
  const [bootState, setBootState] = useState<BootState>('checking');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [storedVaults, setStoredVaults] = useState<VaultRecord[]>([]);
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [liveVtxos, setLiveVtxos] = useState<{ id: string; amountSats: bigint; spent: boolean; locked: boolean; height?: number }[]>([]);
  const [spentVtxos, setSpentVtxos] = useState<{ id: string; amountSats: bigint; spent: boolean; locked: boolean; height?: number; owner?: string }[]>([]);
  const [lockedVtxos, setLockedVtxos] = useState<{ id: string; amountSats: bigint; spent: boolean; locked: boolean; height?: number; vaultAddress?: string }[]>([]);
  const [pendingCredits, setPendingCredits] = useState<Map<string, { amountSats: bigint; addedAt: number }>>(new Map());
  const [balanceCrossCheck, setBalanceCrossCheck] = useState<BalanceCrossCheckResult | null>(null);
  const [watchtowerStatus, setWatchtowerStatus] = useState<WatchtowerStatus | null>(null);
  const [vaultBreachReceipts, setVaultBreachReceipts] = useState<WatchtowerBreachReceipt[]>([]);
  const [activity, setActivity] = useState<IndexerEvent[]>([]);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus>({ state: 'closed', reason: 'No wallet address loaded' });
  const [readinessRecord, setReadinessRecord] = useState<{ vaultAddress: string; readiness: ExitReadiness } | null>(null);
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
  const activeVault = useMemo(() => {
    return [...vaults].sort((a, b) => {
      const aScore = (a.funding ? 4 : 0) + (a.registered ? 2 : 0) + (a.p2tr ? 1 : 0);
      const bScore = (b.funding ? 4 : 0) + (b.registered ? 2 : 0) + (b.p2tr ? 1 : 0);
      return bScore - aScore || b.createdAt - a.createdAt;
    })[0] ?? null;
  }, [vaults]);

  const runPreflight = useCallback(async (quiet = false) => {
    if (!quiet) setBootState('checking');
    try {
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
      setStoredVaults(nextVaults);
      setReceipts(nextReceipts);
      setWatchtowerStatus(wtStatus ?? nextHealth.watchtower ?? null);
      setVaultBreachReceipts(wtReceipts);
      setBootState(nextHealth.daemonOk ? 'ready' : nextHealth.unreachable ? 'unreachable' : 'degraded');

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
  const addVault = useCallback(async (vault: VaultRecord) => {
    if (!store) throw new Error('Public store is not ready');
    const existing = storedVaults.find(item => item.address === vault.address);
    const merged: VaultRecord = existing ? {
      ...existing,
      ...vault,
      funding: vault.funding ?? existing.funding,
      registered: vault.registered || existing.registered,
      registrationTxHash: vault.registrationTxHash ?? existing.registrationTxHash,
      createdAt: existing.createdAt,
    } : vault;
    await store.saveVault(merged);
    setStoredVaults(current => [merged, ...current.filter(item => item.address !== merged.address)]);
  }, [store, storedVaults]);
  const updateVault = addVault;

  const saveReceipt = useCallback(async (receipt: PaymentReceipt) => {
    if (!store) throw new Error('Public store is not ready');
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

  const exitReadiness = readinessRecord && readinessRecord.vaultAddress === activeVault?.address ? readinessRecord.readiness : null;
  const setExitReadiness = useCallback((vaultAddress: string, readiness: ExitReadiness | null) => {
    setReadinessRecord(readiness ? { vaultAddress, readiness } : null);
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
        blocks: true,
        onEvent: event => {
          if (event.kind === 'block:new' && event.txCount === 0) return;

          setActivity(current => {
            const key = 'txHash' in event ? `tx:${event.txHash.toLowerCase()}:${event.kind}` : `block:${event.height}`;
            const seen = current.some(item => {
              const other = 'txHash' in item ? `tx:${item.txHash.toLowerCase()}:${item.kind}` : `block:${item.height}`;
              return other === key;
            });
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
  }, [identity, saveReceipt]);

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
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [identity, activeVault?.address]);

  const value = useMemo<WalletContextValue>(() => ({
    baseUrl: BITCOIN_RPC_BASE, daemonUrl: DEFAULT_DAEMON, bootState, health, identity, vaults, activeVault, receipts,
    liveVtxos, spentVtxos, lockedVtxos, pendingIncomingSats, balanceCrossCheck, watchtowerStatus, vaultBreachReceipts,
    activity, indexerStatus, exitReadiness, store, txQueue: walletTxQueue, refresh, setIdentity, setExitReadiness, waitForIndexerReady,
    addVault, updateVault, saveReceipt, recordActivity, setIndexerStatus,
  }), [activeVault, activity, addVault, balanceCrossCheck, bootState, exitReadiness, health, identity, indexerStatus,
      liveVtxos, lockedVtxos, pendingIncomingSats, receipts, refresh, saveReceipt, setExitReadiness, spentVtxos,
      store, vaults, vaultBreachReceipts, waitForIndexerReady, watchtowerStatus]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
