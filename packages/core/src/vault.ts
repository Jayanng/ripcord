import {
  CompressedHex,
  UserKeyDescriptor,
  VaultRecord,
  VaultAddress,
  asCompressedHex,
  asVaultAddress,
  isCompressedHex,
} from './types.js';
import * as vc from '@tachibtc/taurus-vault-core';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import { RipcordError, RipcordCode } from './errors.js';

export interface CreateVaultParams {
  network: 'regtest';
  nodePubkeys: CompressedHex[];
  csvBlocks: number;
  userKeyDescriptor: UserKeyDescriptor;
}

const ALICE_FIXTURE_VAULT_ADDRESS_CSV2 = 'bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg';
// Live-verified 2026-08-22: Alice's index-0 compressed user pubkey (BIP39 vector 1).
const ALICE_FIXTURE_USER_PUBKEY = '02e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
// Live-verified 2026-08-22: Bob's (BIP39 vector 2) index-0 csv=2 vault address.
const BOB_FIXTURE_VAULT_ADDRESS_CSV2 = 'bcrt1p6vrucm5g4gke5x4cdl5eygl4uf2muv0mct37wdxef72rfggvhxcsrr9hka';

function validateNodePubkeys(nodePubkeys: CompressedHex[]): void {
  if (!Array.isArray(nodePubkeys) || nodePubkeys.length !== 7) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Expected 7 node pubkeys, got ${nodePubkeys?.length ?? 'undefined'}`,
      { hint: 'Vault requires exactly 7 node pubkeys' }
    );
  }

  for (const pk of nodePubkeys) {
    if (!isCompressedHex(pk)) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Invalid compressed pubkey: ${pk}`,
        { hint: 'Node pubkeys must be 66-char hex starting with 02 or 03' }
      );
    }
  }
}

function toSdkUserKeyDescriptor(desc: UserKeyDescriptor): agg.UserKeyDescriptor {
  return {
    version: desc.version,
    scheme: desc.scheme as agg.UserKeyScheme,
    purpose: desc.purpose,
    coinType: desc.coinType,
    network: desc.network,
    account: desc.account,
    change: desc.change,
    index: desc.index,
    path: desc.path,
    publicKey: desc.publicKey,
    masterFingerprint: desc.masterFingerprint,
    address: desc.address,
    addressType: desc.addressType as agg.AddressType,
  };
}

export async function createVault(params: CreateVaultParams): Promise<VaultRecord> {
  const { network, nodePubkeys, csvBlocks, userKeyDescriptor } = params;

  validateNodePubkeys(nodePubkeys);

  const sdkUserKeyDescriptor = toSdkUserKeyDescriptor(userKeyDescriptor);

  const vault = await vc.createVault({
    network: 'regtest',
    nodePubkeys,
    csvBlocks,
    userKeyDescriptor: sdkUserKeyDescriptor,
  });

  if (!vc.bytesEqual(vault.p2tr.internalKey, vc.NUMS_INTERNAL_KEY)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Vault internal key does not match NUMS_INTERNAL_KEY',
      { hint: 'Key path must be provably unusable' }
    );
  }

  try {
    vc.verifyVaultP2tr(vault.p2tr);
  } catch (err) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'P2TR verification failed',
      { cause: err }
    );
  }

  const expectedAddress = vault.p2tr.address;

  const quorumFingerprint = [...nodePubkeys].sort().join(':');
  const fingerprintHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quorumFingerprint));
  const fingerprint = Array.from(new Uint8Array(fingerprintHash)).map(b => b.toString(16).padStart(2, '0')).join('');

  const record: VaultRecord = {
    vaultIdHex: '',
    address: asVaultAddress(expectedAddress),
    csvBlocks,
    userKeyIndex: userKeyDescriptor.index,
    userKeyDescriptor,
    nodePubkeys,
    quorumFingerprint: fingerprint,
    p2tr: vault.p2tr,
    exitLeaf: Buffer.from(vault.p2tr.exitLeaf.script).toString('hex'),
    cooperativeLeaf: Buffer.from(vault.p2tr.cooperativeLeaf.script).toString('hex'),
    registered: false,
    createdAt: Date.now(),
  };

  // Determinism fixtures, scoped to the exact user key that was live-verified.
  // Scoping by index alone was wrong: any user's index-0 csv=2 vault would hit
  // Alice's fixture (live-proven 2026-08-22: Bob's index-0 csv=2 vault derives
  // to a different address). The SDK's verifyVaultP2tr above already validates
  // the cryptographic structure for every vault.
  if (csvBlocks === 2 && userKeyDescriptor.publicKey === ALICE_FIXTURE_USER_PUBKEY) {
    if (expectedAddress !== ALICE_FIXTURE_VAULT_ADDRESS_CSV2) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Vault address mismatch for Alice csvBlocks=2: expected ${ALICE_FIXTURE_VAULT_ADDRESS_CSV2}, got ${expectedAddress}`,
        { hint: 'Vault derivation must be deterministic and match verified fixture' }
      );
    }
  }
  if (csvBlocks === 2 && userKeyDescriptor.publicKey === '02028e9de3ffe2238b2cbf8a60f1c99c076d6e89749018915f2f5af8c8da791c80') {
    if (expectedAddress !== BOB_FIXTURE_VAULT_ADDRESS_CSV2) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Vault address mismatch for Bob csvBlocks=2: expected ${BOB_FIXTURE_VAULT_ADDRESS_CSV2}, got ${expectedAddress}`,
        { hint: 'Vault derivation must be deterministic and match verified fixture' }
      );
    }
  }

  return record;
}

export function describeTapscript(script: string): string[] {
  const scriptBuffer = Buffer.from(script, 'hex');
  const asm = vc.describeTapscript(scriptBuffer);
  return asm.split(' ');
}

export { getQuorum } from './quorum.js';
export { deriveIdentity, makeSigner } from './keys.js';