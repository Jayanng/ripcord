/**
 * L1 settlement address visibility (2026-10-02, user-reported gap).
 *
 * The wallet tracks the vault but never showed the user's plain Bitcoin
 * balance at their L1 settlement address, where the deposit change and the
 * exit proceeds land. This reads it from the live chain with scantxoutset
 * and, when the vault has exited, identifies the exact exit transaction
 * (the unspent whose transaction spends the vault funding outpoint: a
 * funding output can be spent only once, so this is proof, not a guess).
 */

interface RpcUnspent {
  txid: string;
  vout: number;
  amount: number;
  height?: number;
}

export interface L1Scan {
  balanceSats: bigint;
  unspents: readonly { txid: string; vout: number; amountSats: bigint; height: number }[];
  /** The transaction that spent the vault funding outpoint (the exit), if found. */
  exitTxid: string | null;
  exitSats: bigint | null;
}

async function rpc(baseUrl: string, method: string, params: unknown[]): Promise<{ result?: unknown; error?: unknown }> {
  const url = `${baseUrl.replace(/\/+$/, '')}/`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Bitcoin RPC ${method} HTTP ${response.status}`);
  return (await response.json()) as { result?: unknown; error?: unknown };
}

export async function scanL1Settlement(options: {
  address: string;
  baseUrl: string;
  /** The vault funding outpoint, used to prove which transaction is the exit. */
  funding?: { txid: string; vout: number };
}): Promise<L1Scan> {
  const scanned = await rpc(options.baseUrl, 'scantxoutset', ['start', [`addr(${options.address})`]]);
  const result = scanned.result as { success?: boolean; unspents?: RpcUnspent[] } | null;
  const unspents = (result?.unspents ?? []).map(u => ({
    txid: u.txid,
    vout: u.vout,
    amountSats: BigInt(Math.round(u.amount * 100_000_000)),
    height: u.height ?? 0,
  }));
  const balanceSats = unspents.reduce((sum, u) => sum + u.amountSats, 0n);

  let exitTxid: string | null = null;
  let exitSats: bigint | null = null;
  if (options.funding) {
    for (const u of unspents) {
      try {
        const raw = await rpc(options.baseUrl, 'getrawtransaction', [u.txid, true]);
        const tx = raw.result as { vin?: Array<{ txid?: string; vout?: number }> } | null;
        const spendsFunding = (tx?.vin ?? []).some(
          vin => vin.txid === options.funding!.txid && vin.vout === options.funding!.vout,
        );
        if (spendsFunding) {
          exitTxid = u.txid;
          exitSats = u.amountSats;
          break;
        }
      } catch {
        // A failed lookup must not lose the balance reading.
      }
    }
  }

  return { balanceSats, unspents, exitTxid, exitSats };
}
