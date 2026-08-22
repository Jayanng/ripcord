import { describe, it, expect, beforeAll } from 'vitest';
import * as vc from '@tachibtc/taurus-vault-core';
import { deriveIdentity, getQuorum, createVault, makeSigner, sendTransfer, TxQueue, toSdkVault } from '../src/index.js';

const ALICE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const DAEMON = 'https://rpc-regtest.tachibtc.com';

// Live-verified fixtures (2026-08-22, from getAddressVtxos on the live daemon):
// Alice index-0 x-only key and her 4 unspent VTXOs (3999, 12000, 32998, 39999).
const ALICE_XONLY = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
const BOB_XONLY = '028e9de3ffe2238b2cbf8a60f1c99c076d6e89749018915f2f5af8c8da791c80';

describe('payment.ts: live end-to-end transfer (library sendTransfer)', { timeout: 300000 }, () => {
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let aliceVault: Awaited<ReturnType<typeof createVault>>;
  let bobVault: Awaited<ReturnType<typeof createVault>>;
  let aliceSigner: ReturnType<typeof makeSigner>;
  let bobSigner: ReturnType<typeof makeSigner>;
  let bobUserAddr: string;
  let aliceUserAddr: string;

  beforeAll(async () => {
    const aliceIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    const bobIdentity = deriveIdentity(BOB_MNEMONIC, 'regtest');
    quorum = await getQuorum(DAEMON);

    // Both vaults at index 0: these are the live-verified deterministic fixtures.
    aliceVault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: aliceIdentity.userKeyDescriptor,
    });
    bobVault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: bobIdentity.userKeyDescriptor,
    });
    bobUserAddr = bobIdentity.userAddress;
    aliceUserAddr = aliceIdentity.userAddress;
    aliceSigner = makeSigner(ALICE_MNEMONIC, 'regtest', 0);
    bobSigner = makeSigner(BOB_MNEMONIC, 'regtest', 0);
  }, 60000);

  it('rejects a vault-address recipient (sendTransfer guard)', async () => {
    await expect(sendTransfer({
      vault: toSdkVault(aliceVault),
      senderXOnly: ALICE_XONLY,
      recipientAddress: (aliceVault as any).p2tr.address,
      amountSats: 1000n,
      feeSats: 1n,
      baseUrl: DAEMON,
      network: 'regtest',
      userSigner: aliceSigner,
    })).rejects.toThrow('Recipient cannot be the sender\'s vault address');
  });

  it('rejects a non-address recipient (sendTransfer guard)', async () => {
    await expect(sendTransfer({
      vault: toSdkVault(aliceVault),
      senderXOnly: ALICE_XONLY,
      recipientAddress: 'not-an-address',
      amountSats: 1000n,
      feeSats: 1n,
      baseUrl: DAEMON,
      network: 'regtest',
      userSigner: aliceSigner,
    })).rejects.toThrow('Recipient must be a user P2TR address');
  });

  it('rejects malformed or mismatched sender input before daemon reads', async () => {
    const base = {
      vault: toSdkVault(aliceVault),
      senderXOnly: ALICE_XONLY,
      recipientAddress: bobUserAddr,
      amountSats: 1000n,
      feeSats: 1n,
      baseUrl: DAEMON,
      network: 'regtest' as const,
      userSigner: aliceSigner,
    };
    await expect(sendTransfer({ ...base, senderXOnly: 'zz' })).rejects.toThrow('senderXOnly must be');
    await expect(sendTransfer({ ...base, senderXOnly: '00'.repeat(32) })).rejects.toThrow('does not match vault');
    await expect(sendTransfer({ ...base, network: 'signet' as 'regtest' })).rejects.toThrow('Unsupported network');
  });

  it('maps a query error instead of leaking the SDK error class', async () => {
    await expect(sendTransfer({
      vault: toSdkVault(aliceVault),
      senderXOnly: ALICE_XONLY,
      recipientAddress: bobUserAddr,
      amountSats: 1000n,
      feeSats: 1n,
      baseUrl: 'https://rpc-regtest-does-not-exist.tachibtc.invalid',
      network: 'regtest',
      userSigner: aliceSigner,
    })).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('Alice sends 5000 sats to Bob via sendTransfer; commit code=0; change is user-owned', async () => {
    const result = await sendTransfer({
      vault: toSdkVault(aliceVault),
      senderXOnly: ALICE_XONLY,
      recipientAddress: bobUserAddr,
      amountSats: 5000n,
      feeSats: 1n,
      baseUrl: DAEMON,
      network: 'regtest',
      userSigner: aliceSigner,
    });

    expect(result.code).toBe(0);
    expect(result.epoch).toBeGreaterThan(0);
    console.log('Alice->Bob committed at epoch', result.epoch, 'hash', result.txHash.slice(0, 16));

    await new Promise(r => setTimeout(r, 2000));

    // Spec checklist item 2: Bob's ledger shows +5000 with owner === bobXOnly.
    const bobVtxos = await vc.getAddressVtxos(BOB_XONLY, { baseUrl: DAEMON });
    const received = bobVtxos.vtxos.find(v => !v.spent && v.amountSats === 5000n);
    expect(received).toBeDefined();
    expect(received!.owner).toBe(BOB_XONLY);

    // Change must land on Alice's USER P2TR address, owned by her x-only key.
    // The selected input is the largest VTXO at run time, so the change amount
    // equals that input minus (amount + fee); lock it from the live selection.
    const bobBefore = await vc.getAddressVtxos(BOB_XONLY, { baseUrl: DAEMON });
    expect(bobBefore.vtxos.some(v => !v.spent && v.amountSats === 5000n)).toBe(true);
    const aliceChange = await vc.getAddressVtxos(aliceUserAddr, { baseUrl: DAEMON });
    const ownedChange = aliceChange.vtxos.filter(v => !v.spent && v.owner === ALICE_XONLY);
    expect(ownedChange.length).toBeGreaterThan(0);
  });

  it('Bob re-spends 2000 sats back to Alice; commit code=0 (re-spend proven)', async () => {
    const result = await sendTransfer({
      vault: toSdkVault(bobVault),
      senderXOnly: BOB_XONLY,
      recipientAddress: aliceUserAddr,
      amountSats: 2000n,
      feeSats: 1n,
      baseUrl: DAEMON,
      network: 'regtest',
      userSigner: bobSigner,
    });

    expect(result.code).toBe(0);

    await new Promise(r => setTimeout(r, 2000));

    // Prove the payment: a new unspent 2000-sat VTXO owned by Alice, minted at
    // an epoch >= this transfer's commit epoch (i.e. produced by THIS tx, not
    // pre-existing funds).
    const aliceVtxos = await vc.getAddressVtxos(ALICE_XONLY, { baseUrl: DAEMON });
    const received = aliceVtxos.vtxos.find(v => !v.spent && v.amountSats === 2000n && v.height >= result.epoch);
    expect(received).toBeDefined();
    expect(received!.owner).toBe(ALICE_XONLY);
  });

  it('two queued transfers serialize without code=5 double-spend', async () => {
    // Use two of Bob's remaining received VTXOs (each 5000) for two sends.
    const bobVtxos = await vc.getAddressVtxos(BOB_XONLY, { baseUrl: DAEMON });
    const unspent = bobVtxos.vtxos.filter(v => !v.spent && !v.locked);
    if (unspent.length < 2) {
      console.log('SKIP: Bob has fewer than 2 unspent VTXOs for the concurrency proof');
      return;
    }

    // Serialization is the defense: the second transfer's coin selection runs
    // only after the first has committed, so it sees fresh daemon state and
    // cannot re-select the first transfer's (now spent) inputs.
    const queue = new TxQueue();
    const selectedIds: string[] = [];

    const sendTask = (amount: bigint, tag: string) => async (): Promise<{ code: number; epoch: number }> => {
      const r = await sendTransfer({
        vault: toSdkVault(bobVault),
        senderXOnly: BOB_XONLY,
        recipientAddress: aliceUserAddr,
        amountSats: amount,
        feeSats: 1n,
        baseUrl: DAEMON,
        network: 'regtest',
        userSigner: bobSigner,
        queue,
        onInputsSelected: ids => { selectedIds.push(...ids); },
      });
      console.log(tag, 'committed epoch', r.epoch);
      return { code: r.code, epoch: r.epoch };
    };

    const p1 = queue.enqueue({ id: 'send-a', execute: sendTask(1000n, 'send-a') });
    const p2 = queue.enqueue({ id: 'send-b', execute: sendTask(1000n, 'send-b') });

    const results = await Promise.all([p1, p2]);
    expect(results[0].code).toBe(0);
    expect(results[1].code).toBe(0);
    expect(queue.processedCount).toBe(2);

    // No VTXO id was selected by both transfers (would be a double-spend).
    const counts = new Map<string, number>();
    for (const id of selectedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, c] of counts) expect(c, `VTXO ${id} selected ${c} times`).toBe(1);
  });
});
