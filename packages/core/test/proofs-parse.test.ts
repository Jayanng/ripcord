import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchRip, verifyHatInRip, type HatProof, type RipProof } from '../src/proofs.js';

/** Captured verbatim from the live regtest daemon on 2026-09-30 (self-proof
 *  for tx 9ad269f1…af0b73ab): its StateDiff suffix values are null, which the
 *  parser used to reject with INVALID_FORMAT. */
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rip-selfproof-null-values.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('proofs.ts regression: null state-diff values (real regtest payload)', () => {
  it('parses a self-proof whose suffixDiff values are null', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixture));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const rip = await fetchRip(
        '9ad269f1d6d792745f87e038f9c8844a6c7715de7baab78f58d51b08af0b73ab',
        914406,
        { baseUrl: `http://127.0.0.1:${port}`, window: 0 },
      );
      expect(rip.chainLength).toBe(0);
      expect(rip.originEpoch).toBe(914406);
      expect(rip.finalEpoch).toBe(914406);
      // null values are carried as empty strings, never fabricated
      expect(rip.stateDiff[0].suffixDiffs[0].currentValue).toBe('');
      const expectedVtxo = Buffer.from(fixture.rip.VTXOID).toString('hex');
      expect(rip.vtxoId).toBe(expectedVtxo);
    } finally {
      server.close();
    }
  });
});

describe('verifyHatInRip inclusion matching', () => {
  const stem = 'ab'.repeat(31);
  const suffix = 0x66;
  const key = Buffer.from(stem + suffix.toString(16).padStart(2, '0'), 'hex').toString('base64');
  const vtxoId = 'cd'.repeat(32);
  const hatProof = '12'.repeat(32);
  const baseRip: RipProof = {
    originEpoch: 1,
    finalEpoch: 1,
    chainLength: 0,
    finalRoot: 'root',
    originRoot: 'root',
    originCommitment: 'commitment',
    stateDiff: [],
    keys: [key],
    vtxoId,
    psbtPayloadPresent: false,
    btcHeight: 0,
    btcTimestamp: 0,
    originProof: {
      otherStems: null,
      depthExtensionPresent: false,
      commitmentsByPath: [],
      d: 'd',
      ipaProof: { cl: [], cr: [], finalEvaluation: 'f' },
    },
  };
  const hat: HatProof = { vtxoId, proof: hatProof, btcHeight: 0, btcTimestamp: 0 };

  it('verifies an insertion where the HAT lands in newValue', () => {
    const rip: RipProof = {
      ...baseRip,
      stateDiff: [{ stem, suffixDiffs: [{ suffix, currentValue: '', newValue: hatProof }] }],
    };
    const link = verifyHatInRip(hat, rip);
    expect(link.verified).toBe(true);
    expect(link.matchedValue).toBe(hatProof);
    expect(link.keyIdentityHolds).toBe(true);
  });

  it('still verifies the classic currentValue match', () => {
    const rip: RipProof = {
      ...baseRip,
      stateDiff: [{ stem, suffixDiffs: [{ suffix, currentValue: hatProof }] }],
    };
    const link = verifyHatInRip(hat, rip);
    expect(link.verified).toBe(true);
    expect(link.matchedValue).toBe(hatProof);
  });

  it('reports not-verified for null-valued self-proof diffs instead of crashing', () => {
    const rip: RipProof = {
      ...baseRip,
      stateDiff: [{ stem, suffixDiffs: [{ suffix, currentValue: '' }] }],
    };
    const link = verifyHatInRip(hat, rip);
    expect(link.verified).toBe(false);
    expect(link.reason).toContain('not present');
  });
});
