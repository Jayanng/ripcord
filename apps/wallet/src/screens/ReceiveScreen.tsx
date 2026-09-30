import { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { QrCode } from '../components/QrCode';
import { isDaemonSlowError, composeFlowErrorMessage } from '@ripcord/core/lifecycle';
import {
  buildPaymentUri,
  amountInWords,
  satsToBtc,
} from '../lib/recipients';
import { vaultRecordKey } from '../context/WalletContext';

type ReceiveMode = 'offchain' | 'l1' | 'vault';

const MODES: Array<{ id: ReceiveMode; label: string }> = [
  { id: 'offchain', label: 'Receive off-chain (instant)' },
  { id: 'l1', label: 'Fund from L1 (on-chain)' },
  { id: 'vault', label: 'Vault address (direct)' },
];

const MODE_COPY: Record<ReceiveMode, { eyebrow: string; title: string; guidance: string; label: string }> = {
  offchain: {
    eyebrow: 'User-key payment address',
    title: 'Receive VTXO sats',
    guidance:
      'Give this address to anyone paying you from a Tachi or TAURUS wallet. Payments arrive instantly as spendable VTXOs.',
    label: 'Off-chain VTXO address',
  },
  l1: {
    eyebrow: 'L1 settlement address',
    title: 'Fund from Bitcoin L1',
    guidance:
      'Use this address for on-chain Bitcoin deposits (exchanges, faucet, other BTC wallets). Funds arrive on L1, settle into your vault, then register as spendable sats.',
    label: 'L1 settlement address (SegWit)',
  },
  vault: {
    eyebrow: 'Vault address (direct funding)',
    title: 'Fund the vault directly',
    guidance:
      'Advanced: send BTC straight to your TAURUS vault address. The deposit is then registered by this wallet (two steps, both needed). Use "Check and register deposit" after the transaction confirms.',
    label: 'Vault P2TR address',
  },
};

export function ReceiveScreen({ onBack }: { onBack?: () => void } = {}) {
  const wallet = useWallet();
  const { identity, indexerStatus, activeVault } = wallet;
  const [copyState, setCopyState] = useState('');
  const [mode, setMode] = useState<ReceiveMode>('offchain');
  const [amountSats, setAmountSats] = useState('');
  const [memo, setMemo] = useState('');
  const [regBusy, setRegBusy] = useState(false);
  const [regFlow, setRegFlow] = useState('');
  const [regResult, setRegResult] = useState('');
  const [regError, setRegError] = useState('');

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

  const plainAddress =
    mode === 'offchain' ? identity.userAddress : mode === 'l1' ? identity.l1Address : activeVault?.address ?? '';

  // FIX #13: optional amount + memo become a BIP21 payment request in the QR.
  const requestedSats = /^\d+$/.test(amountSats.trim()) ? BigInt(amountSats.trim()) : 0n;
  const qrValue = plainAddress ? buildPaymentUri(plainAddress, requestedSats, memo) : '';
  const copyTarget = qrValue;

  // FIX #5: manual "register this deposit" trigger for direct-to-vault funds.
  const registerDirectDeposit = async () => {
    const vault = activeVault;
    if (!vault || !identity) return;
    setRegBusy(true);
    setRegFlow('checking');
    setRegResult('');
    setRegError('');
    try {
      const { fundVaultLifecycle } = await import('@ripcord/core/lifecycle');
      const result = await fundVaultLifecycle({
        vault,
        mnemonic: identity.mnemonic,
        bitcoinRpcBaseUrl: wallet.baseUrl,
        daemonBaseUrl: wallet.daemonUrl,
        amountSats: 0n, // register-only mode: never broadcasts
        claimedOutpoints: wallet.claimedOutpointsFor(vault),
        onProgress: stage => setRegFlow(stage),
      });
      const fundedRecord = {
        ...vault,
        funding: { txid: result.deposit.txid, vout: result.deposit.vout, valueSats: result.deposit.amountSats },
        vaultIdHex: result.vaultId,
        registered: true,
      };
      await wallet.updateVault(fundedRecord);
      wallet.selectVault(vaultRecordKey(fundedRecord));
      setRegResult(
        result.vtxoId
          ? `Registered. Deposit ${result.deposit.amountSats.toString()} sats is now spendable.`
          : 'Registered. The deposit is now tracked by this wallet.',
      );
    } catch (e) {
      setRegError(isDaemonSlowError(e) ? 'The network is slow to answer. Nothing was lost: try again in a moment.' : composeFlowErrorMessage(e));
    } finally {
      setRegBusy(false);
      setRegFlow('');
    }
  };

  const modeCopy = MODE_COPY[mode];

  return <section className="flow-screen receive-screen">
    {onBack && (
      <button
        type="button"
        className="back-to-wallet-btn"
        onClick={onBack}
        aria-label="Back to wallet"
      >
        ← Back to wallet
      </button>
    )}
    <div className="flow-heading">
      <p className="eyebrow">{modeCopy.eyebrow}</p>
      <h2>{modeCopy.title}</h2>
      <p>Indexer: <strong>{indexerStatus.state}</strong>. A closed indexer means arrivals will not appear live yet.</p>
    </div>
    <div className="receive-mode-tabs" role="tablist" aria-label="Receive mode">
      {MODES.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={mode === item.id}
          className={`receive-mode-tab ${mode === item.id ? 'active' : ''}`}
          onClick={() => { setMode(item.id); setCopyState(''); }}
        >
          {item.label}
        </button>
      ))}
    </div>
    <p className="form-help receive-mode-guidance">{modeCopy.guidance}</p>
    {mode === 'vault' && !activeVault && (
      <p className="inline-error" role="alert">No vault loaded yet. Fund from L1 first to create one.</p>
    )}
    {plainAddress && <>
      <QrCode value={qrValue} />
      <label className="address-label" htmlFor="receive-address">{modeCopy.label}</label>
      <output id="receive-address" className="receive-address">{plainAddress}</output>
      <button className="test-pull" onClick={() => void copy(copyTarget, 'Payment request')}>{requestedSats > 0n ? 'Copy payment request' : 'Copy address'}</button>
      <div className="payment-request-card">
        <div className="payment-request-header">
          <span className="address-label">Payment request (optional)</span>
          {requestedSats > 0n && (
            <span className="payment-request-chip">Requests {amountInWords(requestedSats)} ({satsToBtc(requestedSats)} BTC)</span>
          )}
        </div>
        <div className="payment-request-fields">
          <label htmlFor="request-amount">Amount in sats</label>
          <input
            id="request-amount"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="Any amount"
            value={amountSats}
            onChange={event => setAmountSats(event.target.value.replace(/[^\d]/g, ''))}
          />
          <label htmlFor="request-memo">Memo</label>
          <input
            id="request-memo"
            type="text"
            maxLength={140}
            placeholder="What is this payment for?"
            value={memo}
            onChange={event => setMemo(event.target.value)}
          />
        </div>
        <small className="form-help">
          {requestedSats > 0n || memo.trim()
            ? 'The QR code carries this request (BIP21). The payer sees the amount and memo before paying.'
            : 'Set an amount or memo to encode a payment request into the QR code.'}
        </small>
      </div>
      {mode === 'vault' && (
        <div className="register-deposit-card">
          <div className="settlement-receive-header">
            <span className="address-label">Direct-to-vault deposit</span>
            <button
              type="button"
              className="secondary-action-compact"
              disabled={regBusy || !activeVault}
              onClick={() => void registerDirectDeposit()}
            >
              {regBusy ? 'Checking…' : 'Check and register deposit'}
            </button>
          </div>
          <small className="form-help">
            Sent BTC straight to the vault address? Confirm the transaction on L1, then register it here so it becomes
            spendable. Registration is the second required step (funding alone is not enough).
          </small>
          {regBusy && regFlow && <p className="flow-note" role="status">Step: {regFlow}</p>}
          {regResult && <p className="flow-note" role="status">{regResult}</p>}
          {regError && (
            <div className="error-with-retry">
              <p className="inline-error" role="alert">{regError}</p>
              <button type="button" className="secondary-action-compact" disabled={regBusy} onClick={() => void registerDirectDeposit()}>
                {regBusy ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
        </div>
      )}
      {mode === 'l1' && (
        <div className="settlement-receive-card">
          <div className="settlement-receive-header">
            <span className="address-label">What happens next</span>
          </div>
          <small className="form-help">
            On-chain deposits settle into your TAURUS vault, then register as spendable VTXO sats. Track progress on the
            vault card (Balance screen).
          </small>
        </div>
      )}
    </>}
    {copyState && <p className={copyState.includes('copied') ? 'flow-note' : 'inline-error'} role="status">{copyState}</p>}
  </section>;
}
