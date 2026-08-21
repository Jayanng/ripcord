import { describe, it, expect, beforeAll } from 'vitest';
import { createVault, describeTapscript, deriveIdentity, getQuorum } from '../src/index.js';
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
});