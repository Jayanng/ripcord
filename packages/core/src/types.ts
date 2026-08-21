export type DisplayTxid = string & { readonly __brand: 'DisplayTxid' };
export type InternalTxid = Buffer & { readonly __brand: 'InternalTxid' };
export type XOnlyHex = string & { readonly __brand: 'XOnlyHex' };
export type CompressedHex = string & { readonly __brand: 'CompressedHex' };
export type UserAddress = string & { readonly __brand: 'UserAddress' };
export type VaultAddress = string & { readonly __brand: 'VaultAddress' };

const HEX_REGEX = /^[0-9a-f]+$/i;
const DISPLAY_TXID_LENGTH = 64;
const INTERNAL_TXID_BYTES = 32;
const XONLY_HEX_LENGTH = 64;
const COMPRESSED_HEX_LENGTH = 66;

function isHexString(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && HEX_REGEX.test(value);
}

function isBufferOfLength(value: unknown, length: number): value is Buffer {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(value) && value.length === length;
}

function isValidCompressedHex(value: string): boolean {
  if (!isHexString(value, COMPRESSED_HEX_LENGTH)) {
    return false;
  }
  const prefix = value.slice(0, 2).toLowerCase();
  return prefix === '02' || prefix === '03';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isDisplayTxid(value: unknown): value is DisplayTxid {
  return isHexString(value, DISPLAY_TXID_LENGTH);
}

export function asDisplayTxid(value: unknown): DisplayTxid {
  if (!isDisplayTxid(value)) {
    throw new Error('Expected DisplayTxid: 64-character hex string');
  }
  return value;
}

export function isInternalTxid(value: unknown): value is InternalTxid {
  return isBufferOfLength(value, INTERNAL_TXID_BYTES);
}

export function asInternalTxid(value: unknown): InternalTxid {
  if (!isInternalTxid(value)) {
    throw new Error('Expected InternalTxid: 32-byte Buffer');
  }
  return value;
}

export function isXOnlyHex(value: unknown): value is XOnlyHex {
  return isHexString(value, XONLY_HEX_LENGTH);
}

export function asXOnlyHex(value: unknown): XOnlyHex {
  if (!isXOnlyHex(value)) {
    throw new Error('Expected XOnlyHex: 64-character hex string');
  }
  return value;
}

export function isCompressedHex(value: unknown): value is CompressedHex {
  return typeof value === 'string' && isValidCompressedHex(value);
}

export function asCompressedHex(value: unknown): CompressedHex {
  if (!isCompressedHex(value)) {
    throw new Error('Expected CompressedHex: 66-character hex string starting with 02 or 03');
  }
  return value;
}

export function isUserAddress(value: unknown): value is UserAddress {
  return isNonEmptyString(value);
}

export function asUserAddress(value: unknown): UserAddress {
  if (!isUserAddress(value)) {
    throw new Error('Expected UserAddress: non-empty string (bech32/bech32m)');
  }
  return value;
}

export function isVaultAddress(value: unknown): value is VaultAddress {
  return isNonEmptyString(value);
}

export function asVaultAddress(value: unknown): VaultAddress {
  if (!isVaultAddress(value)) {
    throw new Error('Expected VaultAddress: non-empty string (bech32m)');
  }
  return value;
}

export interface UserKeyDescriptor {
  version: number;
  scheme: string;
  purpose: number;
  coinType: number;
  network: string;
  account: number;
  change: boolean;
  index: number;
  path: string;
  publicKey: CompressedHex;
  masterFingerprint: number;
  address: UserAddress;
  addressType: string;
}

export interface VaultRecord {
  vaultIdHex: string;
  address: VaultAddress;
  csvBlocks: number;
  userKeyIndex: number;
  userKeyDescriptor: UserKeyDescriptor;
  quorumFingerprint: string;
  funding?: {
    txid: DisplayTxid;
    vout: number;
    valueSats: bigint;
  };
  registered: boolean;
  registrationTxHash?: string;
  createdAt: number;
}

export interface LedgerVtxo {
  id: string;
  ownerXOnly: XOnlyHex;
  amountSats: bigint;
  height: number;
  spent: boolean;
  locked: boolean;
  vaultAddress?: VaultAddress;
  localSpentAt?: number;
}

export interface BalanceSnapshot {
  onChainSats: bigint;
  offChainSats: bigint;
  vtxoCount: number;
  pendingIncomingSats: bigint;
  asOfHeight: number;
}

export type ExitReadinessStatus = 'live' | 'maturing' | 'unfunded' | 'spent';

export interface ExitReadiness {
  status: ExitReadinessStatus;
  confirmations: number;
  requiredConfirmations: number;
  confirmationsRemaining: number;
  dryRun?: {
    txid: DisplayTxid;
    vsize: number;
    sequence: number;
    rawHex: string;
  };
  reason?: string;
}

export interface PaymentReceipt {
  txHash: string;
  epoch: number;
  code: number;
  fromXOnly: XOnlyHex;
  toXOnly: XOnlyHex;
  amountSats: bigint;
  feeSats: bigint;
  hat?: {
    vtxoId: string;
    proof: string;
    btcHeight: number;
  };
  rip?: {
    originEpoch: number;
    finalEpoch: number;
    chainLength: number;
    finalRoot: string;
    hatInStateDiff: boolean;
  };
}

export interface Identity {
  mnemonic: string;
  network: string;
  userKeyDescriptor: UserKeyDescriptor;
  xOnly: XOnlyHex;
  userAddress: UserAddress;
}

export interface Quorum {
  nodePubkeys: CompressedHex[];
  threshold: number;
  fingerprint: string;
}