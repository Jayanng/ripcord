import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';

export function TruthRail() {
  const { bootState, health, indexerStatus, balanceCrossCheck, watchtowerStatus, vaultBreachReceipts } = useWallet();
  // Phase 9 (#19): compact sticky banner on mobile, expandable sheet.
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches) {
      setExpanded(false);
    }
  }, []);
  const statusLabel = bootState === 'ready'
    ? 'All probes answered'
    : bootState === 'checking'
    ? 'Checking live daemon'
    : bootState === 'unreachable'
    ? 'Daemon unreachable'
    : 'Daemon degraded';

  const crossCheckLabel = balanceCrossCheck
    ? !balanceCrossCheck.chainReachable || balanceCrossCheck.matches === null
      ? 'Chain unreachable'
      : balanceCrossCheck.matches
        ? 'Verified (matches chain)'
        : 'Reserves mismatch'
    : 'Not checked';

  return <>
    {/* Scope 5: Prominent warning state if any breach receipt exists for the user's vault */}
    {vaultBreachReceipts.length > 0 && (
      <section className="failures" role="alert" aria-labelledby="breach-warning-title">
        <div>
          <p className="eyebrow" style={{ color: '#DC2626' }}>SECURITY ALERT</p>
          <h2 id="breach-warning-title" style={{ color: '#DC2626', margin: 0, fontSize: '18px', fontWeight: 750 }}>
            Breach Detected on Active Vault ({vaultBreachReceipts.length})
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#7F1D1D' }}>
            The watchtower reported breach receipts for your vault. A unilateral exit or recovery is advised.
          </p>
        </div>
        <ul>
          {vaultBreachReceipts.map((receipt, idx) => (
            <li key={receipt.spendTxid || idx} style={{ borderLeft: '3px solid #DC2626' }}>
              <strong>Breach: {receipt.classification}</strong>
              <span>
                Spend txid: {receipt.spendTxid || 'unknown'} (vout {receipt.spendVout}) · Detected at L1 block {receipt.detectedHeight} · State {receipt.broadcastState}/{receipt.latestState}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )}

    <section className={`truth-rail ${bootState}`} aria-live="polite">
      <button
        type="button"
        className="truth-heading truth-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="status-dot" />
        <div><span>CHAIN TRUTH</span><strong>{statusLabel}</strong></div>
        <span className="truth-toggle-glyph" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <dl>
          <div><dt>Chain</dt><dd>{health?.chainId || 'Not verified'}</dd></div>
          <div><dt>Quorum</dt><dd>{health?.quorumSize ? `${health.quorumThreshold} of ${health.quorumSize}` : 'Not verified'}</dd></div>
          <div><dt>L1 height</dt><dd>{health?.l1Height ?? 'Unavailable'}</dd></div>
          <div><dt>Indexer</dt><dd>{`Indexer ${indexerStatus.state}`}</dd></div>
          {/* Scope 5: Watchtower status in CHAIN TRUTH */}
          <div><dt>Watchtower</dt><dd>{watchtowerStatus ? `${watchtowerStatus.mode} (L1: ${watchtowerStatus.lastScannedHeight})` : 'Not checked'}</dd></div>
          <div><dt>WT Receipts</dt><dd>{watchtowerStatus ? `${watchtowerStatus.receiptCount} receipts` : 'Not checked'}</dd></div>
          {/* Scope 3: Balance cross-check (informational, never silently changes balance) */}
          <div>
            <dt>Balance Cross-Check</dt>
            <dd>
              {crossCheckLabel}
            </dd>
          </div>
        </dl>
      )}
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
