import { useBalance } from '../hooks/useBalance';
import { useWallet } from '../context/WalletContext';
import { formatSats, Icon } from './ui';

export interface BalanceHeroProps {
  onSend?: () => void;
  onReceive?: () => void;
  onRipcord?: () => void;
}

export function BalanceHero({ onSend, onReceive, onRipcord }: BalanceHeroProps = {}) {
  const balance = useBalance();
  const { vaults } = useWallet();
  return <section id="balance" className="instrument balance-card" aria-labelledby="balance-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">TAURUS Custody Split</p>
        <h2 id="balance-title">Balances stay separate</h2>
      </div>
      <Icon name="shield" />
    </div>

    {/* Off-chain spendable balance (snapshot-based source of spendable balance) */}
    <div className="balance-primary">
      <span>OFF-CHAIN · SPENDABLE NOW</span>
      <strong>{formatSats(balance.offChainSats)}</strong>
      <small>{balance.vtxoCount ? `across ${balance.vtxoCount} VTXOs` : 'No VTXO snapshot loaded'}</small>
    </div>

    {/* Pending incoming credits (Scope 2) */}
    <div className="balance-secondary balance-pending">
      <div>
        <span>PENDING INCOMING · NOT COMMITTED</span>
        <strong style={balance.pendingIncomingSats > 0n ? { color: 'var(--pending)' } : undefined}>
          {balance.pendingIncomingSats > 0n ? `+${formatSats(balance.pendingIncomingSats)}` : '0 SATS'}
        </strong>
      </div>
      <small>{balance.pendingIncomingSats > 0n ? 'Awaiting block commit' : 'No incoming pending'}</small>
    </div>

    {/* Locked VTXOs (Scope 4) - locked is NOT spendable */}
    <div className="balance-secondary balance-locked">
      <div>
        <span>LOCKED · IN COOPERATIVE ESCROW</span>
        <strong>{formatSats(balance.lockedSats)}</strong>
      </div>
      <small>{balance.lockedCount > 0 ? `${balance.lockedCount} locked VTXO${balance.lockedCount === 1 ? '' : 's'}` : '0 locked VTXOs'}</small>
    </div>

    {/* On-chain vault funding */}
    <div className="balance-secondary">
      <div>
        <span>ON-CHAIN · IN TAURUS VAULTS</span>
        <strong>{formatSats(balance.onChainSats)}</strong>
      </div>
      <small>{vaults.length} {vaults.length === 1 ? 'TAURUS vault' : 'TAURUS vaults'} · public records</small>
    </div>

    {(onSend || onReceive || onRipcord) && <div className="balance-actions">
      {onSend && <button type="button" className="action-btn" onClick={onSend}><Icon name="send" /><span>Send VTXO</span></button>}
      {onReceive && <button type="button" className="action-btn" onClick={onReceive}><Icon name="receive" /><span>Receive</span></button>}
      {onRipcord && <button type="button" className="action-btn ripcord-action" onClick={onRipcord}><Icon name="ripcord" /><span>Ripcord Exit</span></button>}
    </div>}
  </section>;
}
