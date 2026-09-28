import { useWallet } from '../context/WalletContext';

/**
 * Exit-readiness ring: a compact glance at how mature the active vault's
 * unilateral exit timelock is. Tap jumps to the dual-path exit console.
 * Pure presentation of the readiness data the wallet already tracks.
 */
export function ExitRing() {
  const { activeVault: vault, exitReadiness } = useWallet();
  const status = exitReadiness?.status ?? (vault?.funding ? 'maturing' : 'unfunded');
  const csvBlocks = vault?.csvBlocks ?? 1;
  const confirmations = exitReadiness?.confirmations ?? 0;
  const percent =
    status === 'live'
      ? 100
      : status === 'maturing' && csvBlocks > 0
        ? Math.min(100, Math.round((confirmations / csvBlocks) * 100))
        : 0;

  const r = 22;
  const circumference = 2 * Math.PI * r;
  const filled = (percent / 100) * circumference;
  const label =
    status === 'live'
      ? 'Ready to pull'
      : status === 'maturing'
        ? `${percent}% matured`
        : status === 'spent'
          ? 'Exit spent'
          : 'Starts after funding';

  return (
    <a className="exit-ring" href="#exit" aria-label={`Unilateral exit maturity: ${label}. Open exit options.`}>
      <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={status === 'live' ? 'var(--confirmed)' : 'var(--primary)'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          transform="rotate(-90 28 28)"
        />
        <text x="28" y="32" textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--text-hi)">
          {status === 'live' ? '✓' : `${percent}%`}
        </text>
      </svg>
      <div className="exit-ring-copy">
        <strong>Unilateral exit</strong>
        <span>{label}{status === 'maturing' && exitReadiness?.confirmationsRemaining !== undefined ? ` · ${exitReadiness.confirmationsRemaining} blocks to go` : ''}</span>
      </div>
      <span className="exit-ring-cta">Exit options →</span>
    </a>
  );
}
