import { describe, it, expect } from 'vitest';
import { deriveIdentity, makeSigner, userAddressForXOnly } from '../src/keys.js';
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
      expect(identity.userAddress).toBe('bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk');
    });

    it('produces different keys for different mnemonics', () => {
      const identity1 = deriveIdentity(TEST_MNEMONIC, 'regtest');
      const identity2 = deriveIdentity(ANOTHER_MNEMONIC, 'regtest');

      expect(identity1.xOnly).not.toBe(identity2.xOnly);
      expect(identity1.userAddress).not.toBe(identity2.userAddress);
      expect(identity1.userKeyDescriptor.publicKey).not.toBe(identity2.userKeyDescriptor.publicKey);
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
      const xOnly = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
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
  });
});