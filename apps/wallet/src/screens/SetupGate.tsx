import { useEffect, useState } from 'react';
import { OnboardingScreen } from './OnboardingScreen';
import { RecoveryScreen } from './RecoveryScreen';

export type SetupTab = 'create' | 'recover';

export function SetupGate({ initialTab, onEnterWallet }: { initialTab?: SetupTab; onEnterWallet?: () => void }) {
  const [tab, setTab] = useState<SetupTab>(() => {
    if (initialTab) return initialTab;
    if (typeof window !== 'undefined' && window.location.hash.toLowerCase().includes('recover')) {
      return 'recover';
    }
    return 'create';
  });

  useEffect(() => {
    const handleHash = () => {
      const h = window.location.hash.toLowerCase();
      if (h.includes('recover')) setTab('recover');
      else if (h.includes('create')) setTab('create');
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const selectTab = (nextTab: SetupTab) => {
    setTab(nextTab);
    window.location.hash = `#/${nextTab}`;
  };

  return <div className="setup-gate auth-container">
    <div className="auth-header">
      <p className="eyebrow">Setup Gate · Local Custody</p>
      <h2>Initialize your sovereign wallet</h2>
      <p className="auth-subtext">
        Keys remain in memory and are never persisted. Create a new sovereign vault identity or recover an existing one from a 12-word recovery phrase.
      </p>
      <div className="subnav" role="tablist" aria-label="Setup mode" style={{ marginTop: '16px' }}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'create'}
          className={`subnav-btn ${tab === 'create' ? 'active' : ''}`}
          onClick={() => selectTab('create')}
        >
          Create wallet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recover'}
          className={`subnav-btn ${tab === 'recover' ? 'active' : ''}`}
          onClick={() => selectTab('recover')}
        >
          Recover wallet
        </button>
      </div>
    </div>
    <div className="setup-pane">
      {tab === 'create' ? (
        <div className="setup-subpage">
          <OnboardingScreen onEnterWallet={onEnterWallet} />
          <div className="setup-switch-banner">
            <span>Already have an existing 12-word recovery phrase?</span>
            <button type="button" className="link-action" onClick={() => selectTab('recover')}>
              Recover wallet →
            </button>
          </div>
        </div>
      ) : (
        <div className="setup-subpage">
          <RecoveryScreen />
          <div className="setup-switch-banner">
            <span>Need to generate a fresh sovereign identity?</span>
            <button type="button" className="link-action" onClick={() => selectTab('create')}>
              ← Create new wallet
            </button>
          </div>
        </div>
      )}
    </div>
  </div>;
}
