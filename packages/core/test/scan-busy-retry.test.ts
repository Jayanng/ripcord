/**
 * Scan-busy retry (2026-10-16, user hit the raw error live on signet): bitcoind
 * serves ONE scantxoutset at a time node-wide and answers -8 "Scan already in
 * progress" to any overlap. Our own scans are serialized + retried
 * (enqueueScan loops in l1.ts / findExistingVaultFunding), but the SDK's
 * internal scans throw THROUGH the funding flow and surfaced as
 * "RPC scantxoutset failed: bitcoin rpc error -8: Scan already in progress..."
 * on the user's screen. These tests pin the shared retry primitive and the
 * UI mapping. Fail closed: only the busy refusal is retried.
 */
import { describe, expect, it } from 'vitest';
import { isScanBusyError, withScanBusyRetry } from '../src/net.js';
import { composeFlowErrorMessage } from '../src/lifecycle.js';

/** The exact live message shape captured from the user's signet session. */
class FakeScanBusy extends Error {
  constructor() {
    super('RPC scantxoutset failed: bitcoin rpc error -8: Scan already in progress, use action "abort" or "status"');
    this.name = 'RpcError';
  }
}

describe('isScanBusyError on the captured live message', () => {
  it('recognizes the SDK refusal verbatim', () => {
    expect(isScanBusyError(new FakeScanBusy().message)).toBe(true);
  });
  it('does not match unrelated errors', () => {
    expect(isScanBusyError('Insufficient funds: available 1 sats, required 2 sats')).toBe(false);
    expect(isScanBusyError('bitcoin rpc error -6: Block not found')).toBe(false);
  });
});

describe('withScanBusyRetry', () => {
  it('retries the busy refusal and returns the eventual result', async () => {
    let calls = 0;
    const result = await withScanBusyRetry(async () => {
      calls += 1;
      if (calls < 3) throw new FakeScanBusy();
      return 'ok';
    }, { attempts: 5, delayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('fails closed: any other error rethrows on first sight, never retried', async () => {
    let calls = 0;
    await expect(
      withScanBusyRetry(async () => {
        calls += 1;
        throw new Error('Insufficient funds: available 1 sats, required 2 sats');
      }, { attempts: 5, delayMs: 1 }),
    ).rejects.toThrow('Insufficient funds');
    expect(calls).toBe(1);
  });

  it('rethrows the busy error once the budget is exhausted', async () => {
    let calls = 0;
    await expect(
      withScanBusyRetry(async () => {
        calls += 1;
        throw new FakeScanBusy();
      }, { attempts: 3, delayMs: 1 }),
    ).rejects.toThrow(/already in progress/i);
    expect(calls).toBe(3);
  });
});

describe('composeFlowErrorMessage on scan-busy', () => {
  it('replaces the raw node jargon with a plain, actionable note', () => {
    const note = composeFlowErrorMessage(new FakeScanBusy());
    expect(note.toLowerCase()).toContain('busy');
    expect(note).toContain('saved');
    expect(note).not.toMatch(/scantxoutset|-8|RPC/i);
  });

  it('leaves unrelated errors on the existing pipeline', () => {
    const note = composeFlowErrorMessage(new Error('Insufficient funds: available 1 sats, required 2 sats'));
    expect(note).not.toMatch(/busy/i);
  });
});
