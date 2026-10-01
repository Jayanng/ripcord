import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';

/**
 * Network pill (Phase 4): regtest at a glance, and an honest slim banner
 * when live updates are paused (offline or indexer disconnected). Auto-
 * recovers; tapping retries immediately.
 */
export function NetworkBadge() {
  const wallet = useWallet();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const indexerConnected = wallet.indexerStatus.state === 'connected';
  const paused = !online || !indexerConnected;

  return (
    <button
      type="button"
      className={`network-badge${paused ? ' paused' : ''}`}
      aria-label={
        paused
          ? 'Live updates paused, retrying. Tap to retry now.'
          : 'Network: Bitcoin regtest, live updates connected'
      }
      title={
        paused
          ? 'Live updates paused. Tap to retry now.'
          : 'Live updates connected on Bitcoin regtest'
      }
      onClick={() => void wallet.refresh()}
    >
      <span aria-hidden="true" />
      {paused ? 'Live updates paused, retrying' : 'REGTEST'}
    </button>
  );
}
