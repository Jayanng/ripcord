import { useState } from 'react';
import { BalanceScreen } from './BalanceScreen';
import { SendScreen } from './SendScreen';
import { ReceiveScreen } from './ReceiveScreen';
import { Icon } from '../components/ui';

export type WalletSubTab = 'balance' | 'send' | 'receive';

export function WalletScreen({ onExit }: { onExit?: () => void }) {
  const [subTab, setSubTab] = useState<WalletSubTab>('balance');

  return <section className="wallet-section">
    <div className="subnav" role="tablist" aria-label="Wallet sections">
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'balance'}
        className={`subnav-btn ${subTab === 'balance' ? 'active' : ''}`}
        onClick={() => setSubTab('balance')}
      >
        <Icon name="balance" />
        <span>Balance</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'send'}
        className={`subnav-btn ${subTab === 'send' ? 'active' : ''}`}
        onClick={() => setSubTab('send')}
      >
        <Icon name="send" />
        <span>Send</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'receive'}
        className={`subnav-btn ${subTab === 'receive' ? 'active' : ''}`}
        onClick={() => setSubTab('receive')}
      >
        <Icon name="receive" />
        <span>Receive</span>
      </button>
    </div>

    {subTab === 'send' ? (
      <SendScreen />
    ) : subTab === 'receive' ? (
      <ReceiveScreen />
    ) : (
      <BalanceScreen
        onSend={() => setSubTab('send')}
        onReceive={() => setSubTab('receive')}
        onExit={onExit}
      />
    )}
  </section>;
}
