import { useState } from 'react';
import type { PaymentReceipt } from '@ripcord/core/types';
import { useActivity } from '../hooks/useActivity';
import { ActivityRow, type ActivityItem, type VaultDepositActivity, type FaucetActivity, type VtxoSpentActivity } from './ActivityRow';
import { ProofSheet } from './ProofSheet';

export function ActivityFeed() {
  const { activity, receipts, indexerStatus, identity, activeVault, spentVtxos } = useActivity();
  const [selected, setSelected] = useState<PaymentReceipt | null>(null);

  const receiptByHash = new Map(receipts.map(receipt => [receipt.txHash.toLowerCase(), receipt]));

  // Synthesize on-chain activity entries for L1 deposit and faucet testnet funding
  const onChainItems: (VaultDepositActivity | FaucetActivity)[] = [];

  if (activeVault?.funding?.txid) {
    onChainItems.push({
      kind: 'tx:deposit',
      txHash: activeVault.funding.txid,
      amountSats: activeVault.funding.valueSats,
      vout: activeVault.funding.vout,
      vaultAddress: activeVault.address,
      committed: true,
      createdAt: activeVault.createdAt ?? Date.now(),
    });
  }

  if (activeVault) {
    const savedDeposit = localStorage.getItem(`ripcord:deposit:${activeVault.address}`);
    if (savedDeposit && /^[0-9a-f]{64}$/i.test(savedDeposit) && savedDeposit.toLowerCase() !== activeVault.funding?.txid?.toLowerCase()) {
      onChainItems.push({
        kind: 'tx:deposit',
        txHash: savedDeposit,
        amountSats: 40_000n,
        vout: 0,
        vaultAddress: activeVault.address,
        committed: false,
        createdAt: Date.now(),
      });
    }
  }

  if (identity) {
    const savedFaucet = localStorage.getItem(`ripcord:faucet:${identity.l1Address}`);
    if (savedFaucet && /^[0-9a-f]{64}$/i.test(savedFaucet)) {
      onChainItems.push({
        kind: 'tx:faucet',
        txHash: savedFaucet,
        amountSats: 50_000_000n,
        address: identity.l1Address,
        committed: true,
        createdAt: (activeVault?.createdAt ?? Date.now()) - 1000,
      });
    }
  }

  const knownTxHashes = new Set(activity.flatMap(item => 'txHash' in item ? [item.txHash.toLowerCase()] : []));
  const dedupedReceipts = receipts.filter(receipt => !knownTxHashes.has(receipt.txHash.toLowerCase()));
  for (const r of dedupedReceipts) knownTxHashes.add(r.txHash.toLowerCase());
  const dedupedOnChain = onChainItems.filter(item => !knownTxHashes.has(item.txHash.toLowerCase()));

  const spentItems: VtxoSpentActivity[] = (spentVtxos ?? []).map(v => ({
    kind: 'vtxo:spent',
    id: v.id,
    amountSats: v.amountSats,
    height: v.height,
    owner: v.owner,
  }));

  const items: ActivityItem[] = [...activity, ...dedupedReceipts, ...dedupedOnChain, ...spentItems];
  const ownerKeys = identity ? [identity.xOnly.toLowerCase(), identity.userKeyDescriptor.publicKey.toLowerCase()] : [];

  return (
    <section id="activity" className="instrument activity-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live evidence stream</p>
          <h2>Activity</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <a
            className="explorer-link"
            href="https://explorer-regtest.tachibtc.com"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '11px' }}
          >
            Regtest Explorer ↗
          </a>
          <span className={`connection ${indexerStatus.state}`}>Indexer {indexerStatus.state}</span>
        </div>
      </div>
      {items.length ? (
        <div className="activity-list">
          {items.map((item, index) => {
            const receipt = 'txHash' in item ? receiptByHash.get(item.txHash.toLowerCase()) : undefined;
            const key = 'epoch' in item
              ? `receipt:${item.txHash.toLowerCase()}`
              : 'kind' in item && item.kind === 'block:new'
              ? `block:${item.height}:${item.receivedAt}`
              : 'kind' in item && item.kind === 'vtxo:spent'
              ? `spent:${item.id}`
              : 'kind' in item && item.kind === 'vault:breach'
              ? `breach:${item.spendTxid}:${item.detectedHeight}`
              : 'kind' in item && 'txHash' in item
              ? `tx:${item.txHash.toLowerCase()}:${item.kind}`
              : `item:${index}`;
            return (
              <ActivityRow
                key={key}
                item={item}
                receipt={receipt}
                ownerKeys={ownerKeys}
                onProof={setSelected}
              />
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-glyph">⌁</span>
          <strong>No activity restored</strong>
          <p>Pending events, committed transactions, and proof receipts will appear here.</p>
        </div>
      )}
      <ProofSheet receipt={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
