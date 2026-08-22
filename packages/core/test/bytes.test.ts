import { describe, it, expect } from 'vitest';
import { toDisplayTxid, toInternalTxid, serializeJson, deserializeJson } from '../src/bytes.js';
import type { DisplayTxid, InternalTxid } from '../src/types.js';

describe('bytes.ts: byte reversal & BigInt JSON helpers', () => {
  const INTERNAL_FIXTURE_HEX = '8326c9aef63b07555de77812d886ff3ed8886be375435bfa1f63ca9fb5c1225a';
  const DISPLAY_FIXTURE_HEX = '5a22c1b59fca631ffa5b4375e36b88d83eff86d81278e75d55073bf6aec92683';

  describe('toDisplayTxid / toInternalTxid round-trip', () => {
    it('converts the real-world audit fixture from internal to display order', () => {
      const internalBuf = Buffer.from(INTERNAL_FIXTURE_HEX, 'hex');
      const display = toDisplayTxid(internalBuf);
      expect(display).toBe(DISPLAY_FIXTURE_HEX);
    });

    it('converts the real-world audit fixture from display to internal order', () => {
      const internal = toInternalTxid(DISPLAY_FIXTURE_HEX);
      expect(Buffer.from(internal).toString('hex')).toBe(INTERNAL_FIXTURE_HEX);
    });

    it('round-trips internal -> display -> internal exactly', () => {
      const internalBuf = Buffer.from(INTERNAL_FIXTURE_HEX, 'hex');
      const display = toDisplayTxid(internalBuf);
      const backToInternal = toInternalTxid(display);
      expect(Buffer.from(backToInternal).toString('hex')).toBe(INTERNAL_FIXTURE_HEX);
    });

    it('round-trips display -> internal -> display exactly', () => {
      const display = DISPLAY_FIXTURE_HEX;
      const internal = toInternalTxid(display);
      const backToDisplay = toDisplayTxid(internal);
      expect(backToDisplay).toBe(DISPLAY_FIXTURE_HEX);
    });

    it('accepts InternalTxid branded type', () => {
      const internalBuf = Buffer.from(INTERNAL_FIXTURE_HEX, 'hex') as InternalTxid;
      const display = toDisplayTxid(internalBuf);
      expect(display).toBe(DISPLAY_FIXTURE_HEX);
    });

    it('accepts DisplayTxid branded type', () => {
      const display = DISPLAY_FIXTURE_HEX as DisplayTxid;
      const internal = toInternalTxid(display);
      expect(Buffer.from(internal).toString('hex')).toBe(INTERNAL_FIXTURE_HEX);
    });

    it('accepts plain hex string for toInternalTxid', () => {
      const internal = toInternalTxid(DISPLAY_FIXTURE_HEX);
      expect(Buffer.from(internal).toString('hex')).toBe(INTERNAL_FIXTURE_HEX);
    });

    it('accepts plain hex string for toDisplayTxid', () => {
      const display = toDisplayTxid(INTERNAL_FIXTURE_HEX);
      expect(display).toBe(DISPLAY_FIXTURE_HEX);
    });

    it('throws on wrong-length Buffer for toDisplayTxid', () => {
      expect(() => toDisplayTxid(Buffer.from('00', 'hex'))).toThrow('32-byte');
    });

    it('throws on wrong-length hex string for toDisplayTxid', () => {
      expect(() => toDisplayTxid('deadbeef')).toThrow('64-character');
    });

    it('throws on wrong-length hex string for toInternalTxid', () => {
      expect(() => toInternalTxid('deadbeef')).toThrow('64-character');
    });

    it('throws on non-hex charset instead of silently decoding to a 0-byte buffer', () => {
      // Buffer.from(junk, 'hex') silently truncates: a 64-char non-hex string
      // decodes to 0 bytes, which would make toDisplayTxid return '' branded
      // as a DisplayTxid. The charset guard must reject it.
      expect(() => toDisplayTxid('zz' + 'a'.repeat(62))).toThrow('hexadecimal');
      expect(() => toInternalTxid('zz' + 'a'.repeat(62))).toThrow('hexadecimal');
    });

    it('throws on mid-string junk instead of silently truncating', () => {
      // 64 chars, but 'zz' in the middle: Buffer.from stops at the junk.
      const midJunk = 'aa'.repeat(20) + 'zz' + 'bb'.repeat(11);
      expect(midJunk).toHaveLength(64);
      expect(() => toDisplayTxid(midJunk)).toThrow('hexadecimal');
      expect(() => toInternalTxid(midJunk)).toThrow('hexadecimal');
    });

    it('accepts uppercase hex (daemon returns uppercase Tendermint hashes)', () => {
      const upperInternal = INTERNAL_FIXTURE_HEX.toUpperCase();
      const display = toDisplayTxid(upperInternal);
      expect(display).toBe(DISPLAY_FIXTURE_HEX);
      const upperDisplay = DISPLAY_FIXTURE_HEX.toUpperCase();
      const internal = toInternalTxid(upperDisplay);
      expect(Buffer.from(internal).toString('hex')).toBe(INTERNAL_FIXTURE_HEX);
    });
  });

  describe('serializeJson / deserializeJson BigInt round-trip', () => {
    it('serializes bigint values with __bigint: prefix', () => {
      const data = { amount: 12345n, nested: { fee: 100n } };
      const json = serializeJson(data);
      expect(json).toContain('__bigint:12345');
      expect(json).toContain('__bigint:100');
    });

    it('deserializes __bigint: strings back to native BigInt', () => {
      const json = '{"amount":"__bigint:12345","nested":{"fee":"__bigint:100"}}';
      const data = deserializeJson<{ amount: bigint; nested: { fee: bigint } }>(json);
      expect(data.amount).toBe(12345n);
      expect(data.nested.fee).toBe(100n);
    });

    it('round-trips complex objects with bigints exactly', () => {
      const original = {
        balance: 100000000n,
        utxos: [
          { txid: 'abc', value: 50000n },
          { txid: 'def', value: 50000n },
        ],
        metadata: { height: 8865n, timestamp: 1234567890n },
      };
      const json = serializeJson(original);
      const restored = deserializeJson<typeof original>(json);
      expect(restored).toEqual(original);
      expect(typeof restored.balance).toBe('bigint');
      expect(typeof restored.utxos[0].value).toBe('bigint');
      expect(typeof restored.metadata.height).toBe('bigint');
    });

    it('preserves non-bigint values unchanged', () => {
      const original = { str: 'hello', num: 42, bool: true, arr: [1, 2, 3], nil: null };
      const json = serializeJson(original);
      const restored = deserializeJson<typeof original>(json);
      expect(restored).toEqual(original);
    });

    it('handles zero and negative bigints', () => {
      const original = { zero: 0n, negative: -500n };
      const json = serializeJson(original);
      const restored = deserializeJson<typeof original>(json);
      expect(restored.zero).toBe(0n);
      expect(restored.negative).toBe(-500n);
    });
  });

  describe('literal strings colliding with the __bigint: prefix', () => {
    it('round-trips a user string that starts with the prefix', () => {
      // Pre-fix behavior: deserializeJson(serializeJson({s:'__bigint:5'}))
      // either corrupted the string into 5n or threw a SyntaxError.
      const original = { s: '__bigint:5', t: '__bigint:not-a-number' };
      const restored = deserializeJson<typeof original>(serializeJson(original));
      expect(restored.s).toBe('__bigint:5');
      expect(restored.t).toBe('__bigint:not-a-number');
      expect(typeof restored.s).toBe('string');
    });

    it('still decodes genuine encoded bigints', () => {
      const json = '{"amount":"__bigint:12345"}';
      const data = deserializeJson<{ amount: bigint }>(json);
      expect(data.amount).toBe(12345n);
    });

    it('passes foreign prefix strings through unchanged instead of throwing', () => {
      const json = '{"s":"__bigint: 12x34"}';
      const data = deserializeJson<{ s: string }>(json);
      expect(data.s).toBe('__bigint: 12x34');
    });
  });

  describe('serializeJson / deserializeJson Buffer round-trip', () => {
    it('preserves a Buffer through the round-trip as a real Buffer', () => {
      const original = { script: Buffer.from('0014d85c2b71d0060b09c9886aeb815e50991bdda6', 'hex') };
      const restored = deserializeJson<typeof original>(serializeJson(original));
      expect(Buffer.isBuffer(restored.script)).toBe(true);
      expect(restored.script.equals(original.script)).toBe(true);
    });

    it('preserves a plain Uint8Array (bitcoinjs-lib v7) as bytes', () => {
      const bytes = new Uint8Array([1, 2, 3, 250, 255]);
      const restored = deserializeJson<{ b: Uint8Array }>(serializeJson({ b: bytes }));
      expect(Buffer.isBuffer(restored.b)).toBe(true);
      expect(Buffer.from(restored.b)).toEqual(Buffer.from(bytes));
    });

    it('round-trips a mixed object with bigints and Buffers together', () => {
      const original = {
        amount: 500n,
        controlBlock: Buffer.from('c0' + '11'.repeat(32), 'hex'),
        outputs: [Buffer.from([0x51, 0x20])],
      };
      const restored = deserializeJson<typeof original>(serializeJson(original));
      expect(restored.amount).toBe(500n);
      expect(Buffer.isBuffer(restored.controlBlock)).toBe(true);
      expect(restored.controlBlock.equals(original.controlBlock)).toBe(true);
      expect(restored.outputs[0].equals(original.outputs[0])).toBe(true);
    });

    it('round-trips a literal string that starts with the __bytes: prefix', () => {
      const original = { s: '__bytes:not-actually-bytes' };
      const restored = deserializeJson<typeof original>(serializeJson(original));
      expect(restored.s).toBe('__bytes:not-actually-bytes');
      expect(typeof restored.s).toBe('string');
    });
  });

  /**
   * AUDIT (2026-08-23). `Buffer.prototype.toJSON` runs BEFORE a JSON replacer,
   * so the replacer used to see an already-flattened
   * `{ type: 'Buffer', data: [...] }` object and its `Uint8Array` branch only
   * caught plain (non-Buffer) Uint8Arrays. Two real consequences, both fixed:
   *   1. the same bytes encoded two different ways depending on the input type
   *   2. a Buffer serialized ~50% larger than base64 needs
   * The reviver's legacy-shape detection was also too loose and coerced any
   * foreign `{type:'Buffer',data:[...]}` object into a Buffer.
   */
  describe('serialization encoding consistency (audit 2026-08-23)', () => {
    it('encodes a Buffer and an equivalent Uint8Array identically', () => {
      const buf = Buffer.from('5120' + 'ab'.repeat(32), 'hex');
      const u8 = new Uint8Array(buf);
      expect(serializeJson({ x: buf })).toBe(serializeJson({ x: u8 }));
    });

    it('encodes bytes as a compact __bytes: string, not a data array', () => {
      const buf = Buffer.from('deadbeef', 'hex');
      const json = serializeJson({ x: buf });
      expect(json).toContain('__bytes:');
      expect(json).not.toContain('"type":"Buffer"');
      expect(json).not.toContain('"data"');
    });

    it('stays close to base64 size for a 1KB buffer (no per-byte blow-up)', () => {
      const json = serializeJson({ b: Buffer.alloc(1024, 7) });
      // base64 of 1024 bytes is 1368 chars; the old array form produced 2080+.
      expect(json.length).toBeLessThan(1500);
    });

    it('does NOT coerce a foreign {type:"Buffer"} object with non-numeric data', () => {
      const restored = deserializeJson<{ meta: unknown }>(
        '{"meta":{"type":"Buffer","data":["not","numbers"]}}'
      );
      expect(Buffer.isBuffer(restored.meta)).toBe(false);
      expect(restored.meta).toEqual({ type: 'Buffer', data: ['not', 'numbers'] });
    });

    it('does NOT coerce an object with out-of-range byte values', () => {
      const restored = deserializeJson<{ meta: unknown }>(
        '{"meta":{"type":"Buffer","data":[1,2,999]}}'
      );
      expect(Buffer.isBuffer(restored.meta)).toBe(false);
    });

    it('does NOT coerce an object carrying extra keys alongside type/data', () => {
      const restored = deserializeJson<{ meta: unknown }>(
        '{"meta":{"type":"Buffer","data":[1,2,3],"note":"foreign"}}'
      );
      expect(Buffer.isBuffer(restored.meta)).toBe(false);
    });

    it('still restores a legacy {type:"Buffer",data:[...]} snapshot (back-compat)', () => {
      // Snapshots written by the previous implementation must still load.
      const restored = deserializeJson<{ x: Buffer }>('{"x":{"type":"Buffer","data":[81,32,171]}}');
      expect(Buffer.isBuffer(restored.x)).toBe(true);
      expect(restored.x.toString('hex')).toBe('5120ab');
    });

    it('preserves a nested Buffer inside arrays and objects', () => {
      const original = {
        list: [Buffer.from([1, 2]), Buffer.from([3, 4])],
        nested: { deep: { b: Buffer.from('ff', 'hex') } },
      };
      const restored = deserializeJson<typeof original>(serializeJson(original));
      expect(restored.list.every(b => Buffer.isBuffer(b))).toBe(true);
      expect(restored.list[1].toString('hex')).toBe('0304');
      expect(restored.nested.deep.b.toString('hex')).toBe('ff');
    });

    it('preserves an empty Buffer as an empty Buffer', () => {
      const restored = deserializeJson<{ b: Buffer }>(serializeJson({ b: Buffer.alloc(0) }));
      expect(Buffer.isBuffer(restored.b)).toBe(true);
      expect(restored.b.length).toBe(0);
    });

    it('preserves a top-level bigint and a top-level Buffer', () => {
      // A bare value has no holder object; the replacer must not crash.
      expect(deserializeJson<bigint>(serializeJson(7n))).toBe(7n);
      const b = deserializeJson<Buffer>(serializeJson(Buffer.from('ab', 'hex')));
      expect(Buffer.isBuffer(b)).toBe(true);
      expect(b.toString('hex')).toBe('ab');
    });
  });
});