/**
 * HAT and RIP proof fetchers, plus HAT-in-RIP Verkle inclusion linking.
 *
 * Live-probed 2026-08-22 against daemon v0.39.0 (`scratch/probe-proofs.mjs`,
 * `scratch/probe-rip.mjs`) and re-asserted against the three committed
 * transfers documented in `docs/01-VERIFIED-API.md` §16:
 *
 *   FB650479…1095 @ epoch 437326  suffix 148 (0x94)
 *   D501919D…0476 @ epoch 437172  suffix 204 (0xcc)
 *   F5BD7D7F…E749 @ epoch 437193  suffix 250 (0xfa)
 *
 * Scope, stated plainly:
 *   - This is an INCLUSION proof: the daemon's HAT value appears in the
 *     daemon's Verkle StateDiff after hex normalization. It is NOT a local
 *     recomputation of the HAT commitment. `rip.PSBTPayload` is null on
 *     every sampled regtest proof, so SHA256d(payload) cannot be checked.
 *   - Origin.Proof / ipaProof is carried as daemon-attested evidence. This
 *     module does not verify Verkle or IPA cryptography client-side.
 *   - There is no L1 anchoring on the sampled proofs (`btc_height` 0,
 *     `BTCHeight` 0, `epoch.bitcoin_block_height` null).
 *
 * Transport: raw `fetch` of `/tachi_tx`. The SDK wrapper also works if the
 * options are camelCase (`originEpoch` / `finalEpoch`); snake_case is
 * silently dropped and the daemon 400s. Raw fetch keeps this file free of
 * an SDK client dependency. Error bodies on these routes are PLAIN TEXT
 * (not JSON) and use real HTTP status codes: 404, 400, 502.
 */

import { RipcordCode, RipcordError } from './errors.js';
import type { PaymentReceipt, XOnlyHex } from './types.js';

const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;
const HEX_RE = /^[0-9a-f]+$/;
const BARE_PROOF_LEN = 64;
const MAX_RIP_WINDOW = 256;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export interface HatProof {
  readonly vtxoId: string;
  /** Bare lowercase hex, 64 chars, no 0x. */
  readonly proof: string;
  readonly btcHeight: number;
  readonly btcTimestamp: number;
}

export interface RipSuffixDiff {
  readonly suffix: number;
  /** 0x-prefixed hex, 32 bytes. */
  readonly currentValue: string;
  readonly newValue?: string;
}

export interface RipStateDiff {
  /** 0x-prefixed hex, 31 bytes. */
  readonly stem: string;
  readonly suffixDiffs: readonly RipSuffixDiff[];
}

/**
 * Daemon-attested IPA payload. Carried for display as evidence.
 * NOT verified client-side.
 */
export interface DaemonIpaProof {
  readonly cl: readonly string[];
  readonly cr: readonly string[];
  readonly finalEvaluation: string;
}

/**
 * Daemon-attested Verkle proof envelope. Carried for display as evidence.
 * NOT verified client-side.
 */
export interface DaemonOriginProof {
  readonly otherStems: unknown;
  readonly depthExtensionPresent: boolean;
  readonly commitmentsByPath: readonly string[];
  readonly d: string;
  readonly ipaProof: DaemonIpaProof;
}

export interface RipProof {
  readonly originEpoch: number;
  readonly finalEpoch: number;
  readonly chainLength: number;
  readonly finalRoot: string;
  readonly originRoot: string;
  readonly originCommitment: string;
  readonly stateDiff: readonly RipStateDiff[];
  /** Origin.Keys entries, each base64 of a 32-byte Verkle key. */
  readonly keys: readonly string[];
  readonly vtxoId: string;
  readonly psbtPayloadPresent: boolean;
  readonly btcHeight: number;
  readonly btcTimestamp: number;
  /** Daemon-attested IPA/Verkle proof. Not locally verified. */
  readonly originProof: DaemonOriginProof;
}

export interface HatRipLink {
  readonly verified: boolean;
  readonly stem: string;
  readonly suffix: number;
  readonly matchedValue: string;
  readonly keyIdentityHolds: boolean;
  readonly reason?: string;
}

export interface ProofFetchOpts {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}

export interface RipFetchOpts extends ProofFetchOpts {
  /** Inclusive epoch span beyond origin. Default 0 (self-proof). Never 50. */
  readonly window?: number;
  /**
   * When true (default), clamp `final_epoch` to the newest `status: "closed"`
   * epoch from `/tachi_listEpochs` so a large window on a fresh transfer does
   * not 502. Set false to send the requested window unmodified (used to
   * surface the chain-gap error).
   */
  readonly clamp?: boolean;
}

export interface BuildReceiptParams {
  readonly txHash: string;
  readonly epoch: number;
  readonly code: number;
  readonly fromXOnly: XOnlyHex | string;
  readonly toXOnly: XOnlyHex | string;
  readonly amountSats: bigint;
  readonly feeSats: bigint;
  readonly baseUrl: string;
  readonly window?: number;
  readonly timeoutMs?: number;
}

/** Strip a 0x prefix (any case) and lowercase. Does not validate length. */
export function normalizeProofHex(value: string): string {
  return value.replace(/^0x/i, '').toLowerCase();
}

function isBareProofHex(value: string): boolean {
  return value.length === BARE_PROOF_LEN && HEX_RE.test(value);
}

function requireTxHash(txHash: string): string {
  if (!TX_HASH_RE.test(txHash)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `txHash must be a 64-character hex string, got length ${txHash.length}`,
      { hint: 'Use the committed Tachi tx hash from waitForTachiTxCommit' },
    );
  }
  return txHash;
}

function requireEpoch(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `${label} must be a non-negative integer, got ${value}`,
    );
  }
  return value;
}

function trimBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'baseUrl is required',
    );
  }
  return baseUrl.replace(/\/+$/, '');
}

function jsonBytesToHex(value: unknown, field: string): string {
  if (!Array.isArray(value)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `${field} must be a JSON byte array, got ${typeof value}`,
    );
  }
  if (!value.every(b => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `${field} contains a non-byte value`,
    );
  }
  return Buffer.from(value as number[]).toString('hex');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `${label} is missing or not an object`,
    );
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `${label} must be a finite number`,
    );
  }
  return value;
}

function mapProofHttpError(status: number, body: string): RipcordError {
  const text = body.trim();
  const lower = text.toLowerCase();

  if (status === 404) {
    return new RipcordError(
      RipcordCode.TX_NOT_FOUND,
      text || 'transaction not found',
      { hint: 'The daemon has no transaction for this hash.' },
    );
  }

  if (status === 502 && (lower.includes('not closed') || lower.includes('chain gap'))) {
    return new RipcordError(
      RipcordCode.CHAIN_GAP,
      text || 'RIP chain gap: an epoch in the requested window is not closed',
      {
        hint: 'Use window 0 (self-proof) or clamp final_epoch to the newest closed epoch.',
      },
    );
  }

  if (status === 400) {
    return new RipcordError(
      RipcordCode.INVALID_FORMAT,
      text || 'RIP request rejected',
      { hint: 'RIP requires origin_epoch and final_epoch; the window cannot exceed 256 epochs.' },
    );
  }

  return new RipcordError(
    RipcordCode.UNKNOWN,
    text ? `Proof fetch failed (HTTP ${status}): ${text}` : `Proof fetch failed (HTTP ${status})`,
  );
}

async function daemonGet(
  baseUrl: string,
  pathAndQuery: string,
  timeoutMs: number,
): Promise<{ status: number; text: string; json: unknown }> {
  const url = `${trimBaseUrl(baseUrl)}${pathAndQuery}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (err) {
    throw new RipcordError(
      RipcordCode.DAEMON_UNREACHABLE,
      `Proof request failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err, hint: 'Check the daemon URL and network path.' },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw mapProofHttpError(response.status, text);
  }

  try {
    return { status: response.status, text, json: JSON.parse(text) as unknown };
  } catch (err) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Daemon returned HTTP 200 with a non-JSON proof body',
      { cause: err },
    );
  }
}

function parseHat(json: unknown): HatProof {
  const body = asRecord(json, 'HAT response');
  const hat = asRecord(body.hat, 'hat');
  const proof = normalizeProofHex(asString(hat.proof, 'hat.proof'));
  if (!isBareProofHex(proof)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `hat.proof must be 64-character hex, got length ${proof.length}`,
    );
  }
  return {
    vtxoId: asString(hat.vtxo_id, 'hat.vtxo_id').toLowerCase(),
    proof,
    btcHeight: asNumber(hat.btc_height, 'hat.btc_height'),
    btcTimestamp: asNumber(hat.btc_timestamp, 'hat.btc_timestamp'),
  };
}

function parseSuffixDiff(value: unknown, index: number): RipSuffixDiff {
  const row = asRecord(value, `suffixDiffs[${index}]`);
  const parsed: RipSuffixDiff = {
    suffix: asNumber(row.suffix, `suffixDiffs[${index}].suffix`),
    currentValue: asString(row.currentValue, `suffixDiffs[${index}].currentValue`),
  };
  if (typeof row.newValue === 'string') {
    return { ...parsed, newValue: row.newValue };
  }
  return parsed;
}

function parseStateDiff(value: unknown): RipStateDiff[] {
  if (!Array.isArray(value)) {
    throw new RipcordError(RipcordCode.INVALID_FORMAT, 'Origin.StateDiff must be an array');
  }
  return value.map((entry, i) => {
    const row = asRecord(entry, `StateDiff[${i}]`);
    if (!Array.isArray(row.suffixDiffs)) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `StateDiff[${i}].suffixDiffs must be an array`,
      );
    }
    return {
      stem: asString(row.stem, `StateDiff[${i}].stem`),
      suffixDiffs: row.suffixDiffs.map((s, j) => parseSuffixDiff(s, j)),
    };
  });
}

function parseOriginProof(value: unknown): DaemonOriginProof {
  const proof = asRecord(value, 'Origin.Proof');
  const ipa = asRecord(proof.ipaProof, 'Origin.Proof.ipaProof');
  if (!Array.isArray(ipa.cl) || !Array.isArray(ipa.cr)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Origin.Proof.ipaProof.cl and cr must be arrays',
    );
  }
  if (!Array.isArray(proof.commitmentsByPath)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Origin.Proof.commitmentsByPath must be an array',
    );
  }
  return {
    otherStems: proof.otherStems,
    depthExtensionPresent: Boolean(proof.depthExtensionPresent),
    commitmentsByPath: proof.commitmentsByPath.map((c, i) =>
      asString(c, `commitmentsByPath[${i}]`),
    ),
    d: asString(proof.d, 'Origin.Proof.d'),
    ipaProof: {
      cl: ipa.cl.map((c, i) => asString(c, `ipaProof.cl[${i}]`)),
      cr: ipa.cr.map((c, i) => asString(c, `ipaProof.cr[${i}]`)),
      finalEvaluation: asString(ipa.finalEvaluation, 'ipaProof.finalEvaluation'),
    },
  };
}

function parseRip(json: unknown, originEpoch: number, finalEpoch: number): RipProof {
  const body = asRecord(json, 'RIP response');
  const rip = asRecord(body.rip, 'rip');
  const origin = asRecord(rip.Origin, 'rip.Origin');

  if (!Array.isArray(origin.Keys) || origin.Keys.some(k => typeof k !== 'string')) {
    throw new RipcordError(RipcordCode.INVALID_FORMAT, 'Origin.Keys must be an array of strings');
  }

  const chain = rip.Chain;
  const chainLength = chain === null ? 0 : Array.isArray(chain) ? chain.length : -1;
  if (chainLength < 0) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'rip.Chain must be null (window 0) or an array',
    );
  }

  const originEpochNum = asNumber(origin.EpochNum, 'Origin.EpochNum');
  if (originEpochNum !== originEpoch) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Origin.EpochNum ${originEpochNum} does not match requested origin_epoch ${originEpoch}`,
    );
  }

  const finalRoot = asString(rip.FinalRoot, 'FinalRoot');
  const originRoot = asString(origin.Root, 'Origin.Root');
  if (chain === null && finalRoot !== originRoot) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Window 0 RIP must have FinalRoot === Origin.Root',
    );
  }
  if (Array.isArray(chain) && chain.length > 0) {
    const last = asRecord(chain[chain.length - 1], 'Chain[last]');
    const lastRoot = asString(last.Root, 'Chain[last].Root');
    if (finalRoot !== lastRoot) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        'FinalRoot must equal Chain[last].Root',
      );
    }
  }

  return {
    originEpoch: originEpochNum,
    finalEpoch,
    chainLength,
    finalRoot,
    originRoot,
    originCommitment: asString(origin.Commitment, 'Origin.Commitment'),
    stateDiff: parseStateDiff(origin.StateDiff),
    keys: origin.Keys as string[],
    vtxoId: jsonBytesToHex(rip.VTXOID, 'rip.VTXOID'),
    psbtPayloadPresent: rip.PSBTPayload !== null && rip.PSBTPayload !== undefined,
    btcHeight: asNumber(rip.BTCHeight, 'rip.BTCHeight'),
    btcTimestamp: asNumber(rip.BTCTimestamp, 'rip.BTCTimestamp'),
    originProof: parseOriginProof(origin.Proof),
  };
}

async function newestClosedEpoch(baseUrl: string, timeoutMs: number): Promise<number | undefined> {
  const { json } = await daemonGet(baseUrl, '/tachi_listEpochs?page=1&page_size=50', timeoutMs);
  const body = asRecord(json, 'listEpochs');
  if (!Array.isArray(body.epochs)) {
    return undefined;
  }
  let newest: number | undefined;
  for (const entry of body.epochs) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (row.status === 'closed' && typeof row.height === 'number') {
      if (newest === undefined || row.height > newest) {
        newest = row.height;
      }
    }
  }
  return newest;
}

/**
 * GET /tachi_tx?hash=<txHash>&hat=true
 *
 * `hat.proof` is bare lowercase hex. The tx hash is case-insensitive.
 * Unknown hash -> HTTP 404 plain text `transaction not found`.
 */
export async function fetchHat(txHash: string, opts: ProofFetchOpts): Promise<HatProof> {
  const hash = requireTxHash(txHash);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const { json } = await daemonGet(
    opts.baseUrl,
    `/tachi_tx?hash=${hash}&hat=true`,
    timeoutMs,
  );
  return parseHat(json);
}

/**
 * GET /tachi_tx?hash=<txHash>&rip=true&origin_epoch=<o>&final_epoch=<f>
 *
 * Both epoch params are mandatory. Window defaults to 0 (self-proof; Chain is
 * null). A window of 50 is not a safe default: every epoch in the range must
 * already be closed or the daemon 502s with a chain gap.
 *
 * `origin_epoch=0&final_epoch=0` is a valid request for epoch 0, NOT a
 * self-proof of the transaction. Callers must pass the tx's own epoch.
 */
export async function fetchRip(
  txHash: string,
  originEpoch: number,
  opts: RipFetchOpts,
): Promise<RipProof> {
  const hash = requireTxHash(txHash);
  const origin = requireEpoch(originEpoch, 'originEpoch');
  const window = opts.window ?? 0;
  requireEpoch(window, 'window');
  if (window > MAX_RIP_WINDOW) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `RIP window ${window} exceeds max chain length of ${MAX_RIP_WINDOW} epochs`,
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  let finalEpoch = origin + window;
  const shouldClamp = opts.clamp !== false && window > 0;
  if (shouldClamp) {
    try {
      const newestClosed = await newestClosedEpoch(opts.baseUrl, timeoutMs);
      if (newestClosed !== undefined) {
        finalEpoch = Math.min(finalEpoch, newestClosed);
      }
    } catch (err) {
      if (err instanceof RipcordError) throw err;
      throw new RipcordError(
        RipcordCode.DAEMON_UNREACHABLE,
        'Failed to list closed epochs while clamping the RIP window',
        { cause: err },
      );
    }
    if (finalEpoch < origin) {
      finalEpoch = origin;
    }
  }

  const { json } = await daemonGet(
    opts.baseUrl,
    `/tachi_tx?hash=${hash}&rip=true&origin_epoch=${origin}&final_epoch=${finalEpoch}`,
    timeoutMs,
  );
  return parseRip(json, origin, finalEpoch);
}

function verkleKeyHex(keyBase64: string): string {
  return Buffer.from(keyBase64, 'base64').toString('hex');
}

/**
 * Inclusion check: the daemon's HAT value appears in the daemon's Verkle
 * StateDiff after stripping 0x and lowercasing both sides. A strict `===`
 * comparison is false on every valid proof.
 *
 * The Verkle suffix is NOT constant 65. It is the last byte of the 32-byte
 * key `stem(31) || suffix(1)` and varies per VTXO. After locating the matching
 * currentValue, this also asserts
 * `base64(Origin.Keys[0]) === stem_hex || suffixByteHex`.
 *
 * This does not recompute the HAT commitment and does not verify the IPA
 * proof.
 */
export function verifyHatInRip(hat: HatProof, rip: RipProof): HatRipLink {
  const want = normalizeProofHex(hat.proof);
  if (!isBareProofHex(want)) {
    return {
      verified: false,
      stem: '',
      suffix: -1,
      matchedValue: '',
      keyIdentityHolds: false,
      reason: 'HAT proof is not 64-character hex',
    };
  }

  const key0 = rip.keys[0];
  const keyHex = typeof key0 === 'string' && key0.length > 0 ? verkleKeyHex(key0) : '';

  for (const diff of rip.stateDiff) {
    for (const suffixDiff of diff.suffixDiffs) {
      const got = normalizeProofHex(suffixDiff.currentValue);
      if (got !== want) continue;

      const stemHex = normalizeProofHex(diff.stem);
      const suffixByte = suffixDiff.suffix.toString(16).padStart(2, '0');
      const keyIdentityHolds = keyHex.length > 0 && keyHex === stemHex + suffixByte;
      return {
        verified: keyIdentityHolds,
        stem: diff.stem,
        suffix: suffixDiff.suffix,
        matchedValue: suffixDiff.currentValue,
        keyIdentityHolds,
        reason: keyIdentityHolds
          ? undefined
          : 'HAT value matched StateDiff but Origin.Keys[0] is not stem||suffix',
      };
    }
  }

  return {
    verified: false,
    stem: '',
    suffix: -1,
    matchedValue: '',
    keyIdentityHolds: false,
    reason: 'HAT proof is not present in RIP StateDiff after hex normalization',
  };
}

/**
 * Fetch HAT + RIP for a committed transfer, link them, and fill PaymentReceipt.
 * Proof fields are inclusion evidence, not a locally recomputed commitment.
 */
export async function buildPaymentReceipt(params: BuildReceiptParams): Promise<PaymentReceipt> {
  requireTxHash(params.txHash);
  requireEpoch(params.epoch, 'epoch');
  if (!TX_HASH_RE.test(params.fromXOnly) || !TX_HASH_RE.test(params.toXOnly)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'fromXOnly and toXOnly must be 64-character hex',
    );
  }

  const fetchOpts = { baseUrl: params.baseUrl, timeoutMs: params.timeoutMs };
  const hat = await fetchHat(params.txHash, fetchOpts);
  const rip = await fetchRip(params.txHash, params.epoch, {
    ...fetchOpts,
    window: params.window ?? 0,
  });
  const link = verifyHatInRip(hat, rip);

  return {
    txHash: params.txHash.toLowerCase(),
    epoch: params.epoch,
    code: params.code,
    fromXOnly: params.fromXOnly.toLowerCase() as XOnlyHex,
    toXOnly: params.toXOnly.toLowerCase() as XOnlyHex,
    amountSats: params.amountSats,
    feeSats: params.feeSats,
    hat: {
      vtxoId: hat.vtxoId,
      proof: hat.proof,
      btcHeight: hat.btcHeight,
    },
    rip: {
      originEpoch: rip.originEpoch,
      finalEpoch: rip.finalEpoch,
      chainLength: rip.chainLength,
      finalRoot: rip.finalRoot,
      hatInStateDiff: link.verified,
    },
  };
}
