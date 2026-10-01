import { useState } from 'react';
import { readExitRecord } from '../lib/exitRecord';
import { loadSpendLog } from '../lib/conscience';
import { vaultRecordKey } from '../context/WalletContext';
import type { PaymentReceipt } from '@ripcord/core/types';
import { useActivity } from '../hooks/useActivity';
import { ActivityRow, type ActivityItem, type VaultDepositActivity, type FaucetActivity, type VtxoSpentActivity, type ExitActivity, type ConscienceActivity } from './ActivityRow';
import { ProofSheet } from './ProofSheet';
import { activitiesToCsv, activitiesToJson, downloadText, toExportable } from '../lib/activityExport';
import { readSavedDepositTxid } from '../lib/depositResume';
import { Skeleton } from './Skeleton';

type ActivityFilter = 'all' | 'transfers' | 'deposits' | 'blocks';

/** Bucket an item for the filter tabs (Phase 8, #15). */
function bucketOf(item: ActivityItem): Exclude<ActivityFilter, 'all'> {
  if (!('kind' in item)) return 'transfers'; // payment receipt
  if (item.kind === 'block:new') return 'blocks';
  if (item.kind === 'tx:deposit' || item.kind === 'tx:faucet') return 'deposits';
  if ((item.kind === 'tx:pending' || item.kind === 'tx:committed') && 'type' in item) {
    return item.type === 'transfer' ? 'transfers' : 'deposits';
  }
  return 'transfers'; // vtxo:spent and vault:breach are money movement
}

/** Wall-clock timestamp where the item carries one; receipts carry none. */
function timestampOf(item: ActivityItem): number | null {
  if ('receivedAt' in item && typeof item.receivedAt === 'number') return item.receivedAt;
  if ('createdAt' in item && typeof item.createdAt === 'number') return item.createdAt;
  return null;
}

function dayLabelOf(item: ActivityItem): string {
  const ts = timestampOf(item);
  return ts
    ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Undated';
}

export function ActivityFeed() {
  const { activity, receipts, indexerStatus, identity, activeVault, spentVtxos, vtxoSnapshotLoaded } = useActivity();
  const [selected, setSelected] = useState<PaymentReceipt | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [search, setSearch] = useState('');

  const receiptByHash = new Map(receipts.map(receipt => [receipt.txHash.toLowerCase(), receipt]));

  // Synthesize on-chain activity entries for L1 deposit and faucet testnet funding
  const onChainItems: (VaultDepositActivity | FaucetActivity | ExitActivity | ConscienceActivity)[] = [];

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
    const savedDeposit = readSavedDepositTxid(activeVault);
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

  // Exit visibility: the exit record (written at broadcast time or derived
  // from the chain) makes 'Exited to Bitcoin L1' show in Activity across
  // reloads, including exits that predate any local record.
  if (activeVault) {
    const exitRecord = readExitRecord(vaultRecordKey(activeVault));
    if (exitRecord) {
      onChainItems.push({
        kind: 'tx:exit',
        txHash: exitRecord.txid,
        amountSats: BigInt(exitRecord.amountSats),
        vaultAddress: activeVault.address,
        committed: true,
        createdAt: exitRecord.createdAt,
      });
    }
  }

  // Spend Conscience outcomes land in Activity when rules flagged a send the
  // user then chose to make (the plan's "outcomes logged to activity notes").
  for (const entry of loadSpendLog()) {
    if (entry.rulesRun > 0 && !entry.allPassed) {
      onChainItems.push({
        kind: 'tx:conscience',
        amountSats: BigInt(entry.amountSats),
        recipient: entry.recipient,
        createdAt: entry.at,
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
  const dedupedOnChain = onChainItems.filter(item => !('txHash' in item) || !knownTxHashes.has(item.txHash.toLowerCase()));

  const spentItems: VtxoSpentActivity[] = (spentVtxos ?? []).map(v => ({
    kind: 'vtxo:spent',
    id: v.id,
    amountSats: v.amountSats,
    height: v.height,
    owner: v.owner,
  }));

  const items: ActivityItem[] = [...activity, ...dedupedReceipts, ...dedupedOnChain, ...spentItems];
  const ownerKeys = identity ? [identity.xOnly.toLowerCase(), identity.userKeyDescriptor.publicKey.toLowerCase()] : [];

  // Phase 8 (#15): filter tabs + search over the evidence stream.
  const query = search.trim().toLowerCase();
  const filteredItems = items.filter(item => {
    if (filter !== 'all' && bucketOf(item) !== filter) return false;
    if (!query) return true;
    const exported = toExportable(item);
    return `${exported.kind} ${exported.reference} ${exported.detail} ${exported.amountSats}`.toLowerCase().includes(query);
  }).sort((a, b) => {
    // Read as a timeline: dated entries newest first, undated ledger rows
    // (payments and spent VTXOs carry no wall-clock) grouped at the end.
    const ta = timestampOf(a) ?? 0;
    const tb = timestampOf(b) ?? 0;
    return tb - ta;
  });

  const exportItems = () => filteredItems;
  const exportStem = `ripcord-activity-${new Date().toISOString().slice(0, 10)}`;
  if (!vtxoSnapshotLoaded) {
    return (
      <section id="activity" className="instrument activity-card" aria-busy="true" aria-label="Loading activity">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live evidence stream</p>
            <h2>Activity</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Skeleton width={120} height={24} radius={999} />
          </div>
        </div>
        <div style={{ display: 'grid', gap: '16px', padding: '24px' }}>
          <Skeleton width="100%" height={42} radius={8} />
          <div style={{ display: 'grid', gap: '10px', marginTop: '8px' }}>
            <Skeleton width="100%" height={68} radius={12} />
            <Skeleton width="100%" height={68} radius={12} />
            <Skeleton width="100%" height={68} radius={12} />
          </div>
        </div>
      </section>
    );
  }

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
      <div className="activity-toolbar" role="search">
        <div className="activity-filter-tabs" role="tablist" aria-label="Activity filter">
          {([['all', 'All'], ['transfers', 'Transfers'], ['deposits', 'Deposits'], ['blocks', 'Blocks']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`activity-filter-tab ${filter === id ? 'active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="activity-search-input"
          placeholder="Search hashes, types, amounts"
          value={search}
          onChange={event => setSearch(event.target.value)}
          aria-label="Search activity"
        />
        <div className="activity-export-row">
          <button
            type="button"
            className="secondary-action-compact"
            disabled={filteredItems.length === 0}
            onClick={() => downloadText(`${exportStem}.csv`, activitiesToCsv(exportItems()), 'text/csv')}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="secondary-action-compact"
            disabled={filteredItems.length === 0}
            onClick={() => downloadText(`${exportStem}.json`, activitiesToJson(exportItems()), 'application/json')}
          >
            Export JSON
          </button>
        </div>
      </div>
      {filteredItems.length ? (
        <div className="activity-list">
          {filteredItems.map((item, index) => {
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
            const day = dayLabelOf(item);
            const previousDay = index > 0 ? dayLabelOf(filteredItems[index - 1]) : null;
            return (
              <div key={key} className="activity-day-group">
                {day !== previousDay && (
                  <p className="activity-date-sep" role="separator">
                    {day}
                  </p>
                )}
                <ActivityRow
                  item={item}
                  receipt={receipt}
                  ownerKeys={ownerKeys}
                  onProof={setSelected}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-glyph">⌁</span>
          <strong>{items.length ? 'Nothing matches this filter' : 'No activity yet'}</strong>
          <p>
            {items.length
              ? 'Clear the search or switch the filter tab to see the rest of the evidence stream.'
              : 'No activity yet. Your transfers and deposits will appear here.'}
          </p>
        </div>
      )}
      <ProofSheet receipt={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
