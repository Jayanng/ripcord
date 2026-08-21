export enum RipcordCode {
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  VTXO_ALREADY_SPENT = 'VTXO_ALREADY_SPENT',
  NOT_OWNER = 'NOT_OWNER',
  FEE_TOO_LOW = 'FEE_TOO_LOW',
  INVALID_FORMAT = 'INVALID_FORMAT',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  EXIT_IMMATURE = 'EXIT_IMMATURE',
  FUNDING_MISSING = 'FUNDING_MISSING',
  DAEMON_UNREACHABLE = 'DAEMON_UNREACHABLE',
  INVALID_CHAIN = 'INVALID_CHAIN',
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
  }
  return undefined;
}

function extractMessage(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === 'string') {
      return msg;
    }
  }
  return undefined;
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

  if (message) {
    const lower = message.toLowerCase();
    if (lower.includes('amount mismatch')) {
      return new RipcordError(
        RipcordCode.AMOUNT_MISMATCH,
        'Amount mismatch',
        { cause: err, hint: 'Check the amounts and fees on every input and output.' }
      );
    }
    if (lower.includes('non-bip68-final')) {
      return new RipcordError(
        RipcordCode.EXIT_IMMATURE,
        'Exit immature: non-BIP68-final',
        { cause: err, hint: 'Exit needs N more confirmations.' }
      );
    }
    if (lower.includes('bad-txns-inputs-missingorspent')) {
      return new RipcordError(
        RipcordCode.FUNDING_MISSING,
        'Funding missing or already spent',
        { cause: err }
      );
    }
  }

  return new RipcordError(RipcordCode.UNKNOWN, 'Unknown error', { cause: err });
}
