import { useEffect, useState } from 'react';
import { useWallet } from './context/WalletContext';
import { Layout } from './components/Layout';
import type { AppTab } from './components/TabBar';
import { SetupGate } from './screens/SetupGate';
import { WalletScreen } from './screens/WalletScreen';
import { ExitScreen } from './screens/ExitScreen';
import { ProofsScreen } from './screens/ProofsScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { Skeleton } from './components/Skeleton';

export function App() {
  const wallet = useWallet();
  const [tab, setTab] = useState<AppTab>('wallet');
  const isBooting = wallet.bootState === 'checking';

  useEffect(() => {
    // 1. While the wallet state is booting, do not normalize routes or rewrite hash
    if (wallet.bootState === 'checking') {
      return;
    }

    const handleHash = () => {
      if (wallet.bootState === 'checking') return;

      const hash = window.location.hash.toLowerCase().replace('#/', '').replace('#', '');
      if (hash === 'docs' || hash.startsWith('docs')) {
        window.location.href = '/docs';
        return;
      }

      // 2. Only AFTER boot completes: if zero vaults -> gate (preserve #/recover in recovery flow)
      if (!wallet.hasVault) {
        if (hash === 'recover' || hash.startsWith('recover')) {
          setTab('wallet');
          return;
        }
        if (
          hash === 'activity' ||
          hash === 'proofs' ||
          hash === 'exit' ||
          hash === 'wallet' ||
          hash === 'send' ||
          hash === 'receive' ||
          hash === 'balance' ||
          hash === ''
        ) {
          window.location.hash = '#/create';
        }
        setTab('wallet');
        return;
      }

      // 3. Vault exists -> restore intended route or wallet default
      if (hash === 'activity') {
        setTab('activity');
      } else if (hash === 'proofs') {
        setTab('proofs');
      } else if (hash === 'exit') {
        setTab('exit');
      } else if (
        hash === 'wallet' ||
        hash === 'send' ||
        hash === 'receive' ||
        hash === 'balance'
      ) {
        setTab('wallet');
      } else if (hash === 'create' || hash === 'recover' || hash === '') {
        setTab('wallet');
        window.location.hash = '#/wallet';
      } else {
        setTab('wallet');
        window.location.hash = '#/wallet';
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [wallet.bootState, wallet.hasVault]);

  const handleTabChange = (nextTab: AppTab) => {
    if (!wallet.hasVault) {
      setTab('wallet');
      window.location.hash = '#/create';
      return;
    }
    setTab(nextTab);
    window.location.hash = `#/${nextTab}`;
  };

  const navVisible = !isBooting && wallet.hasVault;

  return (
    <Layout tab={tab} onTabChange={handleTabChange} navVisible={navVisible}>
      {isBooting ? (
        <section className="flow-screen" aria-busy="true" aria-label="Loading wallet">
          <div style={{ display: 'grid', gap: '20px', padding: '24px 0' }}>
            <Skeleton width="35%" height={32} radius={8} />
            <Skeleton width="100%" height={120} radius={12} />
            <Skeleton width="100%" height={80} radius={12} />
          </div>
        </section>
      ) : navVisible ? (
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
