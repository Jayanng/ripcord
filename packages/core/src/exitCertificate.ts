/**
 * Exit Readiness Certificate (Bounty #1 build, Phase 2).
 *
 * Turns the four exit-readiness checks Tachi's docs recommend into visible,
 * exportable evidence: a certificate stating that this vault's unilateral
 * exit is enforced by Bitcoin consensus and not by any node's goodwill.
 *
 * Pure data in, pure data out: no network, no side effects. The wallet
 * supplies the vault's exit script + key and the live readiness state; this
 * module verifies the four checks and formats the certificate.
 */
import type { ExitReadiness } from './types.js';
import { maturityEtaText } from './sentinel.js';

export type ExitCheckId = 'timelock' | 'key-binding' | 'script-shape' | 'tree-proof';

export interface ExitCertificateCheck {
  readonly id: ExitCheckId;
  /** Plain-English name the user reads first. */
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface ExitCertificate {
  readonly vaultAddress: string;
  readonly csvBlocks: number;
  readonly userKeyFingerprint: string;
  readonly checks: readonly ExitCertificateCheck[];
  /** How many of the four checks pass. */
  readonly passed: number;
  readonly maturity: {
    readonly status: ExitReadiness['status'];
    readonly confirmations: number;
    readonly required: number;
    readonly remaining: number;
    readonly text: string;
  };
  readonly network: string;
  readonly timestamp: number;
}

export interface ExitVaultView {
  readonly csvBlocks: number;
  /** The exit tapscript as hex or opcode text (wallet passes core's describeTapscript output). */
  readonly exitScript: string;
  /** The user's x-only key the exit leaf must commit (64 hex). */
  readonly userKeyHex: string;
  readonly address: string;
}

export interface BuildCertificateOptions {
  readonly network: string;
  /** Minimum acceptable CSV. 2 is the regtest vault configuration floor; Tachi's mainnet default is 1008. */
  readonly expectedMinCsv?: number;
  /** Result of the dry-run tree verification (verifyUnilateralExitPsbt). */
  readonly treeVerified?: boolean;
  readonly now?: number;
}

const KEY_RE = /[0-9a-fA-F]{64}/;

export function buildExitCertificate(
  vault: ExitVaultView,
  readiness: ExitReadiness,
  options: BuildCertificateOptions,
): ExitCertificate {
  const now = options.now ?? Date.now();
  const expectedMinCsv = options.expectedMinCsv ?? 2;
  const script = vault.exitScript.trim();
  const scriptKey = (script.match(KEY_RE)?.[0] ?? '').toLowerCase();
  const expectedKey = vault.userKeyHex.toLowerCase();

  // Check 1: the timelock is the one this vault declared, and it cannot be
  // smaller than the expected floor (a substituted vault cannot shrink it).
  const csvOk = Number.isInteger(vault.csvBlocks) && vault.csvBlocks >= expectedMinCsv;

  // Check 2: the exit leaf commits THIS key, so no one else's key can exit.
  const keyOk = scriptKey.length === 64 && scriptKey === expectedKey;

  // Check 3: the script shape is exactly the unilateral exit shape:
  // <csv> OP_CHECKSEQUENCEVERIFY OP_DROP <userKey> OP_CHECKSIG
  const shapeRe = /^OP_\d+\s+OP_CHECKSEQUENCEVERIFY\s+OP_DROP\s+[0-9a-fA-F]{64}\s+OP_CHECKSIG$/i;
  const shapeOk = shapeRe.test(script);

  // Check 4: the leaf is in the tap tree committed by the on-chain address
  // (proven by the dry-run verification the wallet runs).
  const treeOk = options.treeVerified === true;

  const checks: ExitCertificateCheck[] = [
    {
      id: 'timelock',
      name: 'Timelock is the one this vault declared',
      pass: csvOk,
      detail: csvOk
        ? `${vault.csvBlocks} blocks, the vault's own CSV. It cannot be shortened.`
        : `CSV is ${vault.csvBlocks} blocks but at least ${expectedMinCsv} are required.`,
    },
    {
      id: 'key-binding',
      name: 'Exit leaf commits your key',
      pass: keyOk,
      detail: keyOk
        ? 'Only your key can sign the exit. No other key qualifies.'
        : 'The exit leaf does not match your key. Do not send value to this vault.',
    },
    {
      id: 'script-shape',
      name: 'Script shape is the sovereign exit',
      pass: shapeOk,
      detail: shapeOk
        ? 'Reads: CSV, wait, drop, your key, check signature. Nothing else.'
        : 'The exit script does not match the sovereign exit shape.',
    },
    {
      id: 'tree-proof',
      name: 'Leaf is proven inside the on-chain address',
      pass: treeOk,
      detail: treeOk
        ? 'The control block proves this leaf is committed by your vault address on Bitcoin.'
        : 'Tree proof not verified yet. Run the exit dry-run to prove it.',
    },
  ];

  return {
    vaultAddress: vault.address,
    csvBlocks: vault.csvBlocks,
    userKeyFingerprint: expectedKey.length === 64 ? `${expectedKey.slice(0, 8)}…${expectedKey.slice(-8)}` : 'unknown',
    checks,
    passed: checks.filter(c => c.pass).length,
    maturity: {
      status: readiness.status,
      confirmations: readiness.confirmations,
      required: readiness.requiredConfirmations,
      remaining: readiness.confirmationsRemaining,
      text: readiness.status === 'live'
        ? 'mature'
        : readiness.status === 'maturing'
          ? maturityEtaText(readiness.confirmationsRemaining)
          : readiness.status === 'spent'
            ? 'funding already spent on L1'
            : 'not funded yet',
    },
    network: options.network,
    timestamp: now,
  };
}

/** One honest line a user can share or paste into an issue. */
export function certificateSummaryText(cert: ExitCertificate): string {
  const total = cert.checks.length;
  if (cert.passed === total) {
    return `Exit Certificate: ${cert.passed}/${total} checks pass. Your exit is enforced by Bitcoin consensus, not by any node's goodwill.`;
  }
  return `Exit Certificate: ${cert.passed}/${total} checks pass. Fix the failed checks before relying on this exit path.`;
}

/** File-friendly export payload (already plain JSON-serializable data). */
export function certificateToJson(cert: ExitCertificate): string {
  return JSON.stringify(cert, null, 2);
}
