import { useMemo } from 'react';
import { useWallet } from '../context/WalletContext';

export function useBalance() {
  const { vaults, liveVtxos, pendingIncomingSats, lockedVtxos } = useWallet();
  return useMemo(() => {
    const unspent = liveVtxos.filter(vtxo => !vtxo.spent && !vtxo.locked);
    const lockedFromLive = liveVtxos.filter(vtxo => !vtxo.spent && vtxo.locked);
    const lockedFromVault = lockedVtxos ?? [];
    const lockedIds = new Set(lockedFromLive.map(v => v.id));
    const uniqueVaultLocked = lockedFromVault.filter(v => !lockedIds.has(v.id));
    const allLocked = [...lockedFromLive, ...uniqueVaultLocked];
    const lockedSats = allLocked.reduce((sum, v) => sum + v.amountSats, 0n);

    return {
      onChainSats: vaults.reduce((sum, vault) => sum + (vault.funding?.valueSats ?? 0n), 0n),
      offChainSats: unspent.reduce((sum, vtxo) => sum + vtxo.amountSats, 0n),
      vtxoCount: unspent.length,
      lockedSats,
      lockedCount: allLocked.length,
      pendingIncomingSats: pendingIncomingSats ?? 0n,
      source: 'public vault records' as const,
    };
  }, [liveVtxos, vaults, pendingIncomingSats, lockedVtxos]);
}
