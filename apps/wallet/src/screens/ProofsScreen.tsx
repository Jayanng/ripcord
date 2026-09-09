import { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { ProofSheet } from '../components/ProofSheet';
import { ProofOfReservesBadge } from '../components/ProofOfReservesBadge';
import { formatSats, truncate, Icon, explorerTxUrl } from '../components/ui';
import type { PaymentReceipt } from '@ripcord/core/types';

export function ProofsScreen() {
  const { receipts, activeVault, vaults } = useWallet();
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentReceipt | null>(null);

  return <section className="proofs-container" aria-labelledby="proofs-title">
    <div className="flow-heading">
      <p className="eyebrow">Cryptographic Evidence & Verifications</p>
      <h2 id="proofs-title">Proof before promise</h2>
      <p>Every balance and transfer is backed by explicit cryptographic proofs. Inspect vault reserves and transaction inclusion proofs below.</p>
    </div>

    <div className="proofs-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TAURUS On-Chain Custody</p>
          <h3>Proof of TAURUS Reserves</h3>
        </div>
        <Icon name="shield" />
      </div>
      {activeVault ? (
        <dl className="docs-facts" style={{ marginTop: '14px' }}>
          <div><dt>Vault Address</dt><dd>{activeVault.address}</dd></div>
          <div><dt>Script Binding</dt><dd><ProofOfReservesBadge vault={activeVault} /></dd></div>
          <div><dt>Quorum</dt><dd>{activeVault.quorumFingerprint}</dd></div>
          <div><dt>Funding Outpoint</dt><dd>{activeVault.funding ? <a className="explorer-link" href={explorerTxUrl(activeVault.funding.txid)} target="_blank" rel="noreferrer">{truncate(activeVault.funding.txid, 12, 10)}:{activeVault.funding.vout} ({formatSats(activeVault.funding.valueSats)}) ↗</a> : 'Unfunded'}</dd></div>
          <div><dt>Known Vaults</dt><dd>{vaults.length} recorded in local database</dd></div>
        </dl>
      ) : (
        <p style={{ marginTop: '14px', color: 'var(--text-lo)' }}>No active vault loaded. Create or recover an identity to view proof of reserves.</p>
      )}
    </div>

    <div className="proofs-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Payment Verification</p>
          <h3>Inclusion Receipts</h3>
        </div>
        <Icon name="proofs" />
      </div>
      {receipts.length > 0 ? (
        <div className="proofs-list">
          {receipts.map((receipt) => (
            <div key={receipt.txHash} className="proof-item">
              <div className="proof-item-info">
                <strong>{formatSats(receipt.amountSats)}</strong>
                <span>Tx: <a className="explorer-link" href={explorerTxUrl(receipt.txHash)} target="_blank" rel="noreferrer">{truncate(receipt.txHash, 14, 10)} ↗</a> · Epoch {receipt.epoch}</span>
                <span>{receipt.hat ? '✓ HAT proof committed' : 'Awaiting HAT'} · {receipt.rip ? `${receipt.rip.chainLength} epoch RIP chain` : 'Self-proof'}</span>
              </div>
              <button
                type="button"
                className="secondary-action"
                style={{ minHeight: '38px', padding: '0 14px' }}
                onClick={() => setSelectedReceipt(receipt)}
              >
                Inspect Proof
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ minHeight: '180px' }}>
          <span className="empty-glyph">⌁</span>
          <strong>No payment receipts yet</strong>
          <p>When you send or receive off-chain VTXO transfers, their cryptographic inclusion proofs will appear here.</p>
        </div>
      )}
    </div>

    <ProofSheet receipt={selectedReceipt} onClose={() => setSelectedReceipt(null)} />
  </section>;
}
