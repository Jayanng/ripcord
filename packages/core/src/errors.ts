export enum RipcordCode {
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  VTXO_ALREADY_SPENT = 'VTXO_ALREADY_SPENT',
  NOT_OWNER = 'NOT_OWNER',
  FEE_TOO_LOW = 'FEE_TOO_LOW',
  INVALID_FORMAT = 'INVALID_FORMAT',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  EXIT_IMMATURE = 'EXIT_IMMATURE',
  FUNDING_MISSING = 'FUNDING_MISSING',
  QUEUE_OVERFLOW = 'QUEUE_OVERFLOW',
  DAEMON_UNREACHABLE = 'DAEMON_UNREACHABLE',
  INVALID_CHAIN = 'INVALID_CHAIN',
  /** HTTP 404 from /tachi_tx?hat= or ?rip= : plain text `transaction not found`. */
  TX_NOT_FOUND = 'TX_NOT_FOUND',
  /** HTTP 502 from RIP: an epoch in [origin, final] is not yet closed. */
  CHAIN_GAP = 'CHAIN_GAP',
  UNKNOWN = 'UNKNOWN',
}

export class RipcordError extends Error {
  public readonly code: RipcordCode;
  public readonly cause?: unknown;
  public readonly hint?: string;
  public readonly daemonCode?: number;

  constructor(
    code: RipcordCode,
    message: string,
    options?: { cause?: unknown; hint?: string; daemonCode?: number }
  ) {
    super(message);
    this.name = 'RipcordError';
    this.code = code;
    this.cause = options?.cause;
    this.hint = options?.hint;
    this.daemonCode = options?.daemonCode;
    Object.setPrototypeOf(this, RipcordError.prototype);
  }
}

function extractCode(err: unknown): number | undefined {
  // Live-probed 2026-08-22: a real daemon rejection (broadcastVtxoToTachiMempool
  // with invalid bytes) throws VtxoBroadcastError whose .code is the string
  // "VTXO_BROADCAST"; the real CometBFT code sits in .tendermintCode. Numeric
  // .code appears only on plain response objects, never on SDK error classes.
  if (err && typeof err === 'object') {
    const asObj = err as Record<string, unknown>;
    if (typeof asObj.tendermintCode === 'number') {
      return asObj.tendermintCode;
    }
    if (typeof asObj.code === 'number') {
      return asObj.code;
    }
    // Bitcoin JSON-RPC proxy envelope: { error: { code: -26, message: "..." } }.
    // Codes are negative and cannot collide with the CometBFT map.
    const nested = asObj.error;
    if (nested && typeof nested === 'object') {
      const nestedCode = (nested as Record<string, unknown>).code;
      if (typeof nestedCode === 'number') {
        return nestedCode;
      }
    }
  }
  return undefined;
}

/**
 * Collect every field that can carry a human-readable rejection reason.
 *
 * AUDIT FIX (2026-08-23): this used to read `message` only, which meant none of
 * the text-based mappings below ever fired against a real daemon response. The
 * SDK's own types are explicit about where the reason actually lives:
 *
 *   - `TachiTxCommitStatus` (what `waitForTachiTxCommit` resolves to) is
 *     `{ code, log, found, ... }`. The docs call `log` "the rejection reason
 *     when code is non-zero". There is no `message` field at all.
 *   - `VtxoBroadcastError` carries `tendermintLog` alongside `tendermintCode`.
 *   - The Bitcoin JSON-RPC proxy nests its reason at `error.message`.
 *
 * `amount mismatch` in particular has NO numeric code (docs §17 lists it with a
 * blank code column), so text is the only signal, and it was being missed.
 * Every candidate is joined so a match in any one of them is found.
 */
function extractMessage(err: unknown): string | undefined {
  if (typeof err === 'string') {
    return err;
  }
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const asObj = err as Record<string, unknown>;
  const parts: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) {
      parts.push(value);
    }
  };

  if (err instanceof Error) {
    push(err.message);
  } else {
    push(asObj.message);
  }
  push(asObj.log);
  push(asObj.tendermintLog);
  push(asObj.tendermintTxLog);
  push(asObj.reason);

  const nested = asObj.error;
  if (nested && typeof nested === 'object') {
    push((nested as Record<string, unknown>).message);
  } else {
    push(nested);
  }

  return parts.length > 0 ? parts.join(' | ') : undefined;
}

interface DaemonCodeMapping {
  code: RipcordCode;
  message: string;
  hint: string;
}

const CODE_MAP: Record<number, DaemonCodeMapping> = {
  3: {
    code: RipcordCode.INVALID_SIGNATURE,
    message: 'Invalid signature',
    hint: 'Signature rejected. Re-derive the signer.',
  },
  5: {
    code: RipcordCode.VTXO_ALREADY_SPENT,
    message: 'VTXO already spent',
    hint: 'Those funds were already spent. Refreshing.',
  },
  6: {
    code: RipcordCode.NOT_OWNER,
    message: 'Not the owner of this VTXO',
    hint: 'This balance belongs to a different key.',
  },
  8: {
    code: RipcordCode.FEE_TOO_LOW,
    message: 'Fee too low',
    hint: 'Minimum fee is 1 sat.',
  },
  12: {
    code: RipcordCode.INVALID_FORMAT,
    message: 'Invalid transaction format',
    hint: 'Transaction structure rejected.',
  },
};

export function mapDaemonError(err: unknown): RipcordError {
  if (err instanceof RipcordError) {
    return err;
  }

  const code = extractCode(err);
  const message = extractMessage(err);

  if (code !== undefined) {
    const mapped = CODE_MAP[code];
    if (mapped) {
      return new RipcordError(mapped.code, mapped.message, {
        cause: err,
        hint: mapped.hint,
        daemonCode: code,
      });
    }
  }

  // AUDIT FIX (2026-08-23): the text-based branches below used to drop the
  // numeric code, so a rejection carrying both (e.g. a commit status with
  // `code: 7` and `log: "amount mismatch: …"`) lost the code entirely and the
  // caller could not tell an unmapped daemon code from a client-side failure.
  // `daemonCode` is now threaded through every mapping.
  const daemonCode = code !== undefined ? { daemonCode: code } : {};

  if (message) {
    const lower = message.toLowerCase();
    if (lower.includes('amount mismatch')) {
      return new RipcordError(
        RipcordCode.AMOUNT_MISMATCH,
        'Amount mismatch',
        { cause: err, hint: 'Check the amounts and fees on every input and output.', ...daemonCode }
      );
    }
    if (lower.includes('non-bip68-final')) {
      return new RipcordError(
        RipcordCode.EXIT_IMMATURE,
        'Exit immature: non-BIP68-final',
        { cause: err, hint: 'Exit needs N more confirmations.', ...daemonCode }
      );
    }
    if (lower.includes('bad-txns-inputs-missingorspent')) {
      return new RipcordError(
        RipcordCode.FUNDING_MISSING,
        'Funding missing or already spent',
        { cause: err, ...daemonCode }
      );
    }
  }

  return new RipcordError(
    RipcordCode.UNKNOWN,
    // AUDIT FIX (2026-08-23): this used to be the bare string 'Unknown error',
    // which discarded the daemon's own text from `.message` entirely (it
    // survived only inside `.cause`). `03-DESIGN-SYSTEM.md` requires the raw
    // daemon message to stay available for the error "details" disclosure, and
    // an unmapped rejection is exactly the case where a human needs it.
    message ? `Unknown error: ${message}` : 'Unknown error',
    { cause: err, ...daemonCode }
  );
}
