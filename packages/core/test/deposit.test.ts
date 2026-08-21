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

      const result = await depositToVault({
        vault: { p2tr: vault.p2tr },
        userWallet,
        rpc: { baseUrl: DAEMON },
        amountSats: 40000n,
        feeRateSatVb: 2,
      });

      expect(result.txid).toBeDefined();
      expect(result.rawTxHex).toBeDefined();
      expect(typeof result.txid).toBe('string');
      expect(typeof result.rawTxHex).toBe('string');
      expect(result.txid.length).toBe(64);
      expect(/^[0-9a-f]+$/i.test(result.txid)).toBe(true);
      expect(result.rawTxHex.length).toBeGreaterThan(0);
      expect(/^[0-9a-f]+$/i.test(result.rawTxHex)).toBe(true);

      const expectedOutputScriptHex = Buffer.from(vault.p2tr.output).toString('hex');
      const verified = await verifyDepositProofOfReserves(DAEMON, result.txid, expectedOutputScriptHex);

      expect(verified).toBe(true);
    });
  });
});