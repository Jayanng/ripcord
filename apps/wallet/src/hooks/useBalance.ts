import { useMemo } from 'react';
import { useWallet } from '../context/WalletContext';

export function useBalance() {
  const { vaults } = useWallet();
  return useMemo(() => ({
    onChainSats: vaults.reduce((sum, vault) => sum + (vault.funding?.valueSats ?? 0n), 0n),
    offChainSats: 0n,
    vtxoCount: 0,
    pendingIncomingSats: 0n,
    source: 'public vault records' as const,
  }), [vaults]);
}
