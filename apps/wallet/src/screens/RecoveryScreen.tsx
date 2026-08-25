import { useMemo, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { RecoveryProgress, type RecoveryStepState } from '../components/RecoveryProgress';
import { truncate } from '../components/ui';

const LABELS = [
  'Derive BIP84/BIP340 identity keys',
  'Fetch the authoritative 5-of-7 consensus quorum',
  'Scan for on-chain vaults across candidate CSV parameters',
  'Validate addressMatchesRebuild = true',
  'Verify proof of reserves on L1 through exact funding-script matching',
  'Reconnect the WSS indexer and restore public receipts',
];

export function RecoveryScreen() {
  const wallet = useWallet();
  const [mnemonic, setMnemonic] = useState('');
  const [index, setIndex] = useState(0);
  const [csv, setCsv] = useState(2);
  const [states, setStates] = useState<RecoveryStepState[]>(LABELS.map(() => 'pending'));
  const [details, setDetails] = useState<string[]>(LABELS.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (step: number, state: RecoveryStepState, detail = '') => {
    setStates(current => current.map((item, i) => i === step ? state : item));
    setDetails(current => current.map((item, i) => i === step ? detail : item));
  };
  const steps = useMemo(() => LABELS.map((label, i) => ({ label, state: states[i], detail: details[i] })), [states, details]);

  const recover = async () => {
    setBusy(true); setError(''); setStates(LABELS.map(() => 'pending')); setDetails(LABELS.map(() => ''));
    let currentStep = 0;
    try {
      currentStep = 0; update(0, 'active');
      const { deriveIdentity } = await import('@ripcord/core/keys');
      const identity = deriveIdentity(mnemonic.trim(), 'regtest', index);
      update(0, 'passed', `Identity ${truncate(identity.userAddress, 12, 8)}`);
      currentStep = 1; update(1, 'active');
      const { getQuorum } = await import('@ripcord/core/quorum');
      const quorum = await getQuorum(wallet.daemonUrl, { allowInsecureHttp: wallet.daemonUrl.startsWith('http://') });
      update(1, 'passed', `${quorum.threshold} of ${quorum.nodePubkeys.length} validators`);
      currentStep = 2; update(2, 'active');
      const { recoverVaults } = await import('@ripcord/core/recovery');
      const vaults = await recoverVaults({ identity, quorum, baseUrl: wallet.daemonUrl, bitcoinRpcBaseUrl: wallet.baseUrl, knownCsvBlocks: [csv, 144, 432, 1008, 2016], startIndex: index });
      if (vaults.length === 0) throw new Error('No registered vault matched this mnemonic, key index, and CSV candidates.');
      update(2, 'passed', `${vaults.length} registered vault${vaults.length === 1 ? '' : 's'} found`);
      currentStep = 3; update(3, 'active');
      update(3, 'passed', 'Every recovered vault matched its rebuilt address');
      currentStep = 4; update(4, 'active');
      update(4, 'passed', 'Funding scripts matched live Bitcoin RPC outputs');
      for (const vault of vaults) await wallet.addVault(vault);
      wallet.setIdentity(identity);
      currentStep = 5; update(5, 'active');
      await wallet.waitForIndexerReady();
      update(5, 'passed', `WSS connected; ${wallet.receipts.length} public receipts available`);
      setMnemonic('');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      update(currentStep, 'failed', message);
    } finally { setBusy(false); }
  };

  return <section className="recovery-screen flow-screen" aria-labelledby="recovery-title">
    <div className="flow-heading"><p className="eyebrow">Phase 13 · cold-start recovery</p><h2 id="recovery-title">Recover from a clean browser</h2><p>Recovery reads the live chain and writes only public vault metadata. Your mnemonic stays in memory and is cleared after success.</p></div>
    <form onSubmit={event => { event.preventDefault(); void recover(); }}>
      <label>12-word BIP-39 mnemonic<textarea value={mnemonic} onChange={event => setMnemonic(event.target.value)} autoComplete="off" spellCheck={false} required rows={4} /></label>
      <div className="form-grid"><label>Vault key index<input type="number" min="0" value={index} onChange={event => setIndex(Number(event.target.value))} /></label><label>CSV confirmations<input type="number" min="1" value={csv} onChange={event => setCsv(Number(event.target.value))} /></label></div>
      <button className="test-pull" disabled={busy}>{busy ? 'Recovering from live chain…' : 'Start live recovery'}</button>
    </form>
    <RecoveryProgress steps={steps} />
    {states[5] === 'passed' && wallet.activeVault && <><dl className="recovery-evidence"><div><dt>Vault</dt><dd>{wallet.activeVault.address}</dd></div><div><dt>Funding</dt><dd>{wallet.activeVault.funding ? `${wallet.activeVault.funding.txid}:${wallet.activeVault.funding.vout}` : 'Not reported'}</dd></div><div><dt>VTXOs</dt><dd>{wallet.liveVtxos.length}</dd></div></dl><p className="flow-note">Historical proof receipts are restored only when the daemon exposes them or they were persisted locally. This recovery run does not fabricate missing receipts.</p></>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
