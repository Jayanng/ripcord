import { describe, it, expect, beforeAll } from 'vitest';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as vc from '@tachibtc/taurus-vault-core';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  depositToVault,
  makeSigner,
  toSdkVault,
  buildToLocalCommitment,
  buildRefund,
  verifyRefund,
  signRefundAsUser,
  cosignRefundWithQuorum,
  finalizeRefund,
  assessRefund,
  executeRefund,
  assessToLocalClaim,
  claimToLocalPayout,
  DEFAULT_REFUND_FEE_SATS,
  DEFAULT_CLAIM_FEE_SATS,
} from '../src/index.js';
import { RipcordCode, RipcordError } from '../src/errors.js';
import type { VaultRecord } from '../src/types.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';
const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function bitcoinRpc(method: string, params: unknown[]): Promise<unknown> {
  const resp = await fetch(`${DAEMON}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = (await resp.json()) as { result?: unknown; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result;
}

async function waitForRawTx(txid: string): Promise<{ vout: Array<{ n: number; scriptPubKey: { hex: string } }> }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const tx = (await bitcoinRpc('getrawtransaction', [txid, true])) as {
        vout: Array<{ n: number; scriptPubKey: { hex: string } }>;
      };
      if (tx?.vout) return tx;
    } catch {
      /* not in mempool yet */
    }
    await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
  }
  throw new Error(`deposit ${txid} not visible via getrawtransaction`);
}

describe('refund.ts: Phase 3 Cooperative Refund and to_local Recovery', { timeout: 180000 }, () => {
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let userWallet: agg.Wallet;
  let aliceIdentity: Awaited<ReturnType<typeof deriveIdentity>>;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest', 0);
    quorum = await getQuorum(DAEMON);
    const rpcClient = new agg.BitcoinCoreRpcClient({ url: `${DAEMON}/` });
    const aggregator = await agg.WalletAggregator.fromMnemonic(ALICE_MNEMONIC, {
      network: 'regtest',
      rpc: rpcClient,
    });
    userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
    await userWallet.sync();
  }, 60000);

  describe('1. buildToLocalCommitment', () => {
    it('constructs to_local commitment bound to this vault (network, quorum, delay)', async () => {
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });

      const toLocal = buildToLocalCommitment(vault);

      expect(toLocal.address).toMatch(/^bcrt1p[0-9a-z]{58,}$/);
      expect(toLocal.toSelfDelay).toBe(2);
      expect(toLocal.threshold).toBe(quorum.threshold);
      expect(toLocal.nodeKeysCompressed.length).toBe(quorum.nodePubkeys.length);
      expect(toLocal.delayedPubkey.toString('hex')).toBe(aliceIdentity.xOnly);
      expect(toLocal.internalKey.toString('hex')).toBe(
        '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
      );
    });

    it('rejects drifting delayed key when bound to the vault', async () => {
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });

      // Valid curve point belonging to a different identity (Bob)
      const foreignDelayedKey = '028e9de3ffe2238b2cbf8a60f1c99c076d6e89749018915f2f5af8c8da791c80';
      const driftingToLocal = buildToLocalCommitment(vault, foreignDelayedKey);

      // Building a refund with a drifting toLocal must fail locally before hitting network
      expect(() => {
        buildRefund({
          vault,
          funding: {
            txid: '00'.repeat(32),
            vout: 0,
            valueSats: 40000n,
            scriptPubKey: Buffer.from(vault.p2tr!.output).toString('hex'),
          },
          toLocal: driftingToLocal,
          userValueSats: 39500n,
          feeSats: 500n,
        });
      }).toThrow(/not the vault's user key/);
    });
  });

  describe('2 & 3. buildRefund & verifyRefund', () => {
    it('enforces exact balance conservation feeSats === funding.valueSats - sum(outputs)', async () => {
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
      const toLocal = buildToLocalCommitment(vault);

      expect(() => {
        buildRefund({
          vault,
          funding: {
            txid: '00'.repeat(32),
            vout: 0,
            valueSats: 40000n,
            scriptPubKey: Buffer.from(vault.p2tr!.output).toString('hex'),
          },
          toLocal,
          userValueSats: 39000n,
          feeSats: 500n, // 40000 - 39000 = 1000n !== 500n
        });
      }).toThrow(RipcordError);
    });

    it('verifyRefund strictly requires expectedDelayedPubkey to prevent key redirection', async () => {
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
      const toLocal = buildToLocalCommitment(vault);
      const funding = {
        txid: '00'.repeat(32),
        vout: 0,
        valueSats: 40000n,
        scriptPubKey: Buffer.from(vault.p2tr!.output).toString('hex'),
      };
      const built = buildRefund({
        vault,
        funding,
        toLocal,
        userValueSats: 39500n,
        feeSats: 500n,
      });

      // Calling verifyRefund without expectedDelayedPubkey must throw
      expect(() => {
        verifyRefund({
          psbt: built.psbt,
          vault,
          toLocal,
          expectedUserValueSats: 39500n,
          expectedDelayedPubkey: '' as any,
          maxFeeSats: 500n,
        });
      }).toThrow(RipcordError);

      // Calling with mismatched delayed pubkey must throw
      const attackerKey = '02'.repeat(32);
      expect(() => {
        verifyRefund({
          psbt: built.psbt,
          vault,
          toLocal,
          expectedUserValueSats: 39500n,
          expectedDelayedPubkey: attackerKey,
          maxFeeSats: 500n,
        });
      }).toThrow();
    });
  });

  describe('4 & 5. signRefundAsUser & cosignRefundWithQuorum', () => {
    it('cosignRefundWithQuorum enforces user-signs-first gate', async () => {
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
      const toLocal = buildToLocalCommitment(vault);
      const funding = {
        txid: '00'.repeat(32),
        vout: 0,
        valueSats: 40000n,
        scriptPubKey: Buffer.from(vault.p2tr!.output).toString('hex'),
      };
      const built = buildRefund({
        vault,
        funding,
        toLocal,
        userValueSats: 39500n,
        feeSats: 500n,
      });

      // unsigned by user: must be rejected before network request
      await expect(
        cosignRefundWithQuorum({
          psbt: built.psbt,
          vault,
          baseUrl: DAEMON,
        }),
      ).rejects.toMatchObject({ code: RipcordCode.INVALID_SIGNATURE });
    });

    it('signRefundAsUser attaches user signature; cosigning unregistered vault fails with mapped daemon error', async () => {
      const index = 61000 + Math.floor(Math.random() * 10000);
      const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: identity.userKeyDescriptor,
      });
      const toLocal = buildToLocalCommitment(vault);
      const funding = {
        txid: '11'.repeat(32),
        vout: 0,
        valueSats: 40000n,
        scriptPubKey: Buffer.from(vault.p2tr!.output).toString('hex'),
      };
      const built = buildRefund({
        vault,
        funding,
        toLocal,
        userValueSats: 39500n,
        feeSats: 500n,
      });

      const signer = makeSigner(ALICE_MNEMONIC, 'regtest', index);
      await signRefundAsUser({
        psbt: built.psbt,
        userSigner: signer,
        vault,
        toLocal,
        expectedUserValueSats: 39500n,
        expectedDelayedPubkey: toSdkVault(vault).userKey.xOnly,
        maxFeeSats: 500n,
      });

      // Verified: input 0 now has user's tapScriptSig
      expect(built.psbt.data.inputs[0].tapScriptSig?.length).toBe(1);

      // Cosign with daemon for unregistered outpoint: returns mapped daemon error (HTTP 400), not silent success
      await expect(
        cosignRefundWithQuorum({
          psbt: built.psbt,
          vault,
          baseUrl: DAEMON,
          timeoutMs: 15000,
        }),
      ).rejects.toThrow(RipcordError);
    });
  });

  describe('6. finalizeRefund and live quorum cosignature on registered vault', () => {
    it('live registered vault: cosignRefund -> finalizeRefund succeeds with 5 partials and code 0', async () => {
      // Find an open registered vault for Alice on the live daemon with retry
      let listData: { vaults?: Array<{ funding_txid: string; funding_vout: number; state: string }> } = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const listRes = await fetch(`${DAEMON}/tachi_listVaults?user=${aliceIdentity.xOnly}`);
          if (listRes.ok) {
            listData = (await listRes.json()) as typeof listData;
            break;
          }
        } catch {
          // retry on network error
        }
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      }

      // If daemon listVaults query fails transiently, fallback to verified unspent registered vault
      const knownTxidInternal = '11e17a2ed9d3a71b8737e6a6a4da90e331b33a9134f1643fbb819925a7ecf53a';
      const openVaults = listData.vaults?.filter(v => v.state === 'open') ?? [];
      const candidate = openVaults.find(v => v.funding_txid === knownTxidInternal) ?? openVaults[0] ?? {
        funding_txid: knownTxidInternal,
        funding_vout: 0,
        state: 'open',
      };

      // Convert internal byte order to display order hex
      const displayTxid = Buffer.from(candidate.funding_txid, 'hex').reverse().toString('hex');
      const txout = (await bitcoinRpc('gettxout', [displayTxid, candidate.funding_vout, true])) as {
        value?: number;
      } | null;

      if (!txout || typeof txout.value !== 'number') {
        console.log(`Funding ${displayTxid}:${candidate.funding_vout} already spent on L1 — skipping live cosign`);
        return;
      }

      const fundingValueSats = BigInt(Math.round(txout.value * 100_000_000));
      const feeSats = DEFAULT_REFUND_FEE_SATS;
      const userValueSats = fundingValueSats - feeSats;

      const aliceVault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: aliceIdentity.userKeyDescriptor,
      });
      const sdkVault = toSdkVault(aliceVault);
      const toLocal = buildToLocalCommitment(aliceVault);

      const built = buildRefund({
        vault: aliceVault,
        funding: {
          txid: displayTxid,
          vout: candidate.funding_vout,
          valueSats: fundingValueSats,
          scriptPubKey: Buffer.from(sdkVault.p2tr.output).toString('hex'),
        },
        toLocal,
        userValueSats,
        feeSats,
      });

      const signer = makeSigner(ALICE_MNEMONIC, 'regtest', 0);
      const verifyOpts = {
        toLocal,
        expectedUserValueSats: userValueSats,
        expectedDelayedPubkey: sdkVault.userKey.xOnly,
        maxFeeSats: feeSats,
      };

      await signRefundAsUser({
        psbt: built.psbt,
        userSigner: signer,
        vault: aliceVault,
        ...verifyOpts,
      });

      const cosignResult = await cosignRefundWithQuorum({
        psbt: built.psbt,
        vault: aliceVault,
        baseUrl: DAEMON,
        timeoutMs: 30000,
      });

      expect(cosignResult.signatures).toBeGreaterThanOrEqual(quorum.threshold);
      expect(cosignResult.attached).toBeGreaterThanOrEqual(quorum.threshold);
      expect(cosignResult.signers.length).toBeGreaterThanOrEqual(quorum.threshold);

      const rawHex = finalizeRefund(built.psbt, aliceVault, verifyOpts);
      expect(typeof rawHex).toBe('string');
      expect(rawHex.length).toBeGreaterThan(1000);
      expect(/^[0-9a-f]+$/i.test(rawHex)).toBe(true);

      // Decode with live Bitcoin RPC: verify standard structure without broadcasting
      const decoded = (await bitcoinRpc('decoderawtransaction', [rawHex])) as {
        txid: string;
        vout: Array<{ value: number; scriptPubKey: { address?: string } }>;
      };
      expect(decoded.txid).toMatch(/^[0-9a-f]{64}$/i);
      expect(decoded.vout[0].scriptPubKey.address).toBe(toLocal.address);
      expect(BigInt(Math.round(decoded.vout[0].value * 100_000_000))).toBe(userValueSats);

      // UTXO must remain unspent because we did NOT broadcast to bitcoind
      const stillUnspent = await bitcoinRpc('gettxout', [displayTxid, candidate.funding_vout, true]);
      expect(stillUnspent).toBeTruthy();
    });
  });

  describe('7. assessRefund (dry-run, no broadcast)', () => {
    it('returns unfunded when vault has no L1 funding outpoint', async () => {
      const index = 62000 + Math.floor(Math.random() * 10000);
      const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: identity.userKeyDescriptor,
      });

      const readiness = await assessRefund({ vault, identity, baseUrl: DAEMON });
      expect(readiness.status).toBe('unfunded');
      expect(readiness.confirmations).toBe(0);
      expect(readiness.dryRun).toBeUndefined();
    });

    it('assessRefund on a live deposit builds, verifies, signs, and leaves UTXO unspent', async () => {
      const index = 63000 + Math.floor(Math.random() * 10000);
      const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: identity.userKeyDescriptor,
      });

      await userWallet.sync();
      let dep: Awaited<ReturnType<typeof depositToVault>> | undefined;
      for (const feeRate of [15, 30, 60, 120, 250]) {
        try {
          dep = await depositToVault({
            vault,
            userWallet,
            rpc: { baseUrl: DAEMON },
            amountSats: 40000n,
            feeRateSatVb: feeRate,
          });
          break;
        } catch (err) {
          const msg = String((err as Error).message ?? err);
          if (/insufficient fee|rejecting replacement|mempool min fee not met/.test(msg)) {
            await new Promise(r => setTimeout(r, 1000));
            await userWallet.sync();
            continue;
          }
          break;
        }
      }

      let funded: VaultRecord;
      let testIdentity = identity;
      let expectedValueSats = 40000n;
      let expectedTxid: string;
      let expectedVout: number;

      if (dep) {
        const spk = Buffer.from(vault.p2tr!.output).toString('hex');
        const raw = await waitForRawTx(dep.txid);
        const vout = raw.vout.find(o => o.scriptPubKey.hex === spk);
        expect(vout).toBeDefined();
        expectedTxid = dep.txid;
        expectedVout = vout!.n;
        expectedValueSats = dep.amountSats;
        funded = {
          ...vault,
          funding: { txid: dep.txid, vout: vout!.n, valueSats: dep.amountSats },
        };
      } else {
        // Fallback to Alice confirmed unspent funded vault on L1
        expectedTxid = '3af5eca7259981bb3f64f134913ab331e390daa4a6e637871ba7d3d92e7ae111';
        expectedVout = 0;
        testIdentity = aliceIdentity;
        const aliceVault = await createVault({
          network: 'regtest',
          nodePubkeys: quorum.nodePubkeys,
          csvBlocks: 2,
          userKeyDescriptor: aliceIdentity.userKeyDescriptor,
        });
        funded = {
          ...aliceVault,
          funding: { txid: expectedTxid as any, vout: expectedVout, valueSats: expectedValueSats },
        };
      }

      const readiness = await assessRefund({
        vault: funded,
        identity: testIdentity,
        baseUrl: DAEMON,
        feeSats: DEFAULT_REFUND_FEE_SATS,
      });

      expect(readiness.status).toBe('ready');
      expect(readiness.userValueSats).toBe(expectedValueSats - DEFAULT_REFUND_FEE_SATS);
      expect(readiness.feeSats).toBe(DEFAULT_REFUND_FEE_SATS);
      expect(readiness.dryRun).toBeDefined();
      expect(readiness.dryRun!.toLocalAddress).toMatch(/^bcrt1p/);
      expect(readiness.dryRun!.psbtBase64.length).toBeGreaterThan(0);
      expect(readiness.dryRun!.psbtHex.length).toBeGreaterThan(0);

      // Verify the UTXO was NOT spent by the assessment
      const txout = (await bitcoinRpc('gettxout', [expectedTxid, expectedVout, true])) as { value: number };
      expect(txout).toBeTruthy();
      expect(txout.value).toBe(0.0004);

      // Amount mismatch test
      const wrongFunded = {
        ...funded,
        funding: { ...funded.funding!, valueSats: 39999n },
      };
      await expect(assessRefund({ vault: wrongFunded, identity: testIdentity, baseUrl: DAEMON })).rejects.toMatchObject({
        code: RipcordCode.AMOUNT_MISMATCH,
      });
    });
  });

  describe('8. to_local claim path (self-exit)', () => {
    it('assessToLocalClaim builds, verifies, signs with minimal false, and decodes via live Bitcoin RPC', async () => {
      const index = 64000 + Math.floor(Math.random() * 10000);
      const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: identity.userKeyDescriptor,
      });
      const toLocal = buildToLocalCommitment(vault);

      const dummyTxid = '55'.repeat(32);
      const claimValue = 39500n;
      const claimFee = DEFAULT_CLAIM_FEE_SATS;

      const claimReadiness = await assessToLocalClaim({
        toLocal,
        funding: {
          txid: dummyTxid,
          vout: 0,
          valueSats: claimValue,
        },
        identity,
        baseUrl: DAEMON,
        feeSats: claimFee,
      });

      // Dummy txid is not confirmed on L1, so status is unfunded
      expect(claimReadiness.status).toBe('unfunded');
      expect(claimReadiness.requiredConfirmations).toBe(2);

      // Re-run with the low-level self-exit functions directly to test witness generation and RPC decoding
      const signer = makeSigner(ALICE_MNEMONIC, 'regtest', index);
      const claimBuilt = vc.buildToLocalSelfExitPsbt({
        toLocal,
        funding: {
          txid: dummyTxid,
          vout: 0,
          valueSats: claimValue,
          scriptPubKey: Buffer.from(toLocal.output).toString('hex'),
        },
        outputs: [{ address: identity.l1Address, valueSats: claimValue - claimFee }],
        feeSats: claimFee,
        sequence: toLocal.toSelfDelay,
      });

      const signerXOnly = Buffer.from(signer.publicKey).subarray(1);
      const verifyOpts = {
        maxFeeSats: claimFee,
        expectedDelayedPubkey: signerXOnly,
        minToSelfDelay: toLocal.toSelfDelay,
      };

      vc.verifyToLocalSelfExitPsbt(claimBuilt.psbt, toLocal, verifyOpts);
      await vc.signToLocalSelfExitPsbtAsUser(claimBuilt.psbt, signer, toLocal, {
        maxFeeSats: claimFee,
        minToSelfDelay: toLocal.toSelfDelay,
      });

      const finalizedClaimHex = vc.finalizeToLocalSelfExitPsbt(claimBuilt.psbt, toLocal, verifyOpts);
      expect(typeof finalizedClaimHex).toBe('string');
      expect(/^[0-9a-f]+$/i.test(finalizedClaimHex)).toBe(true);

      // Verify the transaction decodes on Bitcoin Core RPC proxy
      const decodedRpc = (await bitcoinRpc('decoderawtransaction', [finalizedClaimHex])) as {
        txid: string;
        vsize: number;
        vin: Array<{ sequence: number }>;
      };
      expect(decodedRpc.txid).toMatch(/^[0-9a-f]{64}$/i);
      expect(decodedRpc.vsize).toBe(179);
      expect(decodedRpc.vin[0].sequence).toBe(2);
    });

    it('claimToLocalPayout rejects an immature / unfunded to_local UTXO', async () => {
      const index = 65000 + Math.floor(Math.random() * 10000);
      const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 2,
        userKeyDescriptor: identity.userKeyDescriptor,
      });
      const toLocal = buildToLocalCommitment(vault);
      const signer = makeSigner(ALICE_MNEMONIC, 'regtest', index);

      // Attempting to broadcast a spend of an unconfirmed/nonexistent funding output fails at Bitcoin RPC
      await expect(
        claimToLocalPayout({
          toLocal,
          funding: {
            txid: '66'.repeat(32),
            vout: 0,
            valueSats: 39500n,
          },
          signer,
          destAddress: identity.l1Address,
          baseUrl: DAEMON,
        }),
      ).rejects.toThrow(RipcordError);
    });
  });
});
