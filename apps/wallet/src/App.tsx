import { useState } from 'react';
import { useWallet } from './context/WalletContext';
import { Layout } from './components/Layout';
import type { AppTab } from './components/TabBar';
import { BalanceHero } from './components/BalanceHero';
import { RipcordPanel } from './components/RipcordPanel';
import { WhatYouDontManage } from './components/WhatYouDontManage';
import { ActivityFeed } from './components/ActivityFeed';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { SendScreen } from './screens/SendScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';

export function App() {
  const { bootState, health, refresh, indexerStatus } = useWallet();
  const [tab, setTab] = useState<AppTab>('balance');
  const statusLabel = bootState === 'ready' ? 'All probes answered' : bootState === 'checking' ? 'Checking live daemon' : bootState === 'unreachable' ? 'Daemon unreachable' : 'Daemon degraded';
  return <Layout tab={tab} onTabChange={setTab}>
    <section className="hero" aria-labelledby="wallet-title"><div><p className="eyebrow">Sovereign wallet · live regtest</p><h1 id="wallet-title">Proof before promise.</h1><p className="lede">Every custody claim names its source. Every missing proof stays visibly missing.</p></div><button className="refresh" onClick={() => void refresh()} disabled={bootState === 'checking'}>{bootState === 'checking' ? 'Checking…' : 'Run preflight'}</button></section>
    <section className={`truth-rail ${bootState}`} aria-live="polite"><div className="truth-heading"><span className="status-dot" /><div><span>CHAIN TRUTH</span><strong>{statusLabel}</strong></div></div><dl><div><dt>Chain</dt><dd>{health?.chainId || 'Not verified'}</dd></div><div><dt>Quorum</dt><dd>{health?.quorumSize ? `${health.quorumThreshold} of ${health.quorumSize}` : 'Not verified'}</dd></div><div><dt>L1 height</dt><dd>{health?.l1Height ?? 'Unavailable'}</dd></div><div><dt>Indexer</dt><dd>{indexerStatus.state}</dd></div></dl></section>
    {health && health.probeFailures.length > 0 && <section className="failures" aria-labelledby="probe-title"><div><p className="eyebrow">Preflight detail</p><h2 id="probe-title">Some claims could not be verified</h2></div><ul>{health.probeFailures.map(failure => <li key={failure.probe}><strong>{failure.probe}</strong><span>{failure.message}</span></li>)}</ul></section>}
    {tab === 'send' ? <SendScreen /> : tab === 'receive' ? <ReceiveScreen /> : tab === 'activity' ? <ActivityFeed /> : tab === 'ripcord' ? <RipcordPanel /> : <div className="phase11-grid"><div className="primary-stack"><BalanceHero /><OnboardingScreen /><RipcordPanel /></div><div className="secondary-stack"><ActivityFeed /><WhatYouDontManage /></div></div>}
  </Layout>;
}
