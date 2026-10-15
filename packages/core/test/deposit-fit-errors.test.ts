/**
 * Pure tests for the insufficient-funds classifier that drives the fit-down
 * retry. Shape contract verified against the real SDK (2026-10-16):
 * @tachibtc/taurus-wallet-aggregator InsufficientFundsError carries bigint
 * `available`/`required` fields and message "Insufficient funds: available X
 * sats, required Y sats"; @tachibtc/taurus-vault-core wraps it as
 * VaultDepositError("deposit failed: ...", { cause }) and VaultError passes
 * options through to Error, so .cause survives. Classifier must match on
 * message AND fields on the same node (fail closed), and walk the chain.
 */
import { describe, expect, it } from 'vitest';
import { fitDepositToAvailable, readInsufficientFunds } from '../src/deposit.js';

class FakeInsufficient extends Error {
  available: bigint;
  required: bigint;
  constructor(available: bigint, required: bigint) {
    super(`Insufficient funds: available ${available} sats, required ${required} sats`);
    this.name = 'InsufficientFundsError';
    this.available = available;
    this.required = required;
  }
}

class FakeWrap extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
  }
}

describe('readInsufficientFunds', () => {
  it('reads a bare SDK error (message + bigint fields on the same node)', () => {
    expect(readInsufficientFunds(new FakeInsufficient(40_000n, 40_282n))).toEqual({
      available: 40_000n,
      required: 40_282n,
    });
  });

  it('walks the vault-core wrapper chain ("deposit failed: ..." with cause)', () => {
    // The exact live failure from the 40k/40,282 signet case.
    const wrapped = new FakeWrap('deposit failed: Insufficient funds: available 40000 sats, required 40282 sats', {
      cause: new FakeInsufficient(40_000n, 40_282n),
    });
    expect(readInsufficientFunds(wrapped)).toEqual({ available: 40_000n, required: 40_282n });
  });

  it('walks nested wrappers (message-only outer, fields two levels down)', () => {
    const inner = new FakeInsufficient(10_000n, 10_282n);
    const middle = new FakeWrap('deposit failed: Insufficient funds: available 10000 sats, required 10282 sats', { cause: inner });
    const outer = new FakeWrap('funding step failed', { cause: middle });
    expect(readInsufficientFunds(outer)).toEqual({ available: 10_000n, required: 10_282n });
  });

  it('accepts number fields (finite) and normalizes to bigint', () => {
    const err = new Error('Insufficient funds: available 5000 sats, required 5282 sats') as Error & {
      available?: unknown;
      required?: unknown;
    };
    err.available = 5000;
    err.required = 5282;
    expect(readInsufficientFunds(err)).toEqual({ available: 5_000n, required: 5_282n });
  });

  it('fails closed: message match without fields is not enough', () => {
    expect(readInsufficientFunds(new Error('Insufficient funds: available 40000 sats, required 40282 sats'))).toBeNull();
  });

  it('fails closed: fields without the message are not enough', () => {
    const err = new Error('something else went wrong') as Error & { available?: unknown; required?: unknown };
    err.available = 40_000n;
    err.required = 40_282n;
    expect(readInsufficientFunds(err)).toBeNull();
  });

  it('fails closed: non-Error values, null, and non-numeric fields', () => {
    expect(readInsufficientFunds(null)).toBeNull();
    expect(readInsufficientFunds('Insufficient funds: available 1 sats, required 2 sats')).toBeNull();
    const err = new Error('Insufficient funds') as Error & { available?: unknown; required?: unknown };
    err.available = 'forty thousand';
    err.required = 40_282n;
    expect(readInsufficientFunds(err)).toBeNull();
  });

  it('binds fit-down to the classifier output end to end (the live 40k case)', () => {
    const funds = readInsufficientFunds(
      new FakeWrap('deposit failed: Insufficient funds: available 40000 sats, required 40282 sats', {
        cause: new FakeInsufficient(40_000n, 40_282n),
      }),
    );
    expect(funds).not.toBeNull();
    expect(fitDepositToAvailable(funds!.available, 40_000n, funds!.required)).toBe(39_718n);
  });
});
