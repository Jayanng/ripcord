import { useWallet } from '../context/WalletContext';
export function useActivity() {
  const { activity, receipts, indexerStatus, identity, activeVault, spentVtxos, vtxoSnapshotLoaded } = useWallet();
  return { activity, receipts, indexerStatus, identity, activeVault, spentVtxos, vtxoSnapshotLoaded };
}
