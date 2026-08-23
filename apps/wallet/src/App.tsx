import { useWallet } from './context/WalletContext';
import { useBalance } from './hooks/useBalance';

const formatSats = (value: bigint) => `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')} sats`;

function NetworkBadge() {
  return <div className="network-badge" aria-label="Network: Bitcoin regtest"><span />REGTEST</div>;
}

export function App() {
  const { bootState, health, vaults, receipts, refresh, indexerStatus } = useWallet();
  const balance = useBalance();
  const statusLabel = bootState === 'ready' ? 'All probes answered' : bootState === 'checking' ? 'Checking live daemon' : bootState === 'unreachable' ? 'Daemon unreachable' : 'Daemon degraded';

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#main" aria-label="Ripcord home"><span className="brand-mark">R</span><span>RIPCORD</span></a>
      <NetworkBadge />
    </header>

    <main id="main" className="dashboard">
      <section className="hero" aria-labelledby="wallet-title">
        <div>
          <p className="eyebrow">Sovereign wallet · live regtest</p>
          <h1 id="wallet-title">Proof before promise.</h1>
          <p className="lede">The wallet shell is online. Every value below names where it came from—and refuses to turn missing data into certainty.</p>
        </div>
        <button className="refresh" onClick={() => void refresh()} disabled={bootState === 'checking'}>{bootState === 'checking' ? 'Checking…' : 'Run preflight'}</button>
      </section>

      <section className={`truth-rail ${bootState}`} aria-live="polite">
        <div className="truth-heading"><span className="status-dot" /><div><span>CHAIN TRUTH</span><strong>{statusLabel}</strong></div></div>
        <dl>
          <div><dt>Chain</dt><dd>{health?.chainId || 'Not verified'}</dd></div>
          <div><dt>Quorum</dt><dd>{health?.quorumSize ? `${health.quorumThreshold} of ${health.quorumSize}` : 'Not verified'}</dd></div>
          <div><dt>L1 height</dt><dd>{health?.l1Height ?? 'Unavailable'}</dd></div>
          <div><dt>Indexer</dt><dd>{indexerStatus.state}</dd></div>
        </dl>
      </section>

      {health && health.probeFailures.length > 0 && <section className="failures" aria-labelledby="probe-title">
        <div><p className="eyebrow">Preflight detail</p><h2 id="probe-title">Some claims could not be verified</h2></div>
        <ul>{health.probeFailures.map(failure => <li key={failure.probe}><strong>{failure.probe}</strong><span>{failure.message}</span></li>)}</ul>
      </section>}

      <div className="columns">
        <section className="instrument balance-card">
          <div className="section-heading"><div><p className="eyebrow">Public wallet state</p><h2>Balances stay separate</h2></div><span className="local-chip">LOCAL RECORDS</span></div>
          <div className="balance-primary"><span>OFF-CHAIN · SPENDABLE</span><strong>{formatSats(balance.offChainSats)}</strong><small>No VTXO snapshot loaded</small></div>
          <div className="balance-secondary"><div><span>ON-CHAIN · IN VAULTS</span><strong>{formatSats(balance.onChainSats)}</strong></div><small>{vaults.length} persisted {vaults.length === 1 ? 'vault' : 'vaults'}</small></div>
        </section>

        <section className="instrument activity-card">
          <div className="section-heading"><div><p className="eyebrow">Receipt store</p><h2>Recent evidence</h2></div><span className="count">{receipts.length.toString().padStart(2, '0')}</span></div>
          <div className="empty-state"><span className="empty-glyph">⌁</span><strong>No receipts restored</strong><p>Committed payment evidence will appear here after a wallet identity is loaded.</p></div>
        </section>
      </div>
    </main>

    <nav className="tabbar" aria-label="Primary navigation">
      {['Balance', 'Send', 'Activity', 'Ripcord'].map((tab, index) => <button key={tab} className={index === 0 ? 'active' : ''} disabled={index !== 0}><span>{['◫','↗','≋','⟲'][index]}</span>{tab}</button>)}
    </nav>
  </div>;
}
