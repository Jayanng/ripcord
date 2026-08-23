import { Icon } from './ui';
export type AppTab = 'balance' | 'send' | 'activity' | 'ripcord';
export function TabBar({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  const tabs: AppTab[] = ['balance', 'send', 'activity', 'ripcord'];
  return <nav className="tabbar" aria-label="Primary navigation">{tabs.map(tab => <button key={tab} className={active === tab ? 'active' : ''} aria-current={active === tab ? 'page' : undefined} onClick={() => onChange(tab)}><Icon name={tab} />{tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav>;
}
