/**
 * Exit Readiness Certificate (Bounty #1 build, Phase 2).
 *
 * Turns the four exit-readiness checks Tachi's docs recommend into visible,
 * exportable evidence: a certificate stating that this vault's unilateral
 * exit is enforced by Bitcoin consensus and not by any node's goodwill.
 *
 * Honesty rules (second-eye review 2026-10-02):
 * - Nothing is invented: a missing exit leaf fails its checks; it is never
 *   synthesized into a passing shape.
 * - The expected user key is the caller's TRUE key (derived from the user's
 *   phrase), never the vault record's own claim: a tampered record must FAIL.
 * - A spent vault cannot exit: the certificate says so instead of claiming
 *   consensus enforcement for an outpoint Bitcoin will reject.
 * - Unpolled maturity is reported as unknown, never "mature".
 *
 * Pure data in, pure data out: no network, no side effects.
 */
import type { ExitReadiness } from './types.js';
import { maturityEtaText } from './sentinel.js';
import { describeTapscript } from './vault.js';

export type ExitCheckId = 'timelock' | 'key-binding' | 'script-shape' | 'tree-proof';

export interface ExitCertificateCheck {
  readonly id: ExitCheckId;
  /** Plain-English name the user reads first. */
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

/** Public evidence so any judge can re-verify the checks independently. */
export interface ExitCertificateEvidence {
  readonly userKeyXOnly: string;
  readonly exitLeafHex: string | null;
  readonly exitLeafAsm: string | null;
  readonly fundingOutpoint: string | null;
}

export interface ExitCertificate {
  readonly vaultAddress: string;
  readonly csvBlocks: number;
  readonly userKeyFingerprint: string;
  readonly checks: readonly ExitCertificateCheck[];
  /** How many of the four checks pass. */
  readonly passed: number;
  readonly maturity: {
    readonly status: ExitReadiness['status'] | 'unknown';
    readonly confirmations: number;
    readonly required: number;
    readonly remaining: number;
    readonly text: string;
  };
  /** False when the funding is already spent: nothing can be exited. */
  readonly exitStillPossible: boolean;
  readonly evidence: ExitCertificateEvidence;
  readonly network: string;
  readonly timestamp: number;
}

export interface ExitVaultView {
  readonly csvBlocks: number;
  /**
   * The REAL exit tapscript (raw hex or asm text). An empty value fails the
   * script checks honestly; nothing is synthesized.
   */
  readonly exitScript: string;
  /**
   * The key the user ACTUALLY controls (derived from their phrase at the
   * vault's key index). Comparing the leaf against this proves ownership;
   * the vault record's own claim proves nothing.
   */
  readonly userKeyHex: string;
  readonly address: string;
}

export interface BuildCertificateOptions {
  readonly network: string;
  /** Minimum acceptable CSV. 2 is the regtest vault configuration floor; Tachi's mainnet default is 1008. */
  readonly expectedMinCsv?: number;
  /** Result of the dry-run tree verification (verifyUnilateralExitPsbt). */
  readonly treeVerified?: boolean;
  /** The vault's funding outpoint when known (public chain data). */
  readonly fundingOutpoint?: string;
  readonly now?: number;
}

/**
 * OP_n (1..16) or a little-endian CScriptNum push (sign-magnitude, even-byte
 * hex) -> the number it commits. Returns null for anything unrecognized.
 */
const csvFromToken = (tok: string): number | null => {
  const m = /^OP_(\d+)$/.exec(tok);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 16 ? n : null;
  }
  if (/^(?:[0-9a-f]{2}){1,4}$/i.test(tok)) {
    let n = 0;
    for (let i = tok.length - 2; i >= 0; i -= 2) n = n * 256 + parseInt(tok.slice(i, i + 2), 16);
    const lastByte = parseInt(tok.slice(-2), 16);
    if (lastByte & 0x80) {
      // CScriptNum sign bit: a negative CSV must never validate a timelock.
      return -(n - 0x80 * Math.pow(256, tok.length / 2 - 1));
    }
    return n;
  }
  return null;
};

export function buildExitCertificate(
  vault: ExitVaultView,
  readiness: ExitReadiness | null,
  options: BuildCertificateOptions,
): ExitCertificate {
  const now = options.now ?? Date.now();
  const expectedMinCsv = options.expectedMinCsv ?? 2;
  const expectedKey = vault.userKeyHex.toLowerCase();

  // Accept the real leaf hex or asm text; normalize to asm tokens. An empty
  // or unreadable script yields NO tokens and fails every script check.
  let tokens: string[] = [];
  const rawScript = (vault.exitScript ?? '').trim();
  const isAsm = /\s/.test(rawScript);
  try {
    if (rawScript) {
      tokens = isAsm ? rawScript.split(/\s+/).filter(Boolean) : describeTapscript(rawScript);
    }
  } catch {
    tokens = [];
  }

  // Check 1: the leaf commits THIS vault's declared timelock (not shrunken):
  // the CSV in the script must equal vault.csvBlocks and clear the floor.
  const csvInLeaf = tokens.length > 0 ? csvFromToken(tokens[0]) : null;
  const csvOk = Number.isInteger(vault.csvBlocks)
    && vault.csvBlocks >= expectedMinCsv
    && csvInLeaf === vault.csvBlocks;

  // Check 2: the leaf commits the key the USER controls (from their phrase),
  // not whatever the stored record claims. Only token 3 can hold the exit key.
  const scriptKey = /^[0-9a-f]{64}$/i.test(tokens[3] ?? '') ? tokens[3].toLowerCase() : '';
  const keyOk = scriptKey.length === 64 && scriptKey === expectedKey;

  // Check 3: the script shape is exactly the sovereign exit shape:
  // <csv> OP_CHECKSEQUENCEVERIFY OP_DROP <userKey> OP_CHECKSIG
  const csvOpcode = tokens[1] === 'OP_CHECKSEQUENCEVERIFY' || tokens[1] === 'OP_NOP3';
  const shapeOk = tokens.length === 5
    && csvOpcode
    && tokens[2] === 'OP_DROP'
    && /^[0-9a-f]{64}$/i.test(tokens[3])
    && tokens[4] === 'OP_CHECKSIG';

  // Check 4: the leaf is in the tap tree committed by the on-chain address
  // (proven by the dry-run verification the wallet runs).
  const treeOk = options.treeVerified === true;

  const checks: ExitCertificateCheck[] = [
    {
      id: 'timelock',
      name: 'Timelock is the one this vault declared',
      pass: csvOk,
      detail: csvOk
        ? `${vault.csvBlocks} blocks, committed in the script itself. It cannot be shortened.`
        : tokens.length === 0
          ? 'No exit script to inspect on this vault record.'
          : `The script commits ${csvInLeaf ?? 'no recognizable CSV'} blocks while the vault declares ${vault.csvBlocks} (minimum ${expectedMinCsv}).`,
    },
    {
      id: 'key-binding',
      name: 'Exit leaf commits your key',
      pass: keyOk,
      detail: keyOk
        ? 'Only your key can sign the exit. No other key qualifies.'
        : tokens.length === 0
          ? 'No exit script to inspect on this vault record.'
          : 'The exit leaf does not match the key from your recovery phrase. Do not send value to this vault.',
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

  const spent = readiness?.status === 'spent';
  const maturityText = !readiness
    ? 'not checked yet'
    : readiness.status === 'live'
      ? 'mature'
      : readiness.status === 'maturing'
        ? maturityEtaText(readiness.confirmationsRemaining)
        : spent
          ? 'funding already spent on L1'
          : 'not funded yet';

  return {
    vaultAddress: vault.address,
    csvBlocks: vault.csvBlocks,
    userKeyFingerprint: expectedKey.length === 64 ? `${expectedKey.slice(0, 8)}…${expectedKey.slice(-8)}` : 'unknown',
    checks,
    passed: checks.filter(c => c.pass).length,
    maturity: {
      status: readiness ? readiness.status : 'unknown',
      confirmations: readiness?.confirmations ?? 0,
      required: readiness?.requiredConfirmations ?? 0,
      remaining: readiness?.confirmationsRemaining ?? 0,
      text: maturityText,
    },
    exitStillPossible: !spent,
    evidence: {
      userKeyXOnly: expectedKey,
      exitLeafHex: rawScript && !isAsm ? rawScript : null,
      exitLeafAsm: rawScript ? (isAsm ? rawScript : (tokens.length ? tokens.join(' ') : null)) : null,
      fundingOutpoint: options.fundingOutpoint ?? null,
    },
    network: options.network,
    timestamp: now,
  };
}

/** One honest line a user can share or paste into an issue. */
export function certificateSummaryText(cert: ExitCertificate): string {
  const total = cert.checks.length;
  if (!cert.exitStillPossible) {
    return `Exit Certificate: ${cert.passed}/${total} script checks pass, but this vault's funding has already been spent on Bitcoin L1. There is nothing left to exit.`;
  }
  if (cert.passed === total) {
    return `Exit Certificate: ${cert.passed}/${total} checks pass. Your exit is enforced by Bitcoin consensus, not by any node's goodwill.`;
  }
  return `Exit Certificate: ${cert.passed}/${total} checks pass. Fix the failed checks before relying on this exit path.`;
}

/** File-friendly export payload (already plain JSON-serializable data). */
export function certificateToJson(cert: ExitCertificate): string {
  return JSON.stringify(cert, null, 2);
}
