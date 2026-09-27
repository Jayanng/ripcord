import type { IndexerEvent } from '@ripcord/core/indexer';
import type { PaymentReceipt } from '@ripcord/core/types';
import { formatSats, truncate, explorerTxUrl, explorerBlockUrl } from './ui';

export interface VaultDepositActivity {
  kind: 'tx:deposit';
  txHash: string;
  amountSats: bigint;
  vout: number;
  vaultAddress: string;
  committed: boolean;
  createdAt: number;
}

export interface FaucetActivity {
  kind: 'tx:faucet';
  txHash: string;
  amountSats: bigint;
  address: string;
  committed: boolean;
  createdAt: number;
}

export interface VtxoSpentActivity {
  kind: 'vtxo:spent';
  id: string;
  amountSats: bigint;
  height?: number;
  owner?: string;
  createdAt?: number;
}

export type ActivityItem = IndexerEvent | PaymentReceipt | VaultDepositActivity | FaucetActivity | VtxoSpentActivity;

export function ActivityRow({
  item,
  receipt,
  ownerKeys,
  onProof,
}: {
  item: ActivityItem;
  receipt?: PaymentReceipt;
  ownerKeys: readonly string[];
  onProof: (receipt: PaymentReceipt) => void;
}) {
  if ('epoch' in item && 'txHash' in item) {
    return (
      <article className="activity-row committed">
        <div>
          <div className="activity-title-group">
            <strong>{formatSats(item.amountSats)}</strong>
            <span className="activity-tag vtxo">VTXO Payment</span>
          </div>
          <a
            className="tx-link"
            href={explorerTxUrl(item.txHash)}
            target="_blank"
            rel="noreferrer"
            title={`View payment transaction ${item.txHash} on regtest explorer`}
          >
            {truncate(item.txHash, 14, 10)} ↗
          </a>
        </div>
        <div>
          <span>Epoch {item.epoch} · To: {truncate(item.toXOnly, 10, 8)}</span>
          <div className="activity-actions">
            <a
              className="explorer-btn"
              href={explorerTxUrl(item.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer ↗
            </a>
            <button
              type="button"
              disabled={!item.hat}
              onClick={() => onProof(item)}
            >
              {item.hat ? 'View proof' : 'Proof unavailable'}
            </button>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === 'tx:deposit') {
    return (
      <article className={`activity-row ${item.committed ? 'committed' : 'pending'}`}>
        <div>
          <div className="activity-title-group">
            <strong>{formatSats(item.amountSats)}</strong>
            <span className="activity-tag l1">L1 Vault Deposit</span>
          </div>
          <a
            className="tx-link"
            href={explorerTxUrl(item.txHash)}
            target="_blank"
            rel="noreferrer"
            title={`View deposit transaction ${item.txHash} on regtest explorer`}
          >
            {truncate(item.txHash, 14, 10)} ↗
          </a>
        </div>
        <div>
          <span>{item.committed ? `Confirmed on L1 · outpoint vout ${item.vout}` : 'Broadcasting / Confirming on L1'}</span>
          <div className="activity-actions">
            <a
              className="explorer-btn"
              href={explorerTxUrl(item.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer ↗
            </a>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === 'tx:faucet') {
    return (
      <article className="activity-row committed">
        <div>
          <div className="activity-title-group">
            <strong>{formatSats(item.amountSats)}</strong>
            <span className="activity-tag l1">L1 Faucet</span>
          </div>
          <a
            className="tx-link"
            href={explorerTxUrl(item.txHash)}
            target="_blank"
            rel="noreferrer"
            title={`View faucet transaction ${item.txHash} on regtest explorer`}
          >
            {truncate(item.txHash, 14, 10)} ↗
          </a>
        </div>
        <div>
          <span>Faucet settlement to L1 address</span>
          <div className="activity-actions">
            <a
              className="explorer-btn"
              href={explorerTxUrl(item.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer ↗
            </a>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === 'block:new') {
    return (
      <article className="activity-row block">
        <div>
          <div className="activity-title-group">
            <strong>Block {item.height}</strong>
            <span className="activity-tag">Block</span>
          </div>
          <a
            className="tx-link"
            href={explorerBlockUrl(item.height)}
            target="_blank"
            rel="noreferrer"
            title={`View block #${item.height} on regtest explorer`}
          >
            Block #{item.height} ↗
          </a>
        </div>
        <div>
          <span>
            {item.txCount} committed transactions
            {item.epochClosed !== undefined ? ` · epoch ${item.epochClosed} closed` : ' · chain event'}
          </span>
          <div className="activity-actions">
            <a
              className="explorer-btn"
              href={explorerBlockUrl(item.height)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer ↗
            </a>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === 'vtxo:spent') {
    const [txHash] = item.id.split(':');
    return (
      <article className="activity-row spent" style={{ opacity: 0.85 }}>
        <div>
          <div className="activity-title-group">
            <strong style={{ color: 'var(--text-lo)' }}>-{formatSats(item.amountSats)}</strong>
            <span className="activity-tag" style={{ background: '#F1F5F9', color: '#64748B' }}>Spent VTXO</span>
          </div>
          {txHash ? (
            <a
              className="tx-link"
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              title={`View spent VTXO ${item.id} on regtest explorer`}
            >
              {truncate(txHash, 14, 10)} ↗
            </a>
          ) : (
            <span className="tx-link">{truncate(item.id, 14, 10)}</span>
          )}
        </div>
        <div>
          <span>{item.height ? `Spent at height ${item.height}` : 'Spent VTXO on chain'}</span>
          <div className="activity-actions">
            {txHash && (
              <a
                className="explorer-btn"
                href={explorerTxUrl(txHash)}
                target="_blank"
                rel="noreferrer"
              >
                Explorer ↗
              </a>
            )}
          </div>
        </div>
      </article>
    );
  }

  const txEvent = item;
  const ownedAmount = txEvent.vout
    .filter(out => ownerKeys.includes(out.owner.toLowerCase()))
    .reduce((sum, out) => sum + out.amountSats, 0n);
  const amount = receipt?.amountSats ?? (ownedAmount > 0n ? ownedAmount : txEvent.vout.reduce((sum, out) => sum + out.amountSats, 0n));
  const proof = receipt?.hat ? (
    <button type="button" onClick={() => onProof(receipt)}>View proof</button>
  ) : txEvent.kind === 'tx:pending' ? (
    <button type="button" disabled title="Transaction is in consensus mempool awaiting block commit">Awaiting commit</button>
  ) : (
    <button
      type="button"
      disabled
      className="reserve-backed-btn"
      title="Secured on Bitcoin L1 by Proof of Reserves. Cryptographic HAT proofs are generated when spending VTXOs in transfer payments."
    >
      L1 Reserve Backed
    </button>
  );

  return (
    <article className={`activity-row ${txEvent.committed ? 'committed' : 'pending'}`}>
      <div>
        <div className="activity-title-group">
          <strong>{formatSats(amount)}</strong>
          <span className={`activity-tag ${txEvent.committed ? 'vtxo' : ''}`}>
            {txEvent.committed ? 'Committed' : 'Pending'}
          </span>
        </div>
        <a
          className="tx-link"
          href={explorerTxUrl(txEvent.txHash)}
          target="_blank"
          rel="noreferrer"
          title={`View transaction ${txEvent.txHash} on regtest explorer`}
        >
          {truncate(txEvent.txHash, 14, 10)} ↗
        </a>
      </div>
      <div>
        <span>{txEvent.kind === 'tx:pending' ? 'Pending consensus commit' : `Height ${txEvent.height}`}</span>
        <div className="activity-actions">
          <a
            className="explorer-btn"
            href={explorerTxUrl(txEvent.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            Explorer ↗
          </a>
          {proof}
        </div>
      </div>
    </article>
  );
}
