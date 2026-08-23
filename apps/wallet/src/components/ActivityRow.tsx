import type { IndexerEvent } from '@ripcord/core/indexer';
import type { PaymentReceipt } from '@ripcord/core/types';
import { formatSats, truncate } from './ui';
export function ActivityRow({ item, receipt, ownerKeys, onProof }: { item: IndexerEvent | PaymentReceipt; receipt?: PaymentReceipt; ownerKeys: readonly string[]; onProof: (receipt: PaymentReceipt) => void }) {
  if ('txHash' in item && 'epoch' in item) return <article className="activity-row committed"><div><strong>{formatSats(item.amountSats)}</strong><span>{truncate(item.toXOnly)}</span></div><div><span>epoch {item.epoch}</span><button disabled={!item.hat} onClick={() => onProof(item)}>{item.hat ? 'View proof' : 'Proof unavailable'}</button></div></article>;
  if (item.kind === 'block:new') return <article className="activity-row block"><div><strong>Block {item.height}</strong><span>{item.txCount} committed transactions</span></div><span>{item.epochClosed !== undefined ? `epoch ${item.epochClosed} closed` : 'chain event'}</span></article>;
  const ownedAmount = item.vout.filter(out => ownerKeys.includes(out.owner.toLowerCase())).reduce((sum, out) => sum + out.amountSats, 0n);
  const amount = receipt?.amountSats ?? (ownedAmount > 0n ? ownedAmount : item.vout.reduce((sum, out) => sum + out.amountSats, 0n));
  const proof = receipt?.hat ? <button onClick={() => onProof(receipt)}>View proof</button> : <button disabled>{item.kind === 'tx:pending' ? 'Awaiting commit' : 'Proof unavailable'}</button>;
  return <article className={`activity-row ${item.committed ? 'committed' : 'pending'}`}><div><strong>{formatSats(amount)}</strong><span>{truncate(item.txHash)}</span></div><div><span>{item.kind === 'tx:pending' ? 'pending' : `height ${item.height}`}</span>{proof}</div></article>;
}
