import { describe, it, expect } from 'vitest';
import {
  RipcordCode,
  RipcordError,
  mapDaemonError,
} from '../src/errors.js';

describe('RipcordCode', () => {
  it('contains all required error codes', () => {
    expect(RipcordCode.INVALID_SIGNATURE).toBe('INVALID_SIGNATURE');
    expect(RipcordCode.VTXO_ALREADY_SPENT).toBe('VTXO_ALREADY_SPENT');
    expect(RipcordCode.NOT_OWNER).toBe('NOT_OWNER');
    expect(RipcordCode.FEE_TOO_LOW).toBe('FEE_TOO_LOW');
    expect(RipcordCode.INVALID_FORMAT).toBe('INVALID_FORMAT');
    expect(RipcordCode.AMOUNT_MISMATCH).toBe('AMOUNT_MISMATCH');
    expect(RipcordCode.EXIT_IMMATURE).toBe('EXIT_IMMATURE');
    expect(RipcordCode.FUNDING_MISSING).toBe('FUNDING_MISSING');
    expect(RipcordCode.DAEMON_UNREACHABLE).toBe('DAEMON_UNREACHABLE');
    expect(RipcordCode.INVALID_CHAIN).toBe('INVALID_CHAIN');
    expect(RipcordCode.UNKNOWN).toBe('UNKNOWN');
  });
});

describe('RipcordError', () => {
  it('extends Error and has all required fields', () => {
    const err = new RipcordError(
      RipcordCode.INVALID_SIGNATURE,
      'Test error',
      { cause: 'original', hint: 'Try again', daemonCode: 3 }
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RipcordError);
    expect(err.name).toBe('RipcordError');
    expect(err.code).toBe(RipcordCode.INVALID_SIGNATURE);
    expect(err.message).toBe('Test error');
    expect(err.cause).toBe('original');
    expect(err.hint).toBe('Try again');
    expect(err.daemonCode).toBe(3);
  });

  it('works without optional fields', () => {
    const err = new RipcordError(RipcordCode.UNKNOWN, 'Simple error');

    expect(err.code).toBe(RipcordCode.UNKNOWN);
    expect(err.message).toBe('Simple error');
    expect(err.cause).toBeUndefined();
    expect(err.hint).toBeUndefined();
    expect(err.daemonCode).toBeUndefined();
  });
});

describe('mapDaemonError', () => {
  describe('maps CometBFT numeric codes', () => {
    it('maps code 3 to INVALID_SIGNATURE', () => {
      const err = mapDaemonError({ code: 3, message: 'invalid signature' });
      expect(err.code).toBe(RipcordCode.INVALID_SIGNATURE);
      expect(err.hint).toBe('Signature rejected. Re-derive the signer.');
      expect(err.daemonCode).toBe(3);
    });

    it('maps code 5 to VTXO_ALREADY_SPENT', () => {
      const err = mapDaemonError({ code: 5, message: 'vtxo already spent' });
      expect(err.code).toBe(RipcordCode.VTXO_ALREADY_SPENT);
      expect(err.hint).toBe('Those funds were already spent. Refreshing.');
      expect(err.daemonCode).toBe(5);
    });

    it('maps code 6 to NOT_OWNER', () => {
      const err = mapDaemonError({ code: 6, message: 'unauthorized: pubkey does not own vtxo' });
      expect(err.code).toBe(RipcordCode.NOT_OWNER);
      expect(err.hint).toBe('This balance belongs to a different key.');
      expect(err.daemonCode).toBe(6);
    });

    it('maps code 8 to FEE_TOO_LOW', () => {
      const err = mapDaemonError({ code: 8, message: 'fee below minimum' });
      expect(err.code).toBe(RipcordCode.FEE_TOO_LOW);
      expect(err.hint).toBe('Minimum fee is 1 sat.');
      expect(err.daemonCode).toBe(8);
    });

    it('maps code 12 to INVALID_FORMAT', () => {
      const err = mapDaemonError({ code: 12, message: 'invalid transaction format' });
      expect(err.code).toBe(RipcordCode.INVALID_FORMAT);
      expect(err.hint).toBe('Transaction structure rejected.');
      expect(err.daemonCode).toBe(12);
    });
  });

  describe('maps error messages', () => {
    it('maps "amount mismatch" to AMOUNT_MISMATCH', () => {
      const err = mapDaemonError(new Error('amount mismatch: sum(inputs)=12000 sum(outputs)=501000 fee=1'));
      expect(err.code).toBe(RipcordCode.AMOUNT_MISMATCH);
    });

    it('maps "amount mismatch" case-insensitively', () => {
      const err = mapDaemonError({ message: 'AMOUNT MISMATCH detected' });
      expect(err.code).toBe(RipcordCode.AMOUNT_MISMATCH);
    });

    it('maps "non-BIP68-final" to EXIT_IMMATURE', () => {
      const err = mapDaemonError(new Error('bitcoin rpc error -26: non-BIP68-final'));
      expect(err.code).toBe(RipcordCode.EXIT_IMMATURE);
      expect(err.hint).toBe('Exit needs N more confirmations.');
    });

    it('maps "non-BIP68-final" case-insensitively', () => {
      const err = mapDaemonError({ message: 'NON-BIP68-FINAL error' });
      expect(err.code).toBe(RipcordCode.EXIT_IMMATURE);
    });

    it('maps "bad-txns-inputs-missingorspent" to FUNDING_MISSING', () => {
      const err = mapDaemonError(new Error('bad-txns-inputs-missingorspent'));
      expect(err.code).toBe(RipcordCode.FUNDING_MISSING);
    });

    it('maps "bad-txns-inputs-missingorspent" case-insensitively', () => {
      const err = mapDaemonError({ message: 'BAD-TXNS-INPUTS-MISSINGORSPENT' });
      expect(err.code).toBe(RipcordCode.FUNDING_MISSING);
    });
  });

  describe('handles various input types', () => {
    it('accepts raw daemon response object', () => {
      const err = mapDaemonError({ code: 3, log: 'invalid signature' });
      expect(err.code).toBe(RipcordCode.INVALID_SIGNATURE);
    });

    it('accepts thrown Error', () => {
      const err = mapDaemonError(new Error('non-BIP68-final'));
      expect(err.code).toBe(RipcordCode.EXIT_IMMATURE);
    });

    it('accepts plain string', () => {
      const err = mapDaemonError('amount mismatch detected');
      expect(err.code).toBe(RipcordCode.AMOUNT_MISMATCH);
    });

    it('accepts object with message property', () => {
      const err = mapDaemonError({ message: 'bad-txns-inputs-missingorspent', code: 0 });
      expect(err.code).toBe(RipcordCode.FUNDING_MISSING);
    });
  });

  describe('round-trip: RipcordError passes through unchanged', () => {
    it('returns the same RipcordError instance', () => {
      const original = new RipcordError(
        RipcordCode.INVALID_SIGNATURE,
        'Test',
        { cause: 'orig', hint: 'hint', daemonCode: 3 }
      );
      const mapped = mapDaemonError(original);
      expect(mapped).toBe(original);
    });

    it('preserves all fields on round-trip', () => {
      const original = new RipcordError(
        RipcordCode.FEE_TOO_LOW,
        'Fee too low',
        { cause: { code: 8 }, hint: 'Minimum fee is 1 sat.', daemonCode: 8 }
      );
      const mapped = mapDaemonError(original);
      expect(mapped.code).toBe(RipcordCode.FEE_TOO_LOW);
      expect(mapped.message).toBe('Fee too low');
      expect(mapped.cause).toEqual({ code: 8 });
      expect(mapped.hint).toBe('Minimum fee is 1 sat.');
      expect(mapped.daemonCode).toBe(8);
    });
  });

  describe('falls back to UNKNOWN', () => {
    it('returns UNKNOWN for unrecognized code', () => {
      const err = mapDaemonError({ code: 999, message: 'weird error' });
      expect(err.code).toBe(RipcordCode.UNKNOWN);
    });

    it('returns UNKNOWN for unrecognized message', () => {
      const err = mapDaemonError(new Error('something completely different'));
      expect(err.code).toBe(RipcordCode.UNKNOWN);
    });

    it('returns UNKNOWN for null/undefined', () => {
      expect(mapDaemonError(null).code).toBe(RipcordCode.UNKNOWN);
      expect(mapDaemonError(undefined).code).toBe(RipcordCode.UNKNOWN);
    });
  });
});