import { describe, it, expect } from 'vitest';
import {
  evaluateSentinel,
  sentinelScore,
  maturityEtaText,
  fetchSentinelState,
  type SentinelInput,
} from '../src/sentinel.js';
import type { WatchtowerBreachReceipt, WatchtowerStatus, ExitReadiness, BalanceCrossCheckResult } from '../src/types.js';

const STATUS_OK: WatchtowerStatus = {
  mode: 'detection',
  lastScannedHeight: 100,
  receiptCount: 0,
  sweepThreshold: 5,
  bountyConfigured: false,
};

const baseInput = (over: Partial<SentinelInput> = {}): SentinelInput => ({
  watchtowerStatus: STATUS_OK,
  watchtowerReceipts: [],
  exitReadiness: null,
  crossCheck: null,
  liveValidators: 7,
  quorumThreshold: 5,
  daemonReachable: true,
  ...over,
});

const receipt = (over: Partial<WatchtowerBreachReceipt> = {}): WatchtowerBreachReceipt => ({
  vaultId: 'a'.repeat(64),
  broadcastState: 1,
  latestState: 1,
  classification: 'legitimate',
  spendTxid: 'b'.repeat(64),
  spendVout: 0,
  detectedHeight: 90,
  detectedAt: 1700000000,
  ...over,
});

describe('sentinel: evaluateSentinel (pure)', () => {
  it('all clear: score 100, single ALL_CLEAR info finding', () => {
    const report = evaluateSentinel(baseInput(), 1700000000);
    expect(report.status).toBe('all-clear');
    expect(report.score).toBe(100);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].code).toBe('ALL_CLEAR');
    expect(report.findings[0].severity).toBe('info');
    expect(report.checkedAt).toBe(1700000000);
  });

  it('stale watchtower receipt -> alert, score drops', () => {
    const report = evaluateSentinel(baseInput({
      watchtowerReceipts: [receipt({ classification: 'stale' })],
    }));
    expect(report.status).toBe('alert');
    expect(report.score).toBe(60);
    const f = report.findings.find(x => x.code === 'WATCHTOWER_STALE');
    expect(f?.severity).toBe('alert');
    expect(f?.title).toBeTruthy();
  });

  it('anomalous receipt -> WATCHTOWER_BREACH alert', () => {
    const report = evaluateSentinel(baseInput({
      watchtowerReceipts: [receipt({ classification: 'anomalous' })],
    }));
    expect(report.findings.some(x => x.code === 'WATCHTOWER_BREACH')).toBe(true);
    expect(report.status).toBe('alert');
  });

  it('legitimate receipts alone are not findings', () => {
    const report = evaluateSentinel(baseInput({
      watchtowerReceipts: [receipt({ classification: 'legitimate' }), receipt({ classification: 'legitimate' })],
    }));
    expect(report.status).toBe('all-clear');
    expect(report.score).toBe(100);
  });

  it('exit maturing -> info finding with human ETA', () => {
    const exit: ExitReadiness = {
      status: 'maturing',
      confirmations: 2,
      requiredConfirmations: 1008,
      confirmationsRemaining: 1006,
    };
    const report = evaluateSentinel(baseInput({ exitReadiness: exit }));
    const f = report.findings.find(x => x.code === 'EXIT_MATURING');
    expect(f?.severity).toBe('info');
    expect(f?.detail).toContain('1006');
  });

  it('exit live -> EXIT_LIVE info (good news, not an alarm)', () => {
    const exit: ExitReadiness = {
      status: 'live',
      confirmations: 1008,
      requiredConfirmations: 1008,
      confirmationsRemaining: 0,
    };
    const report = evaluateSentinel(baseInput({ exitReadiness: exit }));
    expect(report.findings.some(x => x.code === 'EXIT_LIVE')).toBe(true);
    expect(report.status).toBe('all-clear');
  });

  it('balance mismatch -> alert', () => {
    const cross: BalanceCrossCheckResult = {
      snapshotSats: 100n,
      chainBalanceSats: 200n,
      chainVtxoCount: 1,
      matches: false,
      chainReachable: true,
    };
    const report = evaluateSentinel(baseInput({ crossCheck: cross }));
    expect(report.findings.some(x => x.code === 'BALANCE_MISMATCH')).toBe(true);
    expect(report.status).toBe('alert');
  });

  it('chain unreachable -> BALANCE_INDETERMINATE attention', () => {
    const cross: BalanceCrossCheckResult = {
      snapshotSats: 100n,
      chainBalanceSats: 0n,
      chainVtxoCount: 0,
      matches: null,
      chainReachable: false,
    };
    const report = evaluateSentinel(baseInput({ crossCheck: cross }));
    const f = report.findings.find(x => x.code === 'BALANCE_INDETERMINATE');
    expect(f?.severity).toBe('attention');
  });

  it('quorum low -> alert', () => {
    const report = evaluateSentinel(baseInput({ liveValidators: 3, quorumThreshold: 5 }));
    expect(report.findings.some(x => x.code === 'QUORUM_LOW')).toBe(true);
    expect(report.status).toBe('alert');
  });

  it('daemon unreachable -> status paused (never crashes, never claims all-clear)', () => {
    const report = evaluateSentinel(baseInput({ daemonReachable: false, watchtowerStatus: null }));
    expect(report.status).toBe('paused');
    expect(report.findings.some(x => x.code === 'DAEMON_UNREACHABLE')).toBe(true);
  });

  it('score floors at 0 with stacked alerts', () => {
    const report = evaluateSentinel(baseInput({
      watchtowerReceipts: [receipt({ classification: 'anomalous' }), receipt({ classification: 'stale' })],
      crossCheck: { snapshotSats: 1n, chainBalanceSats: 2n, chainVtxoCount: 0, matches: false, chainReachable: true },
      liveValidators: 1,
      quorumThreshold: 5,
    }));
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(sentinelScore(report.findings)).toBe(report.score);
    expect(report.status).toBe('alert');
    expect(report.summary).toBeTruthy();
  });
});

describe('sentinel: maturityEtaText', () => {
  it('formats days from block countdown (10-minute blocks)', () => {
    expect(maturityEtaText(1006, 10)).toContain('days');
    expect(maturityEtaText(1006, 10)).toContain('1006');
    expect(maturityEtaText(3, 10)).toContain('minutes');
    expect(maturityEtaText(0, 10)).toContain('mature');
  });
});

describe('sentinel: fetchSentinelState (mocked fetch)', () => {
  const jsonResp = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

  it('parses status + receipts from the daemon', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes('tachi_watchtower/status')) {
        return jsonResp({ mode: 'detection', last_scanned_height: 5, receipt_count: 0, sweep_threshold: 5, bounty_configured: false });
      }
      return jsonResp({ receipts: [] });
    }) as typeof fetch;
    const out = await fetchSentinelState({ baseUrl: 'http://localhost:1', fetchImpl });
    expect(out.input.daemonReachable).toBe(true);
    expect(out.input.watchtowerStatus?.mode).toBe('detection');
    expect(calls.some(u => u.includes('tachi_watchtower/receipts'))).toBe(true);
  });

  it('filters receipts to a vault when vaultIdHex given', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes('tachi_watchtower/status')) return jsonResp({ mode: 'detection' });
      return jsonResp({ receipts: [] });
    }) as typeof fetch;
    await fetchSentinelState({ baseUrl: 'http://localhost:1', vaultIdHex: 'c'.repeat(64), fetchImpl });
    expect(calls.some(u => u.includes(`vault=${'c'.repeat(64)}`))).toBe(true);
  });

  it('degrades gracefully when the daemon is unreachable (no throw)', async () => {
    const fetchImpl = (async () => { throw new Error('network down'); }) as typeof fetch;
    const out = await fetchSentinelState({ baseUrl: 'http://localhost:1', fetchImpl });
    expect(out.input.daemonReachable).toBe(false);
    expect(out.errors.length).toBeGreaterThan(0);
  });
});
