import { describe, it, expect } from 'vitest';
import * as vc from '@tachibtc/taurus-vault-core';
import type { VaultEvent } from '@tachibtc/taurus-vault-core';
import {
  VaultIndexer,
  BoundedEventQueue,
  mapVaultEvent,
  type IndexerEvent,
  type IndexerTxEvent,
  type IndexerBlockEvent,
  type IndexerStatus,
  deriveIdentity,
  getQuorum,
  createVault,
  makeSigner,
  toSdkVault,
  isOutputForXOnly,
  getIncomingAmountSats,
  isIncomingPayment,
  synthesizeIncomingReceipt,
  mergePaymentReceipt,
  dedupeReceiptList,
  saveReceiptMerged,
  classifyCredit,
  lookupTachiTx,
  extractSenderPubkeyFromTachiHex,
  NEUTRAL_FROM_XONLY,
  asXOnlyHex,
} from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import type { PaymentReceipt, TxLookupResult, CreditClassification } from '../src/types.js';
import { RipcordCode } from '../src/errors.js';

const DAEMON = 'https://rpc-regtest.tachibtc.com';
const WSS = 'wss://rpc-regtest.tachibtc.com/tachi_ws';
const ALICE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

async function waitFor<T>(fn: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = fn();
    if (value !== undefined) return value;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

/** Pure mapper tests: synthetic inputs exercise the mapping, not the daemon. */
describe('mapVaultEvent (pure)', () => {
  it('maps a pending transfer to tx:pending with height 0', () => {
    const raw: VaultEvent = {
      event: 'tx', state: 'pending', type: 'transfer', vaultAddress: '',
      txHash: 'aa'.repeat(32), height: 0, committed: false,
      vout: [{ owner: 'bb'.repeat(32), amountSats: 500n, script: '' }],
      raw: {},
    };
    const mapped = mapVaultEvent(raw) as IndexerTxEvent | null;
    expect(mapped).not.toBeNull();
    expect(mapped!.kind).toBe('tx:pending');
    expect(mapped!.height).toBe(0);
    expect(mapped!.committed).toBe(false);
    expect(mapped!.txHash).toBe('aa'.repeat(32));
    expect(mapped!.type).toBe('transfer');
    expect(mapped!.vout[0].amountSats).toBe(500n);
  });

  it('maps a committed transfer to tx:committed with a positive height', () => {
    const raw: VaultEvent = {
      event: 'tx', state: 'committed', type: 'transfer', vaultAddress: '',
      txHash: 'aa'.repeat(32), height: 436174, committed: true,
      vout: [],
      raw: {},
    };
    const mapped = mapVaultEvent(raw) as IndexerTxEvent | null;
    expect(mapped!.kind).toBe('tx:committed');
    expect(mapped!.height).toBe(436174);
    expect(mapped!.committed).toBe(true);
  });

  it('maps a block event to block:new', () => {
    const raw: VaultEvent = {
      event: 'block', state: '', type: '', vaultAddress: '', txHash: '',
      height: 100, committed: false, vout: [],
      block: { height: 100, blockHash: 'cc'.repeat(32), appHash: 'dd'.repeat(32), txCount: 1, epochClosed: 99 },
      raw: {},
    };
    const mapped = mapVaultEvent(raw) as IndexerBlockEvent | null;
    expect(mapped!.kind).toBe('block:new');
    expect(mapped!.blockHash).toBe('cc'.repeat(32));
    expect(mapped!.txCount).toBe(1);
    expect(mapped!.epochClosed).toBe(99);
  });

  it('returns null for validator and breach frames (out of scope)', () => {
    const validator: VaultEvent = {
      event: 'validator', state: '', type: '', vaultAddress: '', txHash: '',
      height: 0, committed: false, vout: [],
      validator: { pubKeyHex: 'ee'.repeat(33), peerId: '', host: '', rpcAddr: '', total: 7 },
      raw: {},
    };
    expect(mapVaultEvent(validator)).toBeNull();
    const breach: VaultEvent = {
      event: 'breach', state: '', type: '', vaultAddress: '', txHash: '',
      height: 0, committed: false, vout: [],
      breach: {
        vaultId: 'ff'.repeat(32), broadcastState: 0n, latestState: 0n,
        classification: 'stale', spendTxid: '00'.repeat(32), spendVout: 0,
        detectedHeight: 100, detectedAt: 0,
      },
      raw: {},
    };
    expect(mapVaultEvent(breach)).toBeNull();
  });
});

describe('Incoming receipt synthesis and deduplication (pure)', () => {
  // Captured from real regtest identity derivation (Alice & Bob)
  const ALICE_XONLY = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
  const ALICE_COMPRESSED = '02e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
  const BOB_XONLY = '110d9ecab272c72b5c5b4e3ecb00bf8a081cfd076ff7a2d3ef0c74f762694b88';
  // Real transaction hash captured from live regtest epoch 857232
  const REAL_TX_HASH = '0c8af8cf18444109099cd6da9a23e26425363b7c5bdcf7c1136cefabdc591ff7';
  const SECOND_TX_HASH = '861c3e79d319a8664b49e945f9632dfb4b8d40b6cb9d91d3f1f38ff3fa2eb108';

  describe('isOutputForXOnly', () => {
    it('matches exact 64-character x-only hex string', () => {
      expect(isOutputForXOnly(ALICE_XONLY, ALICE_XONLY)).toBe(true);
      expect(isOutputForXOnly(ALICE_XONLY.toUpperCase(), ALICE_XONLY)).toBe(true);
      expect(isOutputForXOnly(BOB_XONLY, ALICE_XONLY)).toBe(false);
    });

    it('matches 66-character compressed hex with 02 or 03 prefix', () => {
      expect(isOutputForXOnly(ALICE_COMPRESSED, ALICE_XONLY)).toBe(true);
      expect(isOutputForXOnly('03' + ALICE_XONLY, ALICE_XONLY)).toBe(true);
      expect(isOutputForXOnly('04' + ALICE_XONLY, ALICE_XONLY)).toBe(false);
    });

    it('rejects malformed or empty owners', () => {
      expect(isOutputForXOnly('', ALICE_XONLY)).toBe(false);
      expect(isOutputForXOnly('invalid-hex', ALICE_XONLY)).toBe(false);
      expect(isOutputForXOnly(ALICE_XONLY.slice(0, 32), ALICE_XONLY)).toBe(false);
    });
  });

  describe('getIncomingAmountSats and isIncomingPayment', () => {
    it('sums only outputs crediting the target identity', () => {
      const event: IndexerTxEvent = {
        kind: 'tx:committed',
        type: 'transfer',
        txHash: REAL_TX_HASH,
        vaultAddress: '',
        height: 14170,
        committed: true,
        receivedAt: 1700000000000,
        vout: [
          { owner: ALICE_XONLY, amountSats: 15_000n, script: '' },
          { owner: BOB_XONLY, amountSats: 25_000n, script: '' },
          { owner: ALICE_COMPRESSED, amountSats: 5_000n, script: '' },
        ],
      };

      expect(getIncomingAmountSats(event, ALICE_XONLY)).toBe(20_000n);
      expect(isIncomingPayment(event, ALICE_XONLY)).toBe(true);

      expect(getIncomingAmountSats(event, BOB_XONLY)).toBe(25_000n);
      expect(isIncomingPayment(event, BOB_XONLY)).toBe(true);

      expect(getIncomingAmountSats(event, '00'.repeat(32))).toBe(0n);
      expect(isIncomingPayment(event, '00'.repeat(32))).toBe(false);
    });
  });

  describe('synthesizeIncomingReceipt', () => {
    it('synthesizes a pending receipt with epoch 0 and neutral attestation data', () => {
      const pendingEvent: IndexerTxEvent = {
        kind: 'tx:pending',
        type: 'transfer',
        txHash: REAL_TX_HASH,
        vaultAddress: '',
        height: 0,
        committed: false,
        receivedAt: 1700000000000,
        vout: [{ owner: ALICE_XONLY, amountSats: 50_000n, script: '' }],
      };

      const receipt = synthesizeIncomingReceipt(pendingEvent, ALICE_XONLY);
      expect(receipt).not.toBeNull();
      expect(receipt!.txHash).toBe(REAL_TX_HASH);
      expect(receipt!.toXOnly).toBe(ALICE_XONLY);
      expect(receipt!.fromXOnly).toBe(NEUTRAL_FROM_XONLY);
      expect(receipt!.amountSats).toBe(50_000n);
      expect(receipt!.feeSats).toBe(0n);
      expect(receipt!.code).toBe(0);
      expect(receipt!.epoch).toBe(0);
      // Hard Rule: NEVER fabricate attestation data
      expect(receipt!.hat).toBeUndefined();
      expect(receipt!.rip).toBeUndefined();
    });

    it('synthesizes a committed receipt with epoch set to block height', () => {
      const committedEvent: IndexerTxEvent = {
        kind: 'tx:committed',
        type: 'transfer',
        txHash: REAL_TX_HASH,
        vaultAddress: '',
        height: 14170,
        committed: true,
        receivedAt: 1700000000000,
        vout: [{ owner: ALICE_COMPRESSED, amountSats: 30_000n, script: '' }],
      };

      const receipt = synthesizeIncomingReceipt(committedEvent, ALICE_XONLY);
      expect(receipt).not.toBeNull();
      expect(receipt!.amountSats).toBe(30_000n);
      expect(receipt!.epoch).toBe(14170);
      expect(receipt!.hat).toBeUndefined();
      expect(receipt!.rip).toBeUndefined();
    });

    it('returns null when transaction has no outputs crediting identity', () => {
      const otherEvent: IndexerTxEvent = {
        kind: 'tx:committed',
        type: 'transfer',
        txHash: REAL_TX_HASH,
        vaultAddress: '',
        height: 14170,
        committed: true,
        receivedAt: 1700000000000,
        vout: [{ owner: BOB_XONLY, amountSats: 10_000n, script: '' }],
      };
      expect(synthesizeIncomingReceipt(otherEvent, ALICE_XONLY)).toBeNull();
    });
  });

  describe('mergePaymentReceipt and dedupeReceiptList', () => {
    it('prevents pending receipt from downgrading a committed receipt', () => {
      const committedReceipt: PaymentReceipt = {
        txHash: REAL_TX_HASH,
        epoch: 14170,
        code: 0,
        fromXOnly: asXOnlyHex(NEUTRAL_FROM_XONLY),
        toXOnly: asXOnlyHex(ALICE_XONLY),
        amountSats: 50_000n,
        feeSats: 0n,
      };

      const pendingUpdate: PaymentReceipt = {
        txHash: REAL_TX_HASH,
        epoch: 0,
        code: 0,
        fromXOnly: asXOnlyHex(NEUTRAL_FROM_XONLY),
        toXOnly: asXOnlyHex(ALICE_XONLY),
        amountSats: 50_000n,
        feeSats: 0n,
      };

      const merged = mergePaymentReceipt(committedReceipt, pendingUpdate);
      expect(merged.epoch).toBe(14170); // preserved committed epoch
    });

    it('upgrades a pending receipt when commit arrives', () => {
      const pendingReceipt: PaymentReceipt = {
        txHash: REAL_TX_HASH,
        epoch: 0,
        code: 0,
        fromXOnly: asXOnlyHex(NEUTRAL_FROM_XONLY),
        toXOnly: asXOnlyHex(ALICE_XONLY),
        amountSats: 50_000n,
        feeSats: 0n,
      };

      const committedUpdate: PaymentReceipt = {
        txHash: REAL_TX_HASH,
        epoch: 14172,
        code: 0,
        fromXOnly: asXOnlyHex(NEUTRAL_FROM_XONLY),
        toXOnly: asXOnlyHex(ALICE_XONLY),
        amountSats: 50_000n,
        feeSats: 0n,
      };

      const merged = mergePaymentReceipt(pendingReceipt, committedUpdate);
      expect(merged.epoch).toBe(14172);
    });

    it('deduplicates receipt list and updates in place', () => {
      const existing: PaymentReceipt[] = [
        {
          txHash: REAL_TX_HASH,
          epoch: 0,
          code: 0,
          fromXOnly: asXOnlyHex(NEUTRAL_FROM_XONLY),
          toXOnly: asXOnlyHex(ALICE_XONLY),
          amountSats: 50_000n,
          feeSats: 0n,
        },
      ];

      const updateCommitted: PaymentReceipt = {
        txHash: REAL_TX_HASH.toUpperCase(), // case-insensitive dedupe
        epoch: 14175,
        code: 0,
        fromXOnly: asXOnlyHex(NEUTRAL_FROM_XONLY),
        toXOnly: asXOnlyHex(ALICE_XONLY),
        amountSats: 50_000n,
        feeSats: 0n,
      };

      const updated = dedupeReceiptList(existing, updateCommitted);
      expect(updated.length).toBe(1);
      expect(updated[0].epoch).toBe(14175);

      const brandNew: PaymentReceipt = {
        txHash: SECOND_TX_HASH,
        epoch: 0,
        code: 0,
        fromXOnly: asXOnlyHex(NEUTRAL_FROM_XONLY),
        toXOnly: asXOnlyHex(BOB_XONLY),
        amountSats: 20_000n,
        feeSats: 0n,
      };

      const withNew = dedupeReceiptList(updated, brandNew);
      expect(withNew.length).toBe(2);
      expect(withNew[0].txHash).toBe(SECOND_TX_HASH); // prepended
    });

    it('DEFECT 1 regression: synthesized receipt does not clobber rich stored receipt in store', async () => {
      const store = new MemoryStore();
      const txHash = '768f02444109099cd6da9a23e26425363b7c5bdcf7c1136cefabdc591ff7a123';
      const richReceipt: PaymentReceipt = {
        txHash,
        epoch: 14170,
        code: 0,
        fromXOnly: asXOnlyHex(ALICE_XONLY),
        toXOnly: asXOnlyHex(BOB_XONLY),
        amountSats: 5_000n,
        feeSats: 1n,
        hat: {
          vtxoId: '11'.repeat(32),
          proof: 'aa'.repeat(32),
          btcHeight: 0,
        },
        rip: {
          originEpoch: 14170,
          finalEpoch: 14170,
          chainLength: 0,
          finalRoot: 'bb'.repeat(16),
          hatInStateDiff: true,
        },
      };

      // 1. Plant rich receipt (e.g. from SendForm:37 with hat + real fromXOnly)
      await store.saveReceipt(richReceipt);

      // 2. Synthesized incoming event arrives for the same txHash crediting Alice (change output)
      const incomingEvent: IndexerTxEvent = {
        kind: 'tx:committed',
        type: 'transfer',
        txHash,
        vaultAddress: '',
        height: 14170,
        committed: true,
        receivedAt: Date.now(),
        vout: [
          { owner: BOB_XONLY, amountSats: 5_000n, script: '' },
          { owner: ALICE_XONLY, amountSats: 35_000n, script: '' },
        ],
      };

      const rawSynthesized = synthesizeIncomingReceipt(incomingEvent, ALICE_XONLY);
      expect(rawSynthesized).not.toBeNull();
      expect(rawSynthesized!.fromXOnly).toBe(NEUTRAL_FROM_XONLY);
      expect(rawSynthesized!.hat).toBeUndefined();

      // 3. Save synthesized receipt through merged persistence (Defect 1 fix)
      await saveReceiptMerged(store, rawSynthesized!);

      // 4. Reload from store and verify
      const storedList = await store.getReceipts();
      const reloaded = storedList.find(r => r.txHash.toLowerCase() === txHash.toLowerCase());
      expect(reloaded).toBeDefined();

      // Proves the stored/reloaded record still carries hat + original counterpart fields:
      expect(reloaded!.hat).toEqual(richReceipt.hat);
      expect(reloaded!.rip).toEqual(richReceipt.rip);
      expect(reloaded!.fromXOnly).toBe(richReceipt.fromXOnly);
      expect(reloaded!.toXOnly).toBe(richReceipt.toXOnly);
      expect(reloaded!.amountSats).toBe(5_000n); // original send amount preserved, not overwritten by 35_000n change
      expect(reloaded!.feeSats).toBe(1n);
    });
  });

  describe('classifyCredit (pure)', () => {
    const transferEvent: IndexerTxEvent = {
      kind: 'tx:pending',
      type: 'transfer',
      txHash: REAL_TX_HASH,
      vaultAddress: '',
      height: 0,
      committed: false,
      receivedAt: 1700000000000,
      vout: [
        { owner: BOB_XONLY, amountSats: 10_000n, script: '' },
        { owner: ALICE_XONLY, amountSats: 30_000n, script: '' },
      ],
    };

    it('classifies as none when the event has no outputs crediting identity', () => {
      const otherKey = '99'.repeat(32);
      const res = classifyCredit(transferEvent, null, otherKey);
      expect(res).toBe('none');
    });

    it('classifies deposit as incoming without requiring lookup (cannot be self-funded)', () => {
      const depositEvent: IndexerTxEvent = {
        ...transferEvent,
        type: 'deposit',
      };
      // Lookup is null (no lookup needed), still returns incoming
      const res = classifyCredit(depositEvent, null, ALICE_XONLY);
      expect(res).toBe('incoming');
    });

    it('fails closed (skip) on transfer when lookup is null or failed', () => {
      // Daemon outage, 502, network failure -> null lookup
      const res = classifyCredit(transferEvent, null, ALICE_XONLY);
      expect(res).toBe('skip');
    });

    it('classifies as self_move when lookup senderPubkey matches identity (change output)', () => {
      const lookup: TxLookupResult = {
        txHash: REAL_TX_HASH,
        type: 'transfer',
        senderPubkey: ALICE_XONLY,
        vin: [{ vtxoId: '11'.repeat(32), valueSats: 40_001n }],
        vout: [
          { owner: BOB_XONLY, amountSats: 10_000n },
          { owner: ALICE_XONLY, amountSats: 30_000n },
        ],
      };

      const res = classifyCredit(transferEvent, lookup, ALICE_XONLY);
      expect(res).toBe('self_move');
    });

    it('classifies as self_move when lookup senderPubkey is compressed prefix of identity', () => {
      const lookup: TxLookupResult = {
        txHash: REAL_TX_HASH,
        type: 'transfer',
        senderPubkey: ALICE_COMPRESSED,
        vin: [{ vtxoId: '11'.repeat(32), valueSats: 40_001n }],
      };

      const res = classifyCredit(transferEvent, lookup, ALICE_XONLY);
      expect(res).toBe('self_move');
    });

    it('classifies as self_move when all vin inputs are owned by identity', () => {
      const lookup: TxLookupResult = {
        txHash: REAL_TX_HASH,
        type: 'transfer',
        senderPubkey: '',
        vin: [
          { vtxoId: '11'.repeat(32), owner: ALICE_XONLY },
          { vtxoId: '22'.repeat(32), owner: ALICE_COMPRESSED },
        ],
      };

      const res = classifyCredit(transferEvent, lookup, ALICE_XONLY);
      expect(res).toBe('self_move');
    });

    it('classifies as incoming when senderPubkey is a third party', () => {
      const lookup: TxLookupResult = {
        txHash: REAL_TX_HASH,
        type: 'transfer',
        senderPubkey: BOB_XONLY, // Bob sent Alice money
        vin: [{ vtxoId: '11'.repeat(32), valueSats: 40_001n }],
      };

      const res = classifyCredit(transferEvent, lookup, ALICE_XONLY);
      expect(res).toBe('incoming');
    });

    it('classifies as incoming when vin inputs belong to a third party', () => {
      const lookup: TxLookupResult = {
        txHash: REAL_TX_HASH,
        type: 'transfer',
        senderPubkey: '',
        vin: [{ vtxoId: '11'.repeat(32), owner: BOB_XONLY }],
      };

      const res = classifyCredit(transferEvent, lookup, ALICE_XONLY);
      expect(res).toBe('incoming');
    });
  });

  describe('lookupTachiTx (live probe against daemon v0.39.0)', { timeout: 30000 }, () => {
    it('retrieves and parses real committed transaction', async () => {
      const result = await lookupTachiTx(REAL_TX_HASH, DAEMON);
      expect(result).not.toBeNull();
      expect(result!.txHash).toBe(REAL_TX_HASH);
      expect(result!.type).toBe('transfer');
      expect(result!.senderPubkey).toBe(ALICE_XONLY);
      expect(result!.vin?.length).toBeGreaterThan(0);
      expect(result!.vout?.length).toBe(2);

      const testVout = (result!.vout ?? []).map(v => ({
        owner: v.owner,
        amountSats: v.amountSats,
        script: v.script ?? '',
      }));

      // Verify classification with real lookup:
      // Alice sent it, so Alice's credit is self_move (change)
      const aliceCredit = classifyCredit(
        {
          kind: 'tx:committed',
          type: 'transfer',
          txHash: REAL_TX_HASH,
          vaultAddress: '',
          height: 857232,
          committed: true,
          receivedAt: Date.now(),
          vout: testVout,
        },
        result,
        ALICE_XONLY,
      );
      expect(aliceCredit).toBe('self_move');

      // The actual recipient in output 0 received it from Alice (external sender), so recipient's credit is incoming
      const recipientCredit = classifyCredit(
        {
          kind: 'tx:committed',
          type: 'transfer',
          txHash: REAL_TX_HASH,
          vaultAddress: '',
          height: 857232,
          committed: true,
          receivedAt: Date.now(),
          vout: testVout,
        },
        result,
        result!.vout![0]!.owner,
      );
      expect(recipientCredit).toBe('incoming');

      // A third party not in outputs gets 'none'
      const thirdPartyCredit = classifyCredit(
        {
          kind: 'tx:committed',
          type: 'transfer',
          txHash: REAL_TX_HASH,
          vaultAddress: '',
          height: 857232,
          committed: true,
          receivedAt: Date.now(),
          vout: testVout,
        },
        result,
        BOB_XONLY,
      );
      expect(thirdPartyCredit).toBe('none');
    });

    it('returns null when looking up unknown txHash', async () => {
      const result = await lookupTachiTx('ff'.repeat(32), DAEMON);
      expect(result).toBeNull();
    });
  });
});

describe('BoundedEventQueue (pure)', () => {
  it('accepts up to capacity and shifts FIFO', () => {
    const q = new BoundedEventQueue<number>(3);
    q.push(1);
    q.push(2);
    q.push(3);
    expect(q.size).toBe(3);
    expect(q.isFull).toBe(true);
    expect(q.shift()).toBe(1);
    expect(q.shift()).toBe(2);
    expect(q.shift()).toBe(3);
    expect(q.size).toBe(0);
  });

  it('throws QUEUE_OVERFLOW past the bound rather than dropping', () => {
    const q = new BoundedEventQueue<number>(2);
    q.push(1);
    q.push(2);
    let caught: { code?: string } | undefined;
    try {
      q.push(3);
    } catch (err) {
      caught = err as { code?: string };
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe(RipcordCode.QUEUE_OVERFLOW);
    expect(q.hasOverflowed).toBe(true);
    expect(q.size).toBe(2);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new BoundedEventQueue<number>(0)).toThrow();
    expect(() => new BoundedEventQueue<number>(-1)).toThrow();
  });

  it('keeps overflow terminal until explicitly cleared', () => {
    const q = new BoundedEventQueue<number>(1);
    q.push(1);
    expect(() => q.push(2)).toThrowError(expect.objectContaining({ code: RipcordCode.QUEUE_OVERFLOW }));
    expect(q.hasOverflowed).toBe(true);
    expect(() => q.push(3)).toThrowError(expect.objectContaining({ code: RipcordCode.QUEUE_OVERFLOW }));
    q.clear();
    expect(q.hasOverflowed).toBe(false);
    expect(() => q.push(4)).not.toThrow();
  });

  it('rejects non-integer queue capacity', () => {
    expect(() => new BoundedEventQueue<number>(1.5)).toThrow();
    expect(() => new BoundedEventQueue<number>(Number.NaN)).toThrow();
  });
});

describe('VaultIndexer (live daemon)', () => {
  it('rejects a filterless configuration up front', () => {
    expect(() => new VaultIndexer({ url: WSS })).toThrow(/At least one filter is required/);
  });

  it('accepts a filter carried in the URL query string', () => {
    const indexer = new VaultIndexer({ url: `${WSS}?blocks=true` });
    expect(indexer).toBeInstanceOf(VaultIndexer);
    indexer.close();
  });

  it('does not reopen after close when a stale subscription closes later', async () => {
    const statuses: IndexerStatus[] = [];
    const indexer = new VaultIndexer({
      url: `${WSS}?blocks=true`,
      onStatus: status => statuses.push(status),
    });
    indexer.start();
    await waitFor(() => (indexer.socket ? true : undefined), 15_000, 'socket object');
    const oldSocket = indexer.socket!;
    indexer.close();
    oldSocket.close();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(statuses.filter(s => s.state === 'reconnecting')).toHaveLength(0);
    expect(statuses.at(-1)?.state).toBe('closed');
  });

  it('emits block:new for every committed block (blocks=true)', { timeout: 60_000 }, async () => {
    const events: IndexerEvent[] = [];
    let connected = false;
    const statuses: IndexerStatus[] = [];
    const indexer = new VaultIndexer({
      url: `${WSS}?blocks=true`,
      onEvent: ev => { events.push(ev); },
      onStatus: st => { statuses.push(st); if (st.state === 'connected') connected = true; },
    });
    indexer.start();
    try {
      await waitFor(() => (connected ? true : undefined), 15_000, 'connected');
      const block = await waitFor<IndexerBlockEvent>(
        () => events.find(e => e.kind === 'block:new') as IndexerBlockEvent | undefined,
        45_000,
        'block:new event',
      );
      expect(block.height).toBeGreaterThan(0);
      expect(block.blockHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      indexer.close();
    }
  });

  it('auto-reconnects after the socket drops (exponential backoff)', { timeout: 60_000 }, async () => {
    const statuses: IndexerStatus[] = [];
    let connectCount = 0;
    const indexer = new VaultIndexer({
      url: `${WSS}?blocks=true`,
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 1000,
      reconnectJitter: false, // deterministic backoff for the test
      onStatus: st => {
        statuses.push(st);
        if (st.state === 'connected') connectCount++;
      },
    });
    indexer.start();
    try {
      await waitFor(() => (connectCount >= 1 ? true : undefined), 15_000, 'initial connect');
      // Simulate a network drop by closing the raw socket client-side.
      indexer.socket!.close();
      await waitFor(() => (connectCount >= 2 ? true : undefined), 15_000, 'reconnect');
      expect(connectCount).toBeGreaterThanOrEqual(2);
      expect(statuses.some(s => s.state === 'reconnecting')).toBe(true);
    } finally {
      indexer.close();
    }
  });

  it('emits tx:pending then tx:committed for a live transfer, pending within ~2s of broadcast', { timeout: 180_000 }, async () => {
    const alice = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    const bob = deriveIdentity(BOB_MNEMONIC, 'regtest');
    const quorum = await getQuorum(DAEMON);
    const aliceVault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: alice.userKeyDescriptor,
    });
    const aliceSigner = makeSigner(ALICE_MNEMONIC, 'regtest', 0);
    const vault = toSdkVault(aliceVault);
    const bobAddr = bob.userAddress;

    const events: IndexerEvent[] = [];
    let resolveConnected: (() => void) | undefined;
    const connected = new Promise<void>(res => { resolveConnected = res; });
    const indexer = new VaultIndexer({
      url: `${WSS}?address=${bobAddr}&blocks=true`,
      onEvent: ev => { events.push(ev); },
      onError: err => { console.log('indexer onError:', err.message); },
      onStatus: st => { if (st.state === 'connected') resolveConnected?.(); },
    });
    indexer.start();

    try {
      await connected;

      // Manual Alice -> Bob transfer so the broadcast timestamp is exact.
      const vtxos = await vc.getAddressVtxos(alice.xOnly, { baseUrl: DAEMON });
      const input = vtxos.vtxos
        .filter(v => !v.spent && !v.locked)
        .sort((a, b) => (b.amountSats > a.amountSats ? 1 : -1))[0];
      expect(input, 'Alice has an unspent VTXO to spend').toBeDefined();

      const amount = 500n;
      const fee = 1n;
      const change = input.amountSats - amount - fee;
      const inputs = [{
        txid: input.id,
        vout: 0,
        valueSats: input.amountSats,
        scriptPubKey: Buffer.from(vault.p2tr.output).toString('hex'),
        vtxoId: Buffer.from(input.id, 'hex'),
      }];
      const outputs: Array<{ address: string; valueSats: bigint }> = [{ address: bobAddr, valueSats: amount }];
      if (change > 0n) outputs.push({ address: alice.userAddress, valueSats: change });

      const built = vc.buildVtxoPsbt({ vault, inputs, outputs, feeSats: fee });
      await vc.signVtxoPsbtAsUser(built.psbt, aliceSigner, vault, { maxFeeSats: fee });
      const nonce = await vc.getAccountNonce(Buffer.from(alice.xOnly, 'hex'), { baseUrl: DAEMON });
      const signed = await vc.signTachiTx(
        vc.buildTachiTxTransfer({ vault, inputs, outputs, feeSats: fee, nonce, psbt: built.psbt }),
        aliceSigner,
      );

      const t0 = Date.now();
      const broadcast = await vc.broadcastTachiTx(signed, { url: `${DAEMON}/tachi_txBroadcastSync` });
      const commit = await vc.waitForTachiTxCommit(broadcast.tendermintTxHash, {
        baseUrl: DAEMON,
        overallTimeoutMs: 120_000,
      });
      expect(commit.code).toBe(0);
      const restHashLower = commit.hash.toLowerCase();

      // tx:committed arrives on the block that finalises the transfer.
      const pending = await waitFor<IndexerTxEvent>(
        () => events.find(e => e.kind === 'tx:pending' && e.txHash.toLowerCase() === restHashLower) as IndexerTxEvent | undefined,
        60_000,
        'tx:pending event',
      );
      const committedEv = await waitFor<IndexerTxEvent>(
        () => events.find(e => e.kind === 'tx:committed' && e.txHash.toLowerCase() === restHashLower) as IndexerTxEvent | undefined,
        60_000,
        'tx:committed event',
      );

      // Pending: height 0, not committed, and fast (observed ~300 ms).
      expect(pending.height).toBe(0);
      expect(pending.committed).toBe(false);
      expect(pending.type).toBe('transfer');
      expect(pending.receivedAt - t0).toBeLessThan(2000);

      // Committed: positive height and the terminal success state.
      expect(committedEv.height).toBeGreaterThan(0);
      expect(committedEv.committed).toBe(true);

      // Ordering: pending strictly before committed.
      expect(pending.receivedAt).toBeLessThan(committedEv.receivedAt);

      // The recipient's 500-sat output is present in the committed vout.
      const recipientOut = committedEv.vout.find(v => v.amountSats === amount);
      expect(recipientOut).toBeDefined();
    } finally {
      indexer.close();
    }
  });
});
