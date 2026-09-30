import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PaymentReceipt } from '@ripcord/core/types';
import { Icon, truncate, explorerTxUrl } from './ui';
import { downloadText } from '../lib/activityExport';
import { useWallet } from '../context/WalletContext';

/** Phase 10 (#20): the exact receipt as JSON - no field invention. */
function proofToJson(receipt: PaymentReceipt): string {
  return JSON.stringify(receipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
}
export function ProofSheet({ receipt, onClose }: { receipt: PaymentReceipt | null; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null); const close = useRef<HTMLButtonElement>(null);
  const { daemonUrl, saveReceipt } = useWallet();
  const [live, setLive] = useState<PaymentReceipt | null>(receipt);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  useEffect(() => { setLive(receipt); setFetchError(null); }, [receipt]);
  useEffect(() => { if (!receipt) return; const previous = document.activeElement as HTMLElement | null; close.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); return; } if (event.key !== 'Tab' || !panel.current) return; const nodes = [...panel.current.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex=\"-1\"])')]; if (!nodes.length) return; const first = nodes[0]; const last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); }; }, [receipt, onClose]);
  if (!live) return null;

  /** On-demand daemon attestation fetch: fills HAT + RIP from the daemon's
   *  public proof route and persists the merge. Never fabricates evidence -
   *  every displayed value is what the daemon returned. */
  const fetchProofs = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const { buildPaymentReceipt } = await import('@ripcord/core');
      const fetched = await buildPaymentReceipt({
        txHash: live.txHash,
        epoch: live.epoch,
        code: live.code,
        fromXOnly: live.fromXOnly,
        toXOnly: live.toXOnly,
        amountSats: live.amountSats,
        feeSats: live.feeSats,
        baseUrl: daemonUrl,
        window: 0,
      });
      const merged: PaymentReceipt = {
        ...live,
        ...(fetched.hat ? { hat: fetched.hat } : {}),
        ...(fetched.rip ? { rip: fetched.rip } : {}),
      };
      setLive(merged);
      await saveReceipt(merged);
    } catch (cause) {
      let message = cause instanceof Error ? cause.message : 'Proof fetch failed';
      try {
        const { describeDaemonFailure } = await import('@ripcord/core/net');
        message = describeDaemonFailure(cause);
      } catch { /* keep the fallback message */ }
      setFetchError(message);
    } finally {
      setFetching(false);
    }
  };

  const missingProofs = !live.hat || !live.rip;
  return <div className="sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside ref={panel} className="proof-sheet" role="dialog" aria-modal="true" aria-labelledby="proof-title"><header><div><p className="eyebrow">Cryptographic receipt</p><h2 id="proof-title">Proof chain</h2></div><button ref={close} aria-label="Close proof" onClick={onClose}><Icon name="close" /></button></header><div className="proof-chain"><ProofStep label="Transaction" value={<a href={explorerTxUrl(live.txHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>{truncate(live.txHash, 14, 10)} ↗</a>} detail={`epoch ${live.epoch} · code ${live.code}`} /><ProofStep label="HAT" value={live.hat ? truncate(live.hat.proof, 14, 10) : 'Unavailable'} detail={live.hat ? 'daemon commitment included' : 'not fetched'} /><ProofStep label="Verkle" value={live.rip?.hatInStateDiff ? 'HAT found in state diff' : 'Not verified'} detail="normalized inclusion comparison" /><ProofStep label="RIP chain" value={live.rip ? live.rip.chainLength === 0 ? 'self-proof' : `${live.rip.chainLength} epochs` : 'Unavailable'} detail={live.rip ? `origin ${live.rip.originEpoch} → final ${live.rip.finalEpoch}` : 'not fetched'} /><ProofStep label="Final root" value={live.rip ? truncate(live.rip.finalRoot, 14, 10) : 'Unavailable'} detail="daemon-attested; encoding preserved" /></div><div className="proof-diagram" aria-label="Proof chain diagram">
          <p className="eyebrow">Chain of evidence</p>
          <div className="proof-diagram-row">
            <div className={`proof-node ${live.hat ? 'proved' : ''}`}><span>Tx hash</span><strong>{truncate(live.txHash, 8, 6)}</strong></div>
            <span className="proof-arrow" aria-hidden="true">→</span>
            <div className={`proof-node ${live.hat ? 'proved' : ''}`}><span>HAT</span><strong>{live.hat ? truncate(live.hat.proof, 8, 6) : 'n/a'}</strong></div>
            <span className="proof-arrow" aria-hidden="true">→</span>
            <div className={`proof-node ${live.rip?.hatInStateDiff ? 'proved' : ''}`}><span>State diff</span><strong>{live.rip ? (live.rip.hatInStateDiff ? 'HAT in' : 'not found') : 'n/a'}</strong></div>
            <span className="proof-arrow" aria-hidden="true">→</span>
            <div className={`proof-node ${live.rip ? 'proved' : ''}`}><span>Epoch root</span><strong>{live.rip ? truncate(live.rip.finalRoot, 8, 6) : 'n/a'}</strong></div>
          </div>
        </div>
        <div className="proof-export-row">
          {missingProofs && (
            <button type="button" className="secondary-action" onClick={fetchProofs} disabled={fetching}>
              {fetching ? 'Fetching proof from daemon…' : 'Fetch proof from daemon'}
            </button>
          )}
          <button type="button" className="secondary-action" onClick={() => downloadText(`ripcord-proof-${live.txHash.slice(0, 16)}.json`, proofToJson(live), 'application/json')}>
            Export Proof JSON
          </button>
        </div>
        {fetchError && <p style={{ margin: '10px 0 0', color: 'var(--danger, #e5484d)', fontSize: '13px' }}>{fetchError}</p>}
        <div className="proof-caveats"><p><strong>PSBT payload</strong> unavailable on regtest; HAT is not recomputed locally.</p><p><strong>L1 anchor</strong> not populated in sampled regtest proofs.</p></div></aside></div>;
}
function ProofStep({ label, value, detail }: { label: string; value: ReactNode; detail: string }) { return <div className="proof-step"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
