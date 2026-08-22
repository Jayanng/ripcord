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
} from '../src/index.js';
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
