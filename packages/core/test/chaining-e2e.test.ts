import { describe, it, expect } from 'vitest';
import { generateMnemonic } from 'bip39';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  fundVaultLifecycle,
  addressToScriptPubKeyHex,
  crossCheckBalance,
  type ExplicitSpendableInput,
} from '../src/index.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';

const DAEMON_URL = 'https://rpc-regtest.tachibtc.com';
const FAUCET_URL = 'https://faucet.tachibtc.com';

function isPreConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    const code = (current as Error & { code?: string }).code;
    if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ENOTFOUND') {
      return true;
    }
    current = current.cause;
  }
  return false;
}

async function requestFaucet(address: string): Promise<string> {
  let resp: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      resp = await fetch(`${FAUCET_URL}/api/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, amountBtc: 0.5 }),
        signal: AbortSignal.timeout(30000),
      });
      break;
    } catch (error) {
      if (attempt >= 3 || !isPreConnectionFailure(error)) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  const data = await resp.json();
  if (data.error) {
    throw new Error(`Faucet error: ${data.error}`);
  }
  if (!data.txid) {
    throw new Error(`Faucet response missing txid: ${JSON.stringify(data)}`);
  }
  return data.txid;
}

// 0-conf chaining cuts the wait to ONE block wait (~10 min worst case).
// 20 minutes (1,200,000 ms) provides plenty of headroom for a single L1 wait.
const SINGLE_WAIT_TIMEOUT_MS = 1_200_000;

describe.skipIf(!process.env.RIPCORD_LIVE)(
  '0-conf faucet chaining live end-to-end: faucet → chained deposit → single wait → mint → register',
  { timeout: SINGLE_WAIT_TIMEOUT_MS },
  () => {
    it(
      'executes full funding flow in a single block wait with same-block evidence',
      async () => {
        const wallClockStart = Date.now();

      // 1. Fresh identity with distinct userKeyIndex
      const mnemonic = generateMnemonic(128);
      const userKeyIndex = 10000 + Math.floor(Math.random() * 80000);
      const identity = deriveIdentity(mnemonic, 'regtest', userKeyIndex);

      console.log('\n=============================================================');
      console.log('FAUCET-CHAINING LIVE END-TO-END VERIFICATION');
      console.log('=============================================================');
      console.log('L1 Settlement Address:', identity.l1Address);
      console.log('User Key Index:       ', userKeyIndex);

      // 2. Request faucet payout (0.5 BTC)
      const faucetRequestStart = Date.now();
      const faucetTxid = await requestFaucet(identity.l1Address);
      const faucetRequestMs = Date.now() - faucetRequestStart;
      console.log(`Faucet payout received: ${faucetTxid} (${faucetRequestMs}ms)`);

      // 3. Immediately resolve payout UTXO from mempool (0-conf)
      const rpcClient = new agg.BitcoinCoreRpcClient({ url: DAEMON_URL });
      const expectedScriptHex = addressToScriptPubKeyHex(identity.l1Address, 'regtest').toLowerCase();

      let explicitInput: ExplicitSpendableInput | null = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const raw = (await rpcClient.call('getrawtransaction', [faucetTxid, true])) as any;
          const match = raw.vout?.find(
            (v: any) =>
              v.scriptPubKey?.hex?.toLowerCase() === expectedScriptHex ||
              v.scriptPubKey?.address === identity.l1Address
          );
          if (match) {
            explicitInput = {
              txid: faucetTxid,
              vout: match.n,
              amountSats: BigInt(Math.round(match.value * 1e8)),
              scriptPubKey: match.scriptPubKey.hex,
            };
            break;
          }
        } catch {
          // Retry briefly while mempool catches up
        }
        await new Promise(r => setTimeout(r, 500));
      }

      expect(explicitInput).not.toBeNull();
      console.log('Mempool Payout Resolved:', {
        txid: explicitInput!.txid,
        vout: explicitInput!.vout,
        amountSats: explicitInput!.amountSats.toString(),
      });

      // 4. Derive vault
      const quorum = await getQuorum(DAEMON_URL);
      const vault = await createVault({
        network: 'regtest',
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 1008,
        userKeyDescriptor: identity.userKeyDescriptor,
      });

      // 5. Execute chained deposit → SINGLE WAIT → mint → register
      let depositBroadcastTxid = '';
      let progressStage = '';
      const lifecycleResult = await fundVaultLifecycle({
        vault,
        mnemonic,
        bitcoinRpcBaseUrl: DAEMON_URL,
        daemonBaseUrl: DAEMON_URL,
        amountSats: 40_000n,
        feeRateSatVb: 2,
        explicitInput: explicitInput!,
        onProgress: stage => {
          progressStage = stage;
          console.log(`[Lifecycle Progress] Stage: ${stage} (${((Date.now() - wallClockStart) / 1000).toFixed(1)}s elapsed)`);
        },
        onDepositBroadcast: dep => {
          depositBroadcastTxid = dep.txid;
          console.log(`[Chained Deposit Broadcast] ${dep.txid} (fee: ${dep.feeSats} sats, change: ${dep.changeSats} sats)`);
        },
        onConfirmationPoll: confs => {
          if (confs > 0) {
            console.log(`[L1 Block Mined] Deposit confirmed with ${confs} confirmation(s)!`);
          }
        },
      });

      const wallClockElapsedSec = (Date.now() - wallClockStart) / 1000;
      const wallClockMin = (wallClockElapsedSec / 60).toFixed(2);

      // (a) EVIDENCE: Wall-clock duration
      console.log('\n--- (a) EVIDENCE: Wall-clock duration ---');
      console.log(`Total funding flow wall-clock time: ${wallClockElapsedSec.toFixed(1)}s (~${wallClockMin} minutes)`);
      console.log('Cut from ~20 minutes (two block waits) to a single L1 block wait.');

      // (b) EVIDENCE: Same block confirmation
      const faucetRaw = (await rpcClient.call('getrawtransaction', [faucetTxid, true])) as any;
      const depositRaw = (await rpcClient.call('getrawtransaction', [lifecycleResult.deposit.txid, true])) as any;

      const faucetBlockHash = faucetRaw.blockhash;
      const depositBlockHash = depositRaw.blockhash;

      expect(faucetBlockHash).toBeDefined();
      expect(depositBlockHash).toBeDefined();
      expect(faucetBlockHash).toBe(depositBlockHash);

      const blockInfo = (await rpcClient.call('getblock', [depositBlockHash, 1])) as any;
      const blockContainsFaucet = blockInfo.tx.includes(faucetTxid);
      const blockContainsDeposit = blockInfo.tx.includes(lifecycleResult.deposit.txid);

      console.log('\n--- (b) EVIDENCE: Same block confirmation ---');
      console.log('Block Hash:             ', depositBlockHash);
      console.log('Block Height:           ', blockInfo.height);
      console.log('Faucet TXID:            ', faucetTxid);
      console.log('Deposit TXID:           ', lifecycleResult.deposit.txid);
      console.log('Both in same block:     ', faucetBlockHash === depositBlockHash);
      console.log('Block contains faucet:  ', blockContainsFaucet);
      console.log('Block contains deposit: ', blockContainsDeposit);

      expect(blockContainsFaucet).toBe(true);
      expect(blockContainsDeposit).toBe(true);

      // (c) EVIDENCE: Mint + Registration success
      console.log('\n--- (c) EVIDENCE: Mint + Registration success ---');
      console.log('Minted VTXO ID:         ', lifecycleResult.vtxoId);
      console.log('Mint Tx Hash:           ', lifecycleResult.mintTxHash);
      console.log('Mint Epoch:             ', lifecycleResult.mintEpoch);
      console.log('Registered Vault ID:    ', lifecycleResult.vaultId);

      expect(lifecycleResult.vtxoId).toBeTruthy();
      expect(lifecycleResult.vaultId).toBeTruthy();
      expect(lifecycleResult.deposit.amountSats).toBe(40_000n);

      // (d) EVIDENCE: Balance cross-check reconciling exactly
      // 40,000 sats deposit - 1 sat mint fee - 1 sat registration fee = 39,998 sats
      const expectedBalanceSats = 40_000n - 2n;
      const crossCheck = await crossCheckBalance({
        ownerXOnly: identity.xOnly,
        baseUrl: DAEMON_URL,
        snapshotSats: expectedBalanceSats,
      });

      console.log('\n--- (d) EVIDENCE: Balance cross-check ---');
      console.log('Expected Snapshot Sats: ', expectedBalanceSats.toString());
      console.log('Live Chain Balance Sats:', crossCheck.chainBalanceSats.toString());
      console.log('Live Chain VTXO Count:  ', crossCheck.chainVtxoCount);
      console.log('Balances Reconciled:    ', crossCheck.matches);
      console.log('Chain Reachable:        ', crossCheck.chainReachable);
      console.log('=============================================================\n');

      expect(crossCheck.chainReachable).toBe(true);
      expect(crossCheck.chainBalanceSats).toBe(expectedBalanceSats);
      expect(crossCheck.matches).toBe(true);
    }, SINGLE_WAIT_TIMEOUT_MS);
  }
);
