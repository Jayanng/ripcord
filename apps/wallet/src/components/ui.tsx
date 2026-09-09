import type { ReactNode } from 'react';

export const formatSats = (value: bigint) => `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')} sats`;
export const truncate = (value: string, start = 8, end = 6) => value.length > start + end ? `${value.slice(0, start)}…${value.slice(-end)}` : value;
export const EXPLORER_BASE = 'https://explorer-regtest.tachibtc.com';
export const explorerTxUrl = (txid: string) => `${EXPLORER_BASE}/tx/${txid}`;
export const explorerBlockUrl = (heightOrHash: string | number) => `${EXPLORER_BASE}/block/${heightOrHash}`;

export function Icon({ name }: { name: 'balance' | 'send' | 'receive' | 'activity' | 'ripcord' | 'shield' | 'close' | 'wallet' | 'exit' | 'proofs' | 'docs' }) {
  const paths: Record<typeof name, ReactNode> = {
    wallet: <><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></>,
    balance: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M16 10h5v4h-5a2 2 0 0 1 0-4Z"/></>,
    send: <><path d="m5 19 14-14M8 5h11v11"/></>,
    receive: <><path d="M19 5 5 19M8 19H5v-3M16 5h3v3"/></>,
    exit: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    proofs: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
    activity: <><path d="M4 17h16M4 12h10M4 7h16"/></>,
    docs: <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10M6 14h6"/></>,
    ripcord: <><path d="M12 3v8M8 7l4 4 4-4"/><path d="M5 14h14v6H5z"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
