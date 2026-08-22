import { describe, it, expect } from 'vitest';
import { deriveIdentity, makeSigner, userAddressForXOnly } from '../src/keys.js';
import { asXOnlyHex } from '../src/types.js';
import { RipcordError, RipcordCode } from '../src/errors.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ANOTHER_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('keys.ts', () => {
  describe('deriveIdentity', () => {
    it('produces correct values for the verified fixture mnemonic', () => {
      const identity = deriveIdentity(TEST_MNEMONIC, 'regtest');

      expect(identity.mnemonic).toBe(TEST_MNEMONIC);
      expect(identity.network).toBe('regtest');

      expect(identity.userKeyDescriptor.version).toBe(1);
      expect(identity.userKeyDescriptor.scheme).toBe('bip84-p2wpkh');
      expect(identity.userKeyDescriptor.purpose).toBe(84);
      expect(identity.userKeyDescriptor.coinType).toBe(1);
      expect(identity.userKeyDescriptor.network).toBe('regtest');
      expect(identity.userKeyDescriptor.account).toBe(0);
      expect(identity.userKeyDescriptor.change).toBe(false);
      expect(identity.userKeyDescriptor.index).toBe(0);
      expect(identity.userKeyDescriptor.path).toBe("m/84'/1'/0'/0/0");

      expect(identity.userKeyDescriptor.publicKey).toBe('02e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319');
      expect(identity.userKeyDescriptor.address).toBe('bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk');
      expect(identity.userKeyDescriptor.addressType).toBe('p2wpkh');

      expect(identity.xOnly).toBe('e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319');
      // userAddress is the P2TR payment address (R1); l1Address is the p2wpkh settlement address.
      expect(identity.userAddress).toBe('bcrt1pu74j2da46j0fwqcf4tsxa8jf7dkwrj07h02yaj8q68x2pd8ecvvsq4hnlg');
      expect(identity.l1Address).toBe('bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk');
    });

    it('produces different keys for different mnemonics', () => {
      const identity1 = deriveIdentity(TEST_MNEMONIC, 'regtest');
      const identity2 = deriveIdentity(ANOTHER_MNEMONIC, 'regtest');

      expect(identity1.xOnly).not.toBe(identity2.xOnly);
      expect(identity1.userAddress).not.toBe(identity2.userAddress);
      expect(identity1.userKeyDescriptor.publicKey).not.toBe(identity2.userKeyDescriptor.publicKey);
    });
  });

  /**
   * AUDIT (2026-08-23). `deriveIdentity` had no `index` parameter, so only
   * `m/84'/1'/0'/0/0` was reachable. That contradicts the rest of the system:
   * `VaultRecord.userKeyIndex` exists, vaults are atomic (one deposit each) so a
   * fresh index is required per funded run, and `recovery.ts` already rebuilds
   * descriptors at arbitrary indices via `userKeyDescriptorFromWallet`. A vault
   * recovered at index 3 therefore had no matching identity or signer path.
   * The SDK supports it (`deriveUserKey(mnemonic, network, { index })`); only the
   * wrapper did not.
   */
  describe('deriveIdentity index support (audit 2026-08-23)', () => {
    // Live-verified against the SDK for the BIP-39 vector-1 mnemonic.
    const INDEX_0_PUBKEY = '02e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';

    it('defaults to index 0, unchanged from before the fix', () => {
      const identity = deriveIdentity(TEST_MNEMONIC, 'regtest');
      expect(identity.userKeyDescriptor.index).toBe(0);
      expect(identity.userKeyDescriptor.path).toBe("m/84'/1'/0'/0/0");
      expect(identity.userKeyDescriptor.publicKey).toBe(INDEX_0_PUBKEY);
      expect(identity.xOnly).toBe('e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319');
      expect(identity.userAddress).toBe('bcrt1pu74j2da46j0fwqcf4tsxa8jf7dkwrj07h02yaj8q68x2pd8ecvvsq4hnlg');
    });

    it('derives a distinct identity at each index, with the right BIP-84 path', () => {
      const seen = new Set<string>();
      for (const index of [0, 1, 2, 7]) {
        const identity = deriveIdentity(TEST_MNEMONIC, 'regtest', index);
        expect(identity.userKeyDescriptor.index).toBe(index);
        expect(identity.userKeyDescriptor.path).toBe(`m/84'/1'/0'/0/${index}`);
        expect(identity.xOnly).toHaveLength(64);
        expect(seen.has(identity.userKeyDescriptor.publicKey)).toBe(false);
        seen.add(identity.userKeyDescriptor.publicKey);
      }
      expect(seen.size).toBe(4);
    });

    it('makeSigner(index) signs for the SAME key deriveIdentity(index) reports', () => {
      // This is the invariant that matters: a vault built from the descriptor at
      // index N must be spendable by the signer at index N.
      for (const index of [0, 1, 2, 7]) {
        const identity = deriveIdentity(TEST_MNEMONIC, 'regtest', index);
        const signer = makeSigner(TEST_MNEMONIC, 'regtest', index);
        expect(Buffer.from(signer.publicKey).toString('hex')).toBe(identity.userKeyDescriptor.publicKey);
        expect(Buffer.from(signer.publicKey).toString('hex').slice(2)).toBe(identity.xOnly);
      }
    });

    it('rejects a non-integer or negative index', () => {
      for (const bad of [-1, 1.5, Number.NaN]) {
        expect(() => deriveIdentity(TEST_MNEMONIC, 'regtest', bad)).toThrowError(
          expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
        );
        expect(() => makeSigner(TEST_MNEMONIC, 'regtest', bad)).toThrowError(
          expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
        );
      }
    });
  });

  /**
   * AUDIT (2026-08-23). The SDK throws its own `InvalidMnemonicError` for bad
   * input (live-verified for empty, non-BIP39, and bad-checksum phrases). That is
   * not a `RipcordError`, so a caller branching on `err.code` per the documented
   * error model got `undefined` from a foreign error class.
   */
  describe('mnemonic validation surfaces RipcordError (audit 2026-08-23)', () => {
    const BAD_MNEMONICS: [string, string][] = [
      ['empty', ''],
      ['not bip39 words', 'hello world this is not a mnemonic at all friend'],
      ['bad checksum', Array(12).fill('abandon').join(' ')],
    ];

    it.each(BAD_MNEMONICS)('deriveIdentity rejects %s as a RipcordError', (_label, mnemonic) => {
      expect(() => deriveIdentity(mnemonic, 'regtest')).toThrow(RipcordError);
      expect(() => deriveIdentity(mnemonic, 'regtest')).toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });

    it.each(BAD_MNEMONICS)('makeSigner rejects %s as a RipcordError', (_label, mnemonic) => {
      expect(() => makeSigner(mnemonic, 'regtest', 0)).toThrow(RipcordError);
    });

    it('preserves the original SDK error as the cause', () => {
      try {
        deriveIdentity('', 'regtest');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RipcordError);
        expect((err as RipcordError).cause).toBeDefined();
      }
    });
  });

  describe('makeSigner', () => {
    it('produces a signer that can create valid Schnorr signatures', () => {
      const signer = makeSigner(TEST_MNEMONIC, 'regtest', 0);

      expect(signer).toBeDefined();
      expect(signer.publicKey).toBeInstanceOf(Buffer);
      expect(typeof signer.sign).toBe('function');
      expect(typeof signer.signSchnorr).toBe('function');

      const testHash = Buffer.from('00'.repeat(32), 'hex');
      const schnorrSig = signer.signSchnorr(testHash);

      expect(schnorrSig).toBeInstanceOf(Buffer);
      expect(schnorrSig.length).toBe(64);

      const sigHex = schnorrSig.toString('hex');
      expect(sigHex).toMatch(/^[0-9a-f]{128}$/i);
    });

    it('produces different signers for different indices', () => {
      const signer0 = makeSigner(TEST_MNEMONIC, 'regtest', 0);
      const signer1 = makeSigner(TEST_MNEMONIC, 'regtest', 1);

      expect(signer0.publicKey).not.toEqual(signer1.publicKey);

      const testHash = Buffer.from('00'.repeat(32), 'hex');
      const sig0 = signer0.signSchnorr(testHash);
      const sig1 = signer1.signSchnorr(testHash);

      expect(sig0).not.toEqual(sig1);
    });
  });

  describe('userAddressForXOnly', () => {
    it('returns correct bech32m P2TR address for the fixture xOnly', () => {
      const xOnly = asXOnlyHex('e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319');
      const address = userAddressForXOnly(xOnly, 'regtest');

      // P2TR (0x51 0x20 <xOnly>) yields a bech32m bcrt1p... address, NOT the
      // p2wpkh bcrt1q... address from the descriptor. Verified live on this run.
      expect(address).toBe('bcrt1pu74j2da46j0fwqcf4tsxa8jf7dkwrj07h02yaj8q68x2pd8ecvvsq4hnlg');
    });

    it('throws RipcordError for invalid xOnly (wrong length)', () => {
      expect(() => userAddressForXOnly('abc', 'regtest')).toThrow(RipcordError);
      expect(() => userAddressForXOnly('abc', 'regtest')).toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });

    it('throws RipcordError for invalid xOnly (non-hex)', () => {
      const invalid = 'g'.repeat(64);
      expect(() => userAddressForXOnly(invalid, 'regtest')).toThrow(RipcordError);
      expect(() => userAddressForXOnly(invalid, 'regtest')).toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });

    it('throws RipcordError for empty string', () => {
      expect(() => userAddressForXOnly('', 'regtest')).toThrow(RipcordError);
      expect(() => userAddressForXOnly('', 'regtest')).toThrowError(
        expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
      );
    });

    /**
     * AUDIT (2026-08-23). `isXOnlyHex` only checks 64 hex chars, and
     * `btc.address.fromOutputScript` throws a bare bitcoinjs `Error`
     * ("OP_1 <hex> has no matching Address") when the value is not a valid
     * secp256k1 x-coordinate. Live-verified for all-ff, all-zero, and the field
     * prime. That foreign error leaked past the RipcordError taxonomy with
     * `code === undefined`, so a caller following the documented error model had
     * nothing to branch on for an unspendable-key input.
     */
    describe('off-curve x-only keys (audit 2026-08-23)', () => {
      const OFF_CURVE: [string, string][] = [
        ['all 0xff', 'ff'.repeat(32)],
        ['all zero', '00'.repeat(32)],
        ['secp256k1 field prime', 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f'],
      ];

      it.each(OFF_CURVE)('rejects %s as a RipcordError, not a raw bitcoinjs Error', (_label, key) => {
        expect(() => userAddressForXOnly(key, 'regtest')).toThrow(RipcordError);
        expect(() => userAddressForXOnly(key, 'regtest')).toThrowError(
          expect.objectContaining({ code: RipcordCode.INVALID_FORMAT })
        );
      });

      it('preserves the underlying bitcoinjs error as the cause', () => {
        try {
          userAddressForXOnly('ff'.repeat(32), 'regtest');
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RipcordError);
          expect((err as RipcordError).cause).toBeInstanceOf(Error);
        }
      });

      it('still accepts a real derived x-only key', () => {
        const identity = deriveIdentity(TEST_MNEMONIC, 'regtest');
        expect(userAddressForXOnly(identity.xOnly, 'regtest')).toBe(identity.userAddress);
      });
    });
  });
});