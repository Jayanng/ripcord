import { describe, it, expect, beforeAll } from 'vitest';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  depositToVault,
  verifyDepositProofOfReserves,
} from '../src/index.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as vc from '@tachibtc/taurus-vault-core';

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DAEMON = 'https://rpc-regtest.tachibtc.com';

describe('deposit.ts', { timeout: 120000 }, () => {
  let aliceIdentity: Awaited<ReturnType<typeof deriveIdentity>>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let userWallet: agg.Wallet;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    quorum = await getQuorum(DAEMON);

    const rpcClient = new agg.BitcoinCoreRpcClient({ url: `${DAEMON}/` });
    const aggregator = await agg.WalletAggregator.fromMnemonic(ALICE_MNEMONIC, {
      network: 'regtest',
      rpc: rpcClient,
    });
    userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
    await userWallet.sync();
  });

  function makeDepositDesc(index: number) {
    const netObj = agg.getNetwork('regtest');
    return vc.deriveUserKey(ALICE_MNEMONIC, netObj, { index }) as any;
  }

  async function makeVault(index: number) {
    return createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 1008,
      userKeyDescriptor: makeDepositDesc(index),
    });
  }

  describe('depositToVault', () => {
    it('deposits 40000 sats, returns valid txid/rawTxHex, and verifies proof of reserves', async () => {
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
            await userWallet.sync();
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

      // Proof of reserves: the on-chain scriptPubKey must equal the vault's
      // P2TR output script, the only check that binds the rebuild to money.
      const p2tr = vault.p2tr!;
      const expectedOutputScriptHex = Buffer.from(p2tr.output).toString('hex');

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
});
