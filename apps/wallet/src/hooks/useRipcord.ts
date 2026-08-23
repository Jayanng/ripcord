import type { ExitReadiness, VaultRecord } from '@ripcord/core/types';
import type { ExecuteExitParams } from '@ripcord/core/exit';
import { useWallet } from '../context/WalletContext';

export function useRipcord() {
  const wallet = useWallet();
  const refreshMaturity = async (vault: VaultRecord): Promise<ExitReadiness> => {
    const { inspectExitMaturity } = await import('@ripcord/core/exit');
    const liveResult = await inspectExitMaturity(vault, wallet.baseUrl);
    const result = wallet.exitReadiness?.dryRun && (liveResult.status === 'live' || liveResult.status === 'maturing')
      ? { ...liveResult, dryRun: wallet.exitReadiness.dryRun }
      : liveResult;
    wallet.setExitReadiness(vault.address, result);
    return result;
  };
  const assess = async (vault: VaultRecord): Promise<ExitReadiness> => {
    if (!wallet.identity) throw new Error('Load an identity before testing the ripcord');
    const { assessExit } = await import('@ripcord/core/exit');
    const result = await assessExit({ vault, identity: wallet.identity, baseUrl: wallet.baseUrl });
    wallet.setExitReadiness(vault.address, result);
    return result;
  };
  const execute = async (vault: VaultRecord, signer: ExecuteExitParams['signer']) => {
    if (!wallet.identity) throw new Error('Load an identity before pulling the ripcord');
    const { executeExit } = await import('@ripcord/core/exit');
    return executeExit({ vault, identity: wallet.identity, signer, destAddress: wallet.identity.l1Address, baseUrl: wallet.baseUrl });
  };
  return { readiness: wallet.exitReadiness, refreshMaturity, assess, execute };
}
