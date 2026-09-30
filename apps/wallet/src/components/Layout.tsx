import type { ReactNode } from 'react';
import { Header } from './Header';
import { TabBar, type AppTab } from './TabBar';
import { ToastStack } from './ToastStack';
import { useWallet } from '../context/WalletContext';

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

  return (
    <div className="app-shell">
      <Header active={tab} onChange={onTabChange} navVisible={showNav} />
      <main id="main" className="dashboard">
        {children}
      </main>
      <ToastStack />
      {showNav && <TabBar active={tab} onChange={onTabChange} navVisible={showNav} />}
    </div>
  );
}
