import { useEffect, useState } from 'react';
import { PullToRefresh } from '../components/PullToRefresh';
import { useWallet } from '../context/WalletContext';
import { BalanceScreen } from './BalanceScreen';
import { SendScreen } from './SendScreen';
import { ReceiveScreen } from './ReceiveScreen';

export type WalletSubView = 'balance' | 'send' | 'receive';

function readSubViewFromHash(): WalletSubView {
  const hash = window.location.hash.toLowerCase().replace('#/', '').replace('#', '');
  if (hash === 'send') return 'send';
  if (hash === 'receive') return 'receive';
  return 'balance';
}

export function WalletScreen({ onExit }: { onExit?: () => void }) {
  const wallet = useWallet();
  const [subView, setSubView] = useState<WalletSubView>(() => readSubViewFromHash());

  useEffect(() => {
    const handleHash = () => {
      setSubView(readSubViewFromHash());
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigateTo = (view: WalletSubView) => {
    setSubView(view);
    window.location.hash = view === 'balance' ? '#/wallet' : `#/${view}`;
  };

  return (
    <section className="wallet-section">
      {subView === 'send' ? (
        <SendScreen onBack={() => navigateTo('balance')} />
      ) : subView === 'receive' ? (
        <ReceiveScreen onBack={() => navigateTo('balance')} />
      ) : (
        <PullToRefresh onRefresh={() => wallet.refresh()}>
          <BalanceScreen
            onSend={() => navigateTo('send')}
            onReceive={() => navigateTo('receive')}
            onExit={onExit}
          />
        </PullToRefresh>
      )}
    </section>
  );
}
