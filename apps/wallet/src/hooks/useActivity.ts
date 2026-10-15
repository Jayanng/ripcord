import { useWallet } from '../context/WalletContext';
export function useActivity() {
  const { activity, receipts, indexerStatus, identity, activeVault, liveVtxos, spentVtxos, vtxoSnapshotLoaded } = useWallet();
  return { activity, receipts, indexerStatus, identity, activeVault, liveVtxos, spentVtxos, vtxoSnapshotLoaded };
}
