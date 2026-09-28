import { useEffect, useRef, useState } from 'react';
import { generateMnemonic } from 'bip39';
import { useWallet } from '../context/WalletContext';
import { FaucetModal } from '../components/FaucetModal';
import { readSavedDepositTxid, writeSavedDepositTxid, clearSavedDepositTxid } from '../lib/depositResume';
import { truncate } from '../components/ui';
import { describeDaemonFailure } from '@ripcord/core/net';
import { composeFlowErrorMessage, isDaemonSlowError } from '@ripcord/core/lifecycle';

type FlowState = 'ready' | 'depositing' | 'confirming-deposit' | 'minting' | 'registering' | 'complete' | 'error';

export function OnboardingScreen({ onEnterWallet }: { onEnterWallet?: () => void }) {
  const wallet = useWallet();
  const [mnemonic, setMnemonic] = useState('');
  const [index, setIndex] = useState(0);
  const [csv, setCsv] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // Phase 9 (#18): hide/reveal + 3-word backup challenge for generated phrases.
  const [phraseHidden, setPhraseHidden] = useState(false);
  const [generatedInSession, setGeneratedInSession] = useState(false);
  const [challenge, setChallenge] = useState<Array<{ position: number; answer: string }>>([]);
  const [challengeInput, setChallengeInput] = useState<string[]>(['', '', '']);
  const challengePassed = challenge.length > 0 && challenge.every((entry, i) =>
    challengeInput[i].trim().toLowerCase() === entry.answer.toLowerCase());
  const [faucet, setFaucet] = useState(false);
  const [flow, setFlow] = useState<FlowState>('ready');
  const savedDepositTxid = readSavedDepositTxid(wallet.activeVault);
  const [depositTxid, setDepositTxid] = useState(() => savedDepositTxid ?? '');
  const [depositConfirmations, setDepositConfirmations] = useState(0);
  const pendingFaucetTxid = wallet.identity ? localStorage.getItem(`ripcord:faucet:${wallet.identity.l1Address}`) : null;
  const vaultReady = Boolean((wallet.activeVault?.funding || wallet.activeVault?.vaultIdHex) && (wallet.activeVault?.registered || wallet.activeVault?.vaultIdHex));

  const generateNewMnemonic = () => {
    const phrase = generateMnemonic(128);
    setMnemonic(phrase);
    setError('');
    setGeneratedInSession(true);
    setPhraseHidden(false);
    // 3-word verification challenge from the generated phrase itself.
    const wordsIn = phrase.split(' ');
    const positions = new Set<number>();
    while (positions.size < 3) positions.add(Math.floor(Math.random() * wordsIn.length));
    setChallenge([...positions].sort((a, b) => a - b).map(position => ({ position, answer: wordsIn[position] })));
    setChallengeInput(['', '', '']);
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
      setError(composeFlowErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const completeFunding = async (explicitInput?: import('@ripcord/core/types').ExplicitSpendableInput) => {
    if (!wallet.identity || !wallet.activeVault) return;
    const activeVault = wallet.activeVault;
    if (activeVault.vaultIdHex && (activeVault.registered || activeVault.funding)) {
      setFlow('complete');
      localStorage.removeItem(`ripcord:faucet:${wallet.identity.l1Address}`);
      clearSavedDepositTxid(activeVault);
      return;
    }
    setBusy(true);
    setError('');
    setFlow('depositing');
    try {
      const { fundVaultLifecycle } = await import('@ripcord/core/lifecycle');
      setFlow('depositing');
      const savedDeposit = readSavedDepositTxid(activeVault);
      const result = await fundVaultLifecycle({
        vault: activeVault,
        mnemonic: wallet.identity.mnemonic,
        bitcoinRpcBaseUrl: wallet.baseUrl,
        daemonBaseUrl: wallet.daemonUrl,
        amountSats: 40_000n,
        feeRateSatVb: 2,
        explicitInput,
        existingDepositTxid: savedDeposit ?? undefined,
        claimedOutpoints: wallet.claimedOutpointsFor(activeVault),
        onProgress: setFlow,
        onConfirmationPoll: setDepositConfirmations,
        onDepositBroadcast: deposit => {
          setDepositTxid(deposit.txid);
          setDepositConfirmations(0);
          writeSavedDepositTxid(activeVault, deposit.txid);
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
      clearSavedDepositTxid(activeVault);
    } catch (e) {
      const isSlow = isDaemonSlowError(e);
      setFlow(isSlow ? 'ready' : 'error');
      setError(composeFlowErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!wallet.identity || !wallet.activeVault || busy || flow !== 'ready') return;
    if (wallet.activeVault.vaultIdHex && (wallet.activeVault.registered || wallet.activeVault.funding)) {
      localStorage.removeItem(`ripcord:faucet:${wallet.identity.l1Address}`);
      clearSavedDepositTxid(wallet.activeVault);
      setFlow('complete');
      return;
    }
    const savedFaucet = localStorage.getItem(`ripcord:faucet:${wallet.identity.l1Address}`);
    const savedDeposit = readSavedDepositTxid(wallet.activeVault);
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
          const payload = (await response.json()) as {
            result?: {
              confirmations?: number;
              vout: Array<{ n: number; value: number; scriptPubKey: { hex: string; address?: string } }>;
            };
          };
          if (!mounted) return;
          if (payload.result) {
            const targetAddr = wallet.identity?.l1Address;
            if (!targetAddr) return;
            const { addressToScriptPubKeyHex } = await import('@ripcord/core/deposit');
            const expectedScript = addressToScriptPubKeyHex(targetAddr, 'regtest').toLowerCase();
            const match = payload.result.vout?.find(
              v => v.scriptPubKey.hex.toLowerCase() === expectedScript || v.scriptPubKey.address === targetAddr
            );
            if (match) {
              await completeFunding({
                txid: savedFaucet,
                vout: match.n,
                amountSats: BigInt(Math.round(match.value * 1e8)),
                scriptPubKey: match.scriptPubKey.hex,
              });
            } else if ((payload.result.confirmations ?? 0) > 0) {
              await completeFunding();
            }
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
  const isDepositBroadcast = Boolean(depositTxid || savedDepositTxid || wallet.activeVault?.funding);
  const isDepositConfirmed = ['minting', 'registering', 'complete'].includes(flow) || vaultReady;

  const statusText = vaultReady
    ? 'Your vault is funded and registered. You can now receive and send VTXOs.'
    : flow === 'depositing'
    ? 'Preparing and broadcasting your vault deposit…'
    : flow === 'confirming-deposit'
    ? `Your vault deposit is broadcast with ${depositConfirmations} of 1 confirmations. Mining takes ~10 min on regtest (~5 min avg); funding and deposit confirm in the same block.`
    : flow === 'minting'
    ? 'Your deposit is confirmed. Creating your first spendable VTXO on Tachi.'
    : flow === 'registering'
    ? 'Your VTXO is ready. Registering the vault with live validators.'
    : flow === 'complete'
    ? 'Your wallet is funded, your first VTXO is created, and your vault is registered.'
    : isDepositBroadcast
    ? `Vault deposit broadcast (${truncate(depositTxid || savedDepositTxid || '', 10, 8)}). Monitoring Bitcoin L1 block mining in background (~10 min single wait).`
    : pendingFaucetTxid
    ? `Faucet funds broadcast (${truncate(pendingFaucetTxid, 10, 8)}). Chaining vault deposit without waiting for block mining…`
    : 'Fund this settlement address first, or continue if it already has confirmed L1 funds.';

  const fundingSteps = [
    { label: 'Faucet funds broadcast', done: Boolean(pendingFaucetTxid) || isDepositBroadcast || flow !== 'ready' || vaultReady },
    { label: 'Vault deposit broadcast', done: isDepositBroadcast || ['confirming-deposit', 'minting', 'registering', 'complete'].includes(flow) || vaultReady },
    { label: 'Faucet confirmed on L1', done: isDepositConfirmed },
    { label: 'Deposit confirmed on L1', done: isDepositConfirmed },
    { label: 'Spendable VTXO minted', done: ['registering', 'complete'].includes(flow) || vaultReady },
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
        <p className={flow === 'error' && !isDaemonSlowError(error) ? 'inline-error' : 'flow-note'} role={flow === 'error' && !isDaemonSlowError(error) ? 'alert' : 'status'}>
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
            onChange={e => {
              setMnemonic(e.target.value);
              // A hand-entered phrase proves possession; no challenge needed.
              if (generatedInSession) {
                setGeneratedInSession(false);
                setChallenge([]);
              }
            }}
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
          <>
            <div className="mnemonic-reveal-row">
              <span className="address-label">Recovery phrase words</span>
              <button type="button" className="secondary-action-compact" onClick={() => setPhraseHidden(hidden => !hidden)}>
                {phraseHidden ? 'Reveal words' : 'Hide words'}
              </button>
            </div>
            <div className="mnemonic-chip-grid" aria-label="Recovery phrase words">
              {words.map((word, i) => (
                <div key={i} className="mnemonic-chip">
                  <span className="chip-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className={`chip-word ${phraseHidden ? 'chip-word-hidden' : ''}`}>
                    {phraseHidden ? '••••••' : word}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {challenge.length > 0 && (
          <div className="backup-challenge" aria-label="Backup verification">
            <p className="address-label">Backup check: confirm you wrote the phrase down</p>
            <small className="form-help">
              Fill in the missing words. This wallet cannot recover a lost phrase, so we verify the backup before funding.
            </small>
            <div className="backup-challenge-fields">
              {challenge.map((entry, i) => (
                <label key={entry.position} className="backup-challenge-field">
                  <span>Word #{entry.position + 1}</span>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={challengeInput[i]}
                    onChange={event => {
                      const next = [...challengeInput];
                      next[i] = event.target.value;
                      setChallengeInput(next);
                    }}
                    aria-label={`Word number ${entry.position + 1}`}
                  />
                </label>
              ))}
            </div>
            {challengePassed && <p className="flow-note" role="status">Backup verified. All three words match.</p>}
          </div>
        )}
        {/* Hidden from frontend but preserved in backend/logic */}
        <label className="advanced-field"><span>Vault key index (advanced)</span><input type="number" min="0" step="1" inputMode="numeric" value={index} onChange={event => setIndex(Math.max(0, Math.floor(Number(event.target.value) || 0)))} /></label>
        <label className="advanced-field">
          <span>CSV timelock in blocks (advanced)</span>
          <input type="number" min="1" step="1" inputMode="numeric" value={csv} onChange={event => setCsv(Math.max(1, Math.floor(Number(event.target.value) || 2)))} />
        </label>
        <small className="form-help">The CSV timelock sets how many blocks your unilateral exit must mature. Leave at 2 on regtest unless you know you need otherwise.</small>
        <button className="test-pull" disabled={busy || (challenge.length > 0 && !challengePassed)}>
          {busy
            ? 'Deriving and reading quorum…'
            : challenge.length > 0 && !challengePassed
              ? 'Verify the backup check above to continue'
              : 'Create identity and vault'}
        </button>
        {error && (
          <div className="error-with-retry">
            <p className="inline-error" role="alert">{error}</p>
            <button type="button" className="secondary-action-compact" onClick={() => void create()}>
              Retry
            </button>
          </div>
        )}
      </form>
    )}
    {faucet && wallet.identity && (
      <FaucetModal
        address={wallet.identity.l1Address}
        onClose={() => setFaucet(false)}
        onConfirmed={(_txid, explicitInput) => {
          setFaucet(false);
          void completeFunding(explicitInput);
        }}
      />
    )}
  </section>;
}
