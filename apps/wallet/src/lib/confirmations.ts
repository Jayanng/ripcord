/**
 * L1 confirmation polling (Bounty #1, Phase 4): bounded, read-only.
 * gettxout returns the live confirmation count for an unspent output;
 * null means the output is spent or unknown (shown as "final").
 */

interface RpcResponse {
  result?: { confirmations?: number } | null;
  error?: unknown;
}

export async function fetchConfirmations(
  baseUrl: string,
  txid: string,
  vout: number,
): Promise<number | null> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gettxout', params: [txid, vout, true] }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as RpcResponse;
    const confirmations = data.result?.confirmations;
    return typeof confirmations === 'number' && confirmations >= 0 ? confirmations : null;
  } catch {
    return null;
  }
}
