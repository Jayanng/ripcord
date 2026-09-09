import { useWallet } from '../context/WalletContext';

export function TruthRail() {
  const { bootState, health, refresh, indexerStatus } = useWallet();
  const statusLabel = bootState === 'ready'
    ? 'All probes answered'
    : bootState === 'checking'
    ? 'Checking live daemon'
    : bootState === 'unreachable'
    ? 'Daemon unreachable'
    : 'Daemon degraded';

  return <>
    <section className={`truth-rail ${bootState}`} aria-live="polite">
      <div className="truth-heading">
        <span className="status-dot" />
        <div><span>CHAIN TRUTH</span><strong>{statusLabel}</strong></div>
      </div>
      <dl>
        <div><dt>Chain</dt><dd>{health?.chainId || 'Not verified'}</dd></div>
        <div><dt>Quorum</dt><dd>{health?.quorumSize ? `${health.quorumThreshold} of ${health.quorumSize}` : 'Not verified'}</dd></div>
        <div><dt>L1 height</dt><dd>{health?.l1Height ?? 'Unavailable'}</dd></div>
        <div><dt>Indexer</dt><dd>{`Indexer ${indexerStatus.state}`}</dd></div>
      </dl>
      <div className="truth-actions">
        <button
          type="button"
          className="refresh"
          onClick={() => void refresh()}
          disabled={bootState === 'checking'}
        >
          {bootState === 'checking' ? 'Checking…' : 'Run preflight'}
        </button>
      </div>
    </section>

    {health && health.probeFailures.length > 0 && (
      <section className="failures" aria-labelledby="probe-title">
        <div>
          <p className="eyebrow">Preflight detail</p>
          <h2 id="probe-title">Some claims could not be verified</h2>
        </div>
        <ul>
          {health.probeFailures.map(failure => (
            <li key={failure.probe}>
              <strong>{failure.probe}</strong>
              <span>{failure.message}</span>
            </li>
          ))}
        </ul>
      </section>
    )}
  </>;
}
