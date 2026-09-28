import { useMemo, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { Icon } from './ui';
import { VtxoRow } from './VtxoRow';
import { VtxoDetailSheet } from './VtxoDetailSheet';
import { deriveVtxoProvenance, type VtxoRecordItem } from '../lib/provenance';

export type VtxoFilter = 'all' | 'spendable' | 'locked' | 'spent';

export interface VtxoManagementCardProps {
  onFund?: () => void;
}

export function VtxoManagementCard({ onFund }: VtxoManagementCardProps) {
  const { liveVtxos, spentVtxos, lockedVtxos, vaults, receipts, identity } = useWallet();
  const [filter, setFilter] = useState<VtxoFilter>('all');
  const [selectedVtxo, setSelectedVtxo] = useState<VtxoRecordItem | null>(null);

  // Spendable: live and not locked
  const spendableVtxos = useMemo(() => {
    return liveVtxos.filter(v => !v.spent && !v.locked);
  }, [liveVtxos]);

  // Locked: cooperative escrow
  const lockedItems = useMemo(() => {
    // Merge locked from liveVtxos and lockedVtxos without duplicates
    const map = new Map<string, VtxoRecordItem>();
    for (const v of lockedVtxos) map.set(v.id, v);
    for (const v of liveVtxos) {
      if (v.locked && !v.spent) map.set(v.id, v);
    }
    return Array.from(map.values());
  }, [liveVtxos, lockedVtxos]);

  // Spent
  const spentItems = useMemo(() => {
    return spentVtxos;
  }, [spentVtxos]);

  // Full inventory combined
  const allVtxos = useMemo(() => {
    const map = new Map<string, VtxoRecordItem>();
    for (const v of spendableVtxos) map.set(v.id, v);
    for (const v of lockedItems) map.set(v.id, v);
    for (const v of spentItems) map.set(v.id, v);
    return Array.from(map.values());
  }, [spendableVtxos, lockedItems, spentItems]);

  const totalCount = allVtxos.length;
  const spendableCount = spendableVtxos.length;
  const lockedCount = lockedItems.length;
  const spentCount = spentItems.length;

  // Pre-calculate provenance mapping for all VTXOs
  const provenanceMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveVtxoProvenance>>();
    for (const v of allVtxos) {
      map.set(
        v.id,
        deriveVtxoProvenance(v, {
          vaults,
          receipts,
          allVtxos,
          userXOnly: identity?.xOnly,
        }),
      );
    }
    return map;
  }, [allVtxos, vaults, receipts, identity?.xOnly]);

  return (
    <>
      <details className="instrument vtxo-management-card" open>
        <summary className="section-heading vtxo-summary" aria-label="Toggle VTXO Inventory">
          <div>
            <p className="eyebrow">TAURUS INVENTORY</p>
            <h2 id="vtxo-section-title">Your VTXOs ({totalCount})</h2>
          </div>
          <div className="vtxo-summary-right">
            <span className="vtxo-total-pill">{totalCount} total</span>
            <span className="vtxo-chevron" aria-hidden="true">▾</span>
          </div>
        </summary>

        <div className="vtxo-content">
          {totalCount === 0 ? (
            <div className="empty-state vtxo-empty-state">
              <span className="empty-glyph">⌁</span>
              <strong>No VTXOs yet</strong>
              <p>Deposit funds into a TAURUS vault to mint your first spendable VTXO.</p>
              {onFund && (
                <button
                  type="button"
                  className="action-btn"
                  onClick={onFund}
                  style={{ marginTop: '16px', minHeight: '44px' }}
                >
                  <Icon name="receive" />
                  <span>Deposit & Fund Vault</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Filter Tabs */}
              <div className="vtxo-filter-tabs" role="tablist" aria-label="Filter VTXOs by state">
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'all'}
                  className={`vtxo-tab-btn ${filter === 'all' ? 'active' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  All ({totalCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'spendable'}
                  className={`vtxo-tab-btn ${filter === 'spendable' ? 'active' : ''}`}
                  onClick={() => setFilter('spendable')}
                >
                  Spendable ({spendableCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'locked'}
                  className={`vtxo-tab-btn ${filter === 'locked' ? 'active' : ''}`}
                  onClick={() => setFilter('locked')}
                >
                  Locked ({lockedCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'spent'}
                  className={`vtxo-tab-btn ${filter === 'spent' ? 'active' : ''}`}
                  onClick={() => setFilter('spent')}
                >
                  Spent ({spentCount})
                </button>
              </div>

              {/* Grouped lists */}
              <div className="vtxo-groups-container">
                {/* Spendable Group */}
                {(filter === 'all' || filter === 'spendable') && (
                  <section className="vtxo-group" aria-labelledby="group-spendable-title">
                    <div className="vtxo-group-header">
                      <h3 id="group-spendable-title">
                        Spendable <span className="vtxo-group-count">({spendableCount})</span>
                      </h3>
                      <small>Off-chain balance spendable now</small>
                    </div>
                    {spendableCount === 0 ? (
                      <p className="vtxo-group-empty">No spendable VTXOs available</p>
                    ) : (
                      <div className="vtxo-list">
                        {spendableVtxos.map(v => (
                          <VtxoRow
                            key={v.id}
                            vtxo={v}
                            provenance={provenanceMap.get(v.id)!}
                            onSelect={setSelectedVtxo}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* Locked Group */}
                {(filter === 'all' || filter === 'locked') && (
                  <section className="vtxo-group" aria-labelledby="group-locked-title">
                    <div className="vtxo-group-header">
                      <h3 id="group-locked-title">
                        Locked (cooperative escrow) <span className="vtxo-group-count">({lockedCount})</span>
                      </h3>
                      <small>Committed to vault escrow; not spendable</small>
                    </div>
                    {lockedCount === 0 ? (
                      <p className="vtxo-group-empty">0 locked VTXOs</p>
                    ) : (
                      <div className="vtxo-list">
                        {lockedItems.map(v => (
                          <VtxoRow
                            key={v.id}
                            vtxo={v}
                            provenance={provenanceMap.get(v.id)!}
                            onSelect={setSelectedVtxo}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* Spent Group */}
                {(filter === 'all' || filter === 'spent') && (
                  <section className="vtxo-group" aria-labelledby="group-spent-title">
                    <div className="vtxo-group-header">
                      <h3 id="group-spent-title">
                        Spent <span className="vtxo-group-count">({spentCount})</span>
                      </h3>
                      <small>Historical inputs consumed on the ledger</small>
                    </div>
                    {spentCount === 0 ? (
                      <p className="vtxo-group-empty">No spent VTXOs in history</p>
                    ) : (
                      <div className="vtxo-list">
                        {spentItems.map(v => (
                          <VtxoRow
                            key={v.id}
                            vtxo={v}
                            provenance={provenanceMap.get(v.id)!}
                            onSelect={setSelectedVtxo}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </details>

      {/* Detail Inspection Sheet */}
      <VtxoDetailSheet vtxo={selectedVtxo} onClose={() => setSelectedVtxo(null)} />
    </>
  );
}
