import { useEffect, useRef, useState } from 'react';
import { generateMnemonic } from 'bip39';
import { useWallet } from '../context/WalletContext';
import { FaucetModal } from '../components/FaucetModal';
import { truncate } from '../components/ui';

type FlowState = 'ready' | 'depositing' | 'confirming-deposit' | 'minting' | 'registering' | 'complete' | 'error';

export function OnboardingScreen({ onEnterWallet }: { onEnterWallet?: () => void }) {
  const wallet = useWallet();
  const [mnemonic, setMnemonic] = useState('');
  const [index, setIndex] = useState(0);
  const [csv, setCsv] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [faucet, setFaucet] = useState(false);
  const [flow, setFlow] = useState<FlowState>('ready');
  const savedDepositTxid = wallet.activeVault ? localStorage.getItem(`ripcord:deposit:${wallet.activeVault.address}`) : null;
  const [depositTxid, setDepositTxid] = useState(() => savedDepositTxid ?? '');
  const [depositConfirmations, setDepositConfirmations] = useState(0);
  const pendingFaucetTxid = wallet.identity ? localStorage.getItem(`ripcord:faucet:${wallet.identity.l1Address}`) : null;
  const vaultReady = Boolean(wallet.activeVault?.funding && wallet.activeVault.registered);

  const generateNewMnemonic = () => {
    setMnemonic(generateMnemonic(128));
    setError('');
  };

  const copyMnemonic = async () => {
    if (!mnemonic) return;
    try {
      await navigator.clipboard.writeText(mnemonic.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const [{ deriveIdentity }, { getQuorum }, { createVault }, { recoverVaultLifecycleState }] = await Promise.all([
        import('@ripcord/core/keys'),
        import('@ripcord/core/quorum'),
        import('@ripcord/core/vault'),
        import('@ripcord/core/lifecycle'),
      ]);
      const identity = deriveIdentity(mnemonic.trim(), 'regtest', index);
      const quorum = await getQuorum(wallet.daemonUrl, {
        allowInsecureHttp: wallet.daemonUrl.startsWith('http://127.0.0.1:') || wallet.daemonUrl.startsWith('http://localhost:'),
      });
      const derived = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: csv,
        userKeyDescriptor: identity.userKeyDescriptor,
        threshold: quorum.threshold,
      });
      const vault = await recoverVaultLifecycleState({
        vault: derived,
        bitcoinRpcBaseUrl: wallet.baseUrl,
        daemonBaseUrl: wallet.daemonUrl,
      });
      wallet.setIdentity(identity);
      await wallet.addVault(vault);
      onEnterWallet?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const completeFunding = async () => {
    if (!wallet.identity || !wallet.activeVault) return;
    const activeVault = wallet.activeVault;
    setBusy(true);
    setError('');
    setFlow('depositing');
    try {
      const { fundVaultLifecycle } = await import('@ripcord/core/lifecycle');
      setFlow('depositing');
      const result = await fundVaultLifecycle({
        vault: activeVault,
        mnemonic: wallet.identity.mnemonic,
        bitcoinRpcBaseUrl: wallet.baseUrl,
        daemonBaseUrl: wallet.daemonUrl,
        amountSats: 40_000n,
        feeRateSatVb: 2,
        onProgress: setFlow,
        onConfirmationPoll: setDepositConfirmations,
        onDepositBroadcast: deposit => {
          setDepositTxid(deposit.txid);
          setDepositConfirmations(0);
          localStorage.setItem(`ripcord:deposit:${activeVault.address}`, deposit.txid);
        },
      });
      setFlow('complete');
      await wallet.updateVault({
        ...activeVault,
        funding: { txid: result.deposit.txid, vout: result.deposit.vout, valueSats: result.deposit.amountSats },
        vaultIdHex: result.vaultId,
        registered: true,
      });
      localStorage.removeItem(`ripcord:faucet:${wallet.identity.l1Address}`);
      localStorage.removeItem(`ripcord:deposit:${activeVault.address}`);
    } catch (e) {
      setFlow('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!wallet.identity || !wallet.activeVault || busy || flow !== 'ready') return;
    const savedFaucet = localStorage.getItem(`ripcord:faucet:${wallet.identity.l1Address}`);
    const savedDeposit = localStorage.getItem(`ripcord:deposit:${wallet.activeVault.address}`);
    if (!savedFaucet && !savedDeposit) return;

    let mounted = true;
    const checkStatus = async () => {
      try {
        if (savedDeposit) {
          await completeFunding();
          return;
        }
        if (savedFaucet && /^[0-9a-f]{64}$/i.test(savedFaucet)) {
          const response = await fetch('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'getrawtransaction', params: [savedFaucet, true] }),
          });
          const payload = (await response.json()) as { result?: { confirmations?: number } };
          if (!mounted) return;
          if ((payload.result?.confirmations ?? 0) > 0) {
            await completeFunding();
          }
        }
      } catch {
        // silent retry on next interval
      }
    };

    void checkStatus();
    const timer = setInterval(() => {
      void checkStatus();
    }, 10_000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [wallet.identity, wallet.vaults, busy, flow]);

  const explorerUrl = (txid: string) => `https://explorer-regtest.tachibtc.com/tx/${txid}`;
  const isDepositBroadcast = Boolean(depositTxid || savedDepositTxid);

  const statusText = vaultReady
    ? 'Your vault is funded and registered. You can now receive and send VTXOs.'
    : flow === 'depositing'
    ? 'Funding is confirmed. We are now depositing 40,000 sats into your vault.'
    : flow === 'confirming-deposit'
    ? `Your vault deposit is broadcast with ${depositConfirmations} of 1 confirmations. You can safely leave and return later.`
    : flow === 'minting'
    ? 'Your deposit is confirmed. Creating your first spendable VTXO on Tachi.'
    : flow === 'registering'
    ? 'Your VTXO is ready. Registering the vault with live validators.'
    : flow === 'complete'
    ? 'Your wallet is funded, your first VTXO is created, and your vault is registered.'
    : isDepositBroadcast
    ? `Vault deposit broadcast (${truncate(depositTxid || savedDepositTxid || '', 10, 8)}). Monitoring Bitcoin L1 block mining in background (~10 min).`
    : pendingFaucetTxid
    ? `Faucet funds broadcast (${truncate(pendingFaucetTxid, 10, 8)}). Checking Bitcoin L1 block mining in background (~10 min). You can explore the wallet freely; registration will resume automatically.`
    : 'Fund this settlement address first, or continue if it already has confirmed L1 funds.';

  const fundingSteps = [
    { label: 'Faucet funds broadcast', done: Boolean(pendingFaucetTxid) || isDepositBroadcast || flow !== 'ready' },
    { label: 'Faucet confirmed on L1', done: isDepositBroadcast || flow !== 'ready' },
    { label: 'Vault deposit broadcast', done: isDepositBroadcast || ['confirming-deposit', 'minting', 'registering', 'complete'].includes(flow) },
    { label: 'Deposit confirmed on L1', done: ['minting', 'registering', 'complete'].includes(flow) },
    { label: 'Spendable VTXO minted', done: ['registering', 'complete'].includes(flow) },
    { label: 'Vault registered', done: flow === 'complete' || vaultReady },
  ];

  const words = mnemonic.trim().split(/\s+/).filter(Boolean);

  return <section className="flow-screen create-wallet-screen">
    <div className="flow-heading">
      <p className="eyebrow">{wallet.identity ? 'Setup Gate · TAURUS Vault Funding' : 'Setup Gate · Create Wallet'}</p>
      <h2>{wallet.identity ? 'Fund & Register TAURUS Vault' : 'Generate identity & TAURUS vault'}</h2>
      <p>
        {wallet.identity
          ? 'Fund your L1 settlement address to mint your first VTXO and register with consensus validators.'
          : 'The mnemonic stays in memory. Only public vault metadata is written to IndexedDB.'}
      </p>
    </div>

    {wallet.identity ? (
      <div className="flow-success">
        <strong>{vaultReady || flow === 'complete' ? 'Vault ready' : busy ? 'Funding in progress' : 'Identity ready'}</strong>
        <dl>
          <div><dt>Receive</dt><dd>{truncate(wallet.identity.userAddress, 14, 10)}</dd></div>
          <div><dt>L1 settlement</dt><dd>{truncate(wallet.identity.l1Address, 14, 10)}</dd></div>
          <div><dt>Path</dt><dd>{wallet.identity.userKeyDescriptor.path}</dd></div>
          {depositTxid && <div><dt>Deposit tx</dt><dd>{truncate(depositTxid, 14, 10)}</dd></div>}
        </dl>
        {(busy || Boolean(pendingFaucetTxid) || isDepositBroadcast || flow !== 'ready') && (
          <ol className="funding-progress" aria-label="Vault funding progress">
            {fundingSteps.map((step, position) => {
              const active = !step.done && fundingSteps.slice(0, position).every(item => item.done);
              return (
                <li key={step.label} className={step.done ? 'passed' : active ? 'active' : 'pending'}>
                  <span aria-hidden="true">{step.done ? '✓' : position + 1}</span>
                  {step.label}
                </li>
              );
            })}
          </ol>
        )}
        {!vaultReady && flow !== 'complete' && (
          <div className="flow-actions">
            <button className="test-pull" disabled={busy} onClick={() => setFaucet(true)}>
              {pendingFaucetTxid ? 'Check funding status' : 'Request test funds'}
            </button>
            <button className="secondary-action" disabled={busy} onClick={() => void completeFunding()}>
              I already have confirmed funds
            </button>
            {onEnterWallet && (
              <button
                type="button"
                className="secondary-action"
                style={{ border: 0, background: 'transparent', textDecoration: 'underline', cursor: 'pointer', padding: '0 12px' }}
                onClick={onEnterWallet}
              >
                Skip to wallet →
              </button>
            )}
          </div>
        )}
        {(vaultReady || flow === 'complete') && onEnterWallet && (
          <div className="flow-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="test-pull" onClick={onEnterWallet}>
              Enter wallet →
            </button>
          </div>
        )}
        <p className={flow === 'error' ? 'inline-error' : 'flow-note'} role={flow === 'error' ? 'alert' : 'status'}>
          {error || statusText}
        </p>
        {pendingFaucetTxid && flow === 'ready' && (
          <a className="explorer-link" href={explorerUrl(pendingFaucetTxid)} target="_blank" rel="noreferrer">
            View faucet transaction on regtest explorer ↗
          </a>
        )}
        {(depositTxid || savedDepositTxid) && (
          <a className="explorer-link" href={explorerUrl(depositTxid || savedDepositTxid!)} target="_blank" rel="noreferrer">
            View deposit on the regtest explorer ↗
          </a>
        )}
      </div>
    ) : (
      <form onSubmit={e => { e.preventDefault(); void create(); }}>
        <label>12-word BIP-39 mnemonic
          <textarea
            value={mnemonic}
            onChange={e => setMnemonic(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            rows={3}
          />
          <div className="mnemonic-actions">
            <button type="button" className="secondary-action" onClick={generateNewMnemonic}>
              Generate a new recovery phrase
            </button>
            {words.length === 12 && (
              <button type="button" className="secondary-action" onClick={() => void copyMnemonic()}>
                {copied ? 'Copied to clipboard' : 'Copy phrase'}
              </button>
            )}
          </div>
          <small className="form-help">Write it down and keep it offline. Anyone with this phrase can control the wallet.</small>
        </label>
        {words.length === 12 && (
          <div className="mnemonic-chip-grid" aria-label="Recovery phrase words">
            {words.map((word, i) => (
              <div key={i} className="mnemonic-chip">
                <span className="chip-idx">{String(i + 1).padStart(2, '0')}</span>
                <span className="chip-word">{word}</span>
              </div>
            ))}
          </div>
        )}
        {/* Hidden from frontend but preserved in backend/logic */}
        <input type="hidden" name="vaultKeyIndex" value={index} />
        <input type="hidden" name="csvConfirmations" value={csv} />
        <button className="test-pull" disabled={busy}>
          {busy ? 'Deriving and reading quorum…' : 'Create identity and vault'}
        </button>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </form>
    )}
    {faucet && wallet.identity && (
      <FaucetModal
        address={wallet.identity.l1Address}
        onClose={() => setFaucet(false)}
        onConfirmed={() => {
          setFaucet(false);
          void completeFunding();
        }}
      />
    )}
  </section>;
}
