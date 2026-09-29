import { useRef } from 'react';
import type { ExitReadiness, VaultRecord } from '@ripcord/core/types';
import type { ExecuteExitParams } from '@ripcord/core/exit';
import { useWallet, identityForVault, vaultRecordKey } from '../context/WalletContext';

export function useRipcord() {
  const wallet = useWallet();
  // AUDIT FIX (2026-09-29): the Exit screen's 15s maturity poll closes over a
  // stale `refreshMaturity` (its effect deps cover the vault, not the hook
  // function). The old code read `wallet.exitReadiness` from that stale render,
  // saw `null` from before the user's dry run, and overwrote the assessed
  // readiness (with its dryRun report) on the next tick - the report vanished
  // ~10-15s after every dry run. The ref always holds the latest readiness, so
  // the merge below can never read stale state.
  const readinessRef = useRef<ExitReadiness | null>(wallet.exitReadiness);
  readinessRef.current = wallet.exitReadiness;
  const refreshMaturity = async (vault: VaultRecord): Promise<ExitReadiness> => {
    const { inspectExitMaturity } = await import('@ripcord/core/exit');
    const liveResult = await inspectExitMaturity(vault, wallet.baseUrl);
    const previous = readinessRef.current;
    const result = previous?.dryRun && (liveResult.status === 'live' || liveResult.status === 'maturing')
      ? { ...liveResult, dryRun: previous.dryRun }
      : liveResult;
    wallet.setExitReadiness(vaultRecordKey(vault), result);
    return result;
  };
  const assess = async (vault: VaultRecord): Promise<ExitReadiness> => {
    const identity = identityForVault(wallet.identity, vault);
    if (!identity) throw new Error('Load an identity before testing the ripcord');
    const { assessExit } = await import('@ripcord/core/exit');
    const result = await assessExit({ vault, identity, baseUrl: wallet.baseUrl });
    wallet.setExitReadiness(vaultRecordKey(vault), result);
    return result;
  };
  const execute = async (vault: VaultRecord, signer: ExecuteExitParams['signer']) => {
    const identity = identityForVault(wallet.identity, vault);
    if (!identity) throw new Error('Load an identity before pulling the ripcord');
    const { executeExit } = await import('@ripcord/core/exit');
    return executeExit({ vault, identity, signer, destAddress: identity.l1Address, baseUrl: wallet.baseUrl });
  };
  return { readiness: wallet.exitReadiness, refreshMaturity, assess, execute };
}
