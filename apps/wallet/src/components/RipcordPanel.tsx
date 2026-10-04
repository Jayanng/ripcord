import { useEffect, useState } from 'react';
import { useWallet, vaultRecordKey } from '../context/WalletContext';
import { useRipcord } from '../hooks/useRipcord';
import { describeDaemonFailure } from '@ripcord/core/net';
import { ExitSuccessModal } from './ExitSuccessModal';
import { writeExitRecord } from '../lib/exitRecord';
import { HoldToConfirmButton } from './HoldToConfirmButton';
import { ProofOfReservesBadge } from './ProofOfReservesBadge';
import { TapscriptInspector } from './TapscriptInspector';
import { truncate, L1Txid } from './ui';
import { proveExitTree } from '@ripcord/core/exit';

export function RipcordPanel() {
  const { activeVault: vault, identity, setExitReadiness, recordActivity, refresh } = useWallet(); const { readiness, refreshMaturity, assess, execute } = useRipcord(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [broadcastTxid, setBroadcastTxid] = useState(''); const [exitDone, setExitDone] = useState<{ txid: string } | null>(null);
  const status = readiness?.status ?? (vault?.funding ? 'maturing' : 'unfunded');
  // Mandate: tree-proof must pass before broadcast (review pass 4).
  const treeOk = Boolean(vault && proveExitTree(vault).verified);
  useEffect(() => {
    if (!vault?.funding) { if (vault) setExitReadiness(vaultRecordKey(vault), null); return; }
    let cancelled = false;
    const refresh = async () => {
      try { await refreshMaturity(vault); }
      catch (e) { if (!cancelled) setError(describeDaemonFailure(e)); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [vault?.address, vault?.funding?.txid, vault?.funding?.vout]);
  const run = async () => { if (!vault || !identity) return; setBusy(true); setError(''); try { await assess(vault); } catch (e) { setError(describeDaemonFailure(e)); } finally { setBusy(false); } };
  const confirmations = readiness?.confirmations ?? 0;
  const csvBlocks = vault?.csvBlocks ?? 1;
  const confirmationLabel = (() => {
    if (!vault?.funding || status === 'unfunded') {
      return 'Not funded';
    }
    if (status === 'live') {
      return 'Mature, ready to pull';
    }
    if (status === 'maturing') {
      if (typeof readiness?.confirmations === 'number' && typeof vault?.csvBlocks === 'number') {
        return `${readiness.confirmations} of ${vault.csvBlocks} confirmations`;
      }
      return 'Waiting for confirmations';
    }
    if (status === 'spent') {
      return 'Spent';
    }
    return 'Not funded';
  })();
  const progressPercent = vault
    ? status === 'live'
      ? 100
      : status === 'maturing' && typeof readiness?.confirmations === 'number' && typeof vault.csvBlocks === 'number' && vault.csvBlocks > 0
        ? Math.min(100, Math.round((readiness.confirmations / vault.csvBlocks) * 100))
        : 0
    : 0;
  const statusBadge = status === 'live' ? 'LIVE · READY TO PULL' : status === 'maturing' ? 'MATURING · LOCKED' : status.toUpperCase();

  return <section id="ripcord" className="ripcord-panel" aria-labelledby="ripcord-title">
    <div className="ripcord-kicker"><span className="cord" /><div><p className="eyebrow">User-signature exit path</p><h2 id="ripcord-title">Ripcord</h2></div><span className={`exit-status ${status}`}>{statusBadge}</span></div>
    <p className="ripcord-copy">{status === 'live' ? 'The funding output is mature. Your signature can move it to Bitcoin L1.' : status === 'maturing' ? `The exit needs ${readiness?.confirmationsRemaining ?? vault?.csvBlocks ?? 0} more confirmations. Regtest advances with network activity, not time.` : status === 'spent' ? 'The recorded funding output has already been spent.' : 'Create and fund a vault before testing the unilateral exit path.'}</p>
    <dl className="ripcord-facts">
      <div><dt>Vault</dt><dd>{vault ? truncate(vault.address, 12, 8) : 'No vault loaded'}</dd></div>
      <div>
        <dt>Timelock</dt>
        <dd>
          {vault ? (
            <div className="timelock-progress-wrap">
              <div className="timelock-label">
                <span>{confirmationLabel}</span>
                <span className={`timelock-pct ${status === 'live' ? 'live' : ''}`}>{progressPercent}%</span>
              </div>
              <div className="timelock-bar" role="progressbar" aria-valuenow={status === 'live' ? csvBlocks : status === 'unfunded' || status === 'spent' ? 0 : confirmations} aria-valuemin={0} aria-valuemax={csvBlocks}>
                <div className={`timelock-fill ${status === 'live' ? 'live' : ''}`} style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          ) : 'Unavailable'}
        </dd>
      </div>
      <div><dt>Route</dt><dd>exit leaf · user CHECKSIG</dd></div>
      <div><dt>Reserve</dt><dd>{vault ? <ProofOfReservesBadge vault={vault} /> : 'Unavailable'}</dd></div>
    </dl>
    {readiness?.dryRun && <div className="dry-run"><strong>Exit path verified (dry run)</strong><dl><div><dt>txid</dt><dd>{truncate(readiness.dryRun.txid, 12, 10)}</dd></div><div><dt>Destination</dt><dd title={readiness.dryRun.destination}>{truncate(readiness.dryRun.destination, 14, 10)}</dd></div><div><dt>vsize</dt><dd>{readiness.dryRun.vsize} vB</dd></div><div><dt>nSequence</dt><dd>{readiness.dryRun.sequence}</dd></div></dl><p>Nothing was broadcast. No sats moved.</p></div>}
    {readiness?.dryRun && status !== 'spent' && <p className="flow-note" role="status">Exit transaction verified. Ready to broadcast when the timelock matures.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {broadcastTxid && <p className="flow-note" role="status">The exit is broadcast to Bitcoin L1. Copy the txid below to track it.<br /><L1Txid txid={broadcastTxid} /></p>}
    {vault && <TapscriptInspector vault={vault} />}
    <div className="ripcord-actions"><button className="test-pull" disabled={!vault || !identity || busy} onClick={() => void run()}>{busy ? 'Verifying exit path…' : readiness?.dryRun ? 'Verify Exit Path (Dry Run) again' : 'Verify Exit Path (Dry Run)'}</button><HoldToConfirmButton disabled={status !== 'live' || !readiness?.dryRun || busy || !treeOk} onConfirm={async () => { if (!vault || !identity) return; setBusy(true); setError(''); setBroadcastTxid(''); try { const { makeSigner } = await import('@ripcord/core/keys'); const signer = makeSigner(identity.mnemonic, 'regtest', vault.userKeyIndex); const result = await execute(vault, signer); setBroadcastTxid(result.txid); writeExitRecord(vaultRecordKey(vault), { txid: result.txid, amountSats: String((vault.funding?.valueSats ?? 0n) - 200n), createdAt: Date.now() }); setExitDone({ txid: result.txid }); await refreshMaturity(vault); await refresh(); } catch (e) { setError(describeDaemonFailure(e)); } finally { setBusy(false); } }} /></div>
    {exitDone && <ExitSuccessModal txid={exitDone.txid} amountSats={vault?.funding?.valueSats ? Number(vault.funding.valueSats) : 0} destination={readiness?.dryRun?.destination} onClose={() => setExitDone(null)} />}
  </section>;
}
