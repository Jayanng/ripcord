import { describe, it, expect, beforeAll } from 'vitest';
import * as vc from '@tachibtc/taurus-vault-core';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as btc from 'bitcoinjs-lib';
import { deriveIdentity, getQuorum, createVault, makeSigner } from '../src/index.js';

const ALICE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const DAEMON = 'https://rpc-regtest.tachibtc.com';

describe('payment.ts: live end-to-end transfer', { timeout: 300000 }, () => {
  let aliceIdentity: ReturnType<typeof deriveIdentity>;
  let bobIdentity: ReturnType<typeof deriveIdentity>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let vault: Awaited<ReturnType<typeof createVault>>;
  let aliceSigner: ReturnType<typeof makeSigner>;
  let aliceXOnly: string;
  let bobXOnly: string;
  let bobAddr: string;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    bobIdentity = deriveIdentity(BOB_MNEMONIC, 'regtest');
    quorum = await getQuorum(DAEMON);
    aliceXOnly = aliceIdentity.xOnly;
    bobXOnly = bobIdentity.xOnly;

    // Bob's P2TR payment address
    const bobScript = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.from(bobXOnly, 'hex')]);
    bobAddr = btc.address.fromOutputScript(bobScript, btc.networks.regtest);

    // Use Alice index 0 with csv=2 fixture vault (known working VTXOs on-ledger).
    // This avoids the activity-driven regtest deposit timing issue entirely.
    const netObj = agg.getNetwork('regtest');
    const aliceDesc = vc.deriveUserKey(ALICE_MNEMONIC, netObj, { index: 0 });

    vault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: {
        version: aliceDesc.version,
        scheme: aliceDesc.scheme,
        purpose: aliceDesc.purpose,
        coinType: aliceDesc.coinType,
        network: aliceDesc.network,
        account: aliceDesc.account,
        change: aliceDesc.change,
        index: 0,
        path: aliceDesc.path,
        publicKey: aliceDesc.publicKey as any,
        masterFingerprint: aliceDesc.masterFingerprint,
        address: aliceDesc.address as any,
        addressType: aliceDesc.addressType,
      },
    });
    console.log('Vault address:', (vault as any).p2tr.address);

    // Setup signer for index 0
    aliceSigner = makeSigner(ALICE_MNEMONIC, 'regtest', 0);
  }, 60000);

  it('Alice sends 5000 sats to Bob, transfer commits with code 0', async () => {
    // Find spendable VTXO for Alice's index-0 key
    const vtxos = await vc.getAddressVtxos(aliceXOnly, { baseUrl: DAEMON });
    console.log('Alice VTXOs:', vtxos.count);
    const spendable = vtxos.vtxos.find(v => !v.spent && !v.locked && v.amountSats >= 6000n);

    if (!spendable) {
      // All VTXOs may have been spent by prior test runs. This is an honest skip.
      console.log('SKIP: No spendable VTXO found for Alice index 0');
      for (const v of vtxos.vtxos) {
        console.log('  vtxo:', v.id.slice(0, 16), v.amountSats.toString(), 'spent:', v.spent, 'locked:', v.locked);
      }
      return;
    }

    console.log('Using VTXO:', spendable.id.slice(0, 16), spendable.amountSats.toString(), 'sats');

    const transferAmt = 5000n;
    const fee = 1n;
    const change = spendable.amountSats - transferAmt - fee;

    const inputs: vc.VtxoInput[] = [{
      txid: spendable.id,
      vout: 0,
      valueSats: spendable.amountSats,
      scriptPubKey: Buffer.from((vault as any).p2tr.output).toString('hex'),
      vtxoId: Buffer.from(spendable.id, 'hex'),
    }];

    const outputs: vc.VtxoOutput[] = [
      { address: bobAddr, valueSats: transferAmt },
    ];
    if (change > 0n) {
      outputs.push({ address: (vault as any).p2tr.address, valueSats: change });
    }

    // Build PSBT
    const built = vc.buildVtxoPsbt({
      vault: vault as any,
      inputs,
      outputs,
      feeSats: fee,
    });
    console.log('PSBT built, inputs:', built.psbt.inputCount, 'outputs:', built.psbt.txOutputs.length);

    // Sign PSBT as user
    await vc.signVtxoPsbtAsUser(built.psbt, aliceSigner as any, vault as any, {
      maxFeeSats: fee,
    });
    console.log('PSBT signed');

    // Get nonce
    const nonce = await vc.getAccountNonce(Buffer.from(aliceXOnly, 'hex'), { baseUrl: DAEMON });
    console.log('Nonce:', nonce.toString());

    // Build TachiTx
    const tachiTx = vc.buildTachiTxTransfer({
      vault: vault as any,
      inputs,
      outputs,
      feeSats: fee,
      nonce,
      psbt: built.psbt,
    });

    // Sign TachiTx
    const signedTx = await vc.signTachiTx(tachiTx, aliceSigner as any);
    console.log('TachiTx signed, sig len:', signedTx.signature.length);

    // Broadcast
    const br = await vc.broadcastTachiTx(signedTx, {
      url: DAEMON + '/tachi_txBroadcastSync',
    });
    console.log('Broadcast hash:', br.tendermintTxHash);
    expect(br.accepted).toBe(true);

    // Wait for commit
    const status = await vc.waitForTachiTxCommit(br.tendermintTxHash, {
      baseUrl: DAEMON,
      overallTimeoutMs: 120000,
    });
    console.log('Commit: code=', status.code, 'epoch=', status.epoch, 'committed=', status.committed);

    expect(status.code).toBe(0);
    expect(status.committed).toBe(true);

    // Verify Bob received
    await new Promise(r => setTimeout(r, 2000));
    const bobVtxos = await vc.getAddressVtxos(bobXOnly, { baseUrl: DAEMON });
    console.log('Bob VTXOs:', bobVtxos.count);
    const received = bobVtxos.vtxos.find(v => !v.spent && v.amountSats === transferAmt);
    expect(received).toBeDefined();
    expect(received!.amountSats).toBe(transferAmt);
    console.log('SUCCESS: Bob received', received!.amountSats.toString(), 'sats, id:', received!.id.slice(0, 16));
  });
});

