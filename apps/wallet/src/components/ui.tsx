import type { ReactNode } from 'react';

export const formatSats = (value: bigint) => `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')} sats`;
export const truncate = (value: string, start = 8, end = 6) => value.length > start + end ? `${value.slice(0, start)}…${value.slice(-end)}` : value;

export function Icon({ name }: { name: 'balance' | 'send' | 'receive' | 'activity' | 'ripcord' | 'shield' | 'close' }) {
  const paths: Record<typeof name, ReactNode> = {
    balance: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M16 10h5v4h-5a2 2 0 0 1 0-4Z"/></>,
    send: <><path d="m5 19 14-14M8 5h11v11"/></>,
    receive: <><path d="M19 5 5 19M8 19H5v-3M16 5h3v3"/></>,
    activity: <><path d="M4 17h16M4 12h10M4 7h16"/></>,
    ripcord: <><path d="M12 3v8M8 7l4 4 4-4"/><path d="M5 14h14v6H5z"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
