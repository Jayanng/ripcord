import { useState } from 'react';
import type { PaymentReceipt } from '@ripcord/core/types';
import { useActivity } from '../hooks/useActivity';
import { ActivityRow } from './ActivityRow';
import { ProofSheet } from './ProofSheet';
export function ActivityFeed() {
  const { activity, receipts, indexerStatus, identity } = useActivity();
  const [selected, setSelected] = useState<PaymentReceipt | null>(null);
  const receiptByHash = new Map(receipts.map(receipt => [receipt.txHash.toLowerCase(), receipt]));
  const eventHashes = new Set(activity.flatMap(item => 'txHash' in item ? [item.txHash.toLowerCase()] : []));
  const items = [...activity, ...receipts.filter(receipt => !eventHashes.has(receipt.txHash.toLowerCase()))];
  const ownerKeys = identity ? [identity.xOnly.toLowerCase(), identity.userKeyDescriptor.publicKey.toLowerCase()] : [];
  return <section id="activity" className="instrument activity-card"><div className="section-heading"><div><p className="eyebrow">Live evidence stream</p><h2>Activity</h2></div><span className={`connection ${indexerStatus.state}`}>Indexer {indexerStatus.state}</span></div>{items.length ? <div className="activity-list">{items.map((item, index) => { const receipt = 'txHash' in item ? receiptByHash.get(item.txHash.toLowerCase()) : undefined; const key = 'epoch' in item ? `receipt:${item.txHash.toLowerCase()}` : item.kind === 'block:new' ? `block:${item.height}:${item.receivedAt}` : `tx:${item.txHash.toLowerCase()}:${item.kind}`; return <ActivityRow key={key || index} item={item} receipt={receipt} ownerKeys={ownerKeys} onProof={setSelected} />; })}</div> : <div className="empty-state"><span className="empty-glyph">⌁</span><strong>No activity restored</strong><p>Pending events, committed transactions, and proof receipts will appear here.</p></div>}<ProofSheet receipt={selected} onClose={() => setSelected(null)} /></section>;
}
