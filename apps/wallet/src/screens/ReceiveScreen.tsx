import { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { QrCode } from '../components/QrCode';

export function ReceiveScreen() {
  const { identity, indexerStatus } = useWallet();
  const [copyState, setCopyState] = useState('');
  if (!identity) return <section className="flow-screen"><div className="flow-heading"><p className="eyebrow">Receive</p><h2>No receive identity loaded</h2><p>Return to Balance and create a wallet identity before sharing an address.</p></div></section>;

  const copy = async (text: string, label = 'Address') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(`${label} copied`);
      window.setTimeout(() => setCopyState(''), 3000);
    } catch {
      setCopyState('Clipboard access failed. Select and copy the address manually.');
    }
  };

  return <section className="flow-screen receive-screen">
    <div className="flow-heading">
      <p className="eyebrow">User-key payment address</p>
      <h2>Receive VTXO sats</h2>
      <p>Indexer: <strong>{indexerStatus.state}</strong>. A closed indexer means arrivals will not appear live yet.</p>
    </div>
    <QrCode value={identity.userAddress} />
    <label className="address-label" htmlFor="receive-address">Off-chain VTXO address</label>
    <output id="receive-address" className="receive-address">{identity.userAddress}</output>
    <button className="test-pull" onClick={() => void copy(identity.userAddress, 'Address')}>Copy address</button>
    <div className="settlement-receive-card">
      <div className="settlement-receive-header">
        <span className="address-label">L1 Settlement Address (Vault Funding)</span>
        <button type="button" className="secondary-action-compact" onClick={() => void copy(identity.l1Address, 'L1 address')}>
          Copy L1
        </button>
      </div>
      <output className="receive-address-compact">{identity.l1Address}</output>
      <small className="form-help">Use this SegWit address for on-chain Bitcoin deposits or faucet funding.</small>
    </div>
    {copyState && <p className={copyState.includes('copied') ? 'flow-note' : 'inline-error'} role="status">{copyState}</p>}
  </section>;
}
