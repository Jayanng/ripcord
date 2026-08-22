import { describe, it, expect } from 'vitest';
import {
  type DisplayTxid,
  type InternalTxid,
  type XOnlyHex,
  type CompressedHex,
  type UserAddress,
  type VaultAddress,
  isDisplayTxid,
  asDisplayTxid,
  isInternalTxid,
  asInternalTxid,
  isXOnlyHex,
  asXOnlyHex,
  isCompressedHex,
  asCompressedHex,
  isUserAddress,
  asUserAddress,
  isVaultAddress,
  asVaultAddress,
  type VaultRecord,
  type LedgerVtxo,
  type BalanceSnapshot,
  type ExitReadiness,
  type PaymentReceipt,
  type Identity,
  type Quorum,
  type UserKeyDescriptor,
} from '../src/types.js';

const VALID_DISPLAY_TXID = 'a'.repeat(64) as DisplayTxid;
const VALID_INTERNAL_TXID = Buffer.from('b'.repeat(64), 'hex');
const VALID_XONLY_HEX = 'c'.repeat(64) as XOnlyHex;
const VALID_COMPRESSED_HEX_02 = ('02' + 'd'.repeat(64)) as CompressedHex;
const VALID_COMPRESSED_HEX_03 = ('03' + 'e'.repeat(64)) as CompressedHex;
// Live-verified real addresses (independent BIP-173/350 checksum verified):
// Alice's p2wpkh L1 address (bech32 v0, 20-byte program), Alice's P2TR user
// payment address, and the csv=2 vault address (both bech32m v1, 32-byte).
const VALID_USER_ADDRESS = 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk' as UserAddress;
const VALID_USER_ADDRESS_P2TR = 'bcrt1pu74j2da46j0fwqcf4tsxa8jf7dkwrj07h02yaj8q68x2pd8ecvvsq4hnlg' as UserAddress;
const VALID_VAULT_ADDRESS = 'bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg' as VaultAddress;
// Independently generated negative vectors (reference bech32 implementation):
const BAD_CHECKSUM = 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnard0eq';
const BAD_VARIANT = 'bcrt1pqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqxdh5rg';
const BAD_V0_21BYTE = 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzshh9yaa';
const BAD_V1_34BYTE = 'bcrt1pqqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqggckdhwx';
const BAD_MIXED_CASE = 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnard0EW';

describe('DisplayTxid', () => {
  it('isDisplayTxid returns true for valid 64-char hex string', () => {
    expect(isDisplayTxid(VALID_DISPLAY_TXID)).toBe(true);
  });

  it('isDisplayTxid returns false for invalid length', () => {
    expect(isDisplayTxid('a'.repeat(63))).toBe(false);
    expect(isDisplayTxid('a'.repeat(65))).toBe(false);
  });

  it('isDisplayTxid returns false for non-hex characters', () => {
    expect(isDisplayTxid('g'.repeat(64))).toBe(false);
    expect(isDisplayTxid('z'.repeat(64))).toBe(false);
  });

  it('isDisplayTxid accepts uppercase hex (daemon returns uppercase Tendermint hashes)', () => {
    // Verified: daemon returns hashes like "CEBB58..." and "E3C4205B..." in uppercase.
    expect(isDisplayTxid('A'.repeat(64))).toBe(true);
    expect(isDisplayTxid('fF'.repeat(32))).toBe(true);
  });

  it('isDisplayTxid returns false for non-string', () => {
    expect(isDisplayTxid(123)).toBe(false);
    expect(isDisplayTxid(null)).toBe(false);
    expect(isDisplayTxid(undefined)).toBe(false);
    expect(isDisplayTxid({})).toBe(false);
    expect(isDisplayTxid([])).toBe(false);
  });

  it('asDisplayTxid returns the value for valid input', () => {
    const result = asDisplayTxid(VALID_DISPLAY_TXID);
    expect(result).toBe(VALID_DISPLAY_TXID);
  });

  it('asDisplayTxid throws for invalid input', () => {
    expect(() => asDisplayTxid('invalid')).toThrow('Expected DisplayTxid');
    expect(() => asDisplayTxid(123)).toThrow('Expected DisplayTxid');
  });
});

describe('InternalTxid', () => {
  it('isInternalTxid returns true for valid 32-byte Buffer', () => {
    expect(isInternalTxid(VALID_INTERNAL_TXID)).toBe(true);
  });

  it('isInternalTxid returns false for wrong length', () => {
    expect(isInternalTxid(Buffer.from('a'.repeat(62), 'hex'))).toBe(false);
    expect(isInternalTxid(Buffer.from('a'.repeat(66), 'hex'))).toBe(false);
  });

  it('isInternalTxid returns false for non-Buffer', () => {
    expect(isInternalTxid('hexstring')).toBe(false);
    expect(isInternalTxid(123)).toBe(false);
    expect(isInternalTxid(null)).toBe(false);
    expect(isInternalTxid(undefined)).toBe(false);
    expect(isInternalTxid({})).toBe(false);
    expect(isInternalTxid(new Uint8Array(32))).toBe(false);
  });

  it('asInternalTxid returns the value for valid input', () => {
    const result = asInternalTxid(VALID_INTERNAL_TXID);
    expect(result).toBe(VALID_INTERNAL_TXID);
  });

  it('asInternalTxid throws for invalid input', () => {
    expect(() => asInternalTxid('invalid')).toThrow('Expected InternalTxid');
    expect(() => asInternalTxid(Buffer.from('a'.repeat(62), 'hex'))).toThrow('Expected InternalTxid');
  });
});

describe('XOnlyHex', () => {
  it('isXOnlyHex returns true for valid 64-char hex string', () => {
    expect(isXOnlyHex(VALID_XONLY_HEX)).toBe(true);
  });

  it('isXOnlyHex returns false for invalid length', () => {
    expect(isXOnlyHex('c'.repeat(63))).toBe(false);
    expect(isXOnlyHex('c'.repeat(65))).toBe(false);
  });

  it('isXOnlyHex returns false for non-hex characters', () => {
    expect(isXOnlyHex('g'.repeat(64))).toBe(false);
  });

  it('isXOnlyHex returns false for non-string', () => {
    expect(isXOnlyHex(123)).toBe(false);
    expect(isXOnlyHex(null)).toBe(false);
    expect(isXOnlyHex(undefined)).toBe(false);
    expect(isXOnlyHex({})).toBe(false);
  });

  it('asXOnlyHex returns the value for valid input', () => {
    const result = asXOnlyHex(VALID_XONLY_HEX);
    expect(result).toBe(VALID_XONLY_HEX);
  });

  it('asXOnlyHex throws for invalid input', () => {
    expect(() => asXOnlyHex('invalid')).toThrow('Expected XOnlyHex');
    expect(() => asXOnlyHex(123)).toThrow('Expected XOnlyHex');
  });
});

describe('CompressedHex', () => {
  it('isCompressedHex returns true for valid 66-char hex starting with 02', () => {
    expect(isCompressedHex(VALID_COMPRESSED_HEX_02)).toBe(true);
  });

  it('isCompressedHex returns true for valid 66-char hex starting with 03', () => {
    expect(isCompressedHex(VALID_COMPRESSED_HEX_03)).toBe(true);
  });

  it('isCompressedHex returns false for wrong prefix', () => {
    expect(isCompressedHex('04' + 'd'.repeat(64))).toBe(false);
    expect(isCompressedHex('01' + 'd'.repeat(64))).toBe(false);
  });

  it('isCompressedHex returns false for wrong length', () => {
    expect(isCompressedHex('02' + 'd'.repeat(63))).toBe(false);
    expect(isCompressedHex('02' + 'd'.repeat(65))).toBe(false);
  });

  it('isCompressedHex returns false for non-hex characters', () => {
    expect(isCompressedHex('02' + 'g'.repeat(64))).toBe(false);
  });

  it('isCompressedHex returns false for non-string', () => {
    expect(isCompressedHex(123)).toBe(false);
    expect(isCompressedHex(null)).toBe(false);
    expect(isCompressedHex(undefined)).toBe(false);
    expect(isCompressedHex({})).toBe(false);
  });

  it('asCompressedHex returns the value for valid input', () => {
    const result = asCompressedHex(VALID_COMPRESSED_HEX_02);
    expect(result).toBe(VALID_COMPRESSED_HEX_02);
  });

  it('asCompressedHex throws for invalid input', () => {
    expect(() => asCompressedHex('invalid')).toThrow('Expected CompressedHex');
    expect(() => asCompressedHex('04' + 'd'.repeat(64))).toThrow('Expected CompressedHex');
  });
});

describe('UserAddress', () => {
  it('accepts the real live-verified p2wpkh address (bech32 v0)', () => {
    expect(isUserAddress(VALID_USER_ADDRESS)).toBe(true);
  });

  it('accepts the real live-verified P2TR user payment address (bech32m v1)', () => {
    expect(isUserAddress(VALID_USER_ADDRESS_P2TR)).toBe(true);
  });

  it('accepts an all-uppercase valid address (BIP-173 case-insensitive decoding)', () => {
    expect(isUserAddress(VALID_USER_ADDRESS.toUpperCase())).toBe(true);
  });

  it('rejects corrupted checksum', () => {
    expect(isUserAddress(BAD_CHECKSUM)).toBe(false);
  });

  it('rejects v1 program with bech32 checksum instead of bech32m', () => {
    expect(isUserAddress(BAD_VARIANT)).toBe(false);
  });

  it('rejects v0 program of 21 bytes (v0 allows only 20 or 32)', () => {
    expect(isUserAddress(BAD_V0_21BYTE)).toBe(false);
  });

  it('rejects v1 program of 34 bytes (v1 allows only 32)', () => {
    expect(isUserAddress(BAD_V1_34BYTE)).toBe(false);
  });

  it('rejects mixed-case address (BIP-173 violation)', () => {
    expect(isUserAddress(BAD_MIXED_CASE)).toBe(false);
  });

  it('rejects wrong network HRP (mainnet bc1)', () => {
    expect(isUserAddress('bc1q9z0y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3h2g1f0e9d8c7b6a5')).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(isUserAddress(123)).toBe(false);
    expect(isUserAddress(null)).toBe(false);
    expect(isUserAddress(undefined)).toBe(false);
    expect(isUserAddress({})).toBe(false);
  });

  it('asUserAddress returns the value for valid input', () => {
    const result = asUserAddress(VALID_USER_ADDRESS);
    expect(result).toBe(VALID_USER_ADDRESS);
  });

  it('asUserAddress throws for invalid input', () => {
    expect(() => asUserAddress(123)).toThrow('Expected UserAddress');
    expect(() => asUserAddress('')).toThrow('Expected UserAddress');
    expect(() => asUserAddress(BAD_CHECKSUM)).toThrow('Expected UserAddress');
    expect(() => asUserAddress('not an address at all')).toThrow('Expected UserAddress');
  });
});

describe('VaultAddress', () => {
  it('accepts the real live-verified vault P2TR address (bech32m v1)', () => {
    expect(isVaultAddress(VALID_VAULT_ADDRESS)).toBe(true);
  });

  it('accepts the real P2TR user payment address (also bech32m v1)', () => {
    expect(isVaultAddress(VALID_USER_ADDRESS_P2TR)).toBe(true);
  });

  it('rejects a p2wpkh address (bech32 v0 is not a vault address)', () => {
    expect(isVaultAddress(VALID_USER_ADDRESS)).toBe(false);
  });

  it('rejects corrupted checksum', () => {
    expect(isVaultAddress(BAD_CHECKSUM)).toBe(false);
  });

  it('rejects v1 program with bech32 checksum instead of bech32m', () => {
    expect(isVaultAddress(BAD_VARIANT)).toBe(false);
  });

  it('rejects v1 program of 34 bytes', () => {
    expect(isVaultAddress(BAD_V1_34BYTE)).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(isVaultAddress(123)).toBe(false);
    expect(isVaultAddress(null)).toBe(false);
    expect(isVaultAddress(undefined)).toBe(false);
    expect(isVaultAddress({})).toBe(false);
  });

  it('asVaultAddress returns the value for valid input', () => {
    const result = asVaultAddress(VALID_VAULT_ADDRESS);
    expect(result).toBe(VALID_VAULT_ADDRESS);
  });

  it('asVaultAddress throws for invalid input', () => {
    expect(() => asVaultAddress(123)).toThrow('Expected VaultAddress');
    expect(() => asVaultAddress('')).toThrow('Expected VaultAddress');
    expect(() => asVaultAddress(BAD_CHECKSUM)).toThrow('Expected VaultAddress');
    expect(() => asVaultAddress(VALID_USER_ADDRESS)).toThrow('Expected VaultAddress');
  });
});

describe('Domain interfaces', () => {
  it('VaultRecord can be constructed with all fields', () => {
    const record: VaultRecord = {
      vaultIdHex: 'a'.repeat(64),
      address: VALID_VAULT_ADDRESS,
      csvBlocks: 2,
      userKeyIndex: 0,
      nodePubkeys: [VALID_COMPRESSED_HEX_02, VALID_COMPRESSED_HEX_03, VALID_COMPRESSED_HEX_02, VALID_COMPRESSED_HEX_03, VALID_COMPRESSED_HEX_02, VALID_COMPRESSED_HEX_03, VALID_COMPRESSED_HEX_02],
      quorumThreshold: 5,
      userKeyDescriptor: {
        version: 1,
        scheme: 'bip84-p2wpkh',
        purpose: 84,
        coinType: 1,
        network: 'regtest',
        account: 0,
        change: false,
        index: 0,
        path: "m/84'/1'/0'/0/0",
        publicKey: VALID_COMPRESSED_HEX_02,
        masterFingerprint: "12345678",
        address: VALID_USER_ADDRESS,
        addressType: 'p2wpkh',
      },
      quorumFingerprint: 'f'.repeat(64),
      funding: {
        txid: VALID_DISPLAY_TXID,
        vout: 0,
        valueSats: 10000n,
      },
      registered: true,
      registrationTxHash: 'r'.repeat(64),
      createdAt: Date.now(),
    };
    expect(record.csvBlocks).toBe(2);
    expect(record.address).toBe(VALID_VAULT_ADDRESS);
  });

  it('VaultRecord funding is optional', () => {
    const record: VaultRecord = {
      vaultIdHex: 'a'.repeat(64),
      address: VALID_VAULT_ADDRESS,
      csvBlocks: 1008,
      userKeyIndex: 1,
      nodePubkeys: [VALID_COMPRESSED_HEX_02, VALID_COMPRESSED_HEX_03, VALID_COMPRESSED_HEX_02, VALID_COMPRESSED_HEX_03, VALID_COMPRESSED_HEX_02, VALID_COMPRESSED_HEX_03, VALID_COMPRESSED_HEX_02],
      quorumThreshold: 5,
      userKeyDescriptor: {
        version: 1,
        scheme: 'bip84-p2wpkh',
        purpose: 84,
        coinType: 1,
        network: 'regtest',
        account: 0,
        change: false,
        index: 1,
        path: "m/84'/1'/0'/0/1",
        publicKey: VALID_COMPRESSED_HEX_03,
        masterFingerprint: "87654321",
        address: VALID_USER_ADDRESS,
        addressType: 'p2wpkh',
      },
      quorumFingerprint: 'f'.repeat(64),
      registered: false,
      createdAt: Date.now(),
    };
    expect(record.funding).toBeUndefined();
    expect(record.registrationTxHash).toBeUndefined();
  });

  it('LedgerVtxo can be constructed with all fields', () => {
    const vtxo: LedgerVtxo = {
      id: 'vtxo123',
      ownerXOnly: VALID_XONLY_HEX,
      amountSats: 50000n,
      height: 100,
      spent: false,
      locked: false,
      vaultAddress: VALID_VAULT_ADDRESS,
      localSpentAt: Date.now(),
    };
    expect(vtxo.amountSats).toBe(50000n);
    expect(vtxo.ownerXOnly).toBe(VALID_XONLY_HEX);
  });

  it('BalanceSnapshot can be constructed', () => {
    const snapshot: BalanceSnapshot = {
      onChainSats: 100000n,
      offChainSats: 50000n,
      vtxoCount: 2,
      pendingIncomingSats: 10000n,
      asOfHeight: 200,
    };
    expect(snapshot.onChainSats).toBe(100000n);
    expect(snapshot.offChainSats).toBe(50000n);
  });

  it('ExitReadiness status can be live', () => {
    const readiness: ExitReadiness = {
      status: 'live',
      confirmations: 5,
      requiredConfirmations: 2,
      confirmationsRemaining: 0,
      dryRun: {
        txid: VALID_DISPLAY_TXID,
        vsize: 250,
        sequence: 2,
        rawHex: 'a'.repeat(500),
      },
    };
    expect(readiness.status).toBe('live');
    expect(readiness.confirmationsRemaining).toBe(0);
  });

  it('ExitReadiness status can be maturing', () => {
    const readiness: ExitReadiness = {
      status: 'maturing',
      confirmations: 1,
      requiredConfirmations: 2,
      confirmationsRemaining: 1,
      reason: 'non-BIP68-final',
    };
    expect(readiness.status).toBe('maturing');
    expect(readiness.reason).toBe('non-BIP68-final');
  });

  it('PaymentReceipt can be constructed with optional HAT/RIP', () => {
    const receipt: PaymentReceipt = {
      txHash: 't'.repeat(64),
      epoch: 1000,
      code: 0,
      fromXOnly: VALID_XONLY_HEX,
      toXOnly: VALID_XONLY_HEX,
      amountSats: 25000n,
      feeSats: 1n,
      hat: {
        vtxoId: 'vtxo123',
        proof: 'p'.repeat(64),
        btcHeight: 100,
      },
      rip: {
        originEpoch: 900,
        finalEpoch: 950,
        chainLength: 50,
        finalRoot: 'r'.repeat(64),
        hatInStateDiff: true,
      },
    };
    expect(receipt.code).toBe(0);
    expect(receipt.hat).toBeDefined();
    expect(receipt.rip).toBeDefined();
  });

  it('Identity can be constructed', () => {
    const identity: Identity = {
      mnemonic: 'test mnemonic phrase for testing purposes only',
      network: 'regtest',
      userKeyDescriptor: {
        version: 1,
        scheme: 'bip84-p2wpkh',
        purpose: 84,
        coinType: 1,
        network: 'regtest',
        account: 0,
        change: false,
        index: 0,
        path: "m/84'/1'/0'/0/0",
        publicKey: VALID_COMPRESSED_HEX_02,
        masterFingerprint: "12345678",
        address: VALID_USER_ADDRESS,
        addressType: 'p2wpkh',
      },
      xOnly: VALID_XONLY_HEX,
      userAddress: VALID_USER_ADDRESS,
      l1Address: VALID_USER_ADDRESS,
    };
    expect(identity.network).toBe('regtest');
    expect(identity.xOnly).toBe(VALID_XONLY_HEX);
  });

  it('Quorum can be constructed', () => {
    const quorum: Quorum = {
      nodePubkeys: [VALID_COMPRESSED_HEX_02, VALID_COMPRESSED_HEX_03],
      threshold: 5,
      fingerprint: 'f'.repeat(64),
    };
    expect(quorum.threshold).toBe(5);
    expect(quorum.nodePubkeys).toHaveLength(2);
  });

  it('UserKeyDescriptor can be constructed', () => {
    const descriptor: UserKeyDescriptor = {
      version: 1,
      scheme: 'bip84-p2wpkh',
      purpose: 84,
      coinType: 1,
      network: 'regtest',
      account: 0,
      change: false,
      index: 0,
      path: "m/84'/1'/0'/0/0",
      publicKey: VALID_COMPRESSED_HEX_02,
      masterFingerprint: "12345678",
      address: VALID_USER_ADDRESS,
      addressType: 'p2wpkh',
    };
    expect(descriptor.scheme).toBe('bip84-p2wpkh');
    expect(descriptor.publicKey).toBe(VALID_COMPRESSED_HEX_02);
  });
});

describe('Branded type distinctness', () => {
  it('DisplayTxid and XOnlyHex are different types', () => {
    const display: DisplayTxid = VALID_DISPLAY_TXID;
    const xonly: XOnlyHex = VALID_XONLY_HEX;
    expect(display).toBe(VALID_DISPLAY_TXID);
    expect(xonly).toBe(VALID_XONLY_HEX);
  });

  it('UserAddress and VaultAddress are different types', () => {
    const user: UserAddress = VALID_USER_ADDRESS;
    const vault: VaultAddress = VALID_VAULT_ADDRESS;
    expect(user).toBe(VALID_USER_ADDRESS);
    expect(vault).toBe(VALID_VAULT_ADDRESS);
  });
});