import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { fetchConfirmations } from '../lib/confirmations';

/**
 * L1 confirmation counter (Phase 4): polls gettxout while visible (30s,
 * bounded and read-only). "final" when the output is spent or unknown.
 */
export function ConfirmationsBadge({ txid, vout }: { txid: string; vout: number }) {
  const wallet = useWallet();
  const [confirmations, setConfirmations] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const value = await fetchConfirmations(wallet.baseUrl, txid, vout);
      if (alive) setConfirmations(value);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [txid, vout, wallet.baseUrl]);

  return (
    <span className="conf-badge" role="status">
      {confirmations === undefined
        ? 'checking confirmations…'
        : confirmations === null
          ? 'final (output spent)'
          : `${confirmations} confirmation${confirmations === 1 ? '' : 's'}`}
    </span>
  );
}
