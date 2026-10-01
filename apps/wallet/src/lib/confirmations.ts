/**
 * L1 confirmation polling (Bounty #1, Phase 4): bounded, read-only.
 * gettxout returns the live confirmation count for an unspent output;
 * null means the output is spent or unknown (shown as "final").
 */

interface RpcResponse {
  result?: { confirmations?: number } | null;
  error?: unknown;
}

/**
 * A confirmed count, or one of the two very different negatives:
 * 'spent' (the chain answered: this output is gone) vs 'unknown' (we could
 * not check at all: network or RPC failure). Never conflate them.
 */
export type ConfirmationsResult =
  | { state: 'confirmed'; confirmations: number }
  | { state: 'spent' }
  | { state: 'unknown' };

export async function fetchConfirmations(
  baseUrl: string,
  txid: string,
  vout: number,
): Promise<ConfirmationsResult> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gettxout', params: [txid, vout, true] }),
    });
    if (!response.ok) return { state: 'unknown' };
    const data = (await response.json()) as RpcResponse;
    const confirmations = data.result?.confirmations;
    if (typeof confirmations === 'number' && confirmations >= 0) {
      return { state: 'confirmed', confirmations };
    }
    // The RPC answered successfully with no UTXO: the output is spent.
    return { state: 'spent' };
  } catch {
    return { state: 'unknown' };
  }
}
