import { useMemo } from 'react';
import { useWallet } from '../context/WalletContext';

export function useBalance() {
  const { vaults, liveVtxos } = useWallet();
  return useMemo(() => ({
    onChainSats: vaults.reduce((sum, vault) => sum + (vault.funding?.valueSats ?? 0n), 0n),
    offChainSats: liveVtxos.filter(vtxo => !vtxo.spent && !vtxo.locked).reduce((sum, vtxo) => sum + vtxo.amountSats, 0n),
    vtxoCount: liveVtxos.filter(vtxo => !vtxo.spent && !vtxo.locked).length,
    pendingIncomingSats: 0n,
    source: 'public vault records' as const,
  }), [liveVtxos, vaults]);
}
