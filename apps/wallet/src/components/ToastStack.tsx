import { useEffect, useState } from 'react';
import { subscribeToasts, dismissToast, type Toast } from '../lib/toasts';

/** Renders toast notifications raised anywhere in the wallet (Phase 8, #32). */
export function ToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.body && <span>{toast.body}</span>}
            {toast.href && (
              <a className="tx-link" href={toast.href} target="_blank" rel="noreferrer">
                {toast.hrefLabel ?? 'View transaction ↗'}
              </a>
            )}
          </div>
          <button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
