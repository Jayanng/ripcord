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
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as Record<string, unknown>).code;
    if (typeof code === 'number') {
      return code;
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

export function mapDaemonError(err: unknown): RipcordError {
  if (err instanceof RipcordError) {
    return err;
  }

  const code = extractCode(err);
  const message = extractMessage(err);

  if (code === 3) {
    return new RipcordError(
      RipcordCode.INVALID_SIGNATURE,
      'Invalid signature',
      { cause: err, hint: 'Signature rejected. Re-derive the signer.', daemonCode: code }
    );
  }
  if (code === 5) {
    return new RipcordError(
      RipcordCode.VTXO_ALREADY_SPENT,
      'VTXO already spent',
      { cause: err, hint: 'Those funds were already spent. Refreshing.', daemonCode: code }
    );
  }
  if (code === 6) {
    return new RipcordError(
      RipcordCode.NOT_OWNER,
      'Not the owner of this VTXO',
      { cause: err, hint: 'This balance belongs to a different key.', daemonCode: code }
    );
  }
  if (code === 8) {
    return new RipcordError(
      RipcordCode.FEE_TOO_LOW,
      'Fee too low',
      { cause: err, hint: 'Minimum fee is 1 sat.', daemonCode: code }
    );
  }
  if (code === 12) {
    return new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Invalid transaction format',
      { cause: err, hint: 'Transaction structure rejected.', daemonCode: code }
    );
  }

  if (message) {
    const lower = message.toLowerCase();
    if (lower.includes('amount mismatch')) {
      return new RipcordError(
        RipcordCode.AMOUNT_MISMATCH,
        'Amount mismatch',
        { cause: err, hint: undefined }
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
        { cause: err, hint: undefined }
      );
    }
  }

  return new RipcordError(RipcordCode.UNKNOWN, 'Unknown error', { cause: err });
}