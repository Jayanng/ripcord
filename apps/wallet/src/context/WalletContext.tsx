import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IndexedDbStore, type RipcordStore } from '@ripcord/core/store';
import { vaultsForIdentity, type ExitReadiness, type Identity, type PaymentReceipt, type VaultRecord } from '@ripcord/core/types';
import type { PreflightResult } from '@ripcord/core/health';
import type { IndexerEvent, IndexerStatus } from '@ripcord/core/indexer';

// Browser calls use the same-origin dev proxy because the public daemon does
// not opt into CORS. Production should provide an equivalent backend proxy.
const LOCAL_DAEMON = window.location.origin;
const DEFAULT_DAEMON = import.meta.env.VITE_DAEMON_URL ?? LOCAL_DAEMON;
const BITCOIN_RPC_BASE = import.meta.env.VITE_BITCOIN_RPC_URL
  ?? new URL('/rpc', window.location.origin).toString().replace(/\/$/, '');

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
  liveVtxos: { id: string; amountSats: bigint; spent: boolean; locked: boolean }[];
  activity: IndexerEvent[];
  indexerStatus: IndexerStatus;
  exitReadiness: ExitReadiness | null;
  store: RipcordStore | null;
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

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<RipcordStore | null>(null);
  const [health, setHealth] = useState<PreflightResult | null>(null);
  const [bootState, setBootState] = useState<BootState>('checking');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [storedVaults, setStoredVaults] = useState<VaultRecord[]>([]);
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [liveVtxos, setLiveVtxos] = useState<{ id: string; amountSats: bigint; spent: boolean; locked: boolean }[]>([]);
  const [activity, setActivity] = useState<IndexerEvent[]>([]);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus>({ state: 'closed', reason: 'No wallet address loaded' });
  const [readinessRecord, setReadinessRecord] = useState<{ vaultAddress: string; readiness: ExitReadiness } | null>(null);
  const indexerStatusRef = useRef(indexerStatus);
  const indexerWaiters = useRef<Array<{ resolve: () => void; reject: (error: Error) => void; timer: number }>>([]);
  useEffect(() => { indexerStatusRef.current = indexerStatus; if (indexerStatus.state === 'connected') { for (const waiter of indexerWaiters.current) { window.clearTimeout(waiter.timer); waiter.resolve(); } indexerWaiters.current = []; } }, [indexerStatus]);

  useEffect(() => { setStore(new IndexedDbStore({ dbName: 'ripcord-public-v1' })); }, []);

  const runPreflight = useCallback(async (quiet = false) => {
    if (!quiet) setBootState('checking');
    try {
      const [nextHealth, nextVaults, nextReceipts] = await Promise.all([
        import('@ripcord/core/health').then(({ preflight }) => preflight(DEFAULT_DAEMON, {
          allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL,
          bitcoinRpcBaseUrl: BITCOIN_RPC_BASE,
        })),
        store?.getVaults() ?? Promise.resolve([]),
        store?.getReceipts() ?? Promise.resolve([]),
      ]);
      setHealth(nextHealth);
      setStoredVaults(nextVaults);
      setReceipts(nextReceipts);
      setBootState(nextHealth.daemonOk ? 'ready' : nextHealth.unreachable ? 'unreachable' : 'degraded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
  }, [store]);

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
  const saveReceipt = useCallback(async (receipt: PaymentReceipt) => { if (!store) throw new Error('Public store is not ready'); await store.saveReceipt(receipt); setReceipts(current => [receipt, ...current.filter(item => item.txHash.toLowerCase() !== receipt.txHash.toLowerCase())]); }, [store]);

  const vaults = useMemo(() => vaultsForIdentity(storedVaults, identity), [identity, storedVaults]);
  const activeVault = useMemo(() => {
    return [...vaults].sort((a, b) => {
      const aScore = (a.funding ? 4 : 0) + (a.registered ? 2 : 0) + (a.p2tr ? 1 : 0);
      const bScore = (b.funding ? 4 : 0) + (b.registered ? 2 : 0) + (b.p2tr ? 1 : 0);
      return bScore - aScore || b.createdAt - a.createdAt;
    })[0] ?? null;
  }, [vaults]);
  const exitReadiness = readinessRecord && readinessRecord.vaultAddress === activeVault?.address ? readinessRecord.readiness : null;
  const setExitReadiness = useCallback((vaultAddress: string, readiness: ExitReadiness | null) => {
    setReadinessRecord(readiness ? { vaultAddress, readiness } : null);
  }, []);

  useEffect(() => {
    if (!identity) { setLiveVtxos([]); setIndexerStatus({ state: 'closed', reason: 'No wallet address loaded' }); return; }
    let indexer: import('@ripcord/core/indexer').VaultIndexer | undefined;
    let cancelled = false;
    void import('@ripcord/core/indexer').then(({ VaultIndexer }) => {
      if (cancelled) return;
      const configured = import.meta.env.VITE_INDEXER_URL as string | undefined;
      const url = configured ?? 'wss://rpc-regtest.tachibtc.com/tachi_ws';
      indexer = new VaultIndexer({ url, address: identity.xOnly, blocks: true, onEvent: event => { if (event.kind === 'block:new' && event.txCount === 0) return; setActivity(current => { const key = 'txHash' in event ? `tx:${event.txHash.toLowerCase()}:${event.kind}` : `block:${event.height}`; const seen = current.some(item => { const other = 'txHash' in item ? `tx:${item.txHash.toLowerCase()}:${item.kind}` : `block:${item.height}`; return other === key; }); return seen ? current : [event, ...current].slice(0, 200); }); }, onStatus: setIndexerStatus, onError: error => setIndexerStatus({ state: 'closed', reason: error.message }) });
      indexer.start();
    }).catch(error => { if (!cancelled) setIndexerStatus({ state: 'closed', reason: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; indexer?.close(); };
  }, [identity]);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    const load = async () => { try { const { getLiveVtxos } = await import('@ripcord/core/lifecycle'); const result = await getLiveVtxos(identity.xOnly, DEFAULT_DAEMON); if (!cancelled) setLiveVtxos(result); } catch { if (!cancelled) setLiveVtxos([]); } };
    void load(); const timer = setInterval(() => void load(), 5000); return () => { cancelled = true; clearInterval(timer); };
  }, [identity]);

  const value = useMemo<WalletContextValue>(() => ({
    baseUrl: BITCOIN_RPC_BASE, daemonUrl: DEFAULT_DAEMON, bootState, health, identity, vaults, activeVault, receipts, liveVtxos, activity,
    indexerStatus, exitReadiness, store, refresh, setIdentity, setExitReadiness, waitForIndexerReady,
    addVault, updateVault, saveReceipt, recordActivity, setIndexerStatus,
  }), [activeVault, activity, addVault, bootState, exitReadiness, health, identity, indexerStatus, liveVtxos, receipts, refresh, saveReceipt, setExitReadiness, store, vaults, waitForIndexerReady]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
