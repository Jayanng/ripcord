import { useWallet } from '../context/WalletContext';
export function useVaults() { const { vaults, store, refresh } = useWallet(); return { vaults, store, refresh }; }
