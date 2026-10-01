import { useEffect, useState, type ReactNode } from 'react';
import { Header } from './Header';
import { TabBar, type AppTab } from './TabBar';
import { ToastStack } from './ToastStack';
import { NetworkBadge } from './NetworkBadge';
import { useWallet } from '../context/WalletContext';
import { createIdleTimer } from '@ripcord/core/idle-timer';
import { AUTOLOCK_INTERACTION_EVENTS, loadAutoLockSettings } from '../lib/autolock';
import { pushToast } from '../lib/toasts';

export function Layout({
  children,
  tab,
  onTabChange,
  navVisible,
}: {
  children: ReactNode;
  tab: AppTab;
  onTabChange: (tab: AppTab) => void;
  navVisible?: boolean;
}) {
  const wallet = useWallet();
  const showNav = navVisible ?? wallet.hasVault;
  const [autoLockStamp, setAutoLockStamp] = useState(0);

  // Auto-lock (Phase 4): after idle time the in-memory identity is cleared
  // and the existing lock screen appears. RAM-only: nothing is stored, so
  // "keys never stored" stays true. Safety: never lock while a modal or
  // sheet is open (the user is mid-flow), and any interaction resets the
  // countdown.
  useEffect(() => {
    if (!wallet.identity) return;
    const settings = loadAutoLockSettings();
    if (!settings.enabled) return;
    let locked = false;
    const timer = createIdleTimer({
      timeoutMs: settings.minutes * 60_000,
      onIdle: () => {
        if (document.querySelector('.sheet-backdrop')) { timer.reset(); return; } // mid-flow: re-arm
        if (locked) return;
        locked = true;
        wallet.setIdentity(null);
        pushToast({
          title: 'Wallet locked',
          body: `Locked after ${settings.minutes} minutes idle. Your keys left memory; enter your phrase to continue.`,
          tone: 'info',
        });
      },
    });
    const reset = () => timer.reset();
    for (const event of AUTOLOCK_INTERACTION_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }
    return () => {
      timer.dispose();
      for (const event of AUTOLOCK_INTERACTION_EVENTS) {
        window.removeEventListener(event, reset);
      }
    };
  }, [wallet.identity, autoLockStamp]);

  // Re-arm with new settings when the header pill changes them.
  useEffect(() => {
    const onChange = () => setAutoLockStamp(value => value + 1);
    window.addEventListener('ripcord:autolock-changed', onChange);
    return () => window.removeEventListener('ripcord:autolock-changed', onChange);
  }, []);

  return (
    <div className="app-shell">
      <Header active={tab} onChange={onTabChange} navVisible={showNav} />
      <div className="network-pill-row">
        <NetworkBadge />
      </div>
      <main id="main" className="dashboard">
        {children}
      </main>
      <ToastStack />
      {showNav && <TabBar active={tab} onChange={onTabChange} navVisible={showNav} />}
    </div>
  );
}
