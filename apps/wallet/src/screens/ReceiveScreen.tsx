import { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { QrCode } from '../components/QrCode';

export function ReceiveScreen() {
  const { identity, indexerStatus } = useWallet();
  const [copyState, setCopyState] = useState('');
  if (!identity) return <section className="flow-screen"><div className="flow-heading"><p className="eyebrow">Receive</p><h2>No receive identity loaded</h2><p>Return to Balance and create a wallet identity before sharing an address.</p></div></section>;
  const copy = async () => { try { await navigator.clipboard.writeText(identity.userAddress); setCopyState('Address copied'); } catch { setCopyState('Clipboard access failed. Select and copy the address manually.'); } };
  return <section className="flow-screen receive-screen"><div className="flow-heading"><p className="eyebrow">User-key payment address</p><h2>Receive VTXO sats</h2><p>Indexer: <strong>{indexerStatus.state}</strong>. A closed indexer means arrivals will not appear live yet.</p></div><QrCode value={identity.userAddress}/><label className="address-label" htmlFor="receive-address">Address</label><output id="receive-address" className="receive-address">{identity.userAddress}</output><button className="test-pull" onClick={() => void copy()}>Copy address</button>{copyState && <p className={copyState.startsWith('Address copied') ? 'flow-note' : 'inline-error'} role="status">{copyState}</p>}</section>;
}
