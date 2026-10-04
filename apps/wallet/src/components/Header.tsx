import type { AppTab } from './TabBar';
import { useWallet } from '../context/WalletContext';

export function Header({
  active,
  onChange,
  navVisible = true,
}: {
  active: AppTab;
  onChange: (tab: AppTab) => void;
  navVisible?: boolean;
}) {
  const tabs: AppTab[] = ['wallet', 'exit', 'proofs', 'activity'];
  const wallet = useWallet();

  return <header className="topbar">
    <button className="brand brand-button" aria-label="Ripcord home" onClick={() => onChange('wallet')}>
      <span className="brand-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ripcord-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FB923C"/>
              <stop offset="100%" stopColor="#EA580C"/>
            </linearGradient>
          </defs>
          <path d="M26 6C26 9.5 23 11 18 11.5" stroke="#EA580C" strokeWidth="2.75" strokeLinecap="round"/>
          <rect x="15" y="10" width="6" height="3" rx="1.5" fill="#0F172A"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M11 15C8.5 15 6 18 6.5 24C7 29.5 12 32 18 32C24 32 29 29.5 29.5 24C30 18 27.5 15 25 15C22 15 21 16.5 18 16.5C15 16.5 14 15 11 15ZM12.5 19.5C14.5 19.5 15.5 21 18 21C20.5 21 21.5 19.5 23.5 19.5C24.5 19.5 25.5 21 25 24C24.5 26.5 21.5 27.5 18 27.5C14.5 27.5 11.5 26.5 11 24C10.5 21 11.5 19.5 12.5 19.5Z" fill="url(#ripcord-logo-grad)"/>
        </svg>
      </span>
      <span>RIPCORD</span>
    </button>
    {navVisible && (
      <nav className="desktop-nav" aria-label="Primary navigation">
        {tabs.map(tab => (
          <button
            key={tab}
            className={active === tab ? 'active' : ''}
            aria-current={active === tab ? 'page' : undefined}
            onClick={() => onChange(tab)}
          >
            {tab === 'wallet' ? 'Wallet' : tab === 'exit' ? 'Exit' : tab === 'proofs' ? 'Proofs' : 'Activity'}
          </button>
        ))}
      </nav>
    )}
    <div className="topbar-actions">
      {/* Phase 4: display unit toggle */}
      <button
        type="button"
        className="theme-toggle"
        aria-label={`Show amounts in ${wallet.displayUnit === 'sats' ? 'BTC' : 'sats'}`}
        title="Display unit only. Data and sends stay in sats."
        onClick={() => wallet.setDisplayUnit(wallet.displayUnit === 'sats' ? 'btc' : 'sats')}
      >
        {wallet.displayUnit === 'sats' ? 'sats' : 'BTC'}
      </button>
    </div>
  </header>;
}
