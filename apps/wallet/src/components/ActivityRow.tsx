import type { IndexerEvent } from '@ripcord/core/indexer';
import type { PaymentReceipt } from '@ripcord/core/types';
import {
  formatSats,
  truncate,
  explorerTxUrl,
  explorerBlockUrl,
  explorerVtxoUrl,
  L1Txid,
} from './ui';
import { ConfirmationsBadge } from './ConfirmationsBadge';

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

export interface ExitActivity {
  kind: 'tx:exit';
  txHash: string;
  amountSats: bigint;
  vaultAddress: string;
  destination: string;
  committed: boolean;
  createdAt: number;
}

export interface ConscienceActivity {
  kind: 'tx:conscience';
  amountSats: bigint;
  recipient: string;
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

export type ActivityItem = IndexerEvent | PaymentReceipt | VaultDepositActivity | FaucetActivity | VtxoSpentActivity | ExitActivity | ConscienceActivity;

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
    // A payment whose recipient is one of our own keys is a self-transfer
    // (a test move or consolidation), not a payment to someone else.
    const toSelf = item.fromXOnly === item.toXOnly
      || ownerKeys.some(key => key.toLowerCase() === item.toXOnly.toLowerCase());
    return (
      <article className="activity-row committed">
        <div>
          <div className="activity-title-group">
            <strong>{formatSats(item.amountSats)}</strong>
            <span className="activity-tag vtxo">{toSelf ? 'Payment to yourself' : 'VTXO Payment'}</span>
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
          <span>{toSelf ? `Moved within your own balance · Epoch ${item.epoch}` : `Epoch ${item.epoch} · To: ${truncate(item.toXOnly, 10, 8)}`}</span>
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
              onClick={() => onProof(item)}
            >
              {item.hat ? 'View proof' : 'Fetch proof'}
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
          <L1Txid txid={item.txHash} />
        </div>
        <div>
          <span>{item.committed ? `Confirmed on L1 · outpoint vout ${item.vout}` : 'Broadcasting / Confirming on L1'}</span>
          <ConfirmationsBadge txid={item.txHash} vout={item.vout} />
          <div className="activity-actions">
            <L1Txid txid={item.txHash} className="explorer-btn">
              Copy deposit txid
            </L1Txid>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === 'tx:conscience') {
    return (
      <article className="activity-row committed">
        <div>
          <div className="activity-title-group">
            <strong>{formatSats(item.amountSats)}</strong>
            <span className="activity-tag" style={{ background: 'rgba(217, 119, 6, 0.14)', color: '#B45309' }}>Conscience flagged</span>
          </div>
          <span className="tx-link">{truncate(item.recipient, 14, 10)}</span>
        </div>
        <div>
          <span>Your rules flagged this send and you sent it after reviewing them.</span>
        </div>
      </article>
    );
  }

  if (item.kind === 'tx:exit') {
    return (
      <article className={`activity-row ${item.committed ? 'committed' : 'pending'}`}>
        <div>
          <div className="activity-title-group">
            <strong>{formatSats(item.amountSats)}</strong>
            <span className="activity-tag l1">L1 Exit</span>
          </div>
          <L1Txid txid={item.txHash} />
        </div>
        <div>
          <span>Exited to Bitcoin L1 · funds at your settlement address</span>
          <ConfirmationsBadge txid={item.txHash} vout={0} />
          <div className="activity-actions">
            <L1Txid txid={item.txHash} className="explorer-btn">
              Copy txid
            </L1Txid>
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
          <L1Txid txid={item.txHash} />
        </div>
        <div>
          <span>Faucet settlement to L1 address</span>
          <div className="activity-actions">
            <L1Txid txid={item.txHash} className="explorer-btn">
              Copy faucet txid
            </L1Txid>
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
            <span className="activity-tag" style={{ background: '#F1F5F9', color: '#64748B' }}>VTXO used as input</span>
          </div>
          {txHash ? (
            <a
              className="tx-link"
              href={explorerVtxoUrl(item.id)}
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
          <span>{item.height ? `Used as input in a payment, not a loss · height ${item.height}` : 'Used as input in a payment, not a loss'}</span>
          <div className="activity-actions">
            {txHash && (
              <a
                className="explorer-btn"
                href={explorerVtxoUrl(item.id)}
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

  if (item.kind === 'vault:breach') {
    return (
      <article className="activity-row committed" style={{ borderLeft: '3px solid #DC2626' }}>
        <div>
          <div className="activity-title-group">
            <strong>Watchtower breach</strong>
            <span className="activity-tag l1">{item.classification}</span>
          </div>
          <L1Txid txid={item.spendTxid} />
        </div>
        <div>
          <span>
            Vault funding spent at L1 block {item.detectedHeight} · states {item.broadcastState}/{item.latestState}
          </span>
          <div className="activity-actions">
            <L1Txid txid={item.spendTxid} className="explorer-btn">Copy breach txid</L1Txid>
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
      onClick={() => {
        if (receipt) onProof(receipt);
      }}
    >
      Fetch proof
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
