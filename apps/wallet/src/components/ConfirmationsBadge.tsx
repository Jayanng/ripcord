import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { fetchConfirmations, type ConfirmationsResult } from '../lib/confirmations';

/**
 * L1 confirmation counter (Phase 4): polls gettxout while visible (30s,
 * bounded and read-only). Shows the chain's answer, and says plainly when
 * the status could not be checked.
 */
export function ConfirmationsBadge({ txid, vout }: { txid: string; vout: number }) {
  const wallet = useWallet();
  const [result, setResult] = useState<ConfirmationsResult | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    // Reset on change: never show a previous output's count under a new one.
    setResult(undefined);
    const poll = async () => {
      // While the tab is hidden, stop asking (bounded, polite).
      if (document.hidden) return;
      const value = await fetchConfirmations(wallet.baseUrl, txid, vout);
      if (alive) setResult(value);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [txid, vout, wallet.baseUrl]);

  return (
    <span className="conf-badge" role="status">
      {result === undefined
        ? 'checking confirmations…'
        : result.state === 'confirmed'
          ? `${result.confirmations} confirmation${result.confirmations === 1 ? '' : 's'}`
          : result.state === 'spent'
            ? 'final (output spent)'
            : 'confirmation status unavailable'}
    </span>
  );
}
