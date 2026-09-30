import { useWallet } from '../context/WalletContext';
import { SentinelAlertBanner, WatchtowerPanel } from '../components/WatchtowerPanel';
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
  const { identity } = useWallet();

  return (
    <div className="balance-screen-stack" style={{ display: 'grid', gap: '20px' }}>
      {/* 1. SentinelAlertBanner (only when a sentinel alert exists) */}
      <SentinelAlertBanner onExit={() => onExit?.()} />

      {/* 2 & 3. BalanceHero (single source of balance truth + quick actions row) */}
      <BalanceHero onSend={onSend} onReceive={onReceive} onRipcord={onExit} />

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
          <WatchtowerPanel />
          <WhatYouDontManage />
        </div>
      </details>
    </div>
  );
}
