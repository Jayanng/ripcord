/**
 * Deterministic largest-first coin selection for VTXO transfers.
 * Selects unspent, unlocked VTXOs to cover an amount + fee.
 */

export interface SpendableVtxo {
  readonly id: string;
  readonly amountSats: bigint;
  readonly spent: boolean;
  readonly locked: boolean;
  readonly localSpentAt?: number;
}

export interface CoinSelection {
  readonly inputs: ReadonlyArray<SpendableVtxo>;
  readonly totalInputSats: bigint;
  readonly changeSats: bigint;
  readonly feeSats: bigint;
}

/**
 * Largest-first coin selection. Skips VTXOs that are spent, locked, or
 * reserved by a prior local spend (localSpentAt set). Asserts fee >= 1n.
 * Throws if insufficient funds.
 */
export function selectCoins(
  vtxos: ReadonlyArray<SpendableVtxo>,
  targetSats: bigint,
  feeSats: bigint,
): CoinSelection {
  if (feeSats < 1n) {
    throw new Error(`feeSats must be >= 1, got ${feeSats}`);
  }
  if (targetSats <= 0n) {
    throw new Error(`targetSats must be > 0, got ${targetSats}`);
  }

  const eligible = vtxos
    .filter(v => !v.spent && !v.locked && v.localSpentAt === undefined)
    .slice()
    .sort((a, b) => {
      if (b.amountSats > a.amountSats) return 1;
      if (b.amountSats < a.amountSats) return -1;
      return a.id.localeCompare(b.id);
    });

  const selected: SpendableVtxo[] = [];
  let total = 0n;
  const needed = targetSats + feeSats;

  for (const v of eligible) {
    selected.push(v);
    total += v.amountSats;
    if (total >= needed) break;
  }

  if (total < needed) {
    throw new Error(
      `Insufficient funds: have ${total} sats, need ${needed} (${targetSats} + ${feeSats} fee)`,
    );
  }

  return {
    inputs: selected,
    totalInputSats: total,
    changeSats: total - targetSats - feeSats,
    feeSats,
  };
}

