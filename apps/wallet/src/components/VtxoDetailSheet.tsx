import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWallet } from '../context/WalletContext';
import { Icon, truncate, explorerVtxoUrl, explorerBlockUrl, formatSats } from './ui';
import { deriveVtxoProvenance, type VtxoRecordItem, type VtxoProvenance } from '../lib/provenance';
import { joinDaemonUrl } from '@ripcord/core/net';

export interface VtxoDetailSheetProps {
  vtxo: VtxoRecordItem | null;
  onClose: () => void;
}

export function VtxoDetailSheet({ vtxo, onClose }: VtxoDetailSheetProps) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const { daemonUrl, vaults, receipts, liveVtxos, spentVtxos, lockedVtxos, identity } = useWallet();

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [enrichedVtxo, setEnrichedVtxo] = useState<VtxoRecordItem | null>(null);

  // Focus trap and escape key listener (ProofSheet pattern)
  useEffect(() => {
    if (!vtxo) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();

    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(
        'button,[href],[tabindex]:not([tabindex="-1"])',
      )];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [vtxo, onClose]);

  // On open, optionally probe /tachi_vtxo?id= to enrich with any extra daemon fields (e.g. script, L1 anchor)
  useEffect(() => {
    if (!vtxo) {
      setEnrichedVtxo(null);
      return;
    }
    setEnrichedVtxo(vtxo);

    let cancelled = false;
    const probe = async () => {
      try {
        const url = `${joinDaemonUrl(daemonUrl, 'tachi_vtxo')}?id=${encodeURIComponent(vtxo.id)}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as {
          id?: string;
          owner?: string;
          amount?: number;
          spent?: boolean;
          height?: number;
          script?: string;
          locked?: boolean;
          vault_address?: string;
          vaultAddress?: string;
          btc_height?: number;
          BTCHeight?: number;
          btc_timestamp?: number;
          BTCTimestamp?: number;
        };
        if (!cancelled && data && data.id) {
          setEnrichedVtxo(prev => ({
            ...(prev ?? vtxo),
            owner: data.owner ?? prev?.owner ?? vtxo.owner,
            script: data.script ?? prev?.script ?? vtxo.script,
            vaultAddress: data.vault_address ?? data.vaultAddress ?? prev?.vaultAddress ?? vtxo.vaultAddress,
            btcHeight: data.btc_height ?? data.BTCHeight ?? prev?.btcHeight ?? vtxo.btcHeight ?? 0,
            btcTimestamp: data.btc_timestamp ?? data.BTCTimestamp ?? prev?.btcTimestamp ?? vtxo.btcTimestamp ?? 0,
          }));
        }
      } catch {
        // Fallback gracefully to existing vtxo data
      }
    };
    void probe();
    return () => { cancelled = true; };
  }, [vtxo, daemonUrl]);

  if (!vtxo) return null;

  const current = enrichedVtxo ?? vtxo;
  const allVtxos = [...liveVtxos, ...spentVtxos, ...lockedVtxos];
  const provenance: VtxoProvenance = deriveVtxoProvenance(current, {
    vaults,
    receipts,
    allVtxos,
    userXOnly: identity?.xOnly,
  });

  const stateLabel = current.spent
    ? 'Spent'
    : current.locked
    ? 'Locked (cooperative escrow)'
    : 'Spendable';

  const stateChipClass = current.spent
    ? 'chip-spent'
    : current.locked
    ? 'chip-locked'
    : 'chip-spendable';

  const copy = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setCopiedField(null);
    }
  };

  const hasL1Anchor = (current.btcHeight ?? 0) > 0 || (current.btcTimestamp ?? 0) > 0;
  const l1AnchorText = hasL1Anchor
    ? `Block ${current.btcHeight ?? 0}${current.btcTimestamp ? ` · ${new Date((current.btcTimestamp ?? 0) * 1000).toLocaleString()}` : ''}`
    : '0 (unanchored on regtest)';

  const lockStatusText = current.locked
    ? `Locked in cooperative escrow${current.vaultAddress ? ` to vault ${truncate(current.vaultAddress, 10, 8)}` : ''}`
    : current.spent
    ? 'Spent on ledger'
    : 'Unlocked (Spendable now)';

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panel}
        className="proof-sheet vtxo-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vtxo-detail-title"
      >
        <header>
          <div>
            <p className="eyebrow">TAURUS VTXO Inspection</p>
            <h2 id="vtxo-detail-title">VTXO Details</h2>
          </div>
          <button ref={close} aria-label="Close details" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="proof-chain vtxo-detail-chain">
          {/* Amount & State */}
          <div className="vtxo-detail-hero">
            <div className="vtxo-detail-amount">
              <span>AMOUNT</span>
              <strong>{formatSats(current.amountSats)}</strong>
            </div>
            <span className={`vtxo-state-chip ${stateChipClass}`}>{stateLabel}</span>
          </div>

          {/* VTXO ID with Copy */}
          <div className="vtxo-detail-item">
            <div className="vtxo-detail-header">
              <span>VTXO ID</span>
              <button
                type="button"
                className="vtxo-inline-copy"
                onClick={() => void copy(current.id, 'id')}
                aria-label="Copy full VTXO ID"
              >
                {copiedField === 'id' ? <><Icon name="check" /> Copied</> : <><Icon name="copy" /> Copy ID</>}
              </button>
            </div>
            <code className="vtxo-mono-block">{current.id}</code>
          </div>

          {/* Provenance Origin Line */}
          <VtxoDetailStep
            label="Provenance"
            value={provenance.label}
            detail={provenance.detail}
          />

          {/* Owner */}
          <div className="vtxo-detail-item">
            <div className="vtxo-detail-header">
              <span>Owner (x-only public key)</span>
              {current.owner && (
                <button
                  type="button"
                  className="vtxo-inline-copy"
                  onClick={() => void copy(current.owner!, 'owner')}
                  aria-label="Copy owner pubkey"
                >
                  {copiedField === 'owner' ? <><Icon name="check" /> Copied</> : <><Icon name="copy" /> Copy Key</>}
                </button>
              )}
            </div>
            <code className="vtxo-mono-block">{current.owner || identity?.xOnly || 'Unknown owner'}</code>
          </div>

          {/* Creation Epoch & Height */}
          <VtxoDetailStep
            label="Creation Epoch / Height"
            value={
              current.height && current.height > 0 ? (
                <a
                  href={explorerBlockUrl(current.height)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--primary)', textDecoration: 'none' }}
                >
                  Epoch {current.height} ↗
                </a>
              ) : (
                'Pending commit'
              )
            }
            detail={current.height && current.height > 0 ? `CometBFT block height ${current.height}` : 'Not committed to a block yet'}
          />

          {/* Lock Status */}
          <VtxoDetailStep
            label="Lock Status"
            value={lockStatusText}
            detail={current.locked ? 'Requires cooperative quorum multisig or unilateral exit to reclaim' : 'Freely transferable off-chain with BIP-340 Schnorr signature'}
          />

          {/* Lock Script */}
          <div className="vtxo-detail-item">
            <div className="vtxo-detail-header">
              <span>Lock Script</span>
              {current.script ? (
                <button
                  type="button"
                  className="vtxo-inline-copy"
                  onClick={() => void copy(current.script!, 'script')}
                  aria-label="Copy lock script"
                >
                  {copiedField === 'script' ? <><Icon name="check" /> Copied</> : <><Icon name="copy" /> Copy Script</>}
                </button>
              ) : null}
            </div>
            {current.script ? (
              <code className="vtxo-mono-block">{current.script}</code>
            ) : (
              <small style={{ color: 'var(--text-lo)', fontSize: '13px' }}>None (standard P2TR user leaf)</small>
            )}
          </div>

          {/* L1 Anchor Info */}
          <VtxoDetailStep
            label="L1 Anchor (Bitcoin Deposit)"
            value={l1AnchorText}
            detail={
              hasL1Anchor
                ? `Bitcoin L1 block anchor per INTEGRATION.md VTXOResponse`
                : `Regtest epochs run unanchored; BTCHeight / BTCTimestamp are 0 (docs/01-VERIFIED-API.md §16.6)`
            }
          />

          {/* Explorer Link */}
          <div className="vtxo-detail-item" style={{ paddingTop: '8px' }}>
            <a
              href={explorerVtxoUrl(String(current.id).split(':')[0])}
              target="_blank"
              rel="noreferrer"
              className="action-btn"
              style={{ textDecoration: 'none', justifyContent: 'center', minHeight: '44px' }}
            >
              <span>View in Regtest Explorer</span>
              <span>↗</span>
            </a>
          </div>
        </div>

        <div className="proof-caveats" style={{ marginTop: '16px' }}>
          <p>
            <strong>Regtest Environment:</strong> VTXO commitments are verified by the live CometBFT quorum.
            L1 block anchoring is unpopulated on regtest per verified daemon contract.
          </p>
        </div>
      </aside>
    </div>
  );
}

function VtxoDetailStep({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="proof-step">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
