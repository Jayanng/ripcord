import { describe, it, expect, beforeAll } from 'vitest';
import {
  deriveIdentity,
  getQuorum,
  recoverVaults,
  describeTapscript,
} from '../src/index.js';

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const VIRGIN_MNEMONIC =
  'endless kite describe situate merit tip wing bridge boss hybrid chalk blue';
const DAEMON_URL = 'https://rpc-regtest.tachibtc.com';

describe('recovery.ts', { timeout: 300000 }, () => {
  let aliceIdentity: Awaited<ReturnType<typeof deriveIdentity>>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    quorum = await getQuorum(DAEMON_URL);
  });

  describe('recoverVaults, cold-start from mnemonic alone', () => {
    it('discovers all registered vaults for Alice (csv=2 fixture vaults), binds funding to the chain', async () => {
      // No mocks: this exercises the real discoverVaults gap-scan against the
      // live daemon, real CSV resolution (daemon redacts csv_delay without an
      // API key), and the real on-chain funding binding via getrawtransaction.
      const vaults = await recoverVaults({
        identity: aliceIdentity,
        quorum,
        baseUrl: DAEMON_URL,
      });

      expect(Array.isArray(vaults)).toBe(true);
      expect(vaults.length).toBeGreaterThanOrEqual(3);

      // Every record must be a fully reconstituted VaultRecord bound to money.
      for (const v of vaults) {
        expect(v.registered).toBe(true);
        expect(v.csvBlocks).toBe(2); // csv resolved by address agreement, not assumed
        expect(v.address).toBe(
          'bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg'
        );
        expect(v.funding).toBeDefined();
        expect(v.funding!.valueSats).toBeGreaterThanOrEqual(30000n);
        expect(v.funding!.txid).toMatch(/^[0-9a-f]{64}$/);
        expect(v.funding!.vout).toBe(0);
        expect(v.exitLeaf).toMatch(/^[0-9a-f]+$/);
        expect(v.cooperativeLeaf).toMatch(/^[0-9a-f]+$/);
        // Exit leaf decodes to the verified CSV tapscript semantics:
        // OP_2 OP_NOP3 OP_DROP <userXOnly> OP_CHECKSIG (csv=2 fixture).
        // Use our own describeTapscript (SDK-backed) to decode it.
        const asm = describeTapscript(v.exitLeaf!);
        expect(asm.slice(0, 3)).toEqual(['OP_2', 'OP_NOP3', 'OP_DROP']);
        expect(v.quorumFingerprint).toBe(quorum.fingerprint);
        expect(v.nodePubkeys).toEqual(quorum.nodePubkeys);
        expect(v.userKeyIndex).toBe(0);
        expect(v.userKeyDescriptor.index).toBe(0);
        expect(v.userKeyDescriptor.publicKey).toBe(
          '02e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319'
        );
        // funding.txid is display-order (reversed from the daemon's internal order)
        expect(v.funding!.txid).not.toBe('8326c9aef63b07555de77812d886ff3ed8886be375435bfa1f63ca9fb5c1225a');
      }

      // The 3 daemon-registered vaults must all be recovered by vaultId.
      const ids = new Set(vaults.map((v) => v.vaultIdHex));
      for (const expected of [
        '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722',
        '7aaf06dcc44ce4829859d65d8613f9f94e141e682a58ddb3b5b726e91c30af8a',
        'bdafe738e306f36ad09a963ee5434d6f1359ff1e94bd816ea9542f5dbaa5fc9a',
      ]) {
        expect(ids.has(expected)).toBe(true);
      }

      // Funding amounts are live ground truth (probed 2026-08-22): 40k/50k/40k sats.
      const amounts = new Set(vaults.map((v) => v.funding!.valueSats.toString()));
      expect(amounts.has('40000')).toBe(true);
      expect(amounts.has('50000')).toBe(true);
    });

    it('returns an empty array for a virgin mnemonic with nothing registered', async () => {
      const virgin = deriveIdentity(VIRGIN_MNEMONIC, 'regtest');
      const vaults = await recoverVaults({
        identity: virgin,
        quorum,
        baseUrl: DAEMON_URL,
      });
      expect(vaults).toEqual([]);
    });

    /**
     * AUDIT (2026-08-23). `recoverVaults` validated CSV candidates but passed
     * `startIndex`, `gapLimit`, and `maxIndex` directly into the SDK. Invalid
     * values therefore leaked the SDK's foreign InvalidVaultArgsError instead of
     * the core error taxonomy. Validate before creating the wallet or issuing
     * discovery requests.
     */
    it('rejects invalid scan bounds as RipcordError before discovery', async () => {
      for (const [label, options] of [
        ['negative start', { startIndex: -1 }],
        ['fraction start', { startIndex: 1.5 }],
        ['zero gap', { gapLimit: 0 }],
        ['negative gap', { gapLimit: -1 }],
        ['negative max', { maxIndex: -1 }],
        ['fraction max', { maxIndex: 1.5 }],
      ] as const) {
        await expect(recoverVaults({ identity: aliceIdentity, quorum, baseUrl: DAEMON_URL, ...options }))
          .rejects.toThrowError(expect.objectContaining({ code: 'INVALID_FORMAT' }));
        expect(label).toBeTypeOf('string');
      }
    });

    it('preserves recovered quorum threshold and fingerprint', async () => {
      const vaults = await recoverVaults({ identity: aliceIdentity, quorum, baseUrl: DAEMON_URL });
      for (const vault of vaults) {
        expect(vault.quorumThreshold).toBe(quorum.threshold);
        expect(vault.quorumFingerprint).toBe(quorum.fingerprint);
      }
    });

    it('rejects unsupported CSV candidates before network discovery', async () => {
      for (const knownCsvBlocks of [[], [0], [-1], [1.5], [NaN], [Infinity]]) {
        await expect(recoverVaults({ identity: aliceIdentity, quorum, baseUrl: DAEMON_URL, knownCsvBlocks }))
          .rejects.toThrowError(expect.objectContaining({ code: 'INVALID_FORMAT' }));
      }
    });

    it('accepts duplicate CSV candidates but returns each vault only once', async () => {
      const vaults = await recoverVaults({
        identity: aliceIdentity,
        quorum,
        baseUrl: DAEMON_URL,
        knownCsvBlocks: [2, 2, 2],
      });
      expect(new Set(vaults.map(v => v.vaultIdHex)).size).toBe(vaults.length);
    });
  });
});
