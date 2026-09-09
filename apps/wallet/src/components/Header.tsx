import type { AppTab } from './TabBar';

export function Header({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  const tabs: AppTab[] = ['wallet', 'exit', 'proofs', 'activity', 'docs'];
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
    <nav className="desktop-nav" aria-label="Primary navigation">
      {tabs.map(tab => (
        <button
          key={tab}
          className={active === tab ? 'active' : ''}
          aria-current={active === tab ? 'page' : undefined}
          onClick={() => onChange(tab)}
        >
          {tab === 'wallet' ? 'Wallet' : tab === 'exit' ? 'Exit' : tab === 'proofs' ? 'Proofs' : tab === 'activity' ? 'Activity' : 'Docs'}
        </button>
      ))}
    </nav>
    <div className="topbar-actions">
      <a
        href="https://github.com/Jayanng/ripcord"
        target="_blank"
        rel="noreferrer"
        className="topbar-github-link"
        aria-label="GitHub repository"
        title="View RIPCORD on GitHub"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>
    </div>
  </header>;
}
