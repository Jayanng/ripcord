import { useEffect, useRef, useState } from 'react';
import { useWallet, vaultRecordKey } from '../context/WalletContext';
import { readSavedDepositTxid, writeSavedDepositTxid, clearSavedDepositTxid } from '../lib/depositResume';
import { FaucetModal } from './FaucetModal';
import { truncate, formatSats } from './ui';
import { describeDaemonFailure } from '@ripcord/core/net';
import { composeFlowErrorMessage, isDaemonSlowError } from '@ripcord/core/lifecycle';

type FlowState = 'ready' | 'depositing' | 'confirming-deposit' | 'minting' | 'registering' | 'complete' | 'error';

export function VaultStatusCard() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [faucet, setFaucet] = useState(false);
  const [flow, setFlow] = useState<FlowState>('ready');
  const savedDepositTxid = readSavedDepositTxid(wallet.activeVault);
  const [depositTxid, setDepositTxid] = useState(() => savedDepositTxid ?? '');
  const [depositConfirmations, setDepositConfirmations] = useState(0);
  const pendingFaucetTxid = wallet.identity ? localStorage.getItem(`ripcord:faucet:${wallet.identity.l1Address}`) : null;
  const vaultReady = Boolean((wallet.activeVault?.funding || wallet.activeVault?.vaultIdHex) && (wallet.activeVault?.registered || wallet.activeVault?.vaultIdHex));

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
      const fundedRecord = {
        ...activeVault,
        funding: { txid: result.deposit.txid, vout: result.deposit.vout, valueSats: result.deposit.amountSats },
        vaultIdHex: result.vaultId,
        registered: true,
      };
      await wallet.updateVault(fundedRecord);
      // The record key transitions address:createdAt -> vaultIdHex on funding;
      // keep the user's selection on the record they just funded.
      wallet.selectVault(vaultRecordKey(fundedRecord));
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

  // Start another deposit round: derive a fresh vault record for the identity
  // and select it so the existing funding flow funds THIS record. TAURUS vaults
  // are per-deposit (vault_id = H(funding_txid || vout)), so each funded round
  // becomes its own record in the switcher.
  const addVaultRound = async () => {
    if (!wallet.identity) return;
    setBusy(true); setError('');
    try {
      const [{ createVault }, { getQuorum }] = await Promise.all([
        import('@ripcord/core/vault'),
        import('@ripcord/core/quorum'),
      ]);
      const quorum = await getQuorum(wallet.daemonUrl, {
        allowInsecureHttp: wallet.daemonUrl.startsWith('http://127.0.0.1:') || wallet.daemonUrl.startsWith('http://localhost:'),
      });
      const derived = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: wallet.activeVault?.csvBlocks ?? 2,
        userKeyDescriptor: wallet.identity.userKeyDescriptor,
        threshold: quorum.threshold,
      });
      // Audit fix: the SAME address legitimately carries one record per funding
      // round (vault_id = H(funding outpoint)). A funded sibling is a previous
      // round - the new derived record IS the next round. Only a still-PENDING
      // (unfunded) record at this address means the round was already started.
      const pending = wallet.vaults.find(v => v.address === derived.address && !v.vaultIdHex);
      if (pending) {
        wallet.selectVault(vaultRecordKey(pending));
        setError('A deposit round at this vault is already waiting for funding. Fund the selected round first, then start the next one.');
        return;
      }
      await wallet.addVault(derived);
      wallet.selectVault(vaultRecordKey(derived));
    } catch (e) {
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

  if (!wallet.identity) return null;

  const explorerUrl = (txid: string) => `https://explorer-regtest.tachibtc.com/tx/${txid}`;
  const isDepositConfirmed = ['minting', 'registering', 'complete'].includes(flow) || vaultReady;
  const isDepositBroadcast = Boolean(depositTxid || savedDepositTxid || wallet.activeVault?.funding);

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
    : depositTxid || savedDepositTxid
    ? `Vault deposit broadcast (${truncate(depositTxid || savedDepositTxid || '', 10, 8)}). Monitoring Bitcoin L1 block mining in background (~10 min single wait).`
    : pendingFaucetTxid
    ? `Faucet funds broadcast (${truncate(pendingFaucetTxid, 10, 8)}). Chaining vault deposit without waiting for block mining…`
    : 'Your sovereign vault is ready to fund. Request test BTC from the faucet to mint your first spendable VTXO.';

  const fundingSteps = [
    { label: 'Faucet funds broadcast', done: Boolean(pendingFaucetTxid) || isDepositBroadcast || flow !== 'ready' || vaultReady },
    { label: 'Vault deposit broadcast', done: isDepositBroadcast || ['confirming-deposit', 'minting', 'registering', 'complete'].includes(flow) || vaultReady },
    { label: 'Faucet confirmed on L1', done: isDepositConfirmed },
    { label: 'Deposit confirmed on L1', done: isDepositConfirmed },
    { label: 'Spendable VTXO minted', done: ['registering', 'complete'].includes(flow) || vaultReady },
    { label: 'Vault registered', done: flow === 'complete' || vaultReady },
  ];

  return <section className="flow-screen vault-status-card">
    <div className="flow-heading">
      <p className="eyebrow">TAURUS Vault Registration & Reserves</p>
      <h2>Active TAURUS Vault Status</h2>
      <p>Your deterministic 5-of-7 TAURUS vault is bound to live validator consensus on Tachi regtest.</p>
    </div>
    {wallet.identity && (
      <div className="vault-switcher" role="tablist" aria-label="Select vault">
        <p className="vault-switcher-totals">
          {wallet.vaults.length} {wallet.vaults.length === 1 ? 'vault' : 'vaults'} · {formatSats(wallet.vaults.reduce((sum, v) => sum + (v.funding?.valueSats ?? 0n), 0n))} total on-chain
        </p>
        <div className="vault-chip-row">
          {wallet.vaults.map((item, index) => {
            const isActive = vaultRecordKey(item) === (wallet.activeVault ? vaultRecordKey(wallet.activeVault) : '');
            return (
              <button
                key={vaultRecordKey(item)}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`vault-chip ${isActive ? 'active' : ''}`}
                onClick={() => wallet.selectVault(vaultRecordKey(item))}
                title={`${item.address}\nfunding ${item.funding ? item.funding.txid.slice(0, 16) : 'none'}`}
              >
                <span className="vault-chip-round">Vault {index + 1}</span>
                <span className="vault-chip-amount">{item.funding ? formatSats(item.funding.valueSats ?? 0n) : 'unfunded'}</span>
                <span className={`vault-chip-state ${item.registered ? 'ready' : ''}`}>{item.registered ? 'registered' : 'pending'}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="vault-chip vault-chip-add"
            disabled={busy}
            onClick={() => void addVaultRound()}
            title="Derive a fresh vault record for the next deposit round"
          >
            <span className="vault-chip-round">New</span>
            <span className="vault-chip-amount">+ Start another deposit round</span>
          </button>
        </div>
      </div>
    )}
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
        </div>
      )}
      <p className={flow === 'error' && !isDaemonSlowError(error) ? 'inline-error' : 'flow-note'} role={flow === 'error' && !isDaemonSlowError(error) ? 'alert' : 'status'}>
        {error || statusText}
      </p>
      {/* Phase 9 (#24): retry next to the error state */}
      {flow === 'error' && error && (
        <div className="error-with-retry">
          <button type="button" className="secondary-action-compact" disabled={busy} onClick={() => void completeFunding()}>
            {busy ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
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
