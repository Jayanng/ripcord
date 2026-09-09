import { Icon } from './ui';

export type AppTab = 'wallet' | 'exit' | 'proofs' | 'activity' | 'docs';

export function TabBar({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  const tabs: AppTab[] = ['wallet', 'exit', 'proofs', 'activity', 'docs'];
  return <nav className="tabbar" aria-label="Primary navigation">
    {tabs.map(tab => (
      <button
        key={tab}
        className={active === tab ? 'active' : ''}
        aria-current={active === tab ? 'page' : undefined}
        onClick={() => onChange(tab)}
      >
        <Icon name={tab} />
        {tab === 'wallet' ? 'Wallet' : tab === 'exit' ? 'Exit' : tab === 'proofs' ? 'Proofs' : tab === 'activity' ? 'Activity' : 'Docs'}
      </button>
    ))}
  </nav>;
}
