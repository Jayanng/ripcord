import { assessExit, executeExit, type ExitReadiness, type VaultRecord } from '@ripcord/core';
import { useWallet } from '../context/WalletContext';

export function useRipcord() {
  const wallet = useWallet();
  const assess = async (vault: VaultRecord): Promise<ExitReadiness> => {
    if (!wallet.identity) throw new Error('Load an identity before testing the ripcord');
    const result = await assessExit({ vault, identity: wallet.identity, baseUrl: wallet.baseUrl });
    wallet.setExitReadiness(result);
    return result;
  };
  const execute = async (vault: VaultRecord, signer: Parameters<typeof executeExit>[0]['signer']) => {
    if (!wallet.identity) throw new Error('Load an identity before pulling the ripcord');
    return executeExit({ vault, identity: wallet.identity, signer, destAddress: wallet.identity.l1Address, baseUrl: wallet.baseUrl });
  };
  return { readiness: wallet.exitReadiness, assess, execute };
}
