import { describe, it, expect, beforeAll } from 'vitest';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  depositToVault,
  addressToScriptPubKeyHex,
  computeFundingSteps,
  evaluateFundingStep,
  composeFlowErrorMessage,
  isDaemonSlowError,
  DAEMON_SLOW_NOTE,
  recoverVaultLifecycleState,
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

    it('advances through step machine when registration state is unknown', () => {
      // Step 1: No deposit yet -> deposit
      const step1 = evaluateFundingStep({
        vault,
        registrationState: 'unknown',
      });
      expect(step1.action).toBe('deposit');
      expect(step1.stage).toBe('depositing');

      // Step 2: Deposit broadcast, unconfirmed -> confirm-deposit
      const step2 = evaluateFundingStep({
        vault,
        deposit: { txid: REAL_CAPTURED_TXID, vout: 0 },
        hasConfirmedDeposit: false,
        registrationState: 'unknown',
      });
      expect(step2.action).toBe('confirm-deposit');
      expect(step2.stage).toBe('confirming-deposit');

      // Step 3: Deposit confirmed, no VTXO -> mint
      const step3 = evaluateFundingStep({
        vault,
        deposit: { txid: REAL_CAPTURED_TXID, vout: 0 },
        hasConfirmedDeposit: true,
        hasVtxo: false,
        registrationState: 'unknown',
      });
      expect(step3.action).toBe('mint');
      expect(step3.stage).toBe('minting');

      // Step 4: Deposit confirmed, VTXO minted -> register
      const step4 = evaluateFundingStep({
        vault,
        deposit: { txid: REAL_CAPTURED_TXID, vout: 0 },
        hasConfirmedDeposit: true,
        hasVtxo: true,
        registrationState: 'unknown',
      });
      expect(step4.action).toBe('register');
      expect(step4.shouldRegister).toBe(true);
      expect(step4.stage).toBe('registering');

      // Step 5: Later registered -> complete
      const step5 = evaluateFundingStep({
        vault,
        deposit: { txid: REAL_CAPTURED_TXID, vout: 0 },
        hasConfirmedDeposit: true,
        hasVtxo: true,
        registrationState: 'registered',
      });
      expect(step5.action).toBe('complete');
      expect(step5.shouldRegister).toBe(false);
    });
  });

  describe('recoverVaultLifecycleState soft-fail behavior', () => {
    it('returns local vault unchanged when daemon listVaults query fails', async () => {
      // Test double for NETWORK TIMING/FAILURE only: simulates daemon lookup failure
      // while Bitcoin RPC finds a confirmed deposit.
      const timingFailFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('tachi_listVaults')) {
          throw new DOMException('listVaults: query timed out after 50ms', 'AbortError');
        }
        // Simulated Bitcoin RPC scantxoutset response
        return new Response(JSON.stringify({
          result: {
            unspents: [{
              txid: REAL_CAPTURED_TXID,
              vout: 0,
              scriptPubKey: vault.p2tr ? Buffer.from(vault.p2tr.output).toString('hex') : '',
              amount: 0.0004,
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const recovered = await recoverVaultLifecycleState({
        vault,
        bitcoinRpcBaseUrl: 'http://127.0.0.1:18443',
        daemonBaseUrl: 'http://127.0.0.1:26657',
        fetchImpl: timingFailFetch,
        timeoutMs: 50,
      });

      // Does NOT throw; returns local vault unchanged (Rule: soft-fail in status/recovery contexts)
      expect(recovered).toEqual(vault);
      expect(recovered.registered).toBe(false);
    }, 20_000);
  });

  describe('composeFlowErrorMessage friendly error surfacing', () => {
    it('composes friendly note for the exact live production timeout failure', () => {
      const liveProdError = new Error(
        'Unknown error: listVaults: query to https://ripcord-wallet.vercel.app/tachi_listVaults?user=03f65e00000000000000000000000000000000000000000000000000000000025d&page_size=100 timed out after 10000ms: the daemon did not answer in time; it may be slow or down'
      );
      const friendly = composeFlowErrorMessage(liveProdError);
      expect(friendly).toBe(DAEMON_SLOW_NOTE);
      expect(friendly).not.toContain('Unknown error');
      expect(isDaemonSlowError(liveProdError)).toBe(true);
    });

    it('composes friendly note for timeouts, aborts, deadline exceeded, and 502s', () => {
      expect(composeFlowErrorMessage(new DOMException('The operation was aborted', 'AbortError'))).toBe(DAEMON_SLOW_NOTE);
      expect(composeFlowErrorMessage(new Error('context deadline exceeded'))).toBe(DAEMON_SLOW_NOTE);
      expect(composeFlowErrorMessage(new Error('HTTP 502 Bad Gateway from https://rpc-regtest.tachibtc.com'))).toBe(DAEMON_SLOW_NOTE);
      expect(composeFlowErrorMessage(new Error('the daemon did not answer in time; it may be slow or down'))).toBe(DAEMON_SLOW_NOTE);
    });

    it('does not mask non-slow errors and strips any Unknown error: prefix', () => {
      const nonSlow = new Error('Unknown error: Invalid mnemonic word count');
      const formatted = composeFlowErrorMessage(nonSlow);
      expect(formatted).toBe('Invalid mnemonic word count');
      expect(isDaemonSlowError(nonSlow)).toBe(false);
    });
  });
});
