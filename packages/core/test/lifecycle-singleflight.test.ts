import { describe, it, expect, beforeAll } from 'vitest';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  fundVaultLifecycle,
  activeFundingRunCount,
  type VaultRecord,
} from '../src/index.js';
import { withTransportRetry } from './live-fixtures.js';

const DAEMON_URL = 'https://rpc-regtest.tachibtc.com';
const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Alice's live registered vault. Provenance: lifecycle-resilience.test.ts
// (live-verified funding outpoint + vault id on the regtest daemon).
const ALICE_VAULT_FUNDING_DISPLAY =
  '5a22c1b59fca631ffa5b4375e36b88d83eff86d81278e75d55073bf6aec92683' as import('../src/types.js').DisplayTxid;
const ALICE_VAULT_ID = '0d4e138c9432409e97d3c7f6309bf80cdbeb739e6ee1ba93c47d6044bf477722';

/**
 * Regression: concurrent funding re-entry over-minted (live-observed 2026-09-29).
 *
 * Three concurrent `fundVaultLifecycle` calls for the same vault round each ran
 * the full pipeline; the mint guard is check-then-act, so all three minted
 * credits for ONE deposit outpoint (3 x 39,999 sats against a single 40,000-sat
 * funding). The fix joins concurrent callers into one run. These tests exercise
 * the real daemon through the read-only registered-vault path (no broadcasts,
 * no faucet spend).
 */
describe('funding single-flight (regression: concurrent re-entry over-minted)', { timeout: 120_000 }, () => {
  let aliceVault: VaultRecord;

  beforeAll(async () => {
    const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', 0);
    const quorum = await withTransportRetry(() => getQuorum(DAEMON_URL));
    const derived = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: identity.userKeyDescriptor,
      threshold: quorum.threshold,
    });
    aliceVault = {
      ...derived,
      funding: { txid: ALICE_VAULT_FUNDING_DISPLAY, vout: 0, valueSats: 40_000n },
      vaultIdHex: ALICE_VAULT_ID,
      registered: true,
    };
  });

  it('joins concurrent funding runs for the same vault round into one run', async () => {
    const params = {
      vault: aliceVault,
      mnemonic: ALICE_MNEMONIC,
      bitcoinRpcBaseUrl: `${DAEMON_URL}/`,
      daemonBaseUrl: DAEMON_URL,
      amountSats: 0n,
      claimedOutpoints: [] as string[],
    };
    const results = await Promise.all([
      fundVaultLifecycle(params),
      fundVaultLifecycle(params),
      fundVaultLifecycle(params),
    ]);
    // Joined callers share the single run's result object. Without the fix each
    // call ran its own pipeline and resolved to a distinct result object.
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    expect(results[0].vaultId).toBe(ALICE_VAULT_ID);
  });

  it('cleans up the in-flight registry when the run completes', async () => {
    const params = {
      vault: aliceVault,
      mnemonic: ALICE_MNEMONIC,
      bitcoinRpcBaseUrl: `${DAEMON_URL}/`,
      daemonBaseUrl: DAEMON_URL,
      amountSats: 0n,
      claimedOutpoints: [] as string[],
    };
    const result = await fundVaultLifecycle(params);
    expect(result.vaultId).toBe(ALICE_VAULT_ID);
    expect(activeFundingRunCount()).toBe(0);
    // A sequential re-entry after completion is a fresh run, not a stuck join.
    const again = await fundVaultLifecycle(params);
    expect(again.vaultId).toBe(ALICE_VAULT_ID);
    expect(activeFundingRunCount()).toBe(0);
  });
});
