import type { ReactNode } from 'react';
import { Header } from './Header';
import { TabBar, type AppTab } from './TabBar';
import { ToastStack } from './ToastStack';

export function Layout({
  children,
  tab,
  onTabChange,
}: {
  children: ReactNode;
  tab: AppTab;
  onTabChange: (tab: AppTab) => void;
}) {
  return (
    <div className="app-shell">
      <Header active={tab} onChange={onTabChange} />
      <main id="main" className="dashboard">
        {children}
      </main>
      <ToastStack />
      <TabBar active={tab} onChange={onTabChange} />
    </div>
  );
}
