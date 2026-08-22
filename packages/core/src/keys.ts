import {
  XOnlyHex,
  CompressedHex,
  UserAddress,
  UserKeyDescriptor,
  Identity,
  isXOnlyHex,
  asXOnlyHex,
  isCompressedHex,
  asCompressedHex,
  asUserAddress,
} from './types.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as vc from '@tachibtc/taurus-vault-core';
import * as btc from 'bitcoinjs-lib';
import { RipcordError, RipcordCode } from './errors.js';

type SdkUserKeyDescriptor = {
  version: number;
  scheme: string;
  purpose: number;
  coinType: number;
  network: string;
  account: number;
  change: boolean;
  index: number;
  path: string;
  publicKey: string;
  masterFingerprint: string;
  address: string;
  addressType: string;
};

export function toUserKeyDescriptor(desc: SdkUserKeyDescriptor): UserKeyDescriptor {
  return {
    version: desc.version,
    scheme: desc.scheme,
    purpose: desc.purpose,
    coinType: desc.coinType,
    network: desc.network,
    account: desc.account,
    change: desc.change,
    index: desc.index,
    path: desc.path,
    publicKey: asCompressedHex(desc.publicKey),
    masterFingerprint: desc.masterFingerprint,
    address: asUserAddress(desc.address),
    addressType: desc.addressType,
  };
}

/**
 * Derive the wallet identity (descriptor, x-only key, P2TR payment address) for
 * one receive-address index.
 *
 * AUDIT FIX (2026-08-23): `index` did not exist. `deriveUserKey` was called with
 * no options, so only `m/84'/1'/0'/0/0` was reachable, while `VaultRecord`
 * carries a `userKeyIndex` and the "one deposit per vault, fresh `userKeyIndex`
 * per funded run" rule requires index > 0. `recovery.ts` already rebuilds
 * descriptors at arbitrary indices via `userKeyDescriptorFromWallet`, so a vault
 * recovered at index 3 had no matching `deriveIdentity` path. Verified live that
 * the SDK derives distinct keys per index.
 *
 * @param index Zero-based receive-address index (default 0).
 */
export function deriveIdentity(
  mnemonic: string,
  network: 'regtest',
  index = 0
): Identity {
  assertKeyIndex(index);
  const netObj = agg.getNetwork(network);

  let desc: SdkUserKeyDescriptor;
  try {
    desc = vc.deriveUserKey(mnemonic, netObj, { index }) as SdkUserKeyDescriptor;
  } catch (err) {
    // AUDIT FIX (2026-08-23): the SDK throws its own `InvalidMnemonicError`
    // (verified live for empty, non-BIP39, and bad-checksum input). That is not a
    // RipcordError, so a caller branching on `err.code` per the error model saw
    // an unmapped foreign error type. Wrapped, with the cause preserved.
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Failed to derive user key at index ${index}`,
      { cause: err, hint: 'Check the mnemonic is a valid BIP-39 phrase' }
    );
  }

  const xOnly = desc.publicKey.slice(2) as XOnlyHex;
  const userAddress = userAddressForXOnly(xOnly, network);

  return {
    mnemonic,
    network,
    userKeyDescriptor: toUserKeyDescriptor(desc),
    xOnly,
    userAddress,
    l1Address: asUserAddress(desc.address),
  };
}

function assertKeyIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Key index must be a non-negative integer, got ${index}`,
      { hint: 'Use 0 for the first receive address' }
    );
  }
}

export function makeSigner(
  mnemonic: string,
  network: 'regtest',
  index: number
): {
  publicKey: Buffer;
  sign: (hash: Buffer) => Buffer;
  signSchnorr: (hash: Buffer) => Buffer;
} {
  assertKeyIndex(index);
  const netObj = agg.getNetwork(network);

  let node: { publicKey: Uint8Array; sign: (h: Buffer) => Uint8Array; signSchnorr: (h: Buffer) => Uint8Array };
  try {
    const ks = agg.Keystore.fromMnemonic(mnemonic, '', netObj, 'p2wpkh', 0);
    node = ks.signerFor(false, index);
  } catch (err) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Failed to build signer at index ${index}`,
      { cause: err, hint: 'Check the mnemonic is a valid BIP-39 phrase' }
    );
  }

  return vc.normalizeTaprootSigner({
    publicKey: Buffer.from(node.publicKey),
    sign: (h: Buffer) => Buffer.from(node.sign(h)),
    signSchnorr: (h: Buffer) => Buffer.from(node.signSchnorr(h)),
  });
}

export function userAddressForXOnly(xOnly: string, network: 'regtest'): UserAddress {
  if (!isXOnlyHex(xOnly)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'xOnly must be a 64-character hex string',
      { hint: 'xOnly public key must be exactly 32 bytes (64 hex chars)' }
    );
  }

  const script = Buffer.concat([
    Buffer.from([0x51, 0x20]),
    Buffer.from(xOnly, 'hex'),
  ]);

  // AUDIT FIX (2026-08-23): `fromOutputScript` throws a bare bitcoinjs `Error`
  // ("OP_1 <hex> has no matching Address") for an x-only value that is not a
  // valid curve point, e.g. all-ff, all-zero, or the field prime. Live-verified.
  // That leaked past the RipcordError taxonomy with `code === undefined`, so a
  // caller branching on the error model got nothing to branch on.
  let address: string;
  try {
    address = btc.address.fromOutputScript(script, btc.networks.regtest);
  } catch (err) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `xOnly key is not a valid Taproot output key: ${xOnly}`,
      { cause: err, hint: 'The 32-byte value must be a valid secp256k1 x-coordinate' }
    );
  }
  return asUserAddress(address);
}
