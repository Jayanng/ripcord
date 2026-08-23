import { CompressedHex, asCompressedHex, isCompressedHex } from './types.js';
import * as vc from '@tachibtc/taurus-vault-core';
import { crypto as btcCrypto } from 'bitcoinjs-lib';
import { RipcordError, RipcordCode } from './errors.js';

export interface QuorumInfo {
  nodePubkeys: CompressedHex[];
  threshold: number;
  fingerprint: string;
  source: string;
}

const quorumCache = new Map<string, QuorumInfo>();

/** Domain tag so a fingerprint preimage can never be confused with a bare key list. */
const FINGERPRINT_DOMAIN = 'ripcord/quorum/v1';

/**
 * Fingerprint the quorum a vault was built against.
 *
 * A `VaultRecord` stores this so a later quorum change is *detectable* instead of
 * silently producing a different vault address. That means the fingerprint must
 * cover everything that changes the vault, and must not change for reasons that
 * do not.
 *
 * AUDIT FIXES (2026-08-23), both live-proven:
 *
 * 1. **Case sensitivity.** The preimage was the raw key strings, but
 *    `isCompressedHex` accepts uppercase hex, so the same 7-node quorum returned
 *    by the daemon in a different case produced a completely different
 *    fingerprint and would have looked like a quorum rotation. Keys are now
 *    lowercased first.
 * 2. **The threshold was not covered.** `sha256(sorted keys)` is identical for a
 *    3-of-7 and a 5-of-7 quorum over the same node set, so a threshold change,
 *    which absolutely does change the vault's cooperative leaf, was invisible to
 *    the quorum-change check. The threshold is now part of the preimage.
 *
 * A domain tag and the key count are included so the preimage is unambiguous
 * rather than relying on the 66-char length invariant to keep `:` unambiguous.
 *
 * Hashing goes through bitcoinjs-lib's `crypto.sha256` rather than `node:crypto`.
 * `@ripcord/core` is consumed by a browser PWA (Phase 10) where `node:crypto` has
 * no bundler-free equivalent; `vault.ts` had reached for `crypto.subtle` for the
 * same reason, which is async and was part of how the two implementations
 * diverged. bitcoinjs-lib is already a hard dependency and works in both runtimes.
 */
export function computeFingerprint(nodePubkeys: CompressedHex[], threshold: number): string {
  const normalized = nodePubkeys.map((pk) => pk.toLowerCase());
  const sorted = [...normalized].sort();
  const preimage = [
    FINGERPRINT_DOMAIN,
    String(threshold),
    String(sorted.length),
    ...sorted,
  ].join(':');
  return Buffer.from(btcCrypto.sha256(Buffer.from(preimage, 'utf8'))).toString('hex');
}

/**
 * Validate a quorum keyset: exactly 7 well-formed, DISTINCT compressed keys.
 *
 * AUDIT FIX (2026-08-23): uniqueness was never checked. A keyset with a repeated
 * node key still has length 7 and passes every per-key format check, but it is
 * not a real 5-of-7: the duplicated node can satisfy two of the five required
 * signatures, so the effective security is 5-of-6 or worse. Comparison is
 * case-insensitive so `02AA…` and `02aa…` count as the same key.
 */
export function assertDistinctPubkeys(pubkeys: CompressedHex[]): void {
  const seen = new Set<string>();
  for (const pk of pubkeys) {
    const key = pk.toLowerCase();
    if (seen.has(key)) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Duplicate node pubkey in quorum: ${pk}`,
        { hint: 'A repeated node key is not a real 5-of-7 quorum; one node could sign twice' }
      );
    }
    seen.add(key);
  }
}

/**
 * Freeze a `QuorumInfo` so a cached entry cannot be mutated by a caller.
 *
 * AUDIT FIX (2026-08-23): `getQuorumWithCache` returned the cached object by
 * reference, so a caller could set `threshold = 1` or push an eighth key and
 * every later consumer of the shared cache saw the poisoned value, with the
 * 5-of-7 validation having already run. Live-proven before the fix.
 */
function freezeQuorum(quorum: QuorumInfo): QuorumInfo {
  Object.freeze(quorum.nodePubkeys);
  return Object.freeze(quorum);
}

async function fetchAndValidateQuorum(baseUrl: string): Promise<QuorumInfo> {
  const q = await vc.fetchConsensusQuorum({ baseUrl });

  if (q.threshold !== 5) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Expected threshold 5, got ${q.threshold}`,
      { hint: 'Quorum threshold must be exactly 5 for regtest' }
    );
  }

  if (!Array.isArray(q.nodePubkeys) || q.nodePubkeys.length !== 7) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Expected 7 node pubkeys, got ${q.nodePubkeys?.length ?? 'undefined'}`,
      { hint: 'Quorum must have exactly 7 node pubkeys for regtest' }
    );
  }

  const validatedPubkeys: CompressedHex[] = [];
  for (const pk of q.nodePubkeys) {
    if (!isCompressedHex(pk)) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Invalid compressed pubkey: ${pk}`,
        { hint: 'Node pubkeys must be 66-char hex starting with 02 or 03' }
      );
    }
    validatedPubkeys.push(asCompressedHex(pk));
  }

  assertDistinctPubkeys(validatedPubkeys);

  return freezeQuorum({
    nodePubkeys: validatedPubkeys,
    threshold: q.threshold,
    fingerprint: computeFingerprint(validatedPubkeys, q.threshold),
    source: q.source,
  });
}

export interface GetQuorumOptions {
  /** Local loopback proxy only; never enable this for public endpoints. */
  allowInsecureHttp?: boolean;
}

async function fetchAndValidateQuorumWithOptions(baseUrl: string, options: GetQuorumOptions = {}): Promise<QuorumInfo> {
  const q = await vc.fetchConsensusQuorum({
    baseUrl,
    ...(options.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
  });
  if (q.threshold !== 5) throw new RipcordError(RipcordCode.INVALID_FORMAT, `Expected threshold 5, got ${q.threshold}`, { hint: 'Quorum threshold must be exactly 5 for regtest' });
  if (!Array.isArray(q.nodePubkeys) || q.nodePubkeys.length !== 7) throw new RipcordError(RipcordCode.INVALID_FORMAT, `Expected 7 node pubkeys, got ${q.nodePubkeys?.length ?? 'undefined'}`, { hint: 'Quorum must have exactly 7 node pubkeys for regtest' });
  const validatedPubkeys: CompressedHex[] = [];
  for (const pk of q.nodePubkeys) {
    if (!isCompressedHex(pk)) throw new RipcordError(RipcordCode.INVALID_FORMAT, `Invalid compressed pubkey: ${pk}`, { hint: 'Node pubkeys must be 66-char hex starting with 02 or 03' });
    validatedPubkeys.push(asCompressedHex(pk));
  }
  assertDistinctPubkeys(validatedPubkeys);
  return freezeQuorum({ nodePubkeys: validatedPubkeys, threshold: q.threshold, fingerprint: computeFingerprint(validatedPubkeys, q.threshold), source: q.source });
}

export async function getQuorum(baseUrl: string, options: GetQuorumOptions = {}): Promise<QuorumInfo> {
  if (!options.allowInsecureHttp) return fetchAndValidateQuorum(baseUrl);
  return fetchAndValidateQuorumWithOptions(baseUrl, options);
}

export async function getQuorumWithCache(baseUrl: string): Promise<QuorumInfo> {
  const cached = quorumCache.get(baseUrl);
  if (cached) {
    return cached;
  }

  const quorum = await fetchAndValidateQuorum(baseUrl);
  quorumCache.set(baseUrl, quorum);
  return quorum;
}

export function clearQuorumCache(): void {
  quorumCache.clear();
}
