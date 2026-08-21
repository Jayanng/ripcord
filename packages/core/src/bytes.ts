import { DisplayTxid, InternalTxid, isDisplayTxid, isInternalTxid } from './types.js';

const TXID_BYTES = 32;
const TXID_HEX_LENGTH = 64;

function toBuffer32(value: InternalTxid | string | Buffer): Buffer {
  if (isInternalTxid(value)) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    if (value.length !== TXID_BYTES) {
      throw new Error(`Expected ${TXID_BYTES}-byte Buffer for InternalTxid`);
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length !== TXID_HEX_LENGTH) {
      throw new Error(`Expected ${TXID_HEX_LENGTH}-character hex string for InternalTxid`);
    }
    return Buffer.from(value, 'hex');
  }
  throw new Error('Expected InternalTxid, Buffer, or hex string');
}

export function toDisplayTxid(internal: InternalTxid | string | Buffer): DisplayTxid {
  const buf = toBuffer32(internal);
  const reversed = Buffer.from(buf).reverse();
  return reversed.toString('hex') as DisplayTxid;
}

export function toInternalTxid(display: DisplayTxid | string): InternalTxid {
  const hex = isDisplayTxid(display) ? display : display;
  if (typeof hex !== 'string' || hex.length !== TXID_HEX_LENGTH) {
    throw new Error(`Expected ${TXID_HEX_LENGTH}-character hex string for DisplayTxid`);
  }
  const buf = Buffer.from(hex, 'hex').reverse();
  return buf as InternalTxid;
}

const BIGINT_PREFIX = '__bigint:';

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return `${BIGINT_PREFIX}${value.toString()}`;
  }
  return value;
}

function bigintReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BIGINT_PREFIX)) {
    return BigInt(value.slice(BIGINT_PREFIX.length));
  }
  return value;
}

export function serializeJson(data: unknown): string {
  return JSON.stringify(data, bigintReplacer);
}

export function deserializeJson<T>(json: string): T {
  return JSON.parse(json, bigintReviver) as T;
}