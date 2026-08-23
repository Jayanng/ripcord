import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  IndexedDbStore, preflight, type ExitReadiness, type Identity, type IndexerEvent,
  type IndexerStatus, type PaymentReceipt, type PreflightResult, type RipcordStore, type VaultRecord,
} from '@ripcord/core';

// Browser calls use the same-origin dev proxy because the public daemon does
// not opt into CORS. Production should provide an equivalent backend proxy.
const LOCAL_DAEMON = window.location.origin;
const DEFAULT_DAEMON = import.meta.env.VITE_DAEMON_URL ?? LOCAL_DAEMON;
const BITCOIN_RPC_BASE = import.meta.env.VITE_BITCOIN_RPC_URL
  ?? new URL('/rpc', window.location.origin).toString().replace(/\/$/, '');

type BootState = 'checking' | 'ready' | 'degraded' | 'unreachable';

interface WalletContextValue {
  baseUrl: string;
  bootState: BootState;
  health: PreflightResult | null;
  identity: Identity | null;
  vaults: VaultRecord[];
  receipts: PaymentReceipt[];
  activity: IndexerEvent[];
  indexerStatus: IndexerStatus;
  exitReadiness: ExitReadiness | null;
  store: RipcordStore | null;
  refresh: () => Promise<void>;
  setIdentity: (identity: Identity | null) => void;
  setExitReadiness: (readiness: ExitReadiness | null) => void;
  recordActivity: (event: IndexerEvent) => void;
  setIndexerStatus: (status: IndexerStatus) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<RipcordStore | null>(null);
  const [health, setHealth] = useState<PreflightResult | null>(null);
  const [bootState, setBootState] = useState<BootState>('checking');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [activity, setActivity] = useState<IndexerEvent[]>([]);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus>({ state: 'closed', reason: 'No wallet address loaded' });
  const [exitReadiness, setExitReadiness] = useState<ExitReadiness | null>(null);

  useEffect(() => { setStore(new IndexedDbStore({ dbName: 'ripcord-public-v1' })); }, []);

  const refresh = useCallback(async () => {
    setBootState('checking');
    try {
      const [nextHealth, nextVaults, nextReceipts] = await Promise.all([
        preflight(DEFAULT_DAEMON, {
          allowInsecureHttp: !import.meta.env.VITE_DAEMON_URL,
          bitcoinRpcBaseUrl: BITCOIN_RPC_BASE,
        }),
        store?.getVaults() ?? Promise.resolve([]),
        store?.getReceipts() ?? Promise.resolve([]),
      ]);
      setHealth(nextHealth);
      setVaults(nextVaults);
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
      setBootState('unreachable');
    }
  }, [store]);

  useEffect(() => { void refresh(); }, [refresh]);

  const recordActivity = useCallback((event: IndexerEvent) => {
    setActivity(current => [event, ...current].slice(0, 200));
  }, []);

  const value = useMemo<WalletContextValue>(() => ({
    baseUrl: DEFAULT_DAEMON, bootState, health, identity, vaults, receipts, activity,
    indexerStatus, exitReadiness, store, refresh, setIdentity, setExitReadiness,
    recordActivity, setIndexerStatus,
  }), [activity, bootState, exitReadiness, health, identity, indexerStatus, receipts, refresh, store, vaults]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
