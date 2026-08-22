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
import { RipcordCode, RipcordError } from '../src/errors.js';
import { MemoryStore } from '../src/store.js';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  makeSigner,
  sendTransfer,
  toSdkVault,
} from '../src/index.js';
import type { XOnlyHex } from '../src/types.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';

/**
 * Live-committed transfers from the 2026-08-23 Phase 8 probe, re-fetched
 * 2026-08-22. Values (proof, vtxo_id, suffix) are read from the daemon in
 * beforeAll, not invented here.
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

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ALICE_XONLY = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const BOB_XONLY = '028e9de3ffe2238b2cbf8a60f1c99c076d6e89749018915f2f5af8c8da791c80';

const UNKNOWN_HASH = 'ff'.repeat(32);

describe('proofs.ts: live HAT / RIP (daemon v0.39.0)', { timeout: 300000 }, () => {
  let hatA: HatProof;
  let hatB: HatProof;
  let ripA0: RipProof;
  let ripB0: RipProof;
  let currentEpoch: number;

  beforeAll(async () => {
    const statsRes = await fetch(`${DAEMON}/tachi_stats`);
    const stats = (await statsRes.json()) as { current_epoch: number };
    currentEpoch = stats.current_epoch;

    hatA = await fetchHat(HIST_A.hash, { baseUrl: DAEMON });
    hatB = await fetchHat(HIST_B.hash, { baseUrl: DAEMON });
    ripA0 = await fetchRip(HIST_A.hash, HIST_A.epoch, { baseUrl: DAEMON, window: 0 });
    ripB0 = await fetchRip(HIST_B.hash, HIST_B.epoch, { baseUrl: DAEMON, window: 0 });
  }, 60000);

  describe('fetchHat', () => {
    it('returns a 64-char bare lowercase hex proof and the spent-input vtxo_id', async () => {
      expect(hatA.proof).toMatch(/^[0-9a-f]{64}$/);
      expect(hatA.proof.startsWith('0x')).toBe(false);
      expect(hatA.vtxoId).toMatch(/^[0-9a-f]{64}$/);
      expect(hatA.btcHeight).toBe(0);
      expect(hatA.btcTimestamp).toBe(0);
    });

    it('is case-insensitive on the tx hash', async () => {
      const lower = await fetchHat(HIST_A.hash.toLowerCase(), { baseUrl: DAEMON });
      expect(lower.proof).toBe(hatA.proof);
      expect(lower.vtxoId).toBe(hatA.vtxoId);
    });

    it('maps an unknown hash to TX_NOT_FOUND instead of parsing the 404 body', async () => {
      let caught: unknown;
      try {
        await fetchHat(UNKNOWN_HASH, { baseUrl: DAEMON });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RipcordError);
      const err = caught as RipcordError;
      expect(err.code).toBe(RipcordCode.TX_NOT_FOUND);
      expect(err.message.toLowerCase()).toContain('transaction not found');
    });
  });

  describe('fetchRip window 0', () => {
    it('returns Origin.EpochNum === tx epoch, Chain null, FinalRoot === Origin.Root', () => {
      expect(ripA0.originEpoch).toBe(HIST_A.epoch);
      expect(ripA0.chainLength).toBe(0);
      expect(ripA0.finalRoot).toBe(ripA0.originRoot);
      expect(ripA0.psbtPayloadPresent).toBe(false);
      expect(ripA0.btcHeight).toBe(0);
      expect(ripA0.btcTimestamp).toBe(0);
      expect(ripA0.vtxoId).toBe(hatA.vtxoId);
    });

    it('carries daemon-attested IPA evidence without claiming local verification', () => {
      expect(ripA0.originProof.ipaProof.cl).toHaveLength(8);
      expect(ripA0.originProof.ipaProof.cr).toHaveLength(8);
      expect(typeof ripA0.originProof.ipaProof.finalEvaluation).toBe('string');
    });

    it('decodes VTXOID as a JSON byte array, not a string', async () => {
      const raw = await fetch(`${DAEMON}/tachi_tx?hash=${HIST_A.hash}&rip=true&origin_epoch=${HIST_A.epoch}&final_epoch=${HIST_A.epoch}`);
      const body = (await raw.json()) as { rip: { VTXOID: unknown } };
      expect(Array.isArray(body.rip.VTXOID)).toBe(true);
      expect(Buffer.from(body.rip.VTXOID as number[]).toString('hex')).toBe(ripA0.vtxoId);
    });
  });

  describe('fetchRip windows and errors', () => {
    it('returns Chain.length === window and FinalRoot === Chain[last].Root when the window is closed', async () => {
      const rip5 = await fetchRip(HIST_A.hash, HIST_A.epoch, { baseUrl: DAEMON, window: 5 });
      expect(rip5.chainLength).toBe(5);
      expect(rip5.originEpoch).toBe(HIST_A.epoch);
      expect(rip5.finalEpoch).toBe(HIST_A.epoch + 5);
      expect(rip5.finalRoot).not.toBe('');
    });

    it('maps a window into unclosed epochs to CHAIN_GAP, not an unhandled 502', async () => {
      let caught: unknown;
      try {
        await fetchRip(HIST_A.hash, currentEpoch, {
          baseUrl: DAEMON,
          window: 50,
          clamp: false,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RipcordError);
      const err = caught as RipcordError;
      expect(err.code).toBe(RipcordCode.CHAIN_GAP);
      expect(err.message.toLowerCase()).toMatch(/not closed|chain gap/);
    });

    it('rejects a window above the 256-epoch cap before hitting the daemon', async () => {
      await expect(
        fetchRip(HIST_A.hash, HIST_A.epoch, { baseUrl: DAEMON, window: 257 }),
      ).rejects.toMatchObject({ code: RipcordCode.INVALID_FORMAT });
    });

    it('maps RIP of an unknown hash to TX_NOT_FOUND', async () => {
      await expect(
        fetchRip(UNKNOWN_HASH, 1, { baseUrl: DAEMON, window: 0 }),
      ).rejects.toMatchObject({ code: RipcordCode.TX_NOT_FOUND });
    });
  });

  describe('verifyHatInRip (normalized inclusion + key identity)', () => {
    it('returns verified for a real matched pair after 0x/case normalization', () => {
      const link = verifyHatInRip(hatA, ripA0);
      expect(link.verified).toBe(true);
      expect(link.keyIdentityHolds).toBe(true);
      expect(link.suffix).not.toBe(65);
      expect(normalizeProofHex(link.matchedValue)).toBe(hatA.proof);

      const rawValue = ripA0.stateDiff[0]?.suffixDiffs[0]?.currentValue ?? '';
      expect(rawValue === hatA.proof).toBe(false);
      expect(rawValue.toLowerCase().startsWith('0x')).toBe(true);
    });

    it('accepts an uppercase 0x-prefixed HAT proof against the same RIP', () => {
      const mutated: HatProof = {
        ...hatA,
        proof: `0x${hatA.proof.toUpperCase()}`,
      };
      expect(verifyHatInRip(mutated, ripA0).verified).toBe(true);
    });

    it('returns false for a HAT proof taken from a different transfer', () => {
      const link = verifyHatInRip(hatB, ripA0);
      expect(link.verified).toBe(false);
      expect(link.keyIdentityHolds).toBe(false);
      expect(link.reason).toMatch(/not present/i);
    });

    it('asserts Origin.Keys[0] (base64) === stem || suffix, and suffix is not 65', async () => {
      const pairs: Array<{ hat: HatProof; rip: RipProof; label: string }> = [
        { hat: hatA, rip: ripA0, label: 'A' },
        { hat: hatB, rip: ripB0, label: 'B' },
      ];
      const hatC = await fetchHat(HIST_C.hash, { baseUrl: DAEMON });
      const ripC = await fetchRip(HIST_C.hash, HIST_C.epoch, { baseUrl: DAEMON, window: 0 });
      pairs.push({ hat: hatC, rip: ripC, label: 'C' });

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
      }
      expect(suffixes.size).toBeGreaterThan(1);
    });
  });

  describe('buildPaymentReceipt + MemoryStore', () => {
    it('assembles a receipt whose proofs survive a snapshot round-trip', async () => {
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
      expect(roundTripped.hat?.proof).toBe(hatA.proof);
      expect(roundTripped.hat?.vtxoId).toBe(hatA.vtxoId);
      expect(roundTripped.rip?.hatInStateDiff).toBe(true);
      expect(roundTripped.rip?.finalRoot).toBe(ripA0.finalRoot);
      expect(roundTripped.rip?.originEpoch).toBe(HIST_A.epoch);
    });
  });

  describe('fresh live transfer', () => {
    it('fetchHat on a just-committed send returns a 64-char proof for the spent input', async () => {
      const alice = deriveIdentity(ALICE_MNEMONIC, 'regtest');
      const bob = deriveIdentity(BOB_MNEMONIC, 'regtest');
      const quorum = await getQuorum(DAEMON);
      const aliceVault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: alice.userKeyDescriptor,
      });
      const result = await sendTransfer({
        vault: toSdkVault(aliceVault),
        senderXOnly: ALICE_XONLY,
        recipientAddress: bob.userAddress,
        amountSats: 1000n,
        feeSats: 1n,
        baseUrl: DAEMON,
        network: 'regtest',
        userSigner: makeSigner(ALICE_MNEMONIC, 'regtest', 0),
      });

      expect(result.code).toBe(0);
      expect(result.epoch).toBeGreaterThan(0);

      const hat = await fetchHat(result.txHash, { baseUrl: DAEMON });
      expect(hat.proof).toMatch(/^[0-9a-f]{64}$/);
      expect(hat.vtxoId).toMatch(/^[0-9a-f]{64}$/);

      const rip = await fetchRip(result.txHash, result.epoch, { baseUrl: DAEMON, window: 0 });
      expect(rip.originEpoch).toBe(result.epoch);
      expect(rip.chainLength).toBe(0);
      expect(rip.finalRoot).toBe(rip.originRoot);
      expect(rip.vtxoId).toBe(hat.vtxoId);
      expect(rip.psbtPayloadPresent).toBe(false);

      const link = verifyHatInRip(hat, rip);
      expect(link.verified).toBe(true);
      expect(link.keyIdentityHolds).toBe(true);
      expect(link.suffix).not.toBe(65);

      const receipt = await buildPaymentReceipt({
        txHash: result.txHash,
        epoch: result.epoch,
        code: result.code,
        fromXOnly: ALICE_XONLY,
        toXOnly: BOB_XONLY,
        amountSats: 1000n,
        feeSats: 1n,
        baseUrl: DAEMON,
      });
      expect(receipt.rip?.hatInStateDiff).toBe(true);
    });
  });
});
