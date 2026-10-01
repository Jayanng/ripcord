import { useWallet } from '../context/WalletContext';
import { truncate, explorerTxUrl } from './ui';

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
