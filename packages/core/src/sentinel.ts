/**
 * Sentinel: Ripcord's watch-only vault health engine.
 *
 * Composes public daemon reads (watchtower status + breach receipts) with
 * locally computed state (exit maturity, balance cross-check, quorum) into a
 * single plain-English health report with a 0-100 score.
 *
 * WATCH-ONLY BY DESIGN: this module never touches key material and never
 * writes to storage. It answers one question honestly: "is anything about
 * this vault worth the user's attention right now?"
 */
import { fetchWatchtowerStatus, fetchWatchtowerReceipts } from './health.js';
import type {
  WatchtowerStatus,
  WatchtowerBreachReceipt,
  ExitReadiness,
  BalanceCrossCheckResult,
} from './types.js';

export type SentinelSeverity = 'info' | 'attention' | 'alert';

export type SentinelFindingCode =
  | 'ALL_CLEAR'
  | 'WATCHTOWER_STALE'
  | 'WATCHTOWER_BREACH'
  | 'EXIT_LIVE'
  | 'EXIT_MATURING'
  | 'BALANCE_MISMATCH'
  | 'BALANCE_INDETERMINATE'
  | 'QUORUM_LOW'
  | 'DAEMON_UNREACHABLE';

export interface SentinelFinding {
  readonly code: SentinelFindingCode;
  readonly severity: SentinelSeverity;
  /** One plain-English line a non-technical user reads first. */
  readonly title: string;
  /** Supporting detail; plain English, no jargon walls. */
  readonly detail: string;
}

export interface SentinelInput {
  readonly watchtowerStatus: WatchtowerStatus | null;
  readonly watchtowerReceipts: readonly WatchtowerBreachReceipt[];
  readonly exitReadiness: ExitReadiness | null;
  readonly crossCheck: BalanceCrossCheckResult | null;
  readonly liveValidators?: number;
  readonly quorumThreshold?: number;
  readonly daemonReachable: boolean;
}

export interface SentinelReport {
  readonly checkedAt: number;
  readonly status: 'all-clear' | 'attention' | 'alert' | 'paused';
  readonly score: number;
  readonly findings: readonly SentinelFinding[];
  /** One-line summary for the panel header. */
  readonly summary: string;
}

const SCORE_PENALTY: Record<SentinelSeverity, number> = {
  info: 0,
  attention: 15,
  alert: 40,
};

export function sentinelScore(findings: readonly SentinelFinding[]): number {
  const total = findings.reduce((acc, f) => acc + SCORE_PENALTY[f.severity], 0);
  return Math.max(0, 100 - total);
}

/**
 * Human-time wording for a CSV maturity countdown.
 * blockMinutes is the chain's average block interval (10 for Bitcoin).
 */
export function maturityEtaText(blocksRemaining: number, blockMinutes = 10): string {
  if (blocksRemaining <= 0) return 'mature';
  const minutes = blocksRemaining * blockMinutes;
  if (minutes < 60) return `about ${minutes} minutes (${blocksRemaining} blocks)`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${hours} hours (${blocksRemaining} blocks)`;
  const days = Math.round(minutes / 60 / 24);
  return `about ${days} days (${blocksRemaining} blocks)`;
}

export function evaluateSentinel(input: SentinelInput, now: number = Date.now()): SentinelReport {
  const findings: SentinelFinding[] = [];

  if (!input.daemonReachable) {
    findings.push({
      code: 'DAEMON_UNREACHABLE',
      severity: 'info',
      title: 'Sentinel paused: the network is not answering.',
      detail: 'Nothing is wrong that we can see. We simply cannot check right now. We will retry automatically.',
    });
  }

  // Watchtower breach receipts: the daemon's own classification is the truth.
  const stale = input.watchtowerReceipts.filter(r => r.classification === 'stale');
  const anomalous = input.watchtowerReceipts.filter(r => r.classification === 'anomalous');
  if (anomalous.length > 0) {
    findings.push({
      code: 'WATCHTOWER_BREACH',
      severity: 'alert',
      title: 'Unusual activity around your vault was flagged.',
      detail: `The watchtower classified ${anomalous.length} vault spend${anomalous.length === 1 ? '' : 's'} as anomalous. Review the exit screen. Your funds are still yours to exit.`,
    });
  }
  if (stale.length > 0) {
    findings.push({
      code: 'WATCHTOWER_STALE',
      severity: 'alert',
      title: 'An out-of-date vault state was broadcast.',
      detail: `The watchtower flagged ${stale.length} stale-state broadcast${stale.length === 1 ? '' : 's'}. This is the situation the timelock protects you from. Check the exit screen.`,
    });
  }

  // Exit maturity: good news surfaced calmly.
  if (input.exitReadiness) {
    const e = input.exitReadiness;
    if (e.status === 'live') {
      findings.push({
        code: 'EXIT_LIVE',
        severity: 'info',
        title: 'Your exit path is ready whenever you want it.',
        detail: 'The timelock has matured. You can leave for Bitcoin L1 any time, and no one can stop you.',
      });
    } else if (e.status === 'maturing') {
      const eta = maturityEtaText(e.confirmationsRemaining);
      findings.push({
        code: 'EXIT_MATURING',
        severity: 'info',
        title: 'Your exit path is maturing normally.',
        detail: `${e.confirmationsRemaining} of ${e.requiredConfirmations} confirmations done, matures in ${eta}.`,
      });
    }
  }

  // Balance cross-check against the chain.
  if (input.crossCheck) {
    if (input.crossCheck.matches === false) {
      findings.push({
        code: 'BALANCE_MISMATCH',
        severity: 'alert',
        title: 'Your balance does not match the chain right now.',
        detail: 'The on-chain check disagrees with the wallet snapshot. Check the proof screens before sending anything.',
      });
    } else if (input.crossCheck.chainReachable === false || input.crossCheck.matches === null) {
      findings.push({
        code: 'BALANCE_INDETERMINATE',
        severity: 'attention',
        title: 'The chain check could not finish.',
        detail: 'We could not reach the chain to verify reserves this time. Your displayed balances are the last known state.',
      });
    }
  }

  // Quorum health: the cooperative path needs the threshold live.
  if (typeof input.liveValidators === 'number' && typeof input.quorumThreshold === 'number'
    && input.quorumThreshold > 0 && input.liveValidators < input.quorumThreshold) {
    findings.push({
      code: 'QUORUM_LOW',
      severity: 'alert',
      title: 'Fewer validators are live than your vault needs.',
      detail: `${input.liveValidators} of ${input.quorumThreshold} needed are live. Your exit path needs no one. Cooperative actions will wait.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: 'ALL_CLEAR',
      severity: 'info',
      title: 'All clear.',
      detail: 'Vault state, exit path, balances, and watchtower all look healthy.',
    });
  }

  const score = sentinelScore(findings);
  const paused = findings.some(f => f.code === 'DAEMON_UNREACHABLE');
  const alert = findings.some(f => f.severity === 'alert');
  const attention = findings.some(f => f.severity === 'attention');
  const status: SentinelReport['status'] = paused ? 'paused' : alert ? 'alert' : attention ? 'attention' : 'all-clear';

  const summary = paused
    ? 'Sentinel paused. We cannot check right now.'
    : alert
      ? `${findings.filter(f => f.severity === 'alert').length} finding${findings.filter(f => f.severity === 'alert').length === 1 ? '' : 's'} need${findings.filter(f => f.severity === 'alert').length === 1 ? 's' : ''} your attention.`
      : attention
        ? 'Minor findings. Nothing urgent.'
        : 'All clear.';

  return { checkedAt: now, status, score, findings, summary };
}

export interface FetchSentinelStateOptions {
  baseUrl: string;
  vaultIdHex?: string;
  allowInsecureHttp?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SentinelStateResult {
  input: SentinelInput;
  errors: string[];
}

/**
 * Fetch the watch-only daemon state for Sentinel with the established
 * bounded-retry discipline: one retry per call, then degrade — never throw.
 */
export async function fetchSentinelState(options: FetchSentinelStateOptions): Promise<SentinelStateResult> {
  const errors: string[] = [];
  const callOpts = {
    allowInsecureHttp: options.allowInsecureHttp,
    timeoutMs: options.timeoutMs ?? 8000,
    fetchImpl: options.fetchImpl,
  };

  // The underlying fetchers swallow errors and return null (status) / []
  // (receipts). For status, null IS the failure signal: retry once, then
  // degrade with an honest error note. For receipts, [] is ambiguous (the
  // healthy case), so a throw is the only failure signal and is caught here.
  let status: WatchtowerStatus | null = null;
  for (let attempt = 0; attempt < 2 && status === null; attempt += 1) {
    status = await fetchWatchtowerStatus(options.baseUrl, callOpts);
    if (status === null && attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  if (status === null) {
    errors.push('watchtower status: the daemon did not answer');
  }

  let receipts: WatchtowerBreachReceipt[] = [];
  try {
    receipts = await fetchWatchtowerReceipts(options.baseUrl, options.vaultIdHex, callOpts);
  } catch (err) {
    errors.push(`watchtower receipts: ${err instanceof Error ? err.message : String(err)}`);
  }

  // A null status means the probe failed or the daemon answered non-200:
  // that is our reachable/not-reachable signal (receipts [] is ambiguous).
  const daemonReachable = status !== null;

  return {
    input: {
      watchtowerStatus: status,
      watchtowerReceipts: receipts ?? [],
      exitReadiness: null,
      crossCheck: null,
      daemonReachable,
    },
    errors,
  };
}
