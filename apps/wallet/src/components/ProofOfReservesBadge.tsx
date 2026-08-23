import type { VaultRecord } from '@ripcord/core/types';
export function ProofOfReservesBadge({ vault }: { vault: VaultRecord }) { const verified = Boolean(vault.p2tr && vault.funding); return <span className={`proof-badge ${verified ? 'verified' : 'unverified'}`}><span />{verified ? 'SPK BOUND' : 'NOT FUNDED'}</span>; }
