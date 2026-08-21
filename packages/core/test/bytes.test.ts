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
});