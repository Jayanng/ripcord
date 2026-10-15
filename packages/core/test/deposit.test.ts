import { describe, it, expect, beforeAll } from 'vitest';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  depositToVault,
  verifyDepositProofOfReserves,
} from '../src/index.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import { TEST_NETWORK, TEST_DAEMON, syncWalletWithScan, ensureFixtureFunds, withTransportRetry, withScanBusyRetry, FIXTURE_FAUCET_NOTE } from './live-fixtures.js';
import * as vc from '@tachibtc/taurus-vault-core';

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DAEMON = TEST_DAEMON;

describe('deposit.ts', { timeout: 120000 }, () => {
  let aliceIdentity: Awaited<ReturnType<typeof deriveIdentity>>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let userWallet: agg.Wallet;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, TEST_NETWORK);
    quorum = await getQuorum(DAEMON);

    const rpcClient = new agg.BitcoinCoreRpcClient({ url: `${DAEMON}/` });
    const aggregator = await agg.WalletAggregator.fromMnemonic(ALICE_MNEMONIC, {
      network: TEST_NETWORK,
      rpc: rpcClient,
    });
    userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
    // NOTE: deposit.ts deliberately sends change to the VAULT USER's L1
    // address (its own audited design), which lives at a random high index the
    // account wallet never scans - so each run permanently moves ~41k sats out
    // of the wallet's view. Keep the fixture topped up via the faucet.
    await syncWalletWithScan(userWallet, `${DAEMON}/`);
  }, 240_000);

  function makeDepositDesc(index: number) {
    const netObj = agg.getNetwork(TEST_NETWORK);
    return vc.deriveUserKey(ALICE_MNEMONIC, netObj, { index }) as any;
  }

  async function makeVault(index: number) {
    return createVault({
      network: TEST_NETWORK,
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 1008,
      userKeyDescriptor: makeDepositDesc(index),
    });
  }

  describe('depositToVault', () => {
    // Live-money test: on signet the fixtures cannot self-heal (the faucet
    // requires human GitHub/X sign-in), so it runs only with pre-funded fixtures
    // (TACHI_SIGNET_FUNDED=1). Regtest runs it as before.
    it.skipIf(TEST_NETWORK === 'signet' && process.env.TACHI_SIGNET_FUNDED !== '1')('deposits 40000 sats, returns valid txid/rawTxHex, and verifies proof of reserves', async (ctx) => {
      const depFixtureUtxos = userWallet.utxos ?? [];
      const fixtureTotal = depFixtureUtxos.reduce(
        (sum: bigint, u: { valueSats?: bigint }) => sum + BigInt(u.valueSats ?? 0), 0n);
      // Round 7A-8: real deposit tx is ~85 + 68 vB per P2WPKH input; the first
      // attempt runs at 10 sat/vB (the ladder retries only on fee rejects,
      // never on insufficient funds). The old flat 40001/42000 admitted a
      // failing window above 42000.
      const needSats = 40_000n + 10n * (85n + 68n * BigInt(depFixtureUtxos.length || 1));
      if (fixtureTotal < needSats) {
        console.warn(`[fixture] skipped: ${fixtureTotal} sats in fixture wallet, need ${needSats} (40000 + first-attempt fee at 10 sat/vB) - ${FIXTURE_FAUCET_NOTE}`);
        ctx.skip(); // rules-allow(skip): fixture economics below the 40000 + first-attempt-fee need
        return;
      }

      // Fixture economics (live, measured): each run moves ~41k sats out of
      // the wallet's visible set (change lands on the vault user's address by
      // product design). ensureFixtureFunds self-heals via the faucet when
      // short; if funds are still unavailable (24h per-address faucet limit,
      // waiting on a block) skip LOUDLY instead of failing - this test spends
      // scarce live resources (AGENTS.md skipIf rule).
      const funds = await ensureFixtureFunds(userWallet, `${DAEMON}/`, needSats);
      if (funds.visibleSats < needSats) {
        console.warn(`[fixture] deposit.test skipped: ${funds.visibleSats} sats visible. ${funds.faucetMessage ?? ''} Re-run after the next block.`);
        ctx.skip(); // rules-allow(skip): conditional on live fixture funds after faucet attempt
        return;
      }
      // Vaults are atomic (verified): one deposit per vault. Use a fresh index
      // per run so repeat executions never collide with an already-funded vault.
      const freshIndex = 20000 + Math.floor(Math.random() * 100000);
      const vault = await makeVault(freshIndex);

      // Back-to-back suite runs can collide with the previous run's still-
      // unconfirmed deposit: coin selection picks the same UTXOs, the new tx
      // is treated as an RBF replacement, and Bitcoin Core rejects it when
      // the fee delta is too small (-26 insufficient fee). Retry with an
      // escalating fee rate and a wallet re-sync between attempts so the
      // wallet observes the mempool state before reselecting coins.
      let result: Awaited<ReturnType<typeof depositToVault>> | undefined;
      const feeRates = [10, 25, 50, 100, 200];
      for (const feeRate of feeRates) {
        try {
          result = await depositToVault({
            vault,
            userWallet,
            rpc: { baseUrl: DAEMON },
            amountSats: 40000n,
            feeRateSatVb: feeRate,
          });
          break;
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          if (/insufficient fee|rejecting replacement/.test(msg)) {
            await syncWalletWithScan(userWallet, `${DAEMON}/`);
            continue;
          }
          throw err;
        }
      }
      expect(result).toBeDefined();

      const txid = result!.txid;
      expect(typeof txid).toBe('string');
      expect(txid.length).toBe(64);
      expect(/^[0-9a-f]+$/i.test(txid)).toBe(true);
      expect(typeof result!.rawTxHex).toBe('string');
      expect(result!.rawTxHex.length).toBeGreaterThan(0);
      expect(/^[0-9a-f]+$/i.test(result!.rawTxHex)).toBe(true);
      expect(result!.amountSats).toBe(40000n);
      expect(result!.feeSats).toBeGreaterThan(0n);
      expect(result!.changeSats).toBeGreaterThanOrEqual(0n);
      expect(result!.vaultAddress).toBe(vault.address);
      expect(typeof result!.vout).toBe('number');
      expect(result!.vout).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result!.vout)).toBe(true);
      expect(result!.inputs.length).toBeGreaterThan(0);
      expect(result!.inputs.every(input => input.txid.length === 64 && input.vout >= 0)).toBe(true);

      // Proof of reserves: the on-chain scriptPubKey must equal the vault's
      // P2TR output script, the only check that binds the rebuild to money.
      const p2tr = vault.p2tr!;
      const expectedOutputScriptHex = Buffer.from(p2tr.output).toString('hex');
      const bitcoin = await import('bitcoinjs-lib');
      const decodedDepositTx = bitcoin.Transaction.fromHex(result!.rawTxHex);
      expect(Buffer.from(decodedDepositTx.outs[result!.vout].script).toString('hex').toLowerCase()).toBe(expectedOutputScriptHex.toLowerCase());
      if (result!.changeSats > 0n) {
        expect(decodedDepositTx.outs.length).toBeGreaterThan(1);
      }

      // The transaction may not be immediately available via getrawtransaction.
      // Retry with a short backoff.
      let verified = false;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          verified = await verifyDepositProofOfReserves(DAEMON, txid, expectedOutputScriptHex);
          if (verified) break;
        } catch (err) {
          lastError = err as Error;
          // If it's a "not found" error, wait and retry.
          const msg = String(err);
          if (!msg.includes('No such mempool or blockchain transaction')) {
            throw err;
          }
          // Wait before retry: 100ms, 200ms, 400ms, 800ms
          await new Promise(r => setTimeout(r, 100 * (2 ** attempt)));
        }
      }
      if (!verified) {
        throw lastError || new Error('Transaction not found after retries');
      }

      expect(verified).toBe(true);
    });
  });

  // Read-only test (getUtxos): runs on any network.
  it('routes SDK global RPC (getUtxos/scantxoutset) through the configured base URL', { timeout: 240_000 }, async () => {
    // Regression for the 2026-09-28 production "Failed to fetch": the SDK's
    // global rpcCall/getUtxos (taurus-wallet-aggregator chunk-V3QPXLNG.js:332/480)
    // POST to network.rpc.jsonRpc, whose default is the ABSOLUTE daemon URL that
    // browsers CORS-block (the daemon only CORS-enables GET /tachi_*).
    // useProxyAwareTaurusRpc must redirect the shared REGTEST config and the SDK
    // must honor that redirect at call time.
    const { useProxyAwareTaurusRpc } = await import('../src/deposit.js');
    const base = `${DAEMON}/`;
    useProxyAwareTaurusRpc(base, TEST_NETWORK);
    const sdkNet = (TEST_NETWORK === 'signet' ? agg.SIGNET : agg.REGTEST) as unknown as { rpc: { jsonRpc: string; rest: string } };
    expect(sdkNet.rpc.jsonRpc).toBe(base);
    expect(sdkNet.rpc.rest).toBe(base);
    // Live call THROUGH the redirected endpoint. Node has no CORS, so this
    // proves the config channel the browser fix depends on is real: if the SDK
    // read any other URL, this call would not follow our redirect.
    // Round 8A-1: getUtxos runs a scantxoutset; the shared node runs one at a
    // time, so ride out external scanners instead of flaking red.
    const utxos = await withScanBusyRetry(() => withTransportRetry(
      () => agg.getUtxos(TEST_NETWORK === 'signet' ? agg.SIGNET : agg.REGTEST, aliceIdentity.userAddress),
      { validate: (r: unknown) => { if (!Array.isArray(r)) throw new Error('getUtxos did not return an array'); } },
    ));
    expect(Array.isArray(utxos)).toBe(true);
    // restore the SDK default for any later tests in this process
    useProxyAwareTaurusRpc(DAEMON, TEST_NETWORK);
  });
});
