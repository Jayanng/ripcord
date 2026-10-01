import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { Icon, formatSats, truncate, explorerTxUrl } from './ui';
import {
  announceOnce,
  alertsEnabled,
  notificationPermission,
  requestNotificationPermission,
  setAlertsEnabled,
  type AlertPermission,
} from '../lib/alerts';
import type { SentinelFinding, SentinelReport } from '@ripcord/core/sentinel';

/**
 * Sentinel: Ripcord's watch-only vault health card (Bounty #1 build, Phase 1).
 *
 * Interprets the core sentinel engine's findings into plain English: a
 * health score, one-line summary, and a findings list. Alerts (browser
 * notification or in-app toast) fire at most once per finding per session.
 * Watch-only: no secrets in, nothing written but the public alert toggle.
 */
export function SentinelPanel() {
  const wallet = useWallet();
  const [report, setReport] = useState<SentinelReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [alertsOn, setAlertsOn] = useState(() => alertsEnabled());
  const [permission, setPermission] = useState<AlertPermission>(() => notificationPermission());
  const lastBreachCount = useRef<number | null>(null);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const { fetchSentinelState, evaluateSentinel } = await import('@ripcord/core/sentinel');
      const { input } = await fetchSentinelState({
        baseUrl: wallet.daemonUrl,
        vaultIdHex: wallet.activeVault?.vaultIdHex,
        allowInsecureHttp: wallet.daemonUrl.startsWith('http://'),
      });
      const merged: typeof input = {
        ...input,
        exitReadiness: wallet.exitReadiness,
        crossCheck: wallet.balanceCrossCheck,
        liveValidators: wallet.health?.liveValidators,
        quorumThreshold: wallet.health?.quorumThreshold,
      };
      const next = evaluateSentinel(merged);
      setReport(next);
      for (const finding of next.findings) {
        if (finding.severity === 'alert') {
          announceOnce(`${finding.code}:${finding.title}`, finding.title, finding.detail);
        }
      }
    } catch {
      // The engine never throws by design; this is the last-resort guard so
      // the panel can never take the wallet down with it.
      setReport(null);
    } finally {
      setChecking(false);
    }
  }, [wallet.daemonUrl, wallet.activeVault?.vaultIdHex, wallet.exitReadiness, wallet.balanceCrossCheck, wallet.health]);

  // Cadence: on mount, every 60s while visible, on tab focus, and when the
  // watchtower reports new breach receipts (real-time angle).
  useEffect(() => {
    void runCheck();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runCheck();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runCheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [runCheck]);

  useEffect(() => {
    const count = wallet.vaultBreachReceipts.length;
    if (lastBreachCount.current === null) {
      lastBreachCount.current = count;
      return;
    }
    if (count !== lastBreachCount.current) {
      lastBreachCount.current = count;
      void runCheck();
    }
  }, [wallet.vaultBreachReceipts.length, runCheck]);

  const toggleAlerts = async () => {
    const next = !alertsOn;
    setAlertsOn(next);
    setAlertsEnabled(next);
    if (next && notificationPermission() === 'default') {
      const result = await requestNotificationPermission();
      setPermission(result);
    } else {
      setPermission(notificationPermission());
    }
  };

  const score = report?.score ?? 100;
  const statusLabel = report
    ? report.status === 'paused'
      ? 'Paused'
      : report.status === 'all-clear'
        ? 'All clear'
        : report.status === 'attention'
          ? 'Worth a look'
          : 'Needs attention'
    : 'Checking…';

  // Score ring geometry
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  return (
    <section className="instrument sentinel-panel" aria-labelledby="sentinel-title" role="status" aria-live="polite">
      <div className="section-heading">
        <div>
          <p className="eyebrow">RIPCORD SENTINEL</p>
          <h2 id="sentinel-title">Vault health</h2>
          <p className="balance-subtitle">Watches your vault so you can walk away. Checks only. Nothing leaves this device.</p>
        </div>
        <Icon name="shield" />
      </div>

      <div className="sentinel-body">
        <div className="sentinel-ring" aria-label={`Vault health score ${score} of 100`}>
          <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
            <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--line)" strokeWidth="8" />
            <circle
              cx="44"
              cy="44"
              r={radius}
              fill="none"
              stroke={score >= 80 ? 'var(--primary, #F36633)' : score >= 50 ? '#D97706' : '#DC2626'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference - dash}`}
              transform="rotate(-90 44 44)"
            />
            <text x="44" y="50" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--text-hi, #0F172A)">{score}</text>
          </svg>
          <span className={`sentinel-status sentinel-status-${report?.status ?? 'checking'}`}>{statusLabel}</span>
        </div>

        <div className="sentinel-findings">
          {report ? (
            report.findings.map((finding: SentinelFinding) => (
              <div key={`${finding.code}:${finding.title}`} className={`sentinel-finding sentinel-finding-${finding.severity}`}>
                <span className="sentinel-finding-chip">
                  {finding.severity === 'alert' ? 'Needs attention' : finding.severity === 'attention' ? 'Worth a look' : 'Good to know'}
                </span>
                <strong>{finding.title}</strong>
                <small>{finding.detail}</small>
              </div>
            ))
          ) : (
            <p className="sentinel-checking">Checking your vault…</p>
          )}
        </div>
      </div>

      <div className="sentinel-footer">
        <button type="button" className="secondary-action-compact" onClick={() => void runCheck()} disabled={checking}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
        <button type="button" className="secondary-action-compact" onClick={() => void toggleAlerts()} aria-pressed={alertsOn}>
          Alerts: {alertsOn ? 'on' : 'off'}
        </button>
        <span className="truth-updated">
          {report ? `Checked ${new Date(report.checkedAt).toLocaleTimeString()}` : 'Not checked yet'}
          {alertsOn && permission === 'denied' ? ' · in-app alerts only' : ''}
        </span>
      </div>

      {/* Watchtower details (merged from the old standalone panel): the raw
          audit view beneath the interpreted health summary. */}
      <details className="sentinel-watchtower">
        <summary className="section-heading vtxo-summary" aria-label="Toggle watchtower details">
          <div>
            <p className="eyebrow">Watchtower</p>
            <h3 id="watchtower-title">Surveillance details</h3>
          </div>
          <div className="vtxo-summary-right">
            <span className="vtxo-total-pill">{wallet.watchtowerStatus ? `MODE · ${wallet.watchtowerStatus.mode.toUpperCase()}` : 'NOT CONNECTED'}</span>
            <span className="vtxo-chevron" aria-hidden="true">▾</span>
          </div>
        </summary>
        <p className="form-help">
          The watchtower scans Bitcoin L1 for spends of your vault's funding output.{' '}
          {wallet.activeVault?.vaultIdHex
            ? 'Breach receipts for this vault arrive live over the vault subscription.'
            : 'Register a vault to subscribe to live breach receipts.'}
        </p>
        <dl className="watchtower-grid">
          <div>
            <dt>L1 scan height</dt>
            <dd>{wallet.watchtowerStatus ? wallet.watchtowerStatus.lastScannedHeight : 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Current L1 height</dt>
            <dd>{wallet.health?.l1Height ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Sweep threshold</dt>
            <dd>{wallet.watchtowerStatus ? formatSats(wallet.watchtowerStatus.sweepThreshold) : 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Bounty</dt>
            <dd>{wallet.watchtowerStatus ? (wallet.watchtowerStatus.bountyConfigured ? 'Configured' : 'Not configured') : 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Receipts on record</dt>
            <dd>{wallet.watchtowerStatus ? wallet.watchtowerStatus.receiptCount : 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Surveillance</dt>
            <dd>{wallet.activeVault?.vaultIdHex ? 'Active vault' : 'Standby'}</dd>
          </div>
        </dl>
        <div className="watchtower-receipts">
          <p className="eyebrow">Breach receipt history</p>
          {wallet.vaultBreachReceipts.length === 0 ? (
            <p className="form-help">
              No breach receipts. That is the healthy state: no spend of your vault funding has been flagged.
            </p>
          ) : (
            <ul className="breach-list">
              {wallet.vaultBreachReceipts.map((receipt, index) => {
                const tone = receipt.classification === 'anomalous' ? 'breach-anomalous' : receipt.classification === 'stale' ? 'breach-stale' : 'breach-legitimate';
                return (
                  <li key={`${receipt.spendTxid}-${index}`} className={`breach-item ${tone}`}>
                    <div className="breach-item-head">
                      <strong className={`breach-chip ${tone}`}>{receipt.classification}</strong>
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
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
