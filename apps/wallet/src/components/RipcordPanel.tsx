import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useRipcord } from '../hooks/useRipcord';
import { HoldToConfirmButton } from './HoldToConfirmButton';
import { ProofOfReservesBadge } from './ProofOfReservesBadge';
import { TapscriptInspector } from './TapscriptInspector';
import { truncate } from './ui';

export function RipcordPanel() {
  const { activeVault: vault, identity, setExitReadiness } = useWallet(); const { readiness, refreshMaturity, assess, execute } = useRipcord(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [broadcastTxid, setBroadcastTxid] = useState('');
  const status = readiness?.status ?? (vault?.funding ? 'maturing' : 'unfunded');
  useEffect(() => {
    if (!vault?.funding) { if (vault) setExitReadiness(vault.address, null); return; }
    let cancelled = false;
    const refresh = async () => {
      try { await refreshMaturity(vault); }
      catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [vault?.address, vault?.funding?.txid, vault?.funding?.vout]);
  const run = async () => { if (!vault || !identity) return; setBusy(true); setError(''); try { await assess(vault); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <section id="ripcord" className="ripcord-panel" aria-labelledby="ripcord-title">
    <div className="ripcord-kicker"><span className="cord" /><div><p className="eyebrow">User-signature exit path</p><h2 id="ripcord-title">Ripcord</h2></div><span className={`exit-status ${status}`}>{status.toUpperCase()}</span></div>
    <p className="ripcord-copy">{status === 'live' ? 'The funding output is mature. Your signature can move it to Bitcoin L1.' : status === 'maturing' ? `The exit needs ${readiness?.confirmationsRemaining ?? vault?.csvBlocks ?? 0} more confirmations. Regtest advances with network activity, not time.` : status === 'spent' ? 'The recorded funding output has already been spent.' : 'Create and fund a vault before testing the unilateral exit path.'}</p>
    <dl className="ripcord-facts"><div><dt>Vault</dt><dd>{vault ? truncate(vault.address, 12, 8) : 'No vault loaded'}</dd></div><div><dt>Timelock</dt><dd>{vault ? `${readiness?.confirmations ?? 0} of ${vault.csvBlocks} confirmations` : 'Unavailable'}</dd></div><div><dt>Route</dt><dd>exit leaf · user CHECKSIG</dd></div><div><dt>Reserve</dt><dd>{vault ? <ProofOfReservesBadge vault={vault} /> : 'Unavailable'}</dd></div></dl>
    {readiness?.dryRun && <div className="dry-run"><strong>Test-pull verified</strong><dl><div><dt>txid</dt><dd>{truncate(readiness.dryRun.txid, 12, 10)}</dd></div><div><dt>Destination</dt><dd title={readiness.dryRun.destination}>{truncate(readiness.dryRun.destination, 14, 10)}</dd></div><div><dt>vsize</dt><dd>{readiness.dryRun.vsize} vB</dd></div><div><dt>nSequence</dt><dd>{readiness.dryRun.sequence}</dd></div></dl><p>Nothing was broadcast. No sats moved.</p></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {broadcastTxid && <p className="flow-note" role="status">Exit broadcast: <code>{broadcastTxid}</code>. Confirm it on the regtest explorer before treating funds as settled.</p>}
    {vault && <TapscriptInspector vault={vault} />}
    <div className="ripcord-actions"><button className="test-pull" disabled={!vault || !identity || busy} onClick={() => void run()}>{busy ? 'Building exit…' : readiness?.dryRun ? 'Run test-pull again' : 'Run test-pull'}</button><HoldToConfirmButton disabled={status !== 'live' || !readiness?.dryRun || busy} onConfirm={async () => { if (!vault || !identity) return; setBusy(true); setError(''); setBroadcastTxid(''); try { const { makeSigner } = await import('@ripcord/core/keys'); const signer = makeSigner(identity.mnemonic, 'regtest', vault.userKeyIndex); const result = await execute(vault, signer); setBroadcastTxid(result.txid); await refreshMaturity(vault); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }} /></div>
  </section>;
}
