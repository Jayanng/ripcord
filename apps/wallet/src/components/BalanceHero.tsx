import { useState } from 'react';
import { useBalance } from '../hooks/useBalance';
import { useWallet } from '../context/WalletContext';
import { formatSats, Icon } from './ui';
import { Skeleton } from './Skeleton';

export interface BalanceHeroProps {
  onSend?: () => void;
  onReceive?: () => void;
  onRipcord?: () => void;
}

export function BalanceHero({ onSend, onReceive, onRipcord }: BalanceHeroProps = {}) {
  const balance = useBalance();
  const { vaults, bootState, refresh, lastRefreshedAt, vtxoSnapshotLoaded, receipts, balanceCrossCheck } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  // Phase 9 (#22): skeletons until the first VTXO snapshot lands - the honest
  // "still loading" signal. After that, real values (including zeros) show.
  const firstLoad = !vtxoSnapshotLoaded;
  const updatedAt = lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString() : null;
  const runRefresh = () => {
    setRefreshing(true);
    void Promise.resolve(refresh()).finally(() => setRefreshing(false));
  };
  return <section id="balance" className="instrument balance-card" aria-labelledby="balance-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">TAURUS Custody Split</p>
        <h2 id="balance-title">Balances stay separate</h2>
      </div>
      <Icon name="shield" />
    </div>
    {/* Phase 10 (#27): always-on proof badge - reserves + inclusion at a glance */}
    <div className="proof-badge-row" aria-label="Proof status">
      <span className={`proof-badge ${balanceCrossCheck?.matches === false ? 'warn' : ''}`} title="L1 reserves cross-checked against the live chain snapshot">
        {balanceCrossCheck
          ? balanceCrossCheck.chainReachable
            ? balanceCrossCheck.matches
              ? 'L1 Reserves Verified'
              : 'Reserves Mismatch'
            : 'Reserves Unchecked (chain unreachable)'
          : 'Checking L1 Reserves'}
      </span>
      <span className={`proof-badge ${receipts.some(r => r.hat) ? '' : 'muted'}`} title="Cryptographic HAT proofs on record for your payments">
        {receipts.filter(r => r.hat).length} of {receipts.length} Proofs On Record
      </span>
      <span className={`proof-badge ${receipts.some(r => r.rip?.hatInStateDiff) ? '' : 'muted'}`} title="HAT inclusion in the Verkle state diff">
        {receipts.some(r => r.rip?.hatInStateDiff) ? 'Inclusion Proven' : 'Inclusion Not Yet Proven'}
      </span>
    </div>
    {/* Phase 9 (#23): last-updated timestamp + tap-to-refresh on the custody split */}
    <div className="custody-updated-row">
      <span className="truth-updated" role="status">{updatedAt ? `Updated ${updatedAt}` : 'Not checked yet'}</span>
      <button type="button" className="secondary-action-compact" onClick={runRefresh} disabled={refreshing || bootState === 'checking'}>
        {refreshing ? 'Refreshing…' : 'Tap to refresh'}
      </button>
    </div>

    {/* Off-chain spendable balance (snapshot-based source of spendable balance) */}
    <div className="balance-primary">
      <span>OFF-CHAIN · SPENDABLE NOW</span>
      {firstLoad ? <Skeleton width="58%" height={26} radius={8} /> : <strong>{formatSats(balance.offChainSats)}</strong>}
      <small>{balance.vtxoCount ? `across ${balance.vtxoCount} VTXOs` : 'No VTXO snapshot loaded'}</small>
    </div>

    {/* Pending incoming credits (Scope 2) */}
    <div className="balance-secondary balance-pending">
      <div>
        <span>PENDING INCOMING · NOT COMMITTED</span>
        <strong style={balance.pendingIncomingSats > 0n ? { color: 'var(--pending)' } : undefined}>
          {balance.pendingIncomingSats > 0n ? `+${formatSats(balance.pendingIncomingSats)}` : '0 sats'}
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
        {firstLoad ? <Skeleton width="45%" height={18} radius={6} /> : <strong>{formatSats(balance.onChainSats)}</strong>}
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
