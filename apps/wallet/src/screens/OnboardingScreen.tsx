import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { FaucetModal } from '../components/FaucetModal';
import { truncate } from '../components/ui';

type FlowState = 'ready' | 'depositing' | 'confirming-deposit' | 'minting' | 'registering' | 'complete' | 'error';

export function OnboardingScreen() {
  const wallet = useWallet();
  const [mnemonic, setMnemonic] = useState('');
  const [index, setIndex] = useState(0);
  const [csv, setCsv] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [faucet, setFaucet] = useState(false);
  const [flow, setFlow] = useState<FlowState>('ready');
  const [depositTxid, setDepositTxid] = useState('');
  const resuming = useRef(false);
  const pendingFaucetTxid = wallet.identity ? localStorage.getItem(`ripcord:faucet:${wallet.identity.l1Address}`) : null;
  const vaultReady = Boolean(wallet.activeVault?.funding && wallet.activeVault.registered);

  const create = async () => { setBusy(true); setError(''); try { const [{ deriveIdentity }, { getQuorum }, { createVault }, { recoverVaultLifecycleState }] = await Promise.all([import('@ripcord/core/keys'), import('@ripcord/core/quorum'), import('@ripcord/core/vault'), import('@ripcord/core/lifecycle')]); const identity = deriveIdentity(mnemonic.trim(), 'regtest', index); const quorum = await getQuorum(wallet.daemonUrl, { allowInsecureHttp: wallet.daemonUrl.startsWith('http://127.0.0.1:') || wallet.daemonUrl.startsWith('http://localhost:') }); const derived = await createVault({ network: 'regtest', nodePubkeys: quorum.nodePubkeys, csvBlocks: csv, userKeyDescriptor: identity.userKeyDescriptor, threshold: quorum.threshold }); const vault = await recoverVaultLifecycleState({ vault: derived, bitcoinRpcBaseUrl: wallet.baseUrl, daemonBaseUrl: wallet.daemonUrl }); wallet.setIdentity(identity); await wallet.addVault(vault); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  const completeFunding = async () => {
    if (!wallet.identity || !wallet.activeVault) return;
    const activeVault = wallet.activeVault;
    setBusy(true); setError(''); setFlow('depositing');
    try {
      const { fundVaultLifecycle } = await import('@ripcord/core/lifecycle');
      setFlow('depositing');
      const result = await fundVaultLifecycle({ vault: activeVault, mnemonic: wallet.identity.mnemonic, bitcoinRpcBaseUrl: wallet.baseUrl, daemonBaseUrl: wallet.daemonUrl, amountSats: 40_000n, feeRateSatVb: 2, onProgress: setFlow, onDepositBroadcast: deposit => { setDepositTxid(deposit.txid); localStorage.setItem(`ripcord:deposit:${activeVault.address}`, deposit.txid); } });
      setFlow('complete');
      await wallet.updateVault({ ...activeVault, funding: { txid: result.deposit.txid, vout: result.deposit.vout, valueSats: result.deposit.amountSats }, vaultIdHex: result.vaultId, registered: true });
      localStorage.removeItem(`ripcord:faucet:${wallet.identity.l1Address}`);
      localStorage.removeItem(`ripcord:deposit:${activeVault.address}`);
    } catch (e) { setFlow('error'); setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!wallet.identity || !wallet.activeVault || busy || flow !== 'ready' || resuming.current) return;
    const saved = localStorage.getItem(`ripcord:faucet:${wallet.identity.l1Address}`);
    if (!saved || !/^[0-9a-f]{64}$/i.test(saved)) return;
    resuming.current = true;
    void (async () => {
      try {
        const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'getrawtransaction', params: [saved, true] }) });
        const payload = await response.json() as { result?: { confirmations?: number } };
        if ((payload.result?.confirmations ?? 0) > 0) await completeFunding();
      } catch {
        resuming.current = false;
      }
    })();
  }, [wallet.identity, wallet.vaults, busy, flow]);

  const statusText = vaultReady ? 'Vault funding and registration restored from live evidence.' : flow === 'depositing' ? 'Synchronizing existing L1 funds and depositing into the vault…' : flow === 'confirming-deposit' ? `Deposit broadcast${depositTxid ? `: ${depositTxid}` : ''}. Waiting for its L1 confirmation…` : flow === 'minting' ? 'Minting a spendable VTXO on Tachi…' : flow === 'registering' ? 'Registering the vault with live validators…' : flow === 'complete' ? 'Vault funded, minted, and registered with live evidence.' : pendingFaucetTxid ? 'A faucet broadcast is saved. Its confirmation will resume automatically.' : 'If this settlement address was already funded, continue with its existing L1 funds.';
  return <section className="flow-screen"><div className="flow-heading"><p className="eyebrow">Step 1 · local custody</p><h2>Create wallet identity and vault</h2><p>The mnemonic stays in memory. Only public vault metadata is written to IndexedDB.</p></div>{wallet.identity ? <div className="flow-success"><strong>{vaultReady || flow === 'complete' ? 'Vault ready' : 'Identity ready'}</strong><dl><div><dt>Receive</dt><dd>{truncate(wallet.identity.userAddress, 14, 10)}</dd></div><div><dt>L1 settlement</dt><dd>{truncate(wallet.identity.l1Address, 14, 10)}</dd></div><div><dt>Path</dt><dd>{wallet.identity.userKeyDescriptor.path}</dd></div></dl>{!vaultReady && flow !== 'complete' && <button className="test-pull" disabled={busy} onClick={() => setFaucet(true)}>{pendingFaucetTxid ? 'Check faucet confirmation' : 'Fund from faucet'}</button>}{!vaultReady && flow !== 'complete' && <button className="test-pull" disabled={busy} onClick={() => void completeFunding()}>Continue with existing L1 funds</button>}<p className={flow === 'error' ? 'inline-error' : 'flow-note'} role={flow === 'error' ? 'alert' : 'status'}>{error || statusText}</p></div> : <form onSubmit={e => { e.preventDefault(); void create(); }}><label>12-word BIP-39 mnemonic<textarea value={mnemonic} onChange={e => setMnemonic(e.target.value)} autoComplete="off" spellCheck={false} required rows={4} /></label><div className="form-grid"><label>Vault key index<input type="number" min="0" value={index} onChange={e => setIndex(Number(e.target.value))} /></label><label>CSV confirmations<input type="number" min="1" value={csv} onChange={e => setCsv(Number(e.target.value))} /></label></div><button className="test-pull" disabled={busy}>{busy ? 'Deriving and reading quorum…' : 'Create identity and vault'}</button>{error && <p className="inline-error" role="alert">{error}</p>}</form>}{faucet && wallet.identity && <FaucetModal address={wallet.identity.l1Address} onClose={() => setFaucet(false)} onConfirmed={() => { setFaucet(false); void completeFunding(); }} />}</section>;
}
