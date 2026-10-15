import { describe, it, expect, beforeAll } from 'vitest';
import { TEST_NETWORK, TEST_DAEMON } from './live-fixtures.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  depositToVault,
  makeSigner,
  assessExit,
  executeExit,
} from '../src/index.js';
import type { VaultRecord } from '../src/types.js';

const DAEMON = TEST_DAEMON;
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
      /* retry */
    }
    await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
  }
  throw new Error(`deposit ${txid} not visible via getrawtransaction`);
}

async function waitForConfirmations(
  txid: string,
  vout: number,
  need: number,
  timeoutMs: number,
  nudge: () => Promise<void>,
): Promise<number> {
  const start = Date.now();
  let last = 0;
  let lastNudge = 0;
  while (Date.now() - start < timeoutMs) {
    const txout = (await bitcoinRpc('gettxout', [txid, vout, true])) as { confirmations?: number } | null;
    last = txout?.confirmations ?? 0;
    if (last >= need) return last;
    if (Date.now() - lastNudge > 15_000) {
      lastNudge = Date.now();
      try { await nudge(); } catch { /* activity is best-effort */ }
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Funding ${txid}:${vout} reached only ${last} confirmations (need ${need}) within ${timeoutMs}ms. L1 blocks are activity-driven.`);
}

// Mature broadcast needs two L1 confirmations. Regtest has no scheduled miner
// (activity-driven). Set RIPCORD_LIVE_EXIT=1 when the chain is producing blocks.
// Round 8A-2: this manual opt-in broadcasts real L1 transactions - on signet
// that additionally requires the documented TACHI_SIGNET_FUNDED opt-in.
const LIVE_EXIT = process.env.RIPCORD_LIVE_EXIT === '1' && (TEST_NETWORK !== 'signet' || process.env.TACHI_SIGNET_FUNDED === '1');

describe('exit.ts Task 9.2: executeExit broadcast (live Bitcoin L1)', { timeout: 300000 }, () => {
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let userWallet: agg.Wallet;

  beforeAll(async () => {
    quorum = await getQuorum(DAEMON);
    const rpcClient = new agg.BitcoinCoreRpcClient({ url: `${DAEMON}/` });
    const aggregator = await agg.WalletAggregator.fromMnemonic(ALICE_MNEMONIC, {
      network: TEST_NETWORK,
      rpc: rpcClient,
    });
    userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
    await userWallet.sync();
  }, 60000);

  it.skipIf(!LIVE_EXIT)('assessExit is live at 2 confs; executeExit returns an L1 txid queryable via getrawtransaction', async () => {
    const index = 54000 + Math.floor(Math.random() * 10000);
    const identity = deriveIdentity(ALICE_MNEMONIC, TEST_NETWORK, index);
    const vault = await createVault({
      network: TEST_NETWORK,
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: identity.userKeyDescriptor,
    });

    let dep: Awaited<ReturnType<typeof depositToVault>> | undefined;
    for (const feeRate of [10, 25, 50, 100, 200]) {
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
        if (/insufficient fee|rejecting replacement/.test(msg)) {
          await userWallet.sync();
          continue;
        }
        throw err;
      }
    }
    expect(dep).toBeDefined();

    const spk = Buffer.from(vault.p2tr!.output).toString('hex');
    const raw = await waitForRawTx(dep!.txid);
    const vout = raw.vout.find(o => o.scriptPubKey.hex === spk);
    expect(vout).toBeDefined();

    const funded: VaultRecord = {
      ...vault,
      funding: { txid: dep!.txid, vout: vout!.n, valueSats: dep!.amountSats },
    };

    const nudge = async (): Promise<void> => {
      const kickIndex = 60000 + Math.floor(Math.random() * 20000);
      const kickId = deriveIdentity(ALICE_MNEMONIC, TEST_NETWORK, kickIndex);
      await fetch('https://faucet.tachibtc.com/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: kickId.l1Address, amountBtc: 0.5 }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => undefined); // silent-ok: best-effort faucet kick; the fixture gates report unfunded state honestly
      const kickVault = await createVault({
        network: TEST_NETWORK,
        nodePubkeys: quorum.nodePubkeys,
        csvBlocks: 1008,
        userKeyDescriptor: kickId.userKeyDescriptor,
      });
      await userWallet.sync();
      await depositToVault({
        vault: kickVault,
        userWallet,
        rpc: { baseUrl: DAEMON },
        amountSats: 10000n,
        feeRateSatVb: 25,
      });
    };

    const confs = await waitForConfirmations(dep!.txid, vout!.n, 2, 180_000, nudge);
    expect(confs).toBeGreaterThanOrEqual(2);

    const readiness = await assessExit({ vault: funded, identity, baseUrl: DAEMON });
    expect(readiness.status).toBe('live');
    expect(readiness.confirmations).toBeGreaterThanOrEqual(2);
    expect(readiness.confirmationsRemaining).toBe(0);
    expect(readiness.dryRun?.vsize).toBe(125);
    expect(readiness.dryRun?.sequence).toBe(2);

    const result = await executeExit({
      vault: funded,
      identity,
      signer: makeSigner(ALICE_MNEMONIC, TEST_NETWORK, index),
      destAddress: identity.l1Address,
      baseUrl: DAEMON,
    });
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/i);

    const broadcast = (await bitcoinRpc('getrawtransaction', [result.txid, true])) as {
      txid: string;
      vin: Array<{ txid?: string; vout?: number }>;
    };
    expect(broadcast.txid.toLowerCase()).toBe(result.txid.toLowerCase());
    expect(broadcast.vin[0]?.txid?.toLowerCase()).toBe(dep!.txid.toLowerCase());
    expect(broadcast.vin[0]?.vout).toBe(vout!.n);

    const spent = await assessExit({ vault: funded, identity, baseUrl: DAEMON });
    expect(spent.status).toBe('spent');
  });
});
