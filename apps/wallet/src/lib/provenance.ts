import type { VaultRecord, PaymentReceipt } from '@ripcord/core/types';
import { formatAmount } from './format';

export interface VtxoRecordItem {
  id: string;
  amountSats: bigint;
  spent: boolean;
  locked: boolean;
  height?: number;
  owner?: string;
  script?: string;
  vaultAddress?: string;
  btcHeight?: number;
  btcTimestamp?: number;
}

export interface VtxoProvenance {
  /** Classification: 'deposit' for L1 vault funding/mint, 'received' for peer transfers */
  type: 'deposit' | 'received';
  /** 1-indexed deposit round ordinal among deposit-funded VTXOs (e.g. 1 for "Deposit #1") */
  roundOrdinal?: number;
  /** Creation height / epoch from daemon VTXO record */
  epoch: number;
  /** Short provenance label, e.g. "Deposit #1 · Epoch 415,925" or "Received · Epoch 882,369" */
  label: string;
  /** Detailed human-readable provenance description for the inspection sheet */
  detail: string;
  /** L1 anchor block height if available on regtest/mainnet */
  btcHeight: number;
  /** L1 anchor block timestamp if available on regtest/mainnet */
  btcTimestamp: number;
}

/**
 * PROVENANCE DERIVATION RULE (FIX #10):
 *
 * 1. Live Data Source:
 *    The daemon REST endpoints GET /tachi_addressVtxos?include_spent=true and GET /tachi_vtxo
 *    provide observed fields: id, owner, amount, spent, height, script, locked.
 *    (INTEGRATION.md VTXOResponse specifies BTCHeight/BTCTimestamp, which default to 0 on regtest).
 *
 * 2. Origin Classification:
 *    - Received: A VTXO is classified as "Received" if it matches an incoming payment receipt
 *      (where receipt.toXOnly === user.xOnly and receipt.fromXOnly !== user.xOnly) at the same
 *      creation epoch and amount, or if it was received as a non-deposit transfer.
 *    - Deposit: A VTXO is classified as deposit-funded if it corresponds to an L1 vault deposit
 *      (amount matches vault funding value or registration spend, or falls in the user's
 *      chronological vault funding sequence).
 *
 * 3. Deposit Round Ordinal Derivation:
 *    - Deposit-funded VTXOs are ordered by L1 anchor (btcHeight/btcTimestamp ascending when > 0),
 *      or by chronological creation order (earliest creation height/epoch ascending),
 *      and tied to the user's ordered vaults (userKeyIndex ascending).
 *    - The ordinal is 1-based: "Deposit #1", "Deposit #2", etc.
 *
 * 4. Label Formatting:
 *    - Deposit: `Deposit #${roundOrdinal} · Epoch ${height}`
 *    - Received: `Received · Epoch ${height}`
 */
export function deriveVtxoProvenance(
  vtxo: VtxoRecordItem,
  context: {
    vaults: VaultRecord[];
    receipts: PaymentReceipt[];
    allVtxos: VtxoRecordItem[];
    userXOnly?: string;
  },
): VtxoProvenance {
  const epoch = vtxo.height ?? 0;
  const btcHeight = vtxo.btcHeight ?? 0;
  const btcTimestamp = vtxo.btcTimestamp ?? 0;
  const userXOnly = (context.userXOnly ?? '').toLowerCase();

  // Check if this VTXO matches any incoming payment receipt
  const isIncomingReceipt = context.receipts.some(receipt => {
    const isToUser = !userXOnly || receipt.toXOnly.toLowerCase() === userXOnly;
    const isFromPeer = !userXOnly || receipt.fromXOnly.toLowerCase() !== userXOnly;
    const matchesEpoch = receipt.epoch === epoch && epoch > 0;
    const matchesAmount = receipt.amountSats === vtxo.amountSats;
    return isToUser && isFromPeer && (matchesEpoch || matchesAmount);
  });

  // Check user's deposit-funded vaults
  const sortedVaults = [...context.vaults].sort((a, b) => {
    return (a.userKeyIndex ?? 0) - (b.userKeyIndex ?? 0) || a.createdAt - b.createdAt;
  });

  // Collect all deposit-derived candidates among all user VTXOs
  // Deposit VTXOs typically match vault funding values or are early mints
  const depositAmounts = new Set<bigint>();
  for (const vault of sortedVaults) {
    if (vault.funding) {
      depositAmounts.add(vault.funding.valueSats);
      depositAmounts.add(vault.funding.valueSats - 1n); // minus 1 sat mint fee
      depositAmounts.add(vault.funding.valueSats - 2n); // minus registration fee
    }
  }

  // Is this VTXO directly matching a deposit amount?
  const matchesDepositAmount = depositAmounts.has(vtxo.amountSats);

  // Determine classification
  let isDeposit = false;
  if (isIncomingReceipt) {
    isDeposit = false;
  } else if (matchesDepositAmount) {
    isDeposit = true;
  } else if (btcHeight > 0) {
    // If an L1 anchor height is present, it is an on-chain deposit
    isDeposit = true;
  } else {
    // Check if the VTXO was created before any incoming receipt was ever recorded
    // or if the user has vaults but no incoming receipts
    const hasIncomingReceipts = context.receipts.some(r => r.fromXOnly.toLowerCase() !== userXOnly);
    if (!hasIncomingReceipts && sortedVaults.length > 0) {
      // With no incoming receipts in wallet history, all funds descend from vault deposits
      isDeposit = true;
    } else {
      // If amount looks like a typical peer transfer (e.g. 1000, 2000 sats), treat as received
      isDeposit = false;
    }
  }

  if (isDeposit) {
    // Determine deposit round ordinal (1-indexed)
    // Order by L1 anchor if present, otherwise by creation height ascending
    let roundOrdinal = 1;

    // Check if it directly matches a specific vault in sorted order
    const vaultIndex = sortedVaults.findIndex(v => {
      if (!v.funding) return false;
      return v.funding.valueSats === vtxo.amountSats ||
        v.funding.valueSats - 1n === vtxo.amountSats ||
        v.funding.valueSats - 2n === vtxo.amountSats;
    });

    if (vaultIndex >= 0) {
      roundOrdinal = vaultIndex + 1;
    } else {
      // Rank among all deposit-classified VTXOs by height
      const depositVtxos = context.allVtxos
        .filter(v => depositAmounts.has(v.amountSats) || (v.btcHeight && v.btcHeight > 0))
        .sort((a, b) => (a.height ?? 0) - (b.height ?? 0) || a.id.localeCompare(b.id));

      const idx = depositVtxos.findIndex(v => v.id === vtxo.id);
      roundOrdinal = idx >= 0 ? Math.min(idx + 1, Math.max(1, sortedVaults.length)) : 1;
    }

    const epochStr = epoch > 0 ? `Epoch ${formatAmount(epoch)}` : 'Mint pending';
    const label = `Deposit #${roundOrdinal} · ${epochStr}`;
    const detail = btcHeight > 0
      ? `Minted from L1 Deposit #${roundOrdinal} anchored at Bitcoin block ${btcHeight}`
      : `Minted from TAURUS Vault Deposit #${roundOrdinal} at epoch ${epoch || 'pending'}`;

    return {
      type: 'deposit',
      roundOrdinal,
      epoch,
      label,
      detail,
      btcHeight,
      btcTimestamp,
    };
  }

  // Otherwise, classify as Received
  const epochStr = epoch > 0 ? `Epoch ${formatAmount(epoch)}` : 'Height unconfirmed';
  const label = `Received · ${epochStr}`;
  const detail = `Received via off-chain VTXO transfer at epoch ${epoch || 'unconfirmed'}`;

  return {
    type: 'received',
    epoch,
    label,
    detail,
    btcHeight,
    btcTimestamp,
  };
}
