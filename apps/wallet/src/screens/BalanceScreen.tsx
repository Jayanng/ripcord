import { BalanceHero } from '../components/BalanceHero';
import { ExitRing } from '../components/ExitRing';
import { VtxoManagementCard } from '../components/VtxoManagementCard';
import { TruthRail } from '../components/TruthRail';
import { VaultStatusCard } from '../components/VaultStatusCard';
import { WatchtowerPanel, SentinelAlertBanner } from '../components/WatchtowerPanel';

export function BalanceScreen({
  onSend,
  onReceive,
  onExit,
}: {
  onSend?: () => void;
  onReceive?: () => void;
  onExit?: () => void;
}) {
  return <div className="balance-screen-stack" style={{ display: 'grid', gap: '20px' }}>
    <SentinelAlertBanner onExit={() => onExit?.()} />
    <BalanceHero onSend={onSend} onReceive={onReceive} onRipcord={onExit} />
    <ExitRing />
    <VtxoManagementCard onFund={onReceive} />
    <TruthRail />
    <WatchtowerPanel />
    <VaultStatusCard />
  </div>;
}
