import { useEffect, useRef } from 'react';
import { explorerAddressUrl, EXPLORER_BASE, truncate } from './ui';

type Props = {
  txid: string;
  amountSats: number;
  destination?: string;
  onClose: () => void;
};

/**
 * Exit success modal (standard practice: one clear completion dialog).
 *
 * Shown the moment the sovereign exit broadcast succeeds, so the user never
 * has to wonder "did anything happen?". States plainly what changed: the
 * vault's funds are moving to their own L1 address, signed by their key alone.
 */
export function ExitSuccessModal({ txid, amountSats, destination, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    try {
      navigator.vibrate?.(30);
    } catch {
      // haptics are optional
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="proof-sheet" role="dialog" aria-modal="true" aria-labelledby="exit-done-title">
        <header>
          <div>
            <p className="eyebrow">Sovereign exit broadcast</p>
            <h2 id="exit-done-title">You are back on Bitcoin L1</h2>
          </div>
          <button ref={close} type="button" className="link-action" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="ripcord-copy">
          Your vault funds are moving to your own Bitcoin address. This transaction
          needs only your signature: no quorum, no permission. Your balance and
          activity below now reflect this exit.
        </p>
        <dl className="ripcord-facts">
          <div>
            <dt>Amount</dt>
            <dd>{amountSats.toLocaleString('en-US')} sats</dd>
          </div>
          {destination ? (
            <div>
              <dt>To your address</dt>
              <dd title={destination}>{truncate(destination, 14, 10)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Transaction</dt>
            <dd>
              <a href={destination ? explorerAddressUrl(destination) : EXPLORER_BASE} target="_blank" rel="noreferrer">
                {truncate(txid, 12, 10)}
              </a>
            </dd>
          </div>
        </dl>
        <p className="flow-note" role="status">
          The vault shows as spent from now on. The transaction is the proof of
          this exit: open it on the explorer above to verify.
        </p>
        <div className="ripcord-actions">
          <button type="button" className="test-pull" onClick={onClose}>
            Got it
          </button>
        </div>
      </aside>
    </div>
  );
}
