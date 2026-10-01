import { describe, it, expect } from 'vitest';
import {
  buildExitCertificate,
  certificateSummaryText,
  type ExitCertificate,
} from '../src/exitCertificate.js';
import type { ExitReadiness } from '../src/types.js';

const USER_KEY_HEX = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';

const readiness = (over: Partial<ExitReadiness> = {}): ExitReadiness => ({
  status: 'live',
  confirmations: 1008,
  requiredConfirmations: 1008,
  confirmationsRemaining: 0,
  ...over,
});

const vault = (over: Partial<{ csvBlocks: number; exitScript: string; userKeyHex: string; address: string }> = {}) => ({
  csvBlocks: 2,
  // '<csv> OP_CHECKSEQUENCEVERIFY OP_DROP <key> OP_CHECKSIG' as describeTapscript-like shape
  exitScript: 'OP_2 OP_CHECKSEQUENCEVERIFY OP_DROP ' + USER_KEY_HEX + ' OP_CHECKSIG',
  userKeyHex: USER_KEY_HEX,
  address: 'bcrt1pqqwtv6xnqvx3jnfttse3rqamgdpeppak62ldmej4af7gslcp5w2sr5nw2t',
  ...over,
});

describe('exitCertificate: buildExitCertificate (pure)', () => {
  it('issues a 4/4 certificate when every check passes', () => {
    const cert = buildExitCertificate(vault(), readiness(), { network: 'regtest', treeVerified: true, now: 1700000000 });
    expect(cert.checks).toHaveLength(4);
    expect(cert.checks.every(c => c.pass)).toBe(true);
    expect(cert.passed).toBe(4);
    expect(cert.network).toBe('regtest');
    expect(cert.timestamp).toBe(1700000000);
    expect(cert.userKeyFingerprint).toContain(USER_KEY_HEX.slice(0, 8));
  });

  it('check 1 fails when the CSV is below the required minimum', () => {
    const cert = buildExitCertificate(vault({ csvBlocks: 1 }), readiness(), { network: 'regtest', expectedMinCsv: 2, now: 0 });
    const csv = cert.checks.find(c => c.id === 'timelock');
    expect(csv?.pass).toBe(false);
    expect(cert.passed).toBeLessThan(4);
  });

  it('check 2 fails when the exit leaf commits a foreign key', () => {
    const cert = buildExitCertificate(
      vault({ exitScript: 'OP_2 OP_CHECKSEQUENCEVERIFY OP_DROP ' + 'ab'.repeat(32) + ' OP_CHECKSIG' }),
      readiness(),
      { network: 'regtest', now: 0 },
    );
    const key = cert.checks.find(c => c.id === 'key-binding');
    expect(key?.pass).toBe(false);
  });

  it('check 3 fails when the script shape is wrong', () => {
    const cert = buildExitCertificate(vault({ exitScript: USER_KEY_HEX + ' OP_CHECKSIG' }), readiness(), { network: 'regtest', now: 0 });
    const shape = cert.checks.find(c => c.id === 'script-shape');
    expect(shape?.pass).toBe(false);
  });

  it('check 4 fails when the tree proof is not verified', () => {
    const cert = buildExitCertificate(vault(), readiness(), { network: 'regtest', treeVerified: false, now: 0 });
    const tree = cert.checks.find(c => c.id === 'tree-proof');
    expect(tree?.pass).toBe(false);
  });

  it('carries human maturity wording from the readiness state', () => {
    const cert = buildExitCertificate(vault(), readiness({ status: 'maturing', confirmations: 2, requiredConfirmations: 1008, confirmationsRemaining: 1006 }), { network: 'regtest', now: 0 });
    expect(cert.maturity.text).toContain('1006');
    expect(cert.maturity.text).toContain('days');
  });

  it('accepts the real leaf hex and disassembles it', () => {
    // OP_2 OP_CHECKSEQUENCEVERIFY OP_DROP <64-byte push> OP_CHECKSIG
    const hex = '52b27520' + USER_KEY_HEX + 'ac';
    const cert = buildExitCertificate(vault({ exitScript: hex }), readiness(), { network: 'regtest', treeVerified: true, now: 0 });
    expect(cert.checks.every(c => c.pass)).toBe(true);
  });

  it('fails when the CSV committed in the leaf differs from the vault declaration', () => {
    const cert = buildExitCertificate(vault({ csvBlocks: 9 }), readiness(), { network: 'regtest', treeVerified: true, now: 0 });
    const csv = cert.checks.find(c => c.id === 'timelock');
    expect(csv?.pass).toBe(false);
  });

  it('a spent vault never claims an exit is possible', () => {
    const spent: ExitReadiness = { status: 'spent', confirmations: 0, requiredConfirmations: 1008, confirmationsRemaining: 0 };
    const cert = buildExitCertificate(vault(), spent, { network: 'regtest', treeVerified: true, now: 0 });
    expect(cert.exitStillPossible).toBe(false);
    expect(certificateSummaryText(cert)).toContain('nothing left to exit');
  });

  it('a missing exit leaf fails the script checks instead of inventing one', () => {
    const cert = buildExitCertificate(vault({ exitScript: '' }), readiness(), { network: 'regtest', treeVerified: true, now: 0 });
    expect(cert.checks.find(c => c.id === 'timelock')?.pass).toBe(false);
    expect(cert.checks.find(c => c.id === 'key-binding')?.pass).toBe(false);
    expect(cert.checks.find(c => c.id === 'script-shape')?.pass).toBe(false);
  });

  it('a negative CScriptNum CSV never validates the timelock', () => {
    // 0x82 is CScriptNum -2; it must NOT pass for any positive declaration.
    const script = '82 OP_NOP3 OP_DROP ' + USER_KEY_HEX + ' OP_CHECKSIG';
    const cert = buildExitCertificate(vault({ csvBlocks: 130, exitScript: script }), readiness(), { network: 'regtest', treeVerified: true, now: 0 });
    expect(cert.checks.find(c => c.id === 'timelock')?.pass).toBe(false);
  });

  it('unpolled maturity is unknown, never mature', () => {
    const cert = buildExitCertificate(vault(), null, { network: 'regtest', treeVerified: true, now: 0 });
    expect(cert.maturity.status).toBe('unknown');
    expect(cert.maturity.text).toBe('not checked yet');
  });

  it('carries public evidence for independent verification', () => {
    const cert = buildExitCertificate(vault(), readiness(), { network: 'regtest', treeVerified: true, fundingOutpoint: 'ab:1', now: 0 });
    expect(cert.evidence.userKeyXOnly).toBe(USER_KEY_HEX);
    expect(cert.evidence.exitLeafAsm).toContain('OP_CHECKSEQUENCEVERIFY');
    expect(cert.evidence.fundingOutpoint).toBe('ab:1');
  });

  it('exports as plain JSON-serializable data (no BigInt)', () => {
    const cert = buildExitCertificate(vault(), readiness(), { network: 'regtest', now: 0 });
    const round = JSON.parse(JSON.stringify(cert)) as ExitCertificate;
    expect(round.checks).toHaveLength(4);
  });
});

describe('exitCertificate: certificateSummaryText', () => {
  it('states the pass count and the consensus guarantee line', () => {
    const cert = buildExitCertificate(vault(), readiness(), { network: 'regtest', treeVerified: true, now: 0 });
    const text = certificateSummaryText(cert);
    expect(text).toContain('4/4');
    expect(text.toLowerCase()).toContain('bitcoin consensus');
  });

  it('flags failures in the summary', () => {
    const cert = buildExitCertificate(vault({ csvBlocks: 1 }), readiness(), { network: 'regtest', expectedMinCsv: 2, treeVerified: true, now: 0 });
    expect(certificateSummaryText(cert)).toContain('3/4');
  });
});
