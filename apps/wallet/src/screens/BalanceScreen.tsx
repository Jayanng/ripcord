import { useWallet } from '../context/WalletContext';
import { SentinelAlertBanner } from '../components/WatchtowerPanel';
import { explorerTxUrl } from '../components/ui';
import { SentinelPanel } from '../components/SentinelPanel';
import { BalanceHero } from '../components/BalanceHero';
import { VaultStatusCard } from '../components/VaultStatusCard';
import { VtxoManagementCard } from '../components/VtxoManagementCard';
import { TruthRail } from '../components/TruthRail';
import { WhatYouDontManage } from '../components/WhatYouDontManage';

export function BalanceScreen({
  onSend,
  onReceive,
  onExit,
}: {
  onSend?: () => void;
  onReceive?: () => void;
  onExit?: () => void;
}) {
  const { identity, exitReadiness } = useWallet();

  return (
    <div className="balance-screen-stack" style={{ display: 'grid', gap: '20px' }}>
      {/* 1. SentinelAlertBanner (only when a sentinel alert exists) */}
      <SentinelAlertBanner onExit={() => onExit?.()} />

      {/* Exit visibility: when the vault funding has been swept to L1, say so
          loudly instead of showing stale numbers as if nothing happened. */}
      {exitReadiness?.status === 'spent' && (() => {
        const spentBy = exitReadiness.spentBy ?? null;
        const sovereignSweep = Boolean(
          spentBy?.txid &&
          identity?.l1Address &&
          spentBy.destination === identity.l1Address &&
          (spentBy.confirmations ?? 0) > 0,
        );
        const pendingSweep = Boolean(
          spentBy?.txid &&
          identity?.l1Address &&
          spentBy.destination === identity.l1Address &&
          (spentBy.confirmations ?? 0) === 0,
        );
        return (
        <div
          role="status"
          style={{
            margin: '0 0 16px', padding: '16px 18px', borderRadius: 14,
            background: 'rgba(5, 150, 105, 0.1)', border: '1px solid rgba(5, 150, 105, 0.35)',
            color: 'var(--text-hi, #0F172A)', fontSize: 13.5, lineHeight: 1.55,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>
            {sovereignSweep ? 'Exited to Bitcoin L1' : pendingSweep ? 'Exit waiting for confirmation' : 'Funding spent on Bitcoin L1'}
          </strong>
          {sovereignSweep
            ? "This vault's funds have been swept back to your own L1 settlement address. The vault is now closed and shows as spent. The exit transaction is the proof; find it in Activity or on the Exit screen."
            : pendingSweep
              ? 'An exit transaction is waiting for confirmation in the mempool. Treat funds as swept only once it confirms. Find it in Activity or on the Exit screen.'
              : "This vault's funding outpoint has been spent on Bitcoin L1. Inspect the transaction in Activity or on the Exit screen to verify where the funds went."}
          {spentBy?.txid && (
            <span style={{ display: 'block', marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 12, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
              {sovereignSweep || pendingSweep ? 'Exit transaction: ' : 'Spending transaction: '}
              <a href={explorerTxUrl(spentBy.txid)} target="_blank" rel="noreferrer">{spentBy.txid}</a>
            </span>
          )}
        </div>
        );
      })()}
      {/* 2 & 3. BalanceHero (single source of balance truth + quick actions row) */}
      <BalanceHero onSend={onSend} onReceive={onReceive} onRipcord={onExit} />

      {/* 2b. Sentinel: watch-only vault health (score + plain-English findings) */}
      <SentinelPanel />

      {/* 4. VaultStatusCard (merged card: identity + address + funding pipeline + registration + L1 anchors) */}
      <VaultStatusCard />

      {/* 5. VtxoManagementCard (VTXO inventory list only, no balance totals repeated) */}
      <VtxoManagementCard />

      {/* 6. Collapsible "Advanced" section (collapsed by default) */}
      <details className="instrument vtxo-management-card advanced-section">
        <summary className="section-heading vtxo-summary" aria-label="Toggle Advanced protocol and diagnostics">
          <div>
            <p className="eyebrow">PROTOCOL &amp; DIAGNOSTICS</p>
            <h2 id="advanced-section-title">Advanced</h2>
          </div>
          <div className="vtxo-summary-right">
            <span className="vtxo-total-pill">Chain truth · Sentinel · Custody</span>
            <span className="vtxo-chevron" aria-hidden="true">▾</span>
          </div>
        </summary>
        <div className="advanced-content" style={{ display: 'grid', gap: '20px', padding: '0 24px 24px' }}>
          {identity?.userKeyDescriptor?.path && (
            <div className="inspector" style={{ marginTop: 0 }}>
              <div className="inspector-grid" style={{ padding: '14px 18px' }}>
                <div>
                  <span>BIP-32 Derivation Path</span>
                  <code>{identity.userKeyDescriptor.path}</code>
                </div>
              </div>
            </div>
          )}
          <TruthRail />
          <WhatYouDontManage />
        </div>
      </details>
    </div>
  );
}
