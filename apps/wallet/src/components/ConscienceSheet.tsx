import { useEffect, useRef } from 'react';
import type { ConscienceCheck } from '@ripcord/core/spend-conscience';
import { formatSats, truncate } from './ui';

type Props = {
  recipient: string;
  amountSats: bigint;
  checks: readonly ConscienceCheck[];
  onProceed: () => void;
  onCancel: () => void;
};

/**
 * Spend Conscience pre-send sheet (Phase 3).
 *
 * Appears only when the user has rules and money is about to move. Every
 * rule reads in plain English with its real numbers. The buttons are
 * "Looks right, send" and "Cancel": the user stays in charge, but a bad send
 * has to get past their own rules first. Nothing here blocks silently and
 * nothing here sends.
 */
export function ConscienceSheet({ recipient, amountSats, checks, onProceed, onCancel }: Props) {
  const proceed = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    proceed.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel]);

  const flagged = checks.filter(c => !c.pass).length;

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <aside className="proof-sheet" role="dialog" aria-modal="true" aria-labelledby="conscience-title">
        <header>
          <div>
            <p className="eyebrow">Spend Conscience</p>
            <h2 id="conscience-title">Your own rules, before the send</h2>
          </div>
          <button type="button" className="link-action" onClick={onCancel}>
            Cancel
          </button>
        </header>
        <p className="ripcord-copy">
          {flagged === 0
            ? `Everything checks out. Sending ${formatSats(amountSats)} to ${truncate(recipient, 12, 10)}.`
            : `${flagged} of your ${checks.length} rule${checks.length === 1 ? '' : 's'} flagged this send of ${formatSats(amountSats)} to ${truncate(recipient, 12, 10)}. Read them before you decide.`}
        </p>
        <ul className="exit-cert-checks" style={{ margin: '0 0 4px' }}>
          {checks.map(check => (
            <li key={check.rule} className={check.pass ? 'pass' : 'fail'}>
              <span className="exit-cert-mark" aria-hidden="true">{check.pass ? '✓' : '!'}</span>
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="ripcord-actions" style={{ marginTop: '16px' }}>
          <button ref={proceed} type="button" className="test-pull" onClick={onProceed}>
            Looks right, send
          </button>
          <button type="button" className="secondary-action" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </aside>
    </div>
  );
}
