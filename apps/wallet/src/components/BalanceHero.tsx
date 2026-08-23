import { useBalance } from '../hooks/useBalance';
import { useWallet } from '../context/WalletContext';
import { formatSats, Icon } from './ui';

export function BalanceHero() {
  const balance = useBalance(); const { vaults } = useWallet();
  return <section id="balance" className="instrument balance-card" aria-labelledby="balance-title">
    <div className="section-heading"><div><p className="eyebrow">Custody split</p><h2 id="balance-title">Balances stay separate</h2></div><Icon name="shield" /></div>
    <div className="balance-primary"><span>OFF-CHAIN · SPENDABLE NOW</span><strong>{formatSats(balance.offChainSats)}</strong><small>{balance.vtxoCount ? `across ${balance.vtxoCount} VTXOs` : 'No VTXO snapshot loaded'}</small></div>
    <div className="balance-secondary"><div><span>ON-CHAIN · IN VAULTS</span><strong>{formatSats(balance.onChainSats)}</strong></div><small>{vaults.length} {vaults.length === 1 ? 'vault' : 'vaults'} · public records</small></div>
  </section>;
}
