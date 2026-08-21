import { DisplayTxid, InternalTxid, isInternalTxid } from './types.js';

const TXID_BYTES = 32;
const TXID_HEX_LENGTH = 64;
const TXID_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

function hexToTxidBuffer(hex: string, label: string): Buffer {
  if (hex.length !== TXID_HEX_LENGTH) {
    throw new Error(`Expected ${TXID_HEX_LENGTH}-character hex string for ${label}`);
  }
  // Buffer.from(x, 'hex') silently truncates at the first invalid character
  // (a 64-char string of junk decodes to a 0-byte Buffer), so the charset is
  // validated explicitly before decoding.
  if (!TXID_HEX_REGEX.test(hex)) {
    throw new Error(`Expected hexadecimal characters in ${label} hex string`);
  }
  return Buffer.from(hex, 'hex');
}

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
    return hexToTxidBuffer(value, 'InternalTxid');
  }
  throw new Error('Expected InternalTxid, Buffer, or hex string');
}

export function toDisplayTxid(internal: InternalTxid | string | Buffer): DisplayTxid {
  const buf = toBuffer32(internal);
  const reversed = Buffer.from(buf).reverse();
  return reversed.toString('hex') as DisplayTxid;
}

export function toInternalTxid(display: DisplayTxid | string): InternalTxid {
  const buf = hexToTxidBuffer(display, 'DisplayTxid').reverse();
  return buf as InternalTxid;
}

const BIGINT_PREFIX = '__bigint:';
const BIGINT_INT_REGEX = /^-?\d+$/;

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return `${BIGINT_PREFIX}${value.toString()}`;
  }
  // Prefix-doubling: a literal string that starts with the reserved prefix is
  // emitted with the prefix doubled so the reviver can tell it apart from an
  // encoded bigint. Without this, deserializeJson(serializeJson({s:'__bigint:5'}))
  // would either corrupt the string into 5n or throw a SyntaxError.
  if (typeof value === 'string' && value.startsWith(BIGINT_PREFIX)) {
    return BIGINT_PREFIX + value;
  }
  return value;
}

function bigintReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BIGINT_PREFIX)) {
    const rest = value.slice(BIGINT_PREFIX.length);
    // Doubled prefix: a literal string that happens to start with the prefix.
    if (rest.startsWith(BIGINT_PREFIX)) {
      return rest;
    }
    // Single prefix with a valid integer payload: a bigint encoded by us
    // (or by the pre-doubling format). Anything else is foreign data and is
    // passed through unchanged rather than crashing the whole parse.
    if (BIGINT_INT_REGEX.test(rest)) {
      return BigInt(rest);
    }
  }
  return value;
}

export function serializeJson(data: unknown): string {
  return JSON.stringify(data, bigintReplacer);
}

export function deserializeJson<T>(json: string): T {
  return JSON.parse(json, bigintReviver) as T;
}
