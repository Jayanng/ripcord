import { useEffect, useState } from 'react';
import { useWallet } from './context/WalletContext';
import { Layout } from './components/Layout';
import type { AppTab } from './components/TabBar';
import { SetupGate } from './screens/SetupGate';
import { SearchDrawer } from './components/SearchDrawer';
import { WalletScreen } from './screens/WalletScreen';
import { ExitScreen } from './screens/ExitScreen';
import { ProofsScreen } from './screens/ProofsScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { DocsScreen } from './screens/DocsScreen';

export function App() {
  const wallet = useWallet();
  const [tab, setTab] = useState<AppTab>('wallet');

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.toLowerCase().replace('#/', '').replace('#', '');
      if (hash === 'docs') setTab('docs');
      else if (hash === 'activity') setTab('activity');
      else if (hash === 'proofs') setTab('proofs');
      else if (hash === 'exit') setTab('exit');
      else if (hash === 'wallet' || hash === 'create' || hash === 'recover') setTab('wallet');
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const handleTabChange = (nextTab: AppTab) => {
    setTab(nextTab);
    window.location.hash = `#/${nextTab}`;
  };

  const showSetup = !wallet.identity;

  return <Layout tab={tab} onTabChange={handleTabChange}>
    <SearchDrawer />
    {tab === 'docs' ? (
      <DocsScreen />
    ) : tab === 'activity' ? (
      <ActivityScreen />
    ) : tab === 'proofs' ? (
      <ProofsScreen />
    ) : tab === 'exit' ? (
      <ExitScreen />
    ) : showSetup ? (
      <SetupGate />
    ) : (
      <WalletScreen onExit={() => handleTabChange('exit')} />
    )}
  </Layout>;
}
