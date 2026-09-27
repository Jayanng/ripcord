import { describe, it, expect, beforeAll } from 'vitest';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  depositToVault,
  addressToScriptPubKeyHex,
  computeFundingSteps,
  evaluateFundingStep,
  RipcordError,
  RipcordCode,
  type ExplicitSpendableInput,
} from '../src/index.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as vc from '@tachibtc/taurus-vault-core';

const DAEMON = 'https://rpc-regtest.tachibtc.com';
const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Real transaction hash captured from live regtest block 14201 on 2026-09-27
const REAL_CAPTURED_TXID =
  '5e5dc86d1b3dadf172d0ea30ceefc22bd1705e1c1abab8fa7346a94d349e4664';

describe('Faucet-chaining pure logic & deposit validation', () => {
  let identity: ReturnType<typeof deriveIdentity>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let vault: Awaited<ReturnType<typeof createVault>>;
  let userWallet: agg.Wallet;

  beforeAll(async () => {
    identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', 0);
    quorum = await getQuorum(DAEMON);
    vault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 1008,
      userKeyDescriptor: identity.userKeyDescriptor,
    });

    const rpcClient = new agg.BitcoinCoreRpcClient({ url: `${DAEMON}/` });
    const aggregator = await agg.WalletAggregator.fromMnemonic(ALICE_MNEMONIC, {
      network: 'regtest',
      rpc: rpcClient,
    });
    userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
  });

  describe('addressToScriptPubKeyHex', () => {
    it('correctly converts P2WPKH regtest address to scriptPubKey hex', () => {
      const scriptHex = addressToScriptPubKeyHex(identity.l1Address, 'regtest');
      expect(scriptHex).toMatch(/^0014[0-9a-f]{40}$/);
    });
  });

  describe('depositToVault explicit input validation', () => {
    it('rejects invalid txid format with INVALID_FORMAT', async () => {
      const badInput: ExplicitSpendableInput = {
        txid: 'not-a-valid-hex-txid',
        vout: 0,
        amountSats: 50_000_000n,
        scriptPubKey: addressToScriptPubKeyHex(identity.l1Address, 'regtest'),
      };

      await expect(
        depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        })
      ).rejects.toThrow(RipcordError);

      try {
        await depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        });
      } catch (err: any) {
        expect(err.code).toBe(RipcordCode.INVALID_FORMAT);
        expect(err.message).toContain('Invalid explicitInput txid');
      }
    });

    it('rejects invalid vout with INVALID_FORMAT', async () => {
      const badInput: ExplicitSpendableInput = {
        txid: REAL_CAPTURED_TXID,
        vout: -1,
        amountSats: 50_000_000n,
        scriptPubKey: addressToScriptPubKeyHex(identity.l1Address, 'regtest'),
      };

      await expect(
        depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        })
      ).rejects.toThrow(RipcordError);

      try {
        await depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        });
      } catch (err: any) {
        expect(err.code).toBe(RipcordCode.INVALID_FORMAT);
        expect(err.message).toContain('Invalid explicitInput vout');
      }
    });

    it('rejects non-positive amountSats with INVALID_FORMAT', async () => {
      const badInput: ExplicitSpendableInput = {
        txid: REAL_CAPTURED_TXID,
        vout: 0,
        amountSats: 0n,
        scriptPubKey: addressToScriptPubKeyHex(identity.l1Address, 'regtest'),
      };

      await expect(
        depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        })
      ).rejects.toThrow(RipcordError);

      try {
        await depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        });
      } catch (err: any) {
        expect(err.code).toBe(RipcordCode.INVALID_FORMAT);
        expect(err.message).toContain('Invalid explicitInput amountSats');
      }
    });

    it('rejects scriptPubKey mismatch when input does not pay to the user L1 address', async () => {
      // Bob at index 1 has a different L1 address and different scriptPubKey
      const otherIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest', 1);
      const wrongScriptHex = addressToScriptPubKeyHex(otherIdentity.l1Address, 'regtest');

      const badInput: ExplicitSpendableInput = {
        txid: REAL_CAPTURED_TXID,
        vout: 0,
        amountSats: 50_000_000n,
        scriptPubKey: wrongScriptHex,
      };

      await expect(
        depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        })
      ).rejects.toThrow(RipcordError);

      try {
        await depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: badInput,
        });
      } catch (err: any) {
        expect(err.code).toBe(RipcordCode.INVALID_FORMAT);
        expect(err.message).toContain('Explicit input scriptPubKey mismatch');
      }
    });

    it('refuses to overspend when explicit input cannot cover deposit amount plus fee', async () => {
      // Input value of only 1,000 sats cannot cover 40,000 sats deposit
      const smallInput: ExplicitSpendableInput = {
        txid: REAL_CAPTURED_TXID,
        vout: 0,
        amountSats: 1_000n,
        scriptPubKey: addressToScriptPubKeyHex(identity.l1Address, 'regtest'),
      };

      await expect(
        depositToVault({
          vault,
          userWallet,
          rpc: { baseUrl: DAEMON },
          amountSats: 40_000n,
          explicitInput: smallInput,
        })
      ).rejects.toThrow();
    });
  });

  describe('computeFundingSteps single-wait progression', () => {
    it('reflects single-wait reality where both faucet and deposit confirm in the mined block', () => {
      // 1. Ready state: nothing broadcast
      const readySteps = computeFundingSteps({
        flow: 'ready',
      });
      expect(readySteps.length).toBe(6);
      expect(readySteps.every(s => !s.done)).toBe(true);

      // 2. Faucet requested and chained deposit broadcast (confirming-deposit stage)
      const chainedSteps = computeFundingSteps({
        flow: 'confirming-deposit',
        depositTxid: REAL_CAPTURED_TXID,
        pendingFaucetTxid: REAL_CAPTURED_TXID,
      });
      // Both faucet broadcast and deposit broadcast are done immediately
      expect(chainedSteps[0].label).toBe('Faucet funds broadcast');
      expect(chainedSteps[0].done).toBe(true);
      expect(chainedSteps[1].label).toBe('Vault deposit broadcast');
      expect(chainedSteps[1].done).toBe(true);
      // Confirmations are waiting for the single block
      expect(chainedSteps[2].label).toBe('Faucet confirmed on L1');
      expect(chainedSteps[2].done).toBe(false);
      expect(chainedSteps[3].label).toBe('Deposit confirmed on L1');
      expect(chainedSteps[3].done).toBe(false);

      // 3. Block lands (minting stage): both faucet and deposit confirm together
      const minedSteps = computeFundingSteps({
        flow: 'minting',
        depositTxid: REAL_CAPTURED_TXID,
      });
      expect(minedSteps[0].done).toBe(true);
      expect(minedSteps[1].done).toBe(true);
      expect(minedSteps[2].label).toBe('Faucet confirmed on L1');
      expect(minedSteps[2].done).toBe(true);
      expect(minedSteps[3].label).toBe('Deposit confirmed on L1');
      expect(minedSteps[3].done).toBe(true);
      expect(minedSteps[4].label).toBe('Spendable VTXO minted');
      expect(minedSteps[4].done).toBe(false);

      // 4. Complete / vaultReady
      const completeSteps = computeFundingSteps({
        flow: 'complete',
        vault: {
          vaultIdHex: '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722',
          registered: true,
          funding: {
            txid: REAL_CAPTURED_TXID as any,
            vout: 0,
            valueSats: 40_000n,
          },
        },
      });
      expect(completeSteps.every(s => s.done)).toBe(true);
    });
  });

  describe('evaluateFundingStep decision logic', () => {
    it('emits deposit action when no deposit exists', () => {
      const decision = evaluateFundingStep({ vault: null });
      expect(decision.action).toBe('deposit');
      expect(decision.shouldRegister).toBe(false);
      expect(decision.stage).toBe('depositing');
    });

    it('emits complete action and suppresses registration when vault is already registered', () => {
      const decision = evaluateFundingStep({
        vault: {
          vaultIdHex: '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722',
          registered: true,
        },
      });
      expect(decision.action).toBe('complete');
      expect(decision.shouldRegister).toBe(false);
    });
  });
});
