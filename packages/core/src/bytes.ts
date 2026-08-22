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
const BUFFER_PREFIX = '__bytes:';

function isUint8Array(value: unknown): value is Uint8Array {
  return typeof Uint8Array !== 'undefined' && value instanceof Uint8Array;
}

/**
 * Buffer.toJSON() emits `{ type: 'Buffer', data: number[] }` and JSON.stringify
 * calls it BEFORE the replacer runs, so a Buffer never reaches jsonReplacer.
 * Detect that exact shape here so a Buffer round-trips as a real Buffer.
 */
function isBufferJson(value: unknown): value is { type: 'Buffer'; data: number[] } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return obj.type === 'Buffer' && Array.isArray(obj.data);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return `${BIGINT_PREFIX}${value.toString()}`;
  }
  if (isUint8Array(value)) {
    // Buffers (and bitcoinjs-lib v7's Uint8Arrays) are pervasive in vault
    // records and proofs. JSON.stringify would otherwise emit them as
    // { type: 'Buffer', data: [...] } and deserialization would leave a plain
    // object, silently corrupting p2tr outputs and control blocks.
    return `${BUFFER_PREFIX}${Buffer.from(value).toString('base64')}`;
  }
  // Prefix-doubling: a literal string that starts with either reserved prefix
  // is emitted with the prefix doubled so the reviver can tell it apart from
  // an encoded value. Without this, deserializeJson(serializeJson({s:'__bigint:5'}))
  // would either corrupt the string into 5n or throw a SyntaxError.
  if (typeof value === 'string') {
    if (value.startsWith(BIGINT_PREFIX)) {
      return BIGINT_PREFIX + value;
    }
    if (value.startsWith(BUFFER_PREFIX)) {
      return BUFFER_PREFIX + value;
    }
  }
  return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  // Buffer.toJSON shape (see isBufferJson): reconstruct a real Buffer.
  if (isBufferJson(value)) {
    return Buffer.from(value.data);
  }
  if (typeof value !== 'string') {
    return value;
  }
  if (value.startsWith(BIGINT_PREFIX)) {
    const rest = value.slice(BIGINT_PREFIX.length);
    // Doubled prefix: a literal string that happens to start with the prefix.
    if (rest.startsWith(BIGINT_PREFIX)) {
      return rest;
    }
    // Single prefix with a valid integer payload: a bigint encoded by us.
    // Anything else is foreign data and is passed through unchanged rather
    // than crashing the whole parse.
    if (BIGINT_INT_REGEX.test(rest)) {
      return BigInt(rest);
    }
    return value;
  }
  if (value.startsWith(BUFFER_PREFIX)) {
    const rest = value.slice(BUFFER_PREFIX.length);
    // Doubled prefix: a literal string that happens to start with the prefix.
    if (rest.startsWith(BUFFER_PREFIX)) {
      return rest;
    }
    // Single prefix: a Buffer/Uint8Array encoded by us. base64 decode is
    // lenient and never throws, so this cannot crash the parse.
    return Buffer.from(rest, 'base64');
  }
  return value;
}

export function serializeJson(data: unknown): string {
  return JSON.stringify(data, jsonReplacer);
}

export function deserializeJson<T>(json: string): T {
  return JSON.parse(json, jsonReviver) as T;
}
