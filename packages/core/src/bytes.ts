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
 * Legacy `Buffer.toJSON()` shape: `{ type: 'Buffer', data: number[] }`.
 *
 * The replacer below now intercepts Buffers before `toJSON` can run, so nothing
 * this library writes uses this form any more. It is still recognised on read so
 * a snapshot written by the previous implementation still restores.
 *
 * AUDIT FIX (2026-08-23): the check used to accept any `data` array, which meant
 * a foreign daemon payload that happened to contain `{type:'Buffer', data:[…]}`
 * was silently coerced into a Buffer (a non-numeric array became zero bytes).
 * Every element must now be a byte-range integer.
 */
function isLegacyBufferJson(value: unknown): value is { type: 'Buffer'; data: number[] } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.type !== 'Buffer' || !Array.isArray(obj.data)) {
    return false;
  }
  // A legacy Buffer payload has exactly these two keys and nothing else.
  if (Object.keys(obj).length !== 2) {
    return false;
  }
  return obj.data.every(b => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255);
}

/**
 * JSON replacer.
 *
 * AUDIT FIX (2026-08-23): `Buffer.prototype.toJSON` runs BEFORE a replacer sees
 * the value, so `value` arrives already flattened to
 * `{ type: 'Buffer', data: [...] }` and the `isUint8Array(value)` branch only
 * ever caught a plain (non-Buffer) `Uint8Array`. The consequences were both real:
 *
 *   1. **Inconsistent encoding.** The same 33 bytes serialized as a 166-char
 *      `{"type":"Buffer","data":[…]}` object when passed as a `Buffer` but as a
 *      64-char `"__bytes:…"` string when passed as a `Uint8Array`. Two wire
 *      formats for one value.
 *   2. **Size blow-up.** A 1 KB Buffer produced 2,080 characters instead of the
 *      ~1,390 base64 needs. On a ~114 KB RIP proof that is a material waste in
 *      an IndexedDB quota.
 *
 * The replacer is invoked with `this` bound to the holder object, and
 * `this[key]` is the ORIGINAL value before `toJSON` was applied. Reading the raw
 * value there catches `Buffer` and `Uint8Array` identically, on one code path.
 */
function jsonReplacer(this: unknown, key: string, value: unknown): unknown {
  // Recover the pre-toJSON value from the holder so a Buffer is still a Buffer.
  const holder = this as Record<string, unknown> | undefined;
  const raw = holder !== undefined && holder !== null ? holder[key] : value;

  if (typeof raw === 'bigint') {
    return `${BIGINT_PREFIX}${raw.toString()}`;
  }
  if (isUint8Array(raw)) {
    // Buffers and bitcoinjs-lib v7's Uint8Arrays are pervasive in vault records
    // and proofs. Both encode to the same compact base64 form.
    return `${BUFFER_PREFIX}${Buffer.from(raw).toString('base64')}`;
  }
  // Prefix-doubling: a literal string that starts with either reserved prefix
  // is emitted with the prefix doubled so the reviver can tell it apart from
  // an encoded value. Without this, deserializeJson(serializeJson({s:'__bigint:5'}))
  // would either corrupt the string into 5n or throw a SyntaxError.
  if (typeof raw === 'string') {
    if (raw.startsWith(BIGINT_PREFIX)) {
      return BIGINT_PREFIX + raw;
    }
    if (raw.startsWith(BUFFER_PREFIX)) {
      return BUFFER_PREFIX + raw;
    }
  }
  return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  // Legacy Buffer.toJSON shape (see isLegacyBufferJson): restore a real Buffer.
  if (isLegacyBufferJson(value)) {
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
