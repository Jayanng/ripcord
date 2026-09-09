import { useBalance } from '../hooks/useBalance';
import { useWallet } from '../context/WalletContext';
import { formatSats, Icon } from './ui';

export interface BalanceHeroProps {
  onSend?: () => void;
  onReceive?: () => void;
  onRipcord?: () => void;
}

export function BalanceHero({ onSend, onReceive, onRipcord }: BalanceHeroProps = {}) {
  const balance = useBalance(); const { vaults } = useWallet();
  return <section id="balance" className="instrument balance-card" aria-labelledby="balance-title">
    <div className="section-heading"><div><p className="eyebrow">TAURUS Custody Split</p><h2 id="balance-title">Balances stay separate</h2></div><Icon name="shield" /></div>
    <div className="balance-primary"><span>OFF-CHAIN · SPENDABLE NOW</span><strong>{formatSats(balance.offChainSats)}</strong><small>{balance.vtxoCount ? `across ${balance.vtxoCount} VTXOs` : 'No VTXO snapshot loaded'}</small></div>
    <div className="balance-secondary"><div><span>ON-CHAIN · IN TAURUS VAULTS</span><strong>{formatSats(balance.onChainSats)}</strong></div><small>{vaults.length} {vaults.length === 1 ? 'TAURUS vault' : 'TAURUS vaults'} · public records</small></div>
    {(onSend || onReceive || onRipcord) && <div className="balance-actions">
      {onSend && <button type="button" className="action-btn" onClick={onSend}><Icon name="send" /><span>Send VTXO</span></button>}
      {onReceive && <button type="button" className="action-btn" onClick={onReceive}><Icon name="receive" /><span>Receive</span></button>}
      {onRipcord && <button type="button" className="action-btn ripcord-action" onClick={onRipcord}><Icon name="ripcord" /><span>Ripcord Exit</span></button>}
    </div>}
  </section>;
}
