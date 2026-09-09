import { BalanceHero } from '../components/BalanceHero';
import { TruthRail } from '../components/TruthRail';
import { VaultStatusCard } from '../components/VaultStatusCard';

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
    <BalanceHero onSend={onSend} onReceive={onReceive} onRipcord={onExit} />
    <TruthRail />
    <VaultStatusCard />
  </div>;
}
