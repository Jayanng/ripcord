import { describe, it, expect, beforeAll } from 'vitest';
import * as vc from '@tachibtc/taurus-vault-core';
import {
  deriveIdentity,
  makeSigner,
  getQuorum,
  createVault,
  registerVault,
  verifyVaultForAdoption,
  deriveVaultIdFromOutpoint,
  evaluateFundingStep,
  computeFundingSteps,
  toSdkVault,
  sendTransfer,
} from '../src/index.js';
import { RipcordError, RipcordCode } from '../src/errors.js';
// Frozen csv=2 vault addresses, one per network's LIVE quorum. Both recomputed
// via createVault against the live daemon quorum and cross-checked twice
// (audit recompute + wallet app create flow, 2026-10-15). A prior value here
// was wrong: the test daemon was still regtest while identities derived signet,
// composing a regtest-quorum vault with a tb HRP.
const EXPECTED_VAULT =
  TEST_NETWORK === 'signet'
    ? 'tb1pwgarrepqhc3cjwccatgx9y0f0t0qh8jty5unewyfhwmwjh3dtnlqt0u7wz'
    : 'bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg';
import { TEST_DAEMON, TEST_NETWORK, FIXTURE_FAUCET_NOTE, withTransportRetry } from './live-fixtures.js';

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DAEMON_URL = TEST_DAEMON;

describe('register.ts', { timeout: 60000 }, () => {
  let aliceIdentity: Awaited<ReturnType<typeof deriveIdentity>>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let vault: Awaited<ReturnType<typeof createVault>>;
  let userSigner: ReturnType<typeof makeSigner>;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, TEST_NETWORK);
    quorum = await withTransportRetry(() => getQuorum(DAEMON_URL));
    vault = await createVault({
      network: TEST_NETWORK,
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: aliceIdentity.userKeyDescriptor,
    });
    userSigner = makeSigner(ALICE_MNEMONIC, TEST_NETWORK, 0);
  });

  it('derives Alice identity and creates csv=2 vault matching verified fixture', () => {
    expect(aliceIdentity.xOnly).toBe(
      'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319'
    );
    expect(vault.address).toBe(
      EXPECTED_VAULT
    );
    expect(vault.csvBlocks).toBe(2);
  });

  it('calls registerVault and catches mapped daemon error without live funds', async () => {
    const dummyTxid = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const dummyVtxoId = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const xOnlyBuf = Buffer.from(aliceIdentity.xOnly, 'hex');

    await expect(
      registerVault({
        vault: {
          ...vault,
          userKey: {
            compressedHex: aliceIdentity.userKeyDescriptor.publicKey,
            xOnly: xOnlyBuf,
          },
        },
        fundingTxid: dummyTxid,
        fundingVout: 0,
        userSigner,
        vtxoId: dummyVtxoId,
        owner: xOnlyBuf,
        amount: 39999n,
        baseUrl: DAEMON_URL,
      })
    ).rejects.toThrow(RipcordError);
  });

  it('rejects malformed inputs before daemon submission', async () => {
    const good = {
      vault,
      fundingTxid: '01'.repeat(32),
      fundingVout: 0,
      userSigner,
      vtxoId: '02'.repeat(32),
      owner: Buffer.from(aliceIdentity.xOnly, 'hex'),
      amount: 39999n,
      baseUrl: DAEMON_URL,
    };
    for (const [label, patch] of [
      ['txid', { fundingTxid: 'zz' }],
      ['vtxo', { vtxoId: 'zz' }],
      ['owner', { owner: 'zz' }],
      ['amount', { amount: 0n }],
      ['vout', { fundingVout: -1 }],
    ] as const) {
      await expect(registerVault({ ...good, ...patch }), `validation case: ${label}`).rejects.toThrow(RipcordError);
    }
  });

  // Env-gated live test – requires manual setup.
  // Round 8A-2: this manual opt-in spends a live VTXO - on signet that
  // additionally requires the documented TACHI_SIGNET_FUNDED opt-in.
  const hasLiveFunds =
    process.env.RIPCORD_LIVE === '1' &&
    Boolean(process.env.LIVE_FUNDING_TXID && process.env.LIVE_VTXO_ID) &&
    (TEST_NETWORK !== 'signet' || process.env.TACHI_SIGNET_FUNDED === '1');

  it.skipIf(!hasLiveFunds)(
    'registers vault on live daemon when live funds are provided',
    async () => {
      const fundingTxid = process.env.LIVE_FUNDING_TXID!;
      const vtxoId = process.env.LIVE_VTXO_ID!;
      const xOnlyBuf = Buffer.from(aliceIdentity.xOnly, 'hex');

      const result = await registerVault({
        vault: {
          ...vault,
          userKey: {
            compressedHex: aliceIdentity.userKeyDescriptor.publicKey,
            xOnly: xOnlyBuf,
          },
        },
        fundingTxid,
        fundingVout: 0,
        userSigner,
        vtxoId,
        owner: xOnlyBuf,
        amount: 39999n,
        baseUrl: DAEMON_URL,
      });

      expect(result.vaultId).toBeDefined();
      expect(typeof result.vaultId).toBe('string');
      expect(result.vaultId.length).toBe(64);
    }
  );

  // Live-money block: self-heals with real sendTransfer broadcasts and live
  // registerVault calls. On signet the fixtures cannot self-heal (faucet needs
  // human sign-in), so it runs only with pre-funded fixtures (TACHI_SIGNET_FUNDED=1).
  describe.skipIf(TEST_NETWORK === 'signet' && process.env.TACHI_SIGNET_FUNDED !== '1')('Live adoption on code=17 (live daemon)', { timeout: 180_000 }, () => {
    // Provenance: this fixture outpoint belongs to Alice (02e7ab25...) and is already
    // registered on the live regtest daemon (GET /tachi_listVaults?user=e7ab2537b5...)
    const INTERNAL_FUNDING_TXID = '8326c9aef63b07555de77812d886ff3ed8886be375435bfa1f63ca9fb5c1225a';
    const DISPLAY_FUNDING_TXID = Buffer.from(INTERNAL_FUNDING_TXID, 'hex').reverse().toString('hex');
    const FUNDING_VOUT = 0;
    const EXPECTED_VAULT_ID = '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722';

    it('re-registers existing vault: proves code=17 from daemon, adopts vaultId, and verifies H(funding_txid || vout)', async ctx => {
      // Fixture economics gate: this live chain step funds a deposit first.
      const gateVtxos = await withTransportRetry(() =>
        vc.getAddressVtxos(aliceIdentity.xOnly, { baseUrl: DAEMON_URL }),
      );
      // Round 6A-5: the gate mirrors the test's real spend paths (a flat 2001
      // over-skipped: the observed 1919-sat fixture would have passed).
      // Path A: one unspent VTXO >= 1000. Path B: self-heal needs >= 1001 total
      // (send 1000 + 1 fee). Path C: Bob's fallback needs Bob >= 2001.
      const gateUnspent = gateVtxos.vtxos.filter(v => !v.spent && !v.locked);
      const gateTotal = gateUnspent.reduce((acc, v) => acc + v.amountSats, 0n);
      const gateLargest = gateUnspent.reduce((acc, v) => (v.amountSats > acc ? v.amountSats : acc), 0n);
      if (gateLargest < 1000n && gateTotal < 1001n) {
        const bobGateIdentity = deriveIdentity('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', TEST_NETWORK);
        const bobGateVtxos = await withTransportRetry(() =>
          vc.getAddressVtxos(bobGateIdentity.xOnly, { baseUrl: DAEMON_URL }),
        );
        const bobGateTotal = bobGateVtxos.vtxos
          .filter(v => !v.spent && !v.locked)
          .reduce((acc, v) => acc + v.amountSats, 0n);
        if (bobGateTotal < 2001n) {
          console.warn(`[fixture] skipped: Alice ${gateTotal} sats (largest ${gateLargest}), Bob ${bobGateTotal} sats - need one >=1000 VTXO, >=1001 for self-heal, or Bob >=2001 - ${FIXTURE_FAUCET_NOTE}`);
          ctx.skip();
          return;
        }
      }
      // 1. Find an unspent VTXO owned by Alice to construct the live registration transaction
      let vtxoRes = await withTransportRetry(() => vc.getAddressVtxos(aliceIdentity.xOnly, { baseUrl: DAEMON_URL }));
      let unspentVtxo = vtxoRes.vtxos.find(v => !v.spent && !v.locked && v.amountSats >= 1000n);

      if (!unspentVtxo) {
        // Self-heal: ensure Alice has an unspent VTXO of at least 1000 sats using sendTransfer
        const aliceTotal = vtxoRes.vtxos
          .filter(v => !v.spent && !v.locked)
          .reduce((sum, v) => sum + v.amountSats, 0n);

        if (aliceTotal >= 1001n) {
          await withTransportRetry(() =>
            sendTransfer({
              vault: toSdkVault(vault),
              senderXOnly: aliceIdentity.xOnly,
              recipientAddress: aliceIdentity.userAddress,
              amountSats: 1000n,
              feeSats: 1n,
              baseUrl: DAEMON_URL,
              network: TEST_NETWORK,
              userSigner,
            }),
          );
        } else {
          const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
          const bobIdentity = deriveIdentity(BOB_MNEMONIC, TEST_NETWORK);
          const bobVault = await createVault({
            network: TEST_NETWORK,
            nodePubkeys: quorum.nodePubkeys,
            csvBlocks: 2,
            userKeyDescriptor: bobIdentity.userKeyDescriptor,
          });
          const bobSigner = makeSigner(BOB_MNEMONIC, TEST_NETWORK, 0);
          await withTransportRetry(() =>
            sendTransfer({
              vault: toSdkVault(bobVault),
              senderXOnly: bobIdentity.xOnly,
              recipientAddress: aliceIdentity.userAddress,
              amountSats: 2000n,
              feeSats: 1n,
              baseUrl: DAEMON_URL,
              network: TEST_NETWORK,
              userSigner: bobSigner,
            }),
          );
        }

        vtxoRes = await withTransportRetry(
          () => vc.getAddressVtxos(aliceIdentity.xOnly, { baseUrl: DAEMON_URL }),
          {
            validate: res => {
              if (!res.vtxos.some(v => !v.spent && v.amountSats >= 1000n)) {
                throw new Error('Waiting for minted VTXO to appear on daemon');
              }
            },
          },
        );
        unspentVtxo = vtxoRes.vtxos.find(v => !v.spent && !v.locked && v.amountSats >= 1000n);
      }

      expect(unspentVtxo).toBeDefined();
      const vtxo = unspentVtxo!;

      // 2. (i) Prove the daemon really returns code=17 by broadcasting the duplicate directly
      let rawDaemonError: any;
      try {
        await withTransportRetry(() =>
          vc.registerVault({
            vault: toSdkVault(vault),
            outpoint: {
              fundingTxid: Buffer.from(INTERNAL_FUNDING_TXID, 'hex'),
              fundingVout: FUNDING_VOUT,
            },
            userSigner,
            inputs: [{ vtxoId: Buffer.from(vtxo.id, 'hex') }],
            outputs: [{ owner: Buffer.from(aliceIdentity.xOnly, 'hex'), amount: vtxo.amountSats - 1n }],
            feeSats: 1n,
            account: { baseUrl: DAEMON_URL },
            broadcast: { url: DAEMON_URL + '/tachi_txBroadcastSync' },
            confirm: { baseUrl: DAEMON_URL },
          }),
        );
      } catch (err: any) {
        rawDaemonError = err;
      }

      expect(rawDaemonError).toBeDefined();
      expect(rawDaemonError.tendermintCode).toBe(17);
      expect(rawDaemonError.tendermintLog).toBe('vault already exists for this funding outpoint');
      expect(rawDaemonError.message).toContain('code=17');
      expect(rawDaemonError.message).toContain('vault already exists for this funding outpoint');

      // Echo the verbatim raw error as required by prompt
      console.log('RAW CODE=17 DAEMON ERROR:', {
        name: rawDaemonError.name,
        code: rawDaemonError.code,
        tendermintCode: rawDaemonError.tendermintCode,
        tendermintLog: rawDaemonError.tendermintLog,
        message: rawDaemonError.message,
      });

      // 3. (ii) Prove the library adopt path returns the correct vaultId instead of throwing
      const adoptResult = await withTransportRetry(() =>
        registerVault({
          vault,
          fundingTxid: DISPLAY_FUNDING_TXID,
          fundingVout: FUNDING_VOUT,
          userSigner,
          vtxoId: vtxo.id,
          owner: Buffer.from(aliceIdentity.xOnly, 'hex'),
          amount: vtxo.amountSats - 1n,
          baseUrl: DAEMON_URL,
        }),
      );

      expect(adoptResult.vaultId).toBe(EXPECTED_VAULT_ID);

      // 4. (iii) Prove the derived id equals H(funding_txid || vout) as the daemon reports it
      const derivedId = deriveVaultIdFromOutpoint(DISPLAY_FUNDING_TXID, FUNDING_VOUT, true);
      expect(derivedId).toBe(EXPECTED_VAULT_ID);
      expect(adoptResult.vaultId).toBe(derivedId);
    });
  });

  describe('Pure guard tests: adoption verification', () => {
    // Provenance: captured live from https://rpc-regtest.tachibtc.com/tachi_listVaults?user=e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319 on 2026-09-27.
    // Kept byte-exact as captured on every network: it is INPUT DATA for the
    // pure adoption guards (which compare vault_id and owner only, never the
    // address), so a per-network swap here would make the fixture lie about
    // its own provenance.
    const REAL_CAPTURED_RECORD = {
      vault_id: '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722',
      state: 'open',
      latest_state_num: 0,
      funding_txid: '8326c9aef63b07555de77812d886ff3ed8886be375435bfa1f63ca9fb5c1225a',
      funding_vout: 0,
      address: 'bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg',
    };
    const REAL_CAPTURED_OWNER = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
    const EXPECTED_VAULT_ID = '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722';

    it('adopts successfully on exact match of vault_id and owner', () => {
      const adopted = verifyVaultForAdoption(REAL_CAPTURED_RECORD, REAL_CAPTURED_OWNER, EXPECTED_VAULT_ID, REAL_CAPTURED_OWNER);
      expect(adopted.vaultId).toBe(EXPECTED_VAULT_ID);
    });

    it('refuses adoption on vault_id mismatch with clear typed error (annotated provenance: real record with deliberately altered vault_id)', () => {
      // Deliberately altered vault_id (annotated fixture provenance) to prove front-run / mismatch detection
      const alteredRecord = {
        ...REAL_CAPTURED_RECORD,
        vault_id: '0000000000000000000000000000000000000000000000000000000000000000',
      };
      expect(() =>
        verifyVaultForAdoption(alteredRecord, REAL_CAPTURED_OWNER, EXPECTED_VAULT_ID, REAL_CAPTURED_OWNER)
      ).toThrowError(/vault exists on our funding outpoint but does not match our keys — possible front-run; refusing to adopt/);

      try {
        verifyVaultForAdoption(alteredRecord, REAL_CAPTURED_OWNER, EXPECTED_VAULT_ID, REAL_CAPTURED_OWNER);
      } catch (err: any) {
        expect(err).toBeInstanceOf(RipcordError);
        expect(err.code).toBe(RipcordCode.NOT_OWNER);
        expect(err.daemonCode).toBe(17);
      }
    });

    it('refuses adoption on owner mismatch with clear typed error', () => {
      const strangerOwner = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      expect(() =>
        verifyVaultForAdoption(REAL_CAPTURED_RECORD, strangerOwner, EXPECTED_VAULT_ID, REAL_CAPTURED_OWNER)
      ).toThrowError(/vault exists on our funding outpoint but does not match our keys — possible front-run; refusing to adopt/);

      try {
        verifyVaultForAdoption(REAL_CAPTURED_RECORD, strangerOwner, EXPECTED_VAULT_ID, REAL_CAPTURED_OWNER);
      } catch (err: any) {
        expect(err).toBeInstanceOf(RipcordError);
        expect(err.code).toBe(RipcordCode.NOT_OWNER);
        expect(err.daemonCode).toBe(17);
      }
    });

    it('refuses adoption when vault is not found in daemon listing', () => {
      expect(() =>
        verifyVaultForAdoption(null, REAL_CAPTURED_OWNER, EXPECTED_VAULT_ID, REAL_CAPTURED_OWNER)
      ).toThrowError(/vault exists on our funding outpoint but does not match our keys — possible front-run; refusing to adopt/);
    });
  });

  describe('Fix 2 regression tests: flow state with vaultId never emits registration attempt', () => {
    it('does not emit registration attempt when flow state already records vaultId', () => {
      const decision = evaluateFundingStep({
        vault: {
          vaultIdHex: '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722',
          funding: {
            txid: '5a22c1b59fca631ffa5b4375e36b88d83eff86d81278e75d55073bf6aef62683' as any,
            vout: 0,
            valueSats: 40000n,
          },
        },
      });

      expect(decision.shouldRegister).toBe(false);
      expect(decision.action).toBe('complete');
    });

    it('does not emit registration attempt when vault is marked registered', () => {
      const decision = evaluateFundingStep({
        vault: {
          registered: true,
        },
      });

      expect(decision.shouldRegister).toBe(false);
      expect(decision.action).toBe('complete');
    });

    it('computes all funding steps as done when vaultReady is true (step 4 is never stuck in progress)', () => {
      const steps = computeFundingSteps({
        vault: {
          vaultIdHex: '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722',
          registered: true,
          funding: {
            txid: '5a22c1b59fca631ffa5b4375e36b88d83eff86d81278e75d55073bf6aef62683' as any,
            vout: 0,
            valueSats: 40000n,
          },
        },
        flow: 'ready',
      });

      expect(steps.length).toBe(6);
      expect(steps.every(s => s.done)).toBe(true);
      expect(steps[3].label).toBe('Deposit confirmed on L1');
      expect(steps[3].done).toBe(true);
    });
  });
});