import { useWallet } from '../context/WalletContext';
export function useActivity() { const { activity, receipts, indexerStatus } = useWallet(); return { activity, receipts, indexerStatus }; }
