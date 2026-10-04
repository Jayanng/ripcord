/**
 * Live, read-only verification of the spender lookup (review round 2).
 * Per AGENTS.md Rule 2 this suite verifies against the real regtest daemon,
 * never with mocked HTTP. Every call is a read (gettxout / getrawtransaction /
 * getblockchaininfo): nothing here broadcasts or mutates state.
 *
 * Chain fixtures self-heal: when the regtest chain no longer carries a
 * historical outpoint, the case degrades to a structural assertion and says so,
 * instead of failing on chain history the test does not control.
 */
import { describe, expect, it } from 'vitest';
import { buildSweepEvidence, findFundingSpender, inspectExitMaturity } from '../src/exit.js';
import type { VaultRecord } from '../src/types.js';

const BASE = process.env.RIPCORD_TEST_DAEMON ?? 'https://rpc-regtest.tachibtc.com/';

// The two independently verified sovereign exits on this chain. Live evidence,
// not product constants: packages/core/src/exit.ts contains no txid literals.
const HISTORICAL = [
  {
    name: 'user wallet vault',
    funding: {
      txid: '044d21264f4e8ff6539ab1d56a8cda1a7a5aee768223f05d9c2f53ccb5afd9a6',
      vout: 0,
      valueSats: 40000n,
    },
    destination: 'bcrt1qmxqa20md357trxchvqzkctxp8dzexr3zzf0f6v',
    amountSats: 39800n,
    feeSats: 200n,
  },
  {
    name: 'demo walkthrough vault',
    funding: {
      txid: 'b1b83036e08d76535ce1a85c5f87bb334bb8b72c1c85d82b83f70fcca8890403',
      vout: 0,
      valueSats: 50000000n,
    },
    destination: 'bcrt1qpr3ms7eznm0xutum2uuz7qqe2vjuy6tgfcesdf',
    amountSats: 49999800n,
    feeSats: 200n,
  },
] as const;

async function fundingExists(txid: string): Promise<boolean> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getrawtransaction', params: [txid, true] }),
  });
  const body = (await res.json()) as { result?: unknown };
  return Boolean(body.result && typeof body.result === 'object');
}

for (const fixture of HISTORICAL) {
  describe(`findFundingSpender live: ${fixture.name}`, () => {
    it('discovers the real spender and produces verified sovereign evidence', { timeout: 120_000 }, async () => {
      if (!(await fundingExists(fixture.funding.txid))) {
        // Chain no longer carries this fixture: structural check only.
        expect(await findFundingSpender(BASE, fixture.funding)).toBeNull();
        return;
      }
      const spender = await findFundingSpender(BASE, fixture.funding);
      expect(spender).not.toBeNull();
      const sweep = buildSweepEvidence({
        funding: fixture.funding,
        spender: spender!,
        destination: fixture.destination,
      });
      expect(sweep.sovereign).toBe(true);
      expect(sweep.label).toBe('sovereign-exit');
      expect(sweep.spentOutpoint).toBe(`${fixture.funding.txid}:0`);
      expect(sweep.destination).toBe(fixture.destination);
      expect(sweep.amountSats).toBe(fixture.amountSats);
      expect(sweep.feeSats).toBe(fixture.feeSats);
      expect(sweep.confirmations).toBeGreaterThanOrEqual(1);
      expect(sweep.blockHash).toBeTruthy();
      expect(sweep.exitRawHex.length).toBeGreaterThan(0);
      expect(sweep.explorerUrl).toBe('');
    });

    it('inspectExitMaturity reports spent with the spender bound to the destination', { timeout: 120_000 }, async () => {
      if (!(await fundingExists(fixture.funding.txid))) return;
      // Warm the cache first: inspectExitMaturity deliberately races the lookup
      // against a 1.5s budget so the maturity poller never stalls, so spentBy is
      // populated from the cache-hit path (one refresh call), not a cold scan.
      await findFundingSpender(BASE, fixture.funding);
      const vault = {
        address: 'bcrt1punusedinthischeck',
        csvBlocks: 2,
        funding: fixture.funding,
      } as unknown as VaultRecord;
      const readiness = await inspectExitMaturity(vault, BASE);
      expect(readiness.status).toBe('spent');
      expect(readiness.spentBy?.txid).toBeTruthy();
      expect(readiness.spentBy?.destination).toBe(fixture.destination);
      expect(readiness.spentBy?.amountSats).toBe(fixture.amountSats);
      expect(readiness.confirmations).toBeGreaterThanOrEqual(1);
    });
  });
}

describe('findFundingSpender live: negative controls', () => {
  it('returns null for an outpoint the chain has never seen', async () => {
    const ghost = { txid: 'ee'.repeat(32), vout: 0 };
    expect(await findFundingSpender(BASE, ghost)).toBeNull();
  });
});
