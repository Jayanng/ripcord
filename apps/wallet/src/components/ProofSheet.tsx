import { useEffect, useRef, type ReactNode } from 'react';
import type { PaymentReceipt } from '@ripcord/core/types';
import { Icon, truncate, explorerTxUrl } from './ui';
import { downloadText } from '../lib/activityExport';

/** Phase 10 (#20): the exact receipt as JSON - no field invention. */
function proofToJson(receipt: PaymentReceipt): string {
  return JSON.stringify(receipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
}
export function ProofSheet({ receipt, onClose }: { receipt: PaymentReceipt | null; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null); const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!receipt) return; const previous = document.activeElement as HTMLElement | null; close.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); return; } if (event.key !== 'Tab' || !panel.current) return; const nodes = [...panel.current.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')]; if (!nodes.length) return; const first = nodes[0]; const last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); }; }, [receipt, onClose]);
  if (!receipt) return null;
  return <div className="sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside ref={panel} className="proof-sheet" role="dialog" aria-modal="true" aria-labelledby="proof-title"><header><div><p className="eyebrow">Cryptographic receipt</p><h2 id="proof-title">Proof chain</h2></div><button ref={close} aria-label="Close proof" onClick={onClose}><Icon name="close" /></button></header><div className="proof-chain"><ProofStep label="Transaction" value={<a href={explorerTxUrl(receipt.txHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>{truncate(receipt.txHash, 14, 10)} ↗</a>} detail={`epoch ${receipt.epoch} · code ${receipt.code}`} /><ProofStep label="HAT" value={receipt.hat ? truncate(receipt.hat.proof, 14, 10) : 'Unavailable'} detail={receipt.hat ? 'daemon commitment included' : 'not fetched'} /><ProofStep label="Verkle" value={receipt.rip?.hatInStateDiff ? 'HAT found in state diff' : 'Not verified'} detail="normalized inclusion comparison" /><ProofStep label="RIP chain" value={receipt.rip ? receipt.rip.chainLength === 0 ? 'self-proof' : `${receipt.rip.chainLength} epochs` : 'Unavailable'} detail={receipt.rip ? `origin ${receipt.rip.originEpoch} → final ${receipt.rip.finalEpoch}` : 'not fetched'} /><ProofStep label="Final root" value={receipt.rip ? truncate(receipt.rip.finalRoot, 14, 10) : 'Unavailable'} detail="daemon-attested; encoding preserved" /></div><div className="proof-diagram" aria-label="Proof chain diagram">
          <p className="eyebrow">Chain of evidence</p>
          <div className="proof-diagram-row">
            <div className={`proof-node ${receipt.hat ? 'proved' : ''}`}><span>Tx hash</span><strong>{truncate(receipt.txHash, 8, 6)}</strong></div>
            <span className="proof-arrow" aria-hidden="true">→</span>
            <div className={`proof-node ${receipt.hat ? 'proved' : ''}`}><span>HAT</span><strong>{receipt.hat ? truncate(receipt.hat.proof, 8, 6) : 'n/a'}</strong></div>
            <span className="proof-arrow" aria-hidden="true">→</span>
            <div className={`proof-node ${receipt.rip?.hatInStateDiff ? 'proved' : ''}`}><span>State diff</span><strong>{receipt.rip ? (receipt.rip.hatInStateDiff ? 'HAT in' : 'not found') : 'n/a'}</strong></div>
            <span className="proof-arrow" aria-hidden="true">→</span>
            <div className={`proof-node ${receipt.rip ? 'proved' : ''}`}><span>Epoch root</span><strong>{receipt.rip ? truncate(receipt.rip.finalRoot, 8, 6) : 'n/a'}</strong></div>
          </div>
        </div>
        <div className="proof-export-row">
          <button type="button" className="secondary-action" onClick={() => downloadText(`ripcord-proof-${receipt.txHash.slice(0, 16)}.json`, proofToJson(receipt), 'application/json')}>
            Export Proof JSON
          </button>
        </div>
        <div className="proof-caveats"><p><strong>PSBT payload</strong> unavailable on regtest; HAT is not recomputed locally.</p><p><strong>L1 anchor</strong> not populated in sampled regtest proofs.</p></div></aside></div>;
}
function ProofStep({ label, value, detail }: { label: string; value: ReactNode; detail: string }) { return <div className="proof-step"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
