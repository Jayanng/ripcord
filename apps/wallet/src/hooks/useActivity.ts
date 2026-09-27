import { useWallet } from '../context/WalletContext';
export function useActivity() {
  const { activity, receipts, indexerStatus, identity, activeVault, spentVtxos } = useWallet();
  return { activity, receipts, indexerStatus, identity, activeVault, spentVtxos };
}
