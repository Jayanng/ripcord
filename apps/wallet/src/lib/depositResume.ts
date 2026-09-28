/**
 * Deposit-resume storage (audit fix). A vault address can carry MULTIPLE
 * funding records (one per deposit round), so the resume txid must be keyed
 * by the RECORD (vaultRecordKey), not the address. Keying by address leaked
 * round 1's in-flight txid into round 2 and cleanup could delete the sibling
 * round's resume state.
 */
import type { VaultRecord } from '@ripcord/core/types';
import { vaultStoreKey } from '@ripcord/core/store';

const LEGACY_PREFIX = 'ripcord:deposit:';

export function depositStorageKey(vault: VaultRecord): string {
  return `${LEGACY_PREFIX}${vaultStoreKey(vault)}`;
}

export function readSavedDepositTxid(vault: VaultRecord | null): string | null {
  if (!vault) return null;
  return localStorage.getItem(depositStorageKey(vault)) ?? localStorage.getItem(`${LEGACY_PREFIX}${vault.address}`);
}

export function writeSavedDepositTxid(vault: VaultRecord, txid: string): void {
  localStorage.setItem(depositStorageKey(vault), txid);
}

/** Clears both the record-keyed entry and the legacy address-keyed entry. */
export function clearSavedDepositTxid(vault: VaultRecord | null): void {
  if (!vault) return;
  localStorage.removeItem(depositStorageKey(vault));
  localStorage.removeItem(`${LEGACY_PREFIX}${vault.address}`);
}
