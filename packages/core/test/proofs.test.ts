import { describe, it, expect, beforeAll } from 'vitest';
import { fetchHat, fetchRip, type HatProof, type RipProof } from '../src/proofs.js';
import { RipcordCode, RipcordError } from '../src/errors.js';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  makeSigner,
  sendTransfer,
  toSdkVault,
} from '../src/index.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';

/**
 * Live-committed transfers from the 2026-08-23 Phase 8 probe, re-fetched live.
 * Proof bytes are read from the daemon, not invented here.
 */
const HIST_A = {
  hash: 'FB650479B490DA680776E4F1EBA4B5700FCAD1F1DE68D180634FF35DF1E31095',
  epoch: 437326,
};
const HIST_B = {
  hash: 'F5BD7D7FB0F4BDA75C6C2D46117F0EAB8D5B07403B53392520A121C9E1D4E749',
  epoch: 437193,
};

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ALICE_XONLY = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

const UNKNOWN_HASH = 'ff'.repeat(32);

describe('proofs.ts Task 8.1: live HAT / RIP fetchers (daemon v0.39.0)', { timeout: 300000 }, () => {
  let hatA: HatProof;
  let ripA0: RipProof;
  let currentEpoch: number;

  beforeAll(async () => {
    const statsRes = await fetch(`${DAEMON}/tachi_stats`);
    const stats = (await statsRes.json()) as { current_epoch: number };
    currentEpoch = stats.current_epoch;

    hatA = await fetchHat(HIST_A.hash, { baseUrl: DAEMON });
    ripA0 = await fetchRip(HIST_A.hash, HIST_A.epoch, { baseUrl: DAEMON, window: 0 });
  }, 60000);

  describe('fetchHat', () => {
    it('returns a 64-char bare lowercase hex proof and the spent-input vtxo_id', () => {
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
      const raw = await fetch(
        `${DAEMON}/tachi_tx?hash=${HIST_A.hash}&rip=true&origin_epoch=${HIST_A.epoch}&final_epoch=${HIST_A.epoch}`,
      );
      const body = (await raw.json()) as { rip: { VTXOID: unknown } };
      expect(Array.isArray(body.rip.VTXOID)).toBe(true);
      expect(Buffer.from(body.rip.VTXOID as number[]).toString('hex')).toBe(ripA0.vtxoId);
    });
  });

  describe('fetchRip windows and errors', () => {
    it('returns Chain.length === window and FinalRoot === Chain[last].Root when the window is closed', async () => {
      const rip5 = await fetchRip(HIST_A.hash, HIST_A.epoch, { baseUrl: DAEMON, window: 5 });
      const raw = await fetch(
        `${DAEMON}/tachi_tx?hash=${HIST_A.hash}&rip=true&origin_epoch=${HIST_A.epoch}&final_epoch=${HIST_A.epoch + 5}`,
      );
      const body = (await raw.json()) as {
        rip: { Chain: Array<{ Root: string }>; FinalRoot: string };
      };

      expect(Array.isArray(body.rip.Chain)).toBe(true);
      expect(body.rip.Chain).toHaveLength(5);
      expect(body.rip.FinalRoot).toBe(body.rip.Chain[4].Root);
      expect(rip5.chainLength).toBe(5);
      expect(rip5.originEpoch).toBe(HIST_A.epoch);
      expect(rip5.finalEpoch).toBe(HIST_A.epoch + 5);
      expect(rip5.finalRoot).toBe(body.rip.FinalRoot);
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

    it('keeps a closed historical window 50 intact when clamping', async () => {
      const rip50 = await fetchRip(HIST_B.hash, HIST_B.epoch, { baseUrl: DAEMON, window: 50 });
      expect(rip50.chainLength).toBe(50);
      expect(rip50.finalEpoch).toBe(HIST_B.epoch + 50);
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

      let spentIds: string[] = [];
      const result = await sendTransfer({
        vault: toSdkVault(aliceVault),
        senderXOnly: ALICE_XONLY,
        recipientAddress: bob.userAddress,
        amountSats: 1000n,
        feeSats: 1n,
        baseUrl: DAEMON,
        network: 'regtest',
        userSigner: makeSigner(ALICE_MNEMONIC, 'regtest', 0),
        onInputsSelected: ids => {
          spentIds = [...ids];
        },
      });

      expect(result.code).toBe(0);
      expect(result.epoch).toBeGreaterThan(0);
      expect(spentIds.length).toBeGreaterThan(0);

      const hat = await fetchHat(result.txHash, { baseUrl: DAEMON });
      expect(hat.proof).toMatch(/^[0-9a-f]{64}$/);
      expect(spentIds.map(id => id.toLowerCase())).toContain(hat.vtxoId);

      const rip = await fetchRip(result.txHash, result.epoch, { baseUrl: DAEMON, window: 0 });
      expect(rip.originEpoch).toBe(result.epoch);
      expect(rip.chainLength).toBe(0);
      expect(rip.finalRoot).toBe(rip.originRoot);
      expect(rip.vtxoId).toBe(hat.vtxoId);
      expect(rip.psbtPayloadPresent).toBe(false);
    });
  });
});
