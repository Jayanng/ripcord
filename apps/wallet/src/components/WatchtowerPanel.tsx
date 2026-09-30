import { useWallet } from '../context/WalletContext';
import { formatSats } from './ui';
import { truncate, explorerTxUrl } from './ui';

/**
 * Phase 7 (#6): the full watchtower surface. The TruthRail keeps its two
 * summary dots; this panel is the audit view: scan progress, sweep threshold,
 * bounty status, and every breach receipt with its classification.
 */
export function WatchtowerPanel() {
  const { watchtowerStatus, vaultBreachReceipts, health, activeVault } = useWallet();

  const classificationTone = (classification: string) =>
    classification === 'anomalous' ? 'breach-anomalous' : classification === 'stale' ? 'breach-stale' : 'breach-legitimate';

  return (
    <section className="watchtower-panel" aria-labelledby="watchtower-title">
      <div className="watchtower-header">
        <div>
          <p className="eyebrow">Watchtower</p>
          <h3 id="watchtower-title">Sentinel surveillance</h3>
        </div>
        <span className={`watchtower-mode ${watchtowerStatus ? 'live' : ''}`}>
          {watchtowerStatus ? `MODE · ${watchtowerStatus.mode.toUpperCase()}` : 'NOT CONNECTED'}
        </span>
      </div>
      <p className="form-help">
        The watchtower scans Bitcoin L1 for spends of your vault's funding output.{' '}
        {activeVault?.vaultIdHex
          ? 'Breach receipts for this vault arrive live over the vault subscription.'
          : 'Register a vault to subscribe to live breach receipts.'}
      </p>
      <dl className="watchtower-grid">
        <div>
          <dt>L1 scan height</dt>
          <dd>{watchtowerStatus ? watchtowerStatus.lastScannedHeight : 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Current L1 height</dt>
          <dd>{health?.l1Height ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Sweep threshold</dt>
          <dd>{watchtowerStatus ? formatSats(watchtowerStatus.sweepThreshold) : 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Bounty</dt>
          <dd>{watchtowerStatus ? (watchtowerStatus.bountyConfigured ? 'Configured' : 'Not configured') : 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Receipts on record</dt>
          <dd>{watchtowerStatus ? watchtowerStatus.receiptCount : 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Surveillance</dt>
          <dd>{activeVault?.vaultIdHex ? 'Active vault' : 'Standby'}</dd>
        </div>
      </dl>

      <div className="watchtower-receipts">
        <p className="eyebrow">Breach receipt history</p>
        {vaultBreachReceipts.length === 0 ? (
          <p className="form-help">
            No breach receipts. That is the healthy state: no spend of your vault funding has been flagged.
          </p>
        ) : (
          <ul className="breach-list">
            {vaultBreachReceipts.map((receipt, index) => (
              <li key={`${receipt.spendTxid}-${index}`} className={`breach-item ${classificationTone(receipt.classification)}`}>
                <div className="breach-item-head">
                  <strong className={`breach-chip ${classificationTone(receipt.classification)}`}>{receipt.classification}</strong>
                  <a
                    className="tx-link"
                    href={explorerTxUrl(receipt.spendTxid)}
                    target="_blank"
                    rel="noreferrer"
                    title={`View L1 spend transaction ${receipt.spendTxid} on regtest explorer`}
                  >
                    {truncate(receipt.spendTxid, 12, 8)} ↗
                  </a>
                </div>
                <span className="breach-item-detail">
                  Funding output v{receipt.spendVout} spent at L1 block {receipt.detectedHeight} · broadcast state{' '}
                  {receipt.broadcastState} vs latest {receipt.latestState}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Phase 7 (#28): the sentinel alert. Renders only when a breach is live
 * (WS-pushed alert or an anomalous receipt on record) and offers the
 * documented response: go sovereign (unilateral exit) or inspect evidence.
 */
export function SentinelAlertBanner({ onExit }: { onExit: () => void }) {
  const { sentinelAlert, vaultBreachReceipts, dismissSentinel } = useWallet();
  const anomalous = vaultBreachReceipts.find(r => r.classification === 'anomalous' || r.classification === 'stale');
  const alert = sentinelAlert ?? (anomalous ? {
    classification: anomalous.classification,
    spendTxid: anomalous.spendTxid,
    detectedHeight: anomalous.detectedHeight,
    at: 0,
  } : null);
  if (!alert) return null;

  return (
    <section className="sentinel-alert" role="alert" aria-labelledby="sentinel-alert-title">
      <div className="sentinel-alert-head">
        <p className="eyebrow">Watchtower sentinel</p>
        <button type="button" className="secondary-action-compact" onClick={dismissSentinel} aria-label="Dismiss alert">
          Dismiss
        </button>
      </div>
      <h3 id="sentinel-alert-title">
        {alert.classification === 'anomalous'
          ? 'Anomalous spend of your vault detected'
          : alert.classification === 'stale'
            ? 'Stale-state spend of your vault detected'
            : 'Vault funding spend detected'}
      </h3>
      <p className="form-help">
        The watchtower classified a spend of your vault's funding output as <strong>{alert.classification}</strong> at L1
        block {alert.detectedHeight}. Spend txid {truncate(alert.spendTxid, 12, 8)}. If this was not you, your funds are
        at risk: pull the ripcord now (unilateral exit needs no quorum) or open a cooperative refund.
      </p>
      <div className="sentinel-alert-actions">
        <button type="button" className="test-pull" onClick={onExit}>
          Go to exit console
        </button>
        <a
          className="secondary-action"
          href={explorerTxUrl(alert.spendTxid)}
          target="_blank"
          rel="noreferrer"
        >
          Inspect spend on explorer ↗
        </a>
      </div>
    </section>
  );
}
