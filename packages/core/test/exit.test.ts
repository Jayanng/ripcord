import { describe, it, expect, beforeAll } from 'vitest';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  depositToVault,
  makeSigner,
  assessExit,
  executeExit,
  DEFAULT_EXIT_FEE_SATS,
} from '../src/index.js';
import { RipcordCode } from '../src/errors.js';
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

describe('exit.ts Task 9.1: assessExit dry-run (live Bitcoin RPC)', { timeout: 180000 }, () => {
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let userWallet: agg.Wallet;

  beforeAll(async () => {
    quorum = await getQuorum(DAEMON);
    const rpcClient = new agg.BitcoinCoreRpcClient({ url: `${DAEMON}/` });
    const aggregator = await agg.WalletAggregator.fromMnemonic(ALICE_MNEMONIC, {
      network: 'regtest',
      rpc: rpcClient,
    });
    userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
    await userWallet.sync();
  }, 60000);

  it('returns unfunded when the vault has no L1 funding outpoint', async () => {
    const index = 51000 + Math.floor(Math.random() * 10000);
    const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
    const vault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: identity.userKeyDescriptor,
    });

    const readiness = await assessExit({ vault, identity, baseUrl: DAEMON });
    expect(readiness.status).toBe('unfunded');
    expect(readiness.confirmations).toBe(0);
    expect(readiness.requiredConfirmations).toBe(2);
    expect(readiness.dryRun).toBeUndefined();
  });

  it('rejects a vault-address destination', async () => {
    const index = 52000 + Math.floor(Math.random() * 10000);
    const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
    const vault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: identity.userKeyDescriptor,
    });
    await expect(assessExit({
      vault,
      identity,
      baseUrl: DAEMON,
      destAddress: vault.address,
    })).rejects.toThrow(/cannot be the vault address/);
  });

  it('assessExit on a 0-conf deposit is maturing, vsize 125, nSequence 2, and does not spend', async () => {
    const index = 53000 + Math.floor(Math.random() * 10000);
    const identity = deriveIdentity(ALICE_MNEMONIC, 'regtest', index);
    const vault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: identity.userKeyDescriptor,
    });

    let dep: Awaited<ReturnType<typeof depositToVault>> | undefined;
    for (const feeRate of [10, 25, 50, 100]) {
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

    const readiness = await assessExit({
      vault: funded,
      identity,
      baseUrl: DAEMON,
      feeSats: DEFAULT_EXIT_FEE_SATS,
    });

    expect(readiness.dryRun?.sequence).toBe(2);

    expect(readiness.status).toBe('maturing');
    expect(readiness.reason).toBe('non-BIP68-final');
    expect(readiness.requiredConfirmations).toBe(2);
    expect(readiness.confirmations).toBeLessThan(2);
    expect(readiness.confirmationsRemaining).toBeGreaterThan(0);
    expect(readiness.dryRun).toBeDefined();
    expect(readiness.dryRun!.vsize).toBe(125);
    expect(readiness.dryRun!.sequence).toBe(2);
    expect(readiness.dryRun!.destination).toBe(identity.l1Address);
    expect(readiness.dryRun!.rawHex).toMatch(/^[0-9a-f]+$/);
    expect(readiness.dryRun!.txid).toMatch(/^[0-9a-f]{64}$/i);

    const stillThere = await bitcoinRpc('gettxout', [dep!.txid, vout!.n, true]);
    expect(stillThere).toBeTruthy();
    expect((stillThere as { value: number }).value).toBe(0.0004);

    const wrongValue = { ...funded, funding: { ...funded.funding!, valueSats: 39999n } };
    await expect(assessExit({ vault: wrongValue, identity, baseUrl: DAEMON }))
      .rejects.toMatchObject({ code: RipcordCode.AMOUNT_MISMATCH });

    await expect(executeExit({
      vault: funded,
      identity,
      signer: makeSigner(ALICE_MNEMONIC, 'regtest', index),
      destAddress: identity.l1Address,
      baseUrl: DAEMON,
    })).rejects.toMatchObject({ code: RipcordCode.EXIT_IMMATURE });

    const afterReject = await bitcoinRpc('gettxout', [dep!.txid, vout!.n, true]);
    expect(afterReject).toBeTruthy();
  });
});
