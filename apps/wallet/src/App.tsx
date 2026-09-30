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

export function App() {
  const wallet = useWallet();
  const [tab, setTab] = useState<AppTab>('wallet');

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.toLowerCase().replace('#/', '').replace('#', '');
      if (hash === 'docs' || hash.startsWith('docs')) {
        window.location.href = '/docs';
        return;
      }
      if (!wallet.hasVault) {
        if (hash === 'recover' || hash.startsWith('recover')) {
          setTab('wallet');
          return;
        }
        if (hash === 'activity' || hash === 'proofs' || hash === 'exit' || hash === 'wallet' || hash === 'send' || hash === 'receive' || hash === 'balance') {
          window.location.hash = '#/create';
        }
        setTab('wallet');
        return;
      }
      if (hash === 'activity') setTab('activity');
      else if (hash === 'proofs') setTab('proofs');
      else if (hash === 'exit') setTab('exit');
      else if (hash === 'wallet' || hash === 'create' || hash === 'recover') {
        setTab('wallet');
        if (hash === 'create' || hash === 'recover') {
          window.location.hash = '#/wallet';
        }
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [wallet.hasVault]);

  const handleTabChange = (nextTab: AppTab) => {
    if (!wallet.hasVault) {
      setTab('wallet');
      window.location.hash = '#/create';
      return;
    }
    setTab(nextTab);
    window.location.hash = `#/${nextTab}`;
  };

  const navVisible = wallet.hasVault;

  return (
    <Layout tab={tab} onTabChange={handleTabChange} navVisible={navVisible}>
      {navVisible && <SearchDrawer />}
      {navVisible ? (
        tab === 'activity' ? (
          <ActivityScreen />
        ) : tab === 'proofs' ? (
          <ProofsScreen />
        ) : tab === 'exit' ? (
          <ExitScreen />
        ) : (
          <WalletScreen onExit={() => handleTabChange('exit')} />
        )
      ) : (
        <SetupGate onEnterWallet={() => handleTabChange('wallet')} />
      )}
    </Layout>
  );
}
