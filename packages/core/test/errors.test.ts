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
    expect(RipcordCode.TX_NOT_FOUND).toBe('TX_NOT_FOUND');
    expect(RipcordCode.CHAIN_GAP).toBe('CHAIN_GAP');
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

  describe('real SDK error shapes (live-probed 2026-08-22)', () => {
    // A real daemon rejection arrives as VtxoBroadcastError with a STRING .code
    // ("VTXO_BROADCAST") and the real CometBFT code in .tendermintCode.
    const realRejection = Object.assign(new Error('tachi mempool rejected VTXO (code=5): vtxo already spent'), {
      code: 'VTXO_BROADCAST',
      tendermintCode: 5,
      tendermintLog: 'vtxo already spent',
    });

    it('reads tendermintCode from a real VtxoBroadcastError shape', () => {
      const err = mapDaemonError(realRejection);
      expect(err.code).toBe(RipcordCode.VTXO_ALREADY_SPENT);
      expect(err.daemonCode).toBe(5);
    });

    it('prefers tendermintCode when both tendermintCode and a string .code exist', () => {
      // The dangerous case: string .code is ignored, real code wins.
      const shape = Object.assign(new Error('mempool rejected (code=12)'), {
        code: 'VTXO_BROADCAST',
        tendermintCode: 12,
      });
      const err = mapDaemonError(shape);
      expect(err.code).toBe(RipcordCode.INVALID_FORMAT);
      expect(err.daemonCode).toBe(12);
    });

    it('still maps plain response objects with numeric code (legacy shape)', () => {
      const err = mapDaemonError({ code: 3, log: 'invalid signature' });
      expect(err.code).toBe(RipcordCode.INVALID_SIGNATURE);
      expect(err.daemonCode).toBe(3);
    });

    it('unmapped tendermintCode falls through to UNKNOWN but keeps daemonCode', () => {
      // Live probe 2026-08-22: code=1 'failed to decode transaction: read input 0
      // vtxoid: unexpected EOF' from broadcastVtxoToTachiMempool(garbage).
      // AUDIT FIX 2026-08-23: daemonCode used to be dropped here, so a caller
      // could not tell an unmapped daemon rejection from a client-side failure.
      const shape = Object.assign(
        new Error('tachi mempool rejected VTXO (code=1): failed to decode transaction'),
        { code: 'VTXO_BROADCAST', tendermintCode: 1 }
      );
      const err = mapDaemonError(shape);
      expect(err.code).toBe(RipcordCode.UNKNOWN);
      expect(err.daemonCode).toBe(1);
    });
  });

  /**
   * AUDIT (2026-08-23). The suite above only ever fed `mapDaemonError` objects
   * with a `message` field, but the real daemon does not use one:
   *
   *   - `waitForTachiTxCommit` resolves `TachiTxCommitStatus` = `{ code, log,
   *     found, … }`. The SDK's own docs call `log` "the rejection reason when
   *     code is non-zero". There is no `message`.
   *   - `VtxoBroadcastError` puts the reason in `tendermintLog`.
   *   - The Bitcoin JSON-RPC proxy nests it at `error.message`.
   *
   * With a message-only extractor, every text-based mapping silently failed in
   * production while passing here. `amount mismatch` is the worst case: docs §17
   * lists it with NO numeric code, so text is the only signal it exists.
   */
  describe('real daemon field shapes (audit 2026-08-23)', () => {
    it('maps "amount mismatch" from a commit status .log (no message field)', () => {
      const commitStatus = {
        code: 7,
        log: 'amount mismatch: sum(inputs)=12000 sum(outputs)=501000 fee=1',
        found: true,
      };
      const err = mapDaemonError(commitStatus);
      expect(err.code).toBe(RipcordCode.AMOUNT_MISMATCH);
      expect(err.daemonCode).toBe(7);
    });

    it('maps "non-BIP68-final" from .log', () => {
      const err = mapDaemonError({ code: 26, log: 'bitcoin rpc error -26: non-BIP68-final', found: true });
      expect(err.code).toBe(RipcordCode.EXIT_IMMATURE);
    });

    it('maps "bad-txns-inputs-missingorspent" from .log', () => {
      const err = mapDaemonError({ code: 1, log: 'bad-txns-inputs-missingorspent', found: true });
      expect(err.code).toBe(RipcordCode.FUNDING_MISSING);
    });

    it('maps text from tendermintLog when tendermintCode is unmapped', () => {
      const shape = Object.assign(new Error('tachi mempool rejected VTXO (code=99)'), {
        code: 'VTXO_BROADCAST',
        tendermintCode: 99,
        tendermintLog: 'amount mismatch: sum(inputs)=1 sum(outputs)=2 fee=1',
      });
      const err = mapDaemonError(shape);
      expect(err.code).toBe(RipcordCode.AMOUNT_MISMATCH);
      expect(err.daemonCode).toBe(99);
    });

    it('maps a nested Bitcoin JSON-RPC proxy error envelope', () => {
      // The proxy returns { result: null, error: { code: -26, message: "..." } }.
      const rpcEnvelope = { result: null, error: { code: -26, message: 'non-BIP68-final' } };
      const err = mapDaemonError(rpcEnvelope);
      expect(err.code).toBe(RipcordCode.EXIT_IMMATURE);
      expect(err.daemonCode).toBe(-26);
    });

    it('a negative RPC code cannot collide with the CometBFT code map', () => {
      // -3 must NOT be read as CometBFT 3 (INVALID_SIGNATURE).
      const err = mapDaemonError({ error: { code: -3, message: 'some rpc failure' } });
      expect(err.code).toBe(RipcordCode.UNKNOWN);
      expect(err.daemonCode).toBe(-3);
    });

    it('prefers a mapped numeric code over conflicting text', () => {
      // code 5 is authoritative even though the log mentions a different failure.
      const err = mapDaemonError({ code: 5, log: 'amount mismatch: whatever' });
      expect(err.code).toBe(RipcordCode.VTXO_ALREADY_SPENT);
      expect(err.daemonCode).toBe(5);
    });

    it('still returns UNKNOWN when no field carries a recognizable reason', () => {
      const err = mapDaemonError({ code: 999, log: '', found: true });
      expect(err.code).toBe(RipcordCode.UNKNOWN);
      expect(err.daemonCode).toBe(999);
    });

    it('preserves the raw daemon text in the UNKNOWN message', () => {
      // AUDIT FIX 2026-08-23: the message used to be the bare 'Unknown error',
      // discarding the daemon's own text (it survived only inside .cause).
      // 03-DESIGN-SYSTEM.md requires the raw message for the error details
      // disclosure, and an unmapped rejection is exactly when a human needs it.
      const err = mapDaemonError({ code: 42, log: 'validator set rotated mid-block' });
      expect(err.code).toBe(RipcordCode.UNKNOWN);
      expect(err.message).toContain('validator set rotated mid-block');
    });

    it('falls back to a bare message when there is no daemon text at all', () => {
      const err = mapDaemonError({});
      expect(err.code).toBe(RipcordCode.UNKNOWN);
      expect(err.message).toBe('Unknown error');
    });
  });
});