import { describe, it, expect, beforeAll } from 'vitest';
import { generateMnemonic } from 'bip39';
import {
  deriveIdentity,
  makeSigner,
  getQuorum,
  createVault,
  depositToVault,
  registerVault,
  recoverVaults,
} from '../src/index.js';
import * as vc from '@tachibtc/taurus-vault-core';
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

async function waitForTxConfirmation(txid: string, maxAttempts = 60, delayMs = 5000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(`${DAEMON_URL}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getrawtransaction',
        params: [txid, true],
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.result && data.result.confirmations >= 1) {
        return;
      }
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Transaction ${txid} did not confirm within timeout`);
}

describe('end-to-end full flow: deposit → onboard → register → recover', { timeout: 600000 }, () => {
  let mnemonic: string;
  let identity: Awaited<ReturnType<typeof deriveIdentity>>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let userWallet: agg.Wallet;
  let rpcClient: agg.BitcoinCoreRpcClient;
  let userSigner: ReturnType<typeof makeSigner>;

  beforeAll(async () => {
    // Fresh mnemonic per run so the faucet's per-address cap never blocks us.
    mnemonic = generateMnemonic(128);
    identity = deriveIdentity(mnemonic, 'regtest');
    quorum = await getQuorum(DAEMON_URL);
    rpcClient = new agg.BitcoinCoreRpcClient({ url: `${DAEMON_URL}/` });
    const aggregator = await agg.WalletAggregator.fromMnemonic(mnemonic, {
      network: 'regtest',
      rpc: rpcClient,
    });
    userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
    await userWallet.sync();
    userSigner = makeSigner(mnemonic, 'regtest', 0);
  });

  it('full lifecycle: create vault, fund L1, deposit, onboard, register, recover', async () => {
    // 1. Create a vault for this identity.
    const vault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: identity.userKeyDescriptor,
    });
    expect(vault.address).toBeDefined();

    // 2. Fund the user's L1 address via faucet.
    const l1Address = identity.l1Address;
    const fundingTxid = await requestFaucet(l1Address);
    expect(fundingTxid).toMatch(/^[0-9a-f]{64}$/);

    // 3. Wait for funding to confirm, then sync.
    await waitForTxConfirmation(fundingTxid);
    await userWallet.sync();

    // 4. Deposit 40k sats from L1 into the vault.
    const depositResult = await depositToVault({
      vault,
      userWallet,
      rpc: { baseUrl: DAEMON_URL },
      amountSats: 40000n,
      feeRateSatVb: 10,
    });
    expect(depositResult.txid).toMatch(/^[0-9a-f]{64}$/);
    await waitForTxConfirmation(depositResult.txid);

    // 5. Onboard a VTXO (mint a spendable ledger VTXO).
    const nonce = await vc.getAccountNonce(
      Buffer.from(identity.xOnly, 'hex'),
      { baseUrl: DAEMON_URL }
    );
    const depositDraft = vc.buildTachiTxDeposit({
      userXOnly: Buffer.from(identity.xOnly, 'hex'),
      amountSats: 40000n - 1n,
      nonce,
      feeSats: 1n,
    });
    const signedDeposit = await vc.signTachiTx(depositDraft, userSigner);
    const broadcastResult = await vc.broadcastTachiTx(signedDeposit, {
      url: `${DAEMON_URL}/tachi_txBroadcastSync`,
    });
    const commitStatus = await vc.waitForTachiTxCommit(broadcastResult.tendermintTxHash, {
      baseUrl: DAEMON_URL,
      overallTimeoutMs: 90000,
    });
    expect(commitStatus.code).toBe(0);

    const vtxoId = Buffer.from(vc.vtxoIdFromDeposit(signedDeposit, 0)).toString('hex');
    expect(vtxoId).toMatch(/^[0-9a-f]{64}$/);

    // 6. Register the vault.
    const xOnlyBuf = Buffer.from(identity.xOnly, 'hex');
    const registerResult = await registerVault({
      vault,
      fundingTxid: depositResult.txid,
      fundingVout: 0,
      userSigner,
      vtxoId,
      owner: xOnlyBuf,
      amount: 40000n - 1n,
      baseUrl: DAEMON_URL,
    });
    expect(registerResult.vaultId).toBeDefined();
    expect(registerResult.vaultId.length).toBe(64);

    // 7. Recover the vault from the mnemonic alone.
    const recovered = await recoverVaults({
      identity,
      quorum,
      baseUrl: DAEMON_URL,
      knownCsvBlocks: [2],
    });
    expect(recovered.length).toBeGreaterThanOrEqual(1);
    const found = recovered.find(v => v.vaultIdHex === registerResult.vaultId);
    expect(found).toBeDefined();
    expect(found!.address).toBe(vault.address);
    expect(found!.funding).toBeDefined();
    expect(found!.funding!.valueSats).toBe(40000n);
  });
});
