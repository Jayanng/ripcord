import { useMemo } from 'react';
import { useWallet, vaultRecordKey } from '../context/WalletContext';

export function useBalance() {
  const { vaults, liveVtxos, pendingIncomingSats, lockedVtxos, exitReadiness, activeVault } = useWallet();
  return useMemo(() => {
    const unspent = liveVtxos.filter(vtxo => !vtxo.spent && !vtxo.locked);
    const lockedFromLive = liveVtxos.filter(vtxo => !vtxo.spent && vtxo.locked);
    const lockedFromVault = lockedVtxos ?? [];
    const lockedIds = new Set(lockedFromLive.map(v => v.id));
    const uniqueVaultLocked = lockedFromVault.filter(v => !lockedIds.has(v.id));
    const allLocked = [...lockedFromLive, ...uniqueVaultLocked];
    const lockedSats = allLocked.reduce((sum, v) => sum + v.amountSats, 0n);

    // Exited vault honesty: once the funding output is spent on L1 (the exit
    // landed), the vault holds 0 sats on-chain and its VTXOs are void: the
    // money lives at the user's L1 settlement address now. Showing the old
    // numbers here would double-count the exit proceeds.
    const exited = exitReadiness?.status === 'spent';
    const exitedKey = exited && activeVault ? vaultRecordKey(activeVault) : null;

    return {
      onChainSats: vaults.reduce(
        (sum, vault) => sum + (exitedKey && vaultRecordKey(vault) === exitedKey ? 0n : (vault.funding?.valueSats ?? 0n)),
        0n,
      ),
      offChainSats: exited ? 0n : unspent.reduce((sum, vtxo) => sum + vtxo.amountSats, 0n),
      vtxoCount: exited ? 0 : unspent.length,
      lockedSats: exited ? 0n : lockedSats,
      lockedCount: exited ? 0 : allLocked.length,
      pendingIncomingSats: exited ? 0n : (pendingIncomingSats ?? 0n),
      exited,
      source: 'public vault records' as const,
    };
  }, [liveVtxos, vaults, pendingIncomingSats, lockedVtxos, exitReadiness, activeVault]);
}
