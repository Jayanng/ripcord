import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { formatSats, truncate, Icon, explorerTxUrl } from './ui';
import type { ChainSearchResult } from '@ripcord/core/search';

/**
 * Phase 8 (#8): in-wallet protocol search. Ctrl+K or "/" opens the drawer;
 * queries hit the daemon's tachi_search (auto-detects tx, block, vtxo,
 * address). No external explorer needed to find your own activity.
 */
export function SearchDrawer() {
  const { daemonUrl } = useWallet();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ChainSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { searchChain } = await import('@ripcord/core/search');
      const found = await searchChain(daemonUrl, trimmed);
      setResult(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Protocol search failed.');
    } finally {
      setBusy(false);
    }
  }, [query, daemonUrl]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setResult(null);
    setError('');
  };

  if (!open) {
    return (
      <button
        type="button"
        className="search-launcher"
        onClick={() => setOpen(true)}
        aria-label="Open protocol search"
      >
        <Icon name="proofs" />
        <span>Search protocol</span>
        <kbd>Ctrl K</kbd>
      </button>
    );
  }

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside
        ref={panelRef}
        className="proof-sheet search-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-drawer-title"
      >
        <header>
          <div>
            <p className="eyebrow">Protocol search</p>
            <h2 id="search-drawer-title">Find anything on-chain</h2>
          </div>
          <button type="button" aria-label="Close search" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="flow-body" style={{ padding: '24px' }}>
          <form
            onSubmit={event => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <label htmlFor="protocol-search-input">Tx hash, block height, VTXO id, or address</label>
            <div className="recipient-input-row">
              <input
                ref={inputRef}
                id="protocol-search-input"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="e.g. 14360 or bcrt1p… or 64-hex"
                autoComplete="off"
              />
              <button type="submit" className="scan-btn" disabled={busy || !query.trim()}>
                {busy ? 'Searching…' : 'Search'}
              </button>
            </div>
            <small className="form-help">
              Searches the protocol directly (tx, block, epoch, VTXO, address). Press Esc to close.
            </small>
          </form>

          {error && (
            <p className="inline-error" role="alert" style={{ marginTop: '16px' }}>
              {error}
            </p>
          )}

          {result && (
            <div className="search-result" role="region" aria-label="Search result">
              {result.kind === 'not-found' && (
                <p className="form-help">
                  Nothing found for <strong>{result.query}</strong>. Check the hash or height and try again.
                </p>
              )}
              {result.kind === 'block' && (
                <dl className="watchtower-grid">
                  <div>
                    <dt>Type</dt>
                    <dd>Block</dd>
                  </div>
                  <div>
                    <dt>Height</dt>
                    <dd>{result.height}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{result.time ? new Date(result.time * 1000).toLocaleString() : 'Unknown'}</dd>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <dt>Block hash</dt>
                    <dd title={result.hash}>{truncate(result.hash, 14, 12)}</dd>
                  </div>
                </dl>
              )}
              {result.kind === 'tx' && (
                <dl className="watchtower-grid">
                  <div>
                    <dt>Type</dt>
                    <dd>{result.type || 'tx'}</dd>
                  </div>
                  <div>
                    <dt>State</dt>
                    <dd>{result.state || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Height</dt>
                    <dd>{result.height || 'Pending'}</dd>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <dt>Tx hash</dt>
                    <dd title={result.txHash}>
                      {truncate(result.txHash, 14, 12)}{' '}
                      <a className="tx-link" href={explorerTxUrl(result.txHash)} target="_blank" rel="noreferrer">
                        Explorer ↗
                      </a>
                    </dd>
                  </div>
                </dl>
              )}
              {result.kind === 'vtxo' && (
                <dl className="watchtower-grid">
                  <div>
                    <dt>Type</dt>
                    <dd>VTXO</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd>{formatSats(result.amountSats)}</dd>
                  </div>
                  <div>
                    <dt>Height</dt>
                    <dd>{result.height}</dd>
                  </div>
                  <div>
                    <dt>Spent</dt>
                    <dd>{result.spent ? 'Yes' : 'No'}</dd>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <dt>VTXO id</dt>
                    <dd title={result.idHex || undefined}>{result.idHex ? truncate(result.idHex, 14, 12) : 'Not hex-decodable'}</dd>
                  </div>
                </dl>
              )}
              {result.kind === 'address' && (
                <dl className="watchtower-grid">
                  <div>
                    <dt>Type</dt>
                    <dd>Address</dd>
                  </div>
                  <div>
                    <dt>Balance</dt>
                    <dd>{formatSats(result.balanceSats)}</dd>
                  </div>
                  <div>
                    <dt>VTXOs</dt>
                    <dd>{result.vtxoCount}</dd>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <dt>Pubkey</dt>
                    <dd title={result.pubkey}>{truncate(result.pubkey, 14, 12)}</dd>
                  </div>
                </dl>
              )}
              {result.kind === 'unknown' && (
                <p className="form-help">
                  The protocol returned a <strong>{result.typeLabel}</strong> result this wallet cannot render in detail
                  yet. Nothing was hidden; the query simply has no dedicated view.
                </p>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
