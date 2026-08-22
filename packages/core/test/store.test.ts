import { describe, it, expect } from 'vitest';
import { MemoryStore, IndexedDbStore, type RipcordStore } from '../src/store.js';
import type { VaultP2tr } from '@tachibtc/taurus-vault-core';
import type {
  VaultRecord,
  PaymentReceipt,
  VaultAddress,
  UserAddress,
  CompressedHex,
  DisplayTxid,
  XOnlyHex,
} from '../src/types.js';

/**
 * Fixtures below are synthetic TEST DATA for the persistence round-trip. They
 * exercise the store's serialization, dedup, and bigint handling, not vault
 * lifecycle correctness. The store persists only public data; nothing here is
 * claimed to be a live daemon record.
 */
function makeVault(address: string, valueSats: bigint): VaultRecord {
  return {
    vaultIdHex: 'ab'.repeat(32),
    address: address as VaultAddress,
    csvBlocks: 2,
    userKeyIndex: 0,
    userKeyDescriptor: {
      version: 1,
      scheme: 'bip84-p2wpkh',
      purpose: 84,
      coinType: 1,
      network: 'regtest',
      account: 0,
      change: false,
      index: 0,
      path: "m/84'/1'/0'/0/0",
      publicKey: ('02' + 'cd'.repeat(32)) as CompressedHex,
      masterFingerprint: 'deadbeef',
      address: ('bcrt1q' + '0'.repeat(38)) as UserAddress,
      addressType: 'p2wpkh',
    },
    nodePubkeys: [('02' + 'ee'.repeat(32)) as CompressedHex, ('03' + 'ff'.repeat(32)) as CompressedHex],
    quorumThreshold: 5,
    quorumFingerprint: 'ff'.repeat(32),
    funding: { txid: '11'.repeat(32) as DisplayTxid, vout: 0, valueSats },
    registered: true,
    createdAt: 1700000000000,
  };
}

function makeReceipt(txHash: string, amountSats: bigint): PaymentReceipt {
  return {
    txHash,
    epoch: 436174,
    code: 0,
    fromXOnly: 'aa'.repeat(32) as XOnlyHex,
    toXOnly: 'bb'.repeat(32) as XOnlyHex,
    amountSats,
    feeSats: 1n,
  };
}

const VAULT_A = 'bcrt1p' + 'a'.repeat(58) + 'xyz';
const VAULT_B = 'bcrt1p' + 'b'.repeat(58) + 'xyz';

describe('MemoryStore', () => {
  it('round-trips vaults and receipts through save and get', async () => {
    const store = new MemoryStore();
    const vault = makeVault(VAULT_A, 40000n);
    const receipt = makeReceipt('AA'.repeat(32), 500n);

    await store.saveVault(vault);
    await store.saveReceipt(receipt);

    const vaults = await store.getVaults();
    const receipts = await store.getReceipts();

    expect(vaults).toHaveLength(1);
    expect(vaults[0].address).toBe(VAULT_A);
    expect(vaults[0].funding!.valueSats).toBe(40000n);
    expect(receipts).toHaveLength(1);
    // Canonicalised to lowercase on save.
    expect(receipts[0].txHash).toBe('aa'.repeat(32));
    expect(receipts[0].amountSats).toBe(500n);
  });

  it('upserts a vault by address (no duplicate rows)', async () => {
    const store = new MemoryStore();
    await store.saveVault(makeVault(VAULT_A, 40000n));
    await store.saveVault(makeVault(VAULT_A, 39999n));

    const vaults = await store.getVaults();
    expect(vaults).toHaveLength(1);
    expect(vaults[0].funding!.valueSats).toBe(39999n);
  });

  it('normalizes receipt txHash case so a re-save cannot duplicate', async () => {
    const store = new MemoryStore();
    await store.saveReceipt(makeReceipt('AB'.repeat(32), 500n));
    // Same tx with the other case (WSS lowercase vs REST uppercase).
    await store.saveReceipt(makeReceipt('ab'.repeat(32), 500n));

    const receipts = await store.getReceipts();
    expect(receipts).toHaveLength(1);
    // Canonicalised to lowercase on save, matching IndexedDbStore.
    expect(receipts[0].txHash).toBe('ab'.repeat(32));
  });

  it('preserves Buffer-bearing p2tr across the snapshot round-trip (lossless)', async () => {
    // A real VaultRecord carries p2tr with Buffer fields (output, control
    // blocks, leaf hashes). The snapshot must round-trip them as Buffers, not
    // as JSON's lossy { type: 'Buffer', data: [...] } object form.
    const vault = makeVault(VAULT_A, 40000n);
    const p2tr = {
      output: Buffer.from('5120' + 'ab'.repeat(32), 'hex'),
      exitControlBlock: Buffer.from('c0' + 'cd'.repeat(32), 'hex'),
    } as unknown as VaultP2tr;
    vault.p2tr = p2tr;

    const store = new MemoryStore();
    await store.saveVault(vault);
    const restored = (await MemoryStore.fromSnapshot(store.exportSnapshot()).getVaults())[0];

    expect(Buffer.isBuffer(restored.p2tr?.output)).toBe(true);
    expect(restored.p2tr!.output.equals(p2tr.output)).toBe(true);
    expect(Buffer.isBuffer(restored.p2tr?.exitControlBlock)).toBe(true);
    expect(restored.p2tr!.exitControlBlock.equals(p2tr.exitControlBlock)).toBe(true);
  });

  it('clear empties both collections', async () => {
    const store = new MemoryStore();
    await store.saveVault(makeVault(VAULT_A, 40000n));
    await store.saveVault(makeVault(VAULT_B, 1000n));
    await store.saveReceipt(makeReceipt('cd'.repeat(32), 500n));

    await store.clear();

    expect(await store.getVaults()).toHaveLength(0);
    expect(await store.getReceipts()).toHaveLength(0);
  });

  it('persists across a simulated reboot via exportSnapshot / fromSnapshot', async () => {
    // "Reboot": build store, persist, drop it, rebuild from the snapshot.
    const live = new MemoryStore();
    await live.saveVault(makeVault(VAULT_A, 40000n));
    await live.saveReceipt(makeReceipt('AB'.repeat(32), 500n));
    const snapshot = live.exportSnapshot();

    // New process "boots" and restores the exact bytes.
    const rebooted = MemoryStore.fromSnapshot(snapshot);

    const vaults = await rebooted.getVaults();
    const receipts = await rebooted.getReceipts();
    expect(vaults).toHaveLength(1);
    expect(vaults[0].address).toBe(VAULT_A);
    // Bigint survived the JSON round-trip intact (not a string).
    expect(vaults[0].funding!.valueSats).toBe(40000n);
    expect(typeof vaults[0].funding!.valueSats).toBe('bigint');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].amountSats).toBe(500n);
    expect(typeof receipts[0].amountSats).toBe('bigint');
  });

  it('satisfies the RipcordStore contract', async () => {
    const store: RipcordStore = new MemoryStore();
    await store.saveVault(makeVault(VAULT_A, 1n));
    expect((await store.getVaults()).length).toBe(1);
  });
});

describe('IndexedDbStore', () => {
  it('fails fast with a clear error when IndexedDB is unavailable (Node env)', () => {
    // Node has no IndexedDB; the store must surface a clear, actionable error
    // rather than failing later with an obscure TypeError. It is exercised
    // for real in-browser when the wallet app (Phase 10+) loads.
    expect(() => new IndexedDbStore()).toThrow(/IndexedDbStore requires an IndexedDB/);
  });
});
