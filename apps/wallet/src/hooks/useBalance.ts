import { useEffect, useMemo, useState } from 'react';
import { useWallet, vaultRecordKey } from '../context/WalletContext';
import { reconcileSpendableSats } from '@ripcord/core/lifecycle';
import { deriveVtxoProvenance } from '../lib/provenance';

/**
 * L1 backing probe (audit fix 2026-10-02).
 *
 * A vault's funding outpoint backs its off-chain notes. Once that outpoint is
 * spent on L1 (the exit landed), the coins live at the user's settlement
 * address and every note it backed is void. The daemon does not know or care:
 * it happily keeps crediting notes, so the UI must reconcile against the chain
 * and never show unbacked credit as spendable. Spent is terminal and cached
 * forever; unspent is re-checked on each poll.
 */
const spentCache = new Map<string, boolean>();
const inFlight = new Map<string, Promise<boolean>>();

function fundingIsSpent(funding: { txid: string; vout: number }, key: string): Promise<boolean> {
  const cached = spentCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = inFlight.get(key);
  if (running) return running;
  const run = (async () => {
    try {
      const response = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gettxout', params: [funding.txid, funding.vout, true] }),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      // A transport failure or RPC error is UNKNOWN, never proof of spent:
      // caching it would zero the user's backing forever (review fix).
      if (body.error !== undefined && body.error !== null) return false;
      // gettxout returns null for a spent outpoint (and for one that never
      // existed): neither backs anything. Only null is terminal.
      const spent = body.result === null;
      if (spent) spentCache.set(key, true);
      return spent;
    } catch {
      // Unknown is NOT proof of spent: keep counting the backing and retry.
      return false;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}

export function useBalance() {
  const { vaults, liveVtxos, pendingIncomingSats, lockedVtxos, exitReadiness, activeVault, receipts, identity } = useWallet();
  const [spentKeys, setSpentKeys] = useState<ReadonlySet<string>>(
    () => new Set(Array.from(spentCache.entries()).filter(([, s]) => s).map(([k]) => k)),
  );

  const funded = useMemo(
    () =>
      vaults
        .filter(v => v.funding)
        .map(v => ({ key: vaultRecordKey(v), funding: v.funding! })),
    [vaults],
  );

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const results = await Promise.all(
        funded.map(async f => ({ key: f.key, spent: await fundingIsSpent(f.funding, f.key) })),
      );
      if (cancelled) return;
      setSpentKeys(prev => {
        const next = new Set(prev);
        for (const r of results) if (r.spent) next.add(r.key);
        return next.size === prev.size ? prev : next;
      });
    };
    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [funded]);

  return useMemo(() => {
    const unspent = liveVtxos.filter(vtxo => !vtxo.spent && !vtxo.locked);
    const lockedFromLive = liveVtxos.filter(vtxo => !vtxo.spent && vtxo.locked);
    const lockedFromVault = lockedVtxos ?? [];
    const lockedIds = new Set(lockedFromLive.map(v => v.id));
    const uniqueVaultLocked = lockedFromVault.filter(v => !lockedIds.has(v.id));
    const allLocked = [...lockedFromLive, ...uniqueVaultLocked];
    const lockedSats = allLocked.reduce((sum, v) => sum + v.amountSats, 0n);

    // Exited vault honesty: once the funding output is spent on L1 (the exit
    // landed), the vault holds 0 sats on-chain and its VTXOs are void: the
    // money lives at the user's L1 settlement address now. Showing the old
    // numbers here would double-count the exit proceeds.
    const exited = exitReadiness?.status === 'spent';
    const exitedKey = exited && activeVault ? vaultRecordKey(activeVault) : null;

    // L1 backing (audit fix 2026-10-02): only vaults whose funding outpoint is
    // STILL UNSPENT back anything. A spent or unfunded vault backs 0. This is
    // cross-vault, so switching to an unfunded round can never show another
    // round's void notes as spendable.
    const backingSats = funded.reduce(
      (sum, f) => (spentKeys.has(f.key) ? sum : sum + f.funding.valueSats),
      0n,
    );
    const notesSats = unspent.reduce((sum, vtxo) => sum + vtxo.amountSats, 0n);
    // Received notes are backed by the SENDER's vault, not ours (review fix):
    // only the deposit-minted share is capped by OUR L1 backing, so honest
    // money from a peer is never under-reported or blocked.
    const receivedSats = unspent.reduce((sum, vtxo) => {
      const provenance = deriveVtxoProvenance(vtxo, {
        vaults,
        receipts,
        allVtxos: liveVtxos,
        userXOnly: identity?.xOnly,
      });
      return provenance.type === 'received' ? sum + vtxo.amountSats : sum;
    }, 0n);
    const depositSats = notesSats - receivedSats;
    const reconciled = reconcileSpendableSats(depositSats, backingSats);

    return {
      onChainSats: vaults.reduce(
        (sum, vault) => sum + (exitedKey && vaultRecordKey(vault) === exitedKey ? 0n : (spentKeys.has(vaultRecordKey(vault)) ? 0n : (vault.funding?.valueSats ?? 0n))),
        0n,
      ),
      offChainSats: exited ? 0n : receivedSats + reconciled.spendableSats,
      unbackedSats: exited ? 0n : reconciled.unbackedSats,
      backingSats,
      vtxoCount: exited ? 0 : unspent.length,
      lockedSats: exited ? 0n : lockedSats,
      lockedCount: exited ? 0 : allLocked.length,
      pendingIncomingSats: exited ? 0n : (pendingIncomingSats ?? 0n),
      exited,
      source: 'public vault records' as const,
    };
  }, [liveVtxos, vaults, pendingIncomingSats, lockedVtxos, exitReadiness, activeVault, funded, spentKeys]);
}
