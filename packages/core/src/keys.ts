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

function toUserKeyDescriptor(desc: SdkUserKeyDescriptor): UserKeyDescriptor {
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

export function deriveIdentity(mnemonic: string, network: 'regtest'): Identity {
  const netObj = agg.getNetwork(network);
  const desc = vc.deriveUserKey(mnemonic, netObj) as SdkUserKeyDescriptor;

  const xOnly = desc.publicKey.slice(2) as XOnlyHex;
  const userAddress = userAddressForXOnly(xOnly, network);

  return {
    mnemonic,
    network,
    userKeyDescriptor: toUserKeyDescriptor(desc),
    xOnly,
    userAddress,
    l1Address: desc.address as UserAddress,
  };
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
  const netObj = agg.getNetwork(network);
  const ks = agg.Keystore.fromMnemonic(mnemonic, '', netObj, 'p2wpkh', 0);
  const node = ks.signerFor(false, index);

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

  const address = btc.address.fromOutputScript(script, btc.networks.regtest);
  return asUserAddress(address);
}