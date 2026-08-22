import { describe, it, expect, beforeAll } from 'vitest';
import {
  fetchHat,
  fetchRip,
  verifyHatInRip,
  buildPaymentReceipt,
  normalizeProofHex,
  type HatProof,
  type RipProof,
} from '../src/proofs.js';
import { MemoryStore } from '../src/store.js';
import type { XOnlyHex } from '../src/types.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';

/**
 * Live-committed transfers from the 2026-08-23 Phase 8 probe, re-fetched live.
 * Task 8.2: normalized HAT-in-RIP inclusion + Origin.Keys[0] identity.
 */
const HIST_A = {
  hash: 'FB650479B490DA680776E4F1EBA4B5700FCAD1F1DE68D180634FF35DF1E31095',
  epoch: 437326,
};
const HIST_B = {
  hash: 'F5BD7D7FB0F4BDA75C6C2D46117F0EAB8D5B07403B53392520A121C9E1D4E749',
  epoch: 437193,
};
const HIST_C = {
  hash: 'D501919DD9914D453163B36F5C89BB187E3E802C0780310A5FD1C1B97EDA0476',
  epoch: 437172,
};

const ALICE_XONLY = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
const BOB_XONLY = '028e9de3ffe2238b2cbf8a60f1c99c076d6e89749018915f2f5af8c8da791c80';

describe('verkle.test.ts Task 8.2: HAT-in-RIP linker (live daemon)', { timeout: 180000 }, () => {
  let hatA: HatProof;
  let hatB: HatProof;
  let hatC: HatProof;
  let ripA0: RipProof;
  let ripB0: RipProof;
  let ripC0: RipProof;

  beforeAll(async () => {
    hatA = await fetchHat(HIST_A.hash, { baseUrl: DAEMON });
    hatB = await fetchHat(HIST_B.hash, { baseUrl: DAEMON });
    hatC = await fetchHat(HIST_C.hash, { baseUrl: DAEMON });
    ripA0 = await fetchRip(HIST_A.hash, HIST_A.epoch, { baseUrl: DAEMON, window: 0 });
    ripB0 = await fetchRip(HIST_B.hash, HIST_B.epoch, { baseUrl: DAEMON, window: 0 });
    ripC0 = await fetchRip(HIST_C.hash, HIST_C.epoch, { baseUrl: DAEMON, window: 0 });
  }, 60000);

  it('returns verified for a real matched pair after 0x/case normalization', () => {
    const link = verifyHatInRip(hatA, ripA0);
    expect(link.verified).toBe(true);
    expect(link.keyIdentityHolds).toBe(true);
    expect(link.suffix).not.toBe(65);
    expect(normalizeProofHex(link.matchedValue)).toBe(hatA.proof);
    expect(hatA.vtxoId).toBe(ripA0.vtxoId);

    const rawValue = ripA0.stateDiff[0]?.suffixDiffs[0]?.currentValue ?? '';
    expect(rawValue === hatA.proof).toBe(false);
    expect(rawValue.toLowerCase().startsWith('0x')).toBe(true);
  });

  it('accepts an uppercase 0x-prefixed HAT proof against the same RIP', () => {
    const mutated: HatProof = {
      ...hatA,
      proof: `0x${hatA.proof.toUpperCase()}`,
    };
    const link = verifyHatInRip(mutated, ripA0);
    expect(link.verified).toBe(true);
    expect(link.keyIdentityHolds).toBe(true);
  });

  it('returns false for a HAT proof taken from a different transfer', () => {
    const link = verifyHatInRip(hatB, ripA0);
    expect(link.verified).toBe(false);
    expect(link.keyIdentityHolds).toBe(false);
    expect(link.reason).toMatch(/not present/i);
  });

  it('fails closed when Origin.Keys[0] is not stem||suffix', () => {
    const broken: RipProof = {
      ...ripA0,
      keys: [Buffer.from('00'.repeat(32), 'hex').toString('base64')],
    };
    const link = verifyHatInRip(hatA, broken);
    expect(link.keyIdentityHolds).toBe(false);
    expect(link.verified).toBe(false);
    expect(normalizeProofHex(link.matchedValue)).toBe(hatA.proof);
    expect(link.reason).toMatch(/stem\|\|suffix/);
  });

  it('asserts Origin.Keys[0] (base64) === stem || suffix on three live transfers, and suffix is not 65', () => {
    const pairs: Array<{ hat: HatProof; rip: RipProof; label: string }> = [
      { hat: hatA, rip: ripA0, label: 'A' },
      { hat: hatB, rip: ripB0, label: 'B' },
      { hat: hatC, rip: ripC0, label: 'C' },
    ];

    const suffixes = new Set<number>();
    for (const { hat, rip, label } of pairs) {
      const link = verifyHatInRip(hat, rip);
      expect(link.verified, label).toBe(true);
      expect(link.keyIdentityHolds, label).toBe(true);
      expect(link.suffix, `${label} suffix must not be the old constant 65`).not.toBe(65);
      suffixes.add(link.suffix);

      const keyHex = Buffer.from(rip.keys[0], 'base64').toString('hex');
      const stemHex = normalizeProofHex(link.stem);
      const suffixHex = link.suffix.toString(16).padStart(2, '0');
      expect(keyHex).toBe(stemHex + suffixHex);
      expect(stemHex.length).toBe(62);
      expect(keyHex.length).toBe(64);
      expect(hat.vtxoId).toBe(rip.vtxoId);
    }
    expect(suffixes.size).toBe(3);
  });

  it('does not recompute the HAT commitment from PSBTPayload', () => {
    expect(ripA0.psbtPayloadPresent).toBe(false);
    expect(ripB0.psbtPayloadPresent).toBe(false);
    expect(ripC0.psbtPayloadPresent).toBe(false);
  });

  it('assembles a PaymentReceipt that survives a MemoryStore snapshot round-trip', async () => {
    const receipt = await buildPaymentReceipt({
      txHash: HIST_A.hash,
      epoch: HIST_A.epoch,
      code: 0,
      fromXOnly: ALICE_XONLY as XOnlyHex,
      toXOnly: BOB_XONLY as XOnlyHex,
      amountSats: 1000n,
      feeSats: 1n,
      baseUrl: DAEMON,
      window: 0,
    });

    expect(receipt.hat?.proof).toBe(hatA.proof);
    expect(receipt.hat?.vtxoId).toBe(hatA.vtxoId);
    expect(receipt.hat?.btcHeight).toBe(0);
    expect(receipt.rip?.hatInStateDiff).toBe(true);
    expect(receipt.rip?.originEpoch).toBe(HIST_A.epoch);
    expect(receipt.rip?.chainLength).toBe(0);
    expect(receipt.rip?.finalRoot).toBe(ripA0.finalRoot);
    expect(receipt.txHash).toBe(HIST_A.hash.toLowerCase());

    const store = new MemoryStore();
    await store.saveReceipt(receipt);
    const restored = MemoryStore.fromSnapshot(store.exportSnapshot());
    const [roundTripped] = await restored.getReceipts();

    expect(roundTripped.txHash).toBe(receipt.txHash);
    expect(roundTripped.amountSats).toBe(1000n);
    expect(typeof roundTripped.amountSats).toBe('bigint');
    expect(roundTripped.feeSats).toBe(1n);
    expect(roundTripped.hat?.proof).toBe(hatA.proof);
    expect(roundTripped.hat?.vtxoId).toBe(hatA.vtxoId);
    expect(roundTripped.hat?.btcHeight).toBe(0);
    expect(roundTripped.rip?.hatInStateDiff).toBe(true);
    expect(roundTripped.rip?.finalRoot).toBe(ripA0.finalRoot);
    expect(roundTripped.rip?.originEpoch).toBe(HIST_A.epoch);
    expect(roundTripped.rip?.finalEpoch).toBe(receipt.rip?.finalEpoch);
    expect(roundTripped.rip?.chainLength).toBe(0);
  });
});
