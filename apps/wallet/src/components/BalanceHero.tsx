import { useEffect, useState } from 'react';
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
  const { vaults, bootState, refresh, lastRefreshedAt, vtxoSnapshotLoaded, receipts, balanceCrossCheck, exitReadiness, l1BalanceSats, identity } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  // Phase 9 (#22): skeletons until the first VTXO snapshot lands - the honest
  // "still loading" signal. After that, real values (including zeros) show.
  // Fix: bound the wait. If the snapshot stalls (blocked/slow network), stop
  // showing placeholder bars after 8s and show known values with an honest
  // "may be out of date" hint instead of gray bars forever.
  const [waitExpired, setWaitExpired] = useState(false);
  useEffect(() => {
    if (vtxoSnapshotLoaded && balanceCrossCheck) return;
    const timer = window.setTimeout(() => setWaitExpired(true), 8000);
    return () => window.clearTimeout(timer);
  }, [vtxoSnapshotLoaded, balanceCrossCheck]);
  const firstLoad = !vtxoSnapshotLoaded && !waitExpired;
  const snapshotStale = !vtxoSnapshotLoaded && waitExpired;
  const updatedAt = lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString() : null;
  const runRefresh = () => {
    setRefreshing(true);
    void Promise.resolve(refresh()).finally(() => setRefreshing(false));
  };
  const proofCount = receipts.filter(r => r.hat).length;

  return <section id="balance" className="instrument balance-card" aria-labelledby="balance-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">TAURUS Custody Split</p>
        <h2 id="balance-title">Your balance</h2>
        <p className="balance-subtitle">
          {balance.exited
            ? 'Your vault exited to Bitcoin L1. These balances are zero on purpose: your funds are at your settlement address.'
            : 'Vault and spending balances are tracked separately.'}
        </p>
      </div>
      <Icon name="shield" />
    </div>
    {/* Phase 10 (#27): always-on proof badge - reserves + inclusion at a glance */}
    <div className="proof-badge-row" aria-label="Proof status">
      <span className={`proof-badge ${balanceCrossCheck?.matches === false ? 'warn' : ''}`} title="L1 reserves cross-checked against the live chain snapshot">
        {balance.exited ? 'Vault exited to L1' : balanceCrossCheck
          ? balanceCrossCheck.chainReachable
            ? balanceCrossCheck.matches === true
              ? 'L1 Reserves Verified'
              : balanceCrossCheck.matches === false
                ? 'Reserves Mismatch'
                : 'Reserves Indeterminate'
            : 'Reserves Unchecked (chain unreachable)'
          : waitExpired
            ? 'Reserve check unavailable'
            : 'Checking L1 Reserves'}
      </span>
      <span className={`proof-badge ${proofCount > 0 ? '' : 'muted'}`} title="Cryptographic HAT proofs on record for your payments">
        {proofCount > 0 ? `${proofCount} proof${proofCount === 1 ? '' : 's'} on record` : 'No proofs on record yet'}
      </span>
    </div>

    {/* L1 settlement visibility: the user's plain Bitcoin balance (deposit
        change and exit proceeds live here), verified live on the chain. */}
    {identity && l1BalanceSats !== null && (
      <div className="balance-secondary">
        <div>
          <span>BITCOIN L1 · YOUR SETTLEMENT ADDRESS</span>
          <strong>{formatSats(l1BalanceSats)}</strong>
        </div>
        <small>Verified on the chain · {balance.exited ? 'your exit proceeds are here' : 'outside the vault, fully yours'}</small>
      </div>
    )}

    {balance.offChainSats === 0n && balance.pendingIncomingSats === 0n && balance.lockedSats === 0n && balance.onChainSats === 0n ? (
      <>
        {/* Fix 2 & 3: Friendly one-line zero state plus funding call-to-action near top */}
        <div className="balance-primary">
          <span>SPENDABLE BALANCE</span>
          {firstLoad ? <Skeleton width="58%" height={26} radius={8} /> : <strong>0 sats</strong>}
          <small className="balance-friendly-helper">{balance.exited ? 'Your exit settled. Your funds are at your L1 address. Fund a new vault round when you want back in.' : 'Nothing here yet. Fund your wallet to get started.'}</small>
          {onReceive && (
            <div style={{ marginTop: '14px' }}>
              <button type="button" className="test-pull balance-fund-cta" onClick={onReceive}>
                <Icon name="receive" />
                <span>Fund your wallet</span>
              </button>
            </div>
          )}
        </div>

        {/* Fix 3: Collapse the four technical rows behind expandable details control */}
        <details className="balance-details-drawer">
          <summary className="balance-details-summary" aria-label="Toggle Balance details">
            <span>Balance details</span>
            <span className="balance-details-chevron" aria-hidden="true">▾</span>
          </summary>
          <div className="balance-details-rows">
            <div className="balance-secondary">
              <div>
                <span>OFF-CHAIN · SPENDABLE NOW</span>
                <strong>{formatSats(balance.offChainSats)}</strong>
              </div>
              <small>{balance.vtxoCount ? `across ${balance.vtxoCount} VTXOs` : '0 VTXOs'}</small>
            </div>
            <div className="balance-secondary balance-pending">
              <div>
                <span>PENDING INCOMING · NOT COMMITTED</span>
                <strong>0 sats</strong>
              </div>
            </div>
            <div className="balance-secondary balance-locked">
              <div>
                <span>LOCKED · IN COOPERATIVE ESCROW</span>
                <strong>0 sats</strong>
              </div>
            </div>
            <div className="balance-secondary">
              <div>
                <span>ON-CHAIN · IN TAURUS VAULTS</span>
                <strong>0 sats</strong>
              </div>
              <small>{vaults.length} {vaults.length === 1 ? 'TAURUS vault' : 'TAURUS vaults'} · public records</small>
            </div>
          </div>
        </details>
      </>
    ) : (
      <>
        {/* Off-chain spendable balance (snapshot-based source of spendable balance) */}
        <div className="balance-primary">
          <span>OFF-CHAIN · SPENDABLE NOW</span>
          {firstLoad ? <Skeleton width="58%" height={26} radius={8} /> : <strong>{formatSats(balance.offChainSats)}</strong>}
          <small>{balance.vtxoCount ? `across ${balance.vtxoCount} VTXOs` : balance.exited ? 'Your exit settled. Your funds are at your L1 address. Fund a new vault round when you want back in.' : 'Nothing here yet. Fund your wallet to get started.'}</small>
        </div>

        {/* Pending incoming credits (Scope 2) */}
        <div className="balance-secondary balance-pending">
          <div>
            <span>PENDING INCOMING · NOT COMMITTED</span>
            <strong style={balance.pendingIncomingSats > 0n ? { color: 'var(--pending)' } : undefined}>
              {balance.pendingIncomingSats > 0n ? `+${formatSats(balance.pendingIncomingSats)}` : formatSats(0n)}
            </strong>
          </div>
          {balance.pendingIncomingSats > 0n && <small>Awaiting block commit</small>}
        </div>

        {/* Locked VTXOs (Scope 4) - locked is NOT spendable */}
        <div className="balance-secondary balance-locked">
          <div>
            <span>LOCKED · IN COOPERATIVE ESCROW</span>
            <strong>{formatSats(balance.lockedSats)}</strong>
          </div>
          {balance.lockedCount > 0 && (
            <small>{balance.lockedCount} locked VTXO{balance.lockedCount === 1 ? '' : 's'}</small>
          )}
        </div>

        {/* On-chain vault funding */}
        <div className="balance-secondary">
          <div>
            <span>ON-CHAIN · IN TAURUS VAULTS</span>
            {firstLoad ? <Skeleton width="45%" height={18} radius={6} /> : <strong>{formatSats(balance.onChainSats)}</strong>}
          </div>
          <small>{vaults.length} {vaults.length === 1 ? 'TAURUS vault' : 'TAURUS vaults'} · public records</small>
        </div>
      </>
    )}

    {/* Fix: honest hint when the snapshot never arrived within the bound */}
    {snapshotStale && (
      <small className="balance-stale-hint" role="status">
        Amounts shown are from your last known state and may be out of date.
      </small>
    )}

    {/* Phase 9 (#23): last-updated timestamp + tap-to-refresh on the balance block */}
    <div className="custody-updated-row">
      <span className="truth-updated" role="status">{updatedAt ? `Updated ${updatedAt}` : 'Not checked yet'}</span>
      <button type="button" className="secondary-action-compact" onClick={runRefresh} disabled={refreshing || bootState === 'checking'}>
        {refreshing ? 'Refreshing…' : 'Tap to refresh'}
      </button>
    </div>

    {(onSend || onReceive || onRipcord) && <div className="balance-actions">
      {onSend && <button type="button" className="action-btn" onClick={onSend}><Icon name="send" /><span>Send VTXO</span></button>}
      {onReceive && <button type="button" className="action-btn" onClick={onReceive}><Icon name="receive" /><span>Receive</span></button>}
      {onRipcord && <button type="button" className="action-btn ripcord-action" onClick={onRipcord}><Icon name="ripcord" /><span>Ripcord Exit</span></button>}
    </div>}
  </section>;
}
