import { CompressedHex, asCompressedHex, isCompressedHex } from './types.js';
import * as vc from '@tachibtc/taurus-vault-core';
import { createHash } from 'node:crypto';
import { RipcordError, RipcordCode } from './errors.js';

export interface QuorumInfo {
  nodePubkeys: CompressedHex[];
  threshold: number;
  fingerprint: string;
  source: string;
}

const quorumCache = new Map<string, QuorumInfo>();

export function computeFingerprint(nodePubkeys: CompressedHex[]): string {
  const sorted = [...nodePubkeys].sort();
  const joined = sorted.join(':');
  return createHash('sha256').update(joined).digest('hex');
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

  return {
    nodePubkeys: validatedPubkeys,
    threshold: q.threshold,
    fingerprint: computeFingerprint(validatedPubkeys),
    source: q.source,
  };
}

export async function getQuorum(baseUrl: string): Promise<QuorumInfo> {
  return fetchAndValidateQuorum(baseUrl);
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