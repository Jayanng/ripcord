import { describe, it, expect, beforeAll } from 'vitest';
import { createVault, describeTapscript, deriveIdentity, getQuorum } from '../src/index.js';
import { computeFingerprint } from '../src/quorum.js';
import { RipcordError, RipcordCode } from '../src/errors.js';

const ALICE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DAEMON_URL = 'https://rpc-regtest.tachibtc.com';

describe('vault.ts', () => {
  let aliceIdentity: Awaited<ReturnType<typeof deriveIdentity>>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    quorum = await getQuorum(DAEMON_URL);
  });

  describe('createVault with csvBlocks=2', () => {
    let vault: Awaited<ReturnType<typeof createVault>>;

    beforeAll(async () => {
      vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
    });

    it('returns vault with correct address matching verified fixture', () => {
      expect(vault.address).toBe('bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg');
    });

    it('exit leaf tapscript includes OP_2, OP_NOP3, and ends with OP_CHECKSIG', () => {
      const opcodes = describeTapscript(vault.exitLeaf!);
      expect(opcodes).toContain('OP_2');
      expect(opcodes).toContain('OP_NOP3');
      expect(opcodes[opcodes.length - 1]).toBe('OP_CHECKSIG');
    });

    it('exit control block length is 65 bytes', () => {
      const p2tr = vault.p2tr as { exitControlBlock: Uint8Array | Buffer };
      expect(p2tr.exitControlBlock.length).toBe(65);
    });
  });

  describe('createVault with csvBlocks=1008', () => {
    let vault: Awaited<ReturnType<typeof createVault>>;

    beforeAll(async () => {
      vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 1008,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
    });

    it('exit leaf starts with f003 opcode (1008 little-endian)', () => {
      const opcodes = describeTapscript(vault.exitLeaf!);
      expect(opcodes[0]).toBe('f003');
    });
  });

  describe('createVault validation', () => {
    it('throws RipcordError INVALID_FORMAT for bad nodePubkeys', async () => {
      const badPubkeys = ['04' + 'aa'.repeat(64)];
      await expect(
        createVault({
          network: 'regtest',
          nodePubkeys: badPubkeys as any,
          csvBlocks: 2,
          userKeyDescriptor: aliceIdentity.userKeyDescriptor,
        })
      ).rejects.toThrow(RipcordError);

      await expect(
        createVault({
          network: 'regtest',
          nodePubkeys: badPubkeys as any,
          csvBlocks: 2,
          userKeyDescriptor: aliceIdentity.userKeyDescriptor,
        })
      ).rejects.toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });

    it('throws RipcordError INVALID_FORMAT for wrong number of nodePubkeys', async () => {
      await expect(
        createVault({
          network: 'regtest',
          nodePubkeys: quorum.nodePubkeys.slice(0, 3) as any,
          csvBlocks: 2,
          userKeyDescriptor: aliceIdentity.userKeyDescriptor,
        })
      ).rejects.toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });
  });

  /**
   * AUDIT (2026-08-23). Three Phase 3 defects surfaced here, all live-proven:
   *
   * 1. `createVault` hand-rolled its OWN sha256 quorum fingerprint via
   *    `crypto.subtle`, a second definition that disagreed with `quorum.ts`
   *    `computeFingerprint` (which `recovery.ts` uses). The same live quorum gave
   *    ddd8831244…900e here and 5ecee6319f…008a there, so a created vault could
   *    NEVER match the quorum it was built against and the VaultRecord
   *    quorum-change check would false-alarm on every vault forever.
   * 2. Node-key uniqueness was never validated: a repeated key still has length 7
   *    and passes every format check, but one node could then satisfy two of the
   *    five cooperative signatures.
   * 3. `threshold` was not a parameter, so the SDK default was relied on
   *    implicitly while the recorded fingerprint did not cover it at all, even
   *    though the threshold changes the cooperative leaf and the vault address.
   */
  describe('quorum binding (audit 2026-08-23)', () => {
    it('records the SAME fingerprint the canonical quorum reports', async () => {
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
      // This is the whole point of storing quorumFingerprint on a VaultRecord:
      // it must be comparable against a freshly fetched quorum.
      expect(vault.quorumFingerprint).toBe(quorum.fingerprint);
      expect(vault.quorumFingerprint).toBe(
        computeFingerprint(quorum.nodePubkeys, quorum.threshold)
      );
      expect(vault.quorumThreshold).toBe(quorum.threshold);
    });

    it('rejects a keyset containing a duplicate node key', async () => {
      const dup = [quorum.nodePubkeys[0], ...quorum.nodePubkeys.slice(0, 6)];
      await expect(
        createVault({
          network: 'regtest',
          nodePubkeys: dup,
          csvBlocks: 2,
          userKeyDescriptor: aliceIdentity.userKeyDescriptor,
        })
      ).rejects.toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });

    it('rejects an invalid threshold', async () => {
      for (const threshold of [0, -1, 1.5, 8]) {
        await expect(
          createVault({
            network: 'regtest',
            nodePubkeys: quorum.nodePubkeys,
            csvBlocks: 2,
            userKeyDescriptor: aliceIdentity.userKeyDescriptor,
            threshold,
          })
        ).rejects.toThrowError(
          expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
        );
      }
    });

    it('defaults to threshold 5 and keeps the live-verified address', async () => {
      const implicit = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
      const explicit = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
        threshold: 5,
      });
      expect(implicit.address).toBe(explicit.address);
      expect(implicit.address).toBe('bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg');
      expect(implicit.quorumFingerprint).toBe(explicit.quorumFingerprint);
    });
  });

  /**
   * AUDIT (2026-08-23). `deriveIdentity` gained an `index` parameter because
   * vaults are atomic (one deposit each) and each funded run needs a fresh
   * `userKeyIndex`. Verify a vault at index > 0 actually derives differently and
   * records the index it was built from.
   */
  describe('vaults at a non-zero user key index (audit 2026-08-23)', () => {
    it('derives a different vault per user key index and records it', async () => {
      const seen = new Set<string>();
      for (const index of [0, 1, 2]) {
        const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
        const vault = await createVault({
          network: 'regtest',
          nodePubkeys: quorum.nodePubkeys,
          csvBlocks: 2,
          userKeyDescriptor: identity.userKeyDescriptor,
        });
        expect(vault.userKeyIndex).toBe(index);
        expect(vault.userKeyDescriptor.index).toBe(index);
        expect(seen.has(vault.address)).toBe(false);
        seen.add(vault.address);
      }
      expect(seen.size).toBe(3);
    });
  });
});