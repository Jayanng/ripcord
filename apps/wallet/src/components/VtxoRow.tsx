import { useState, type MouseEvent } from 'react';
import { truncate, formatSats, Icon } from './ui';
import type { VtxoRecordItem, VtxoProvenance } from '../lib/provenance';

export interface VtxoRowProps {
  vtxo: VtxoRecordItem;
  provenance: VtxoProvenance;
  onSelect: (vtxo: VtxoRecordItem) => void;
}

export function VtxoRow({ vtxo, provenance, onSelect }: VtxoRowProps) {
  const [copied, setCopied] = useState(false);

  const stateLabel = vtxo.spent
    ? 'Spent'
    : vtxo.locked
    ? 'Locked'
    : 'Spendable';

  const stateClass = vtxo.spent
    ? 'chip-spent'
    : vtxo.locked
    ? 'chip-locked'
    : 'chip-spendable';

  const handleCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(vtxo.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`vtxo-row ${vtxo.spent ? 'spent' : vtxo.locked ? 'locked' : 'spendable'}`}
      onClick={() => onSelect(vtxo)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(vtxo);
        }
      }}
      aria-label={`VTXO ${truncate(vtxo.id, 8, 6)}, ${formatSats(vtxo.amountSats)}, ${stateLabel}, ${provenance.label}`}
    >
      <div className="vtxo-row-main">
        {/* Top row: Truncated ID with copy + Amount */}
        <div className="vtxo-row-top">
          <div className="vtxo-id-group">
            <span className="vtxo-id-text" title={vtxo.id}>
              {truncate(vtxo.id, 8, 6)}
            </span>
            <button
              type="button"
              className="vtxo-copy-btn"
              onClick={handleCopy}
              aria-label={`Copy VTXO ID ${vtxo.id}`}
              title="Copy full VTXO ID"
            >
              {copied ? <Icon name="check" /> : <Icon name="copy" />}
            </button>
          </div>
          <strong className="vtxo-amount">{formatSats(vtxo.amountSats)}</strong>
        </div>

        {/* Bottom row: Provenance line + State chip */}
        <div className="vtxo-row-bottom">
          <span className="vtxo-provenance-text" title={provenance.detail}>
            {provenance.label}
          </span>
          <span className={`vtxo-state-chip ${stateClass}`}>{stateLabel}</span>
        </div>
      </div>
    </div>
  );
}
