import { useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';

type Field = 'recipient' | 'amount' | 'form';

export function SendForm() {
  const wallet = useWallet();
  const recipientRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const fail = (field: Field, message: string) => { setError({ field, message }); requestAnimationFrame(() => (field === 'recipient' ? recipientRef.current : field === 'amount' ? amountRef.current : null)?.focus()); };
  const submit = async () => {
    setError(null); setResult('');
    if (!wallet.identity) return fail('form', 'Create or recover an identity first');
    const vault = wallet.activeVault;
    if (!vault?.registered || !vault.p2tr) return fail('form', 'No registered spendable vault is loaded for this identity');
    const sats = Number(amount);
    if (!Number.isSafeInteger(sats) || sats < 1) return fail('amount', 'Enter a whole-sat amount of at least 1');
    setBusy(true);
    try {
      const [{ isUserAddress, toSdkVault }, { makeSigner }, { sendTransfer }] = await Promise.all([import('@ripcord/core/types'), import('@ripcord/core/keys'), import('@ripcord/core/payment')]);
      if (!isUserAddress(recipient)) return fail('recipient', 'Enter a valid regtest SegWit address');
      if (wallet.vaults.some(item => String(item.address) === String(recipient))) return fail('recipient', 'This is a known vault address. Use the recipient wallet’s user receive address.');
      const committed = await sendTransfer({ vault: toSdkVault(vault), senderXOnly: wallet.identity.xOnly, recipientAddress: recipient, network: 'regtest', amountSats: BigInt(sats), feeSats: 1n, baseUrl: wallet.daemonUrl, userSigner: makeSigner(wallet.identity.mnemonic, 'regtest', vault.userKeyIndex) });
      setResult(`Committed ${committed.txHash} at epoch ${committed.epoch}. Fetching proof…`);
      const { buildPaymentReceipt } = await import('@ripcord/core');
      const { address: decodeAddress } = await import('bitcoinjs-lib');
      const recipientXOnly = Buffer.from(decodeAddress.fromBech32(recipient).data).toString('hex');
      const receipt = await buildPaymentReceipt({ txHash: committed.txHash, epoch: committed.epoch, code: committed.code, fromXOnly: wallet.identity.xOnly, toXOnly: recipientXOnly, amountSats: BigInt(sats), feeSats: 1n, baseUrl: wallet.daemonUrl, window: 0 });
      await wallet.saveReceipt(receipt);
      setResult(`Committed ${committed.txHash} at epoch ${committed.epoch} · proof saved`);
    } catch (cause) { fail('form', cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <form className="send-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label htmlFor="send-recipient">Recipient address</label><input ref={recipientRef} id="send-recipient" name="recipient" autoComplete="off" value={recipient} onChange={event => setRecipient(event.target.value.trim())} placeholder="bcrt1p…" required aria-invalid={error?.field === 'recipient'} aria-describedby={error?.field === 'recipient' ? 'send-recipient-error' : undefined} />
    {error?.field === 'recipient' && <p id="send-recipient-error" className="inline-error" role="alert">{error.message}</p>}
    <label htmlFor="send-amount">Amount in sats</label><input ref={amountRef} id="send-amount" name="amount" type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} required aria-invalid={error?.field === 'amount'} aria-describedby={error?.field === 'amount' ? 'send-amount-error' : undefined} />
    {error?.field === 'amount' && <p id="send-amount-error" className="inline-error" role="alert">{error.message}</p>}
    <div className="send-summary"><span>Network fee</span><strong>1 sat</strong><span>Change</span><strong>own user key</strong></div><button className="test-pull" disabled={busy}>{busy ? 'Sending…' : 'Review and send'}</button>
    {error?.field === 'form' && <p className="inline-error" role="alert">{error.message}</p>}{result && <p className="flow-note" role="status">{result}</p>}
  </form>;
}
