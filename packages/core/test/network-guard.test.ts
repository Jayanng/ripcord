/**
 * Pure tests for the network guard + networkOf normalization (audit N3,
 * 2026-10-14): no daemon, no keys — decision logic only.
 */
import { describe, expect, it } from 'vitest';
import { assertSameNetwork } from '../src/types.js';
import { networkOf, DEFAULT_NETWORK } from '../src/networks.js';

describe('networkOf normalization', () => {
  it('legacy artifacts (undefined) normalize to the default network', () => {
    expect(networkOf(undefined)).toBe(DEFAULT_NETWORK);
    expect(networkOf({})).toBe(DEFAULT_NETWORK);
  });
  it('passes known networks through', () => {
    expect(networkOf({ network: 'signet' })).toBe('signet');
    expect(networkOf({ network: 'regtest' })).toBe('regtest');
  });
});

describe('assertSameNetwork', () => {
  it('legacy + legacy passes (both normalize to regtest)', () => {
    expect(() => assertSameNetwork({}, {})).not.toThrow();
    expect(() => assertSameNetwork(undefined, undefined)).not.toThrow();
  });
  it('same network passes', () => {
    expect(() => assertSameNetwork({ network: 'signet' }, { network: 'signet' })).not.toThrow();
  });
  it('mismatched pair throws (the assess/execute divergence class)', () => {
    expect(() => assertSameNetwork({ network: 'signet' }, { network: 'regtest' })).toThrowError(/mismatch/i);
    expect(() => assertSameNetwork({ network: 'signet' }, {})).toThrowError(/mismatch/i);
  });
  it('an unknown network string must not silently normalize to regtest (audit N3)', () => {
    expect(() => assertSameNetwork({ network: 'Signet' }, { network: 'Signet' })).toThrowError(/Unknown network/i);
    expect(() => assertSameNetwork({ network: 'mainnet' }, {})).toThrowError(/Unknown network/i);
  });
});
