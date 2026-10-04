/**
 * Regression tests for the 2026-10-02 certificate audit fix:
 * the certificate must report the sweep that already confirmed, the tree proof
 * must come from the stored leaf + control block (not a session flag), and a
 * spent vault must be able to pass tree-proof without any dry run.
 */
import { describe, expect, it } from 'vitest';
import { buildVaultP2tr, verifyVaultP2tr, type VaultP2tr } from '@tachibtc/taurus-vault-core';
import { buildSweepEvidence, proveExitTree, type FundingSpender } from '../src/exit.js';
import { buildExitCertificate, certificateSummaryText, certificateToJson } from '../src/exitCertificate.js';
import type { ExitReadiness, VaultRecord } from '../src/types.js';

// Deterministic valid secp256k1 keys (k*G for k=2..7), no key material involved.
const USER = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const NODES = [
  '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
  '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
  '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
  '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
  '025cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc',
  '022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01',
];

function makeVault(csvBlocks = 2): { p2tr: VaultP2tr; record: VaultRecord } {
  const p2tr = buildVaultP2tr({
    network: 'regtest',
    userPubkey: USER,
    nodePubkeys: NODES,
    threshold: 5,
    csvBlocks,
  });
  verifyVaultP2tr(p2tr);
  const record = {
    address: p2tr.address,
    csvBlocks,
    userKeyDescriptor: { publicKey: USER },
    exitLeaf: Buffer.from(p2tr.exitLeaf.script).toString('hex'),
    p2tr,
    funding: {
      txid: 'aa'.repeat(32),
      vout: 0,
      valueSats: 40000n,
    },
  } as unknown as VaultRecord;
  return { p2tr, record };
}

const FUNDING = { txid: 'bb'.repeat(32), vout: 0, valueSats: 40000n };

function spenderTo(dest: string, amountSats: bigint, feeSats: bigint): FundingSpender {
  return {
    txid: 'cc'.repeat(32),
    rawHex: '020000000001deadbeef',
    confirmations: 110,
    blockHash: 'dd'.repeat(32),
    inputs: [{ txid: FUNDING.txid, vout: FUNDING.vout }],
    outputs: [{ address: dest, valueSats: amountSats }],
  };
}

describe('proveExitTree (stored leaf + control block, no session flag)', () => {
  it('verifies a stored bundle and exposes the control block evidence', () => {
    const { record } = makeVault();
    const proof = proveExitTree(record);
    expect(proof.verified).toBe(true);
    expect(proof.method).toBe('stored-proof-reverified');
    expect(proof.exitControlBlockHex).toMatch(/^[0-9a-f]+$/i);
    expect(proof.exitLeafHashHex).toMatch(/^[0-9a-f]{64}$/i);
    expect(proof.exitLeafHex).toMatch(/^[0-9a-f]+$/i);
  });

  it('fails when the stored bundle commits to a different address', () => {
    const { record, p2tr } = makeVault();
    const tampered = { ...record, address: p2tr.address.replace(/^bcrt1p/, 'bcrt1q') } as VaultRecord;
    const proof = proveExitTree(tampered);
    expect(proof.verified).toBe(false);
    expect(proof.reason).toBeTruthy();
  });

  it('fails honestly when no taproot bundle is stored', () => {
    const { record } = makeVault();
    const bare = { ...record, p2tr: undefined } as VaultRecord;
    const proof = proveExitTree(bare);
    expect(proof.verified).toBe(false);
  });
});

describe('buildSweepEvidence (node-read, never hardcoded labels)', () => {
  it('labels a sole-input sweep to the user L1 address as a sovereign exit', () => {
    const sweep = buildSweepEvidence({
      funding: FUNDING,
      spender: spenderTo('bcrt1quseruseruseruseruseruseruseruseruseruseruseruser', 39800n, 200n),
      destination: 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser',
    });
    expect(sweep.sovereign).toBe(true);
    expect(sweep.label).toBe('sovereign-exit');
    expect(sweep.exitTxid).toBe('cc'.repeat(32));
    expect(sweep.spentOutpoint).toBe(`${FUNDING.txid}:0`);
    expect(sweep.amountSats).toBe(39800n);
    expect(sweep.feeSats).toBe(200n);
    expect(sweep.confirmations).toBe(110);
    expect(sweep.explorerUrl).toBe('');
  });

  it('refuses the sovereign label when the payout is not the user L1 address', () => {
    const sweep = buildSweepEvidence({
      funding: FUNDING,
      spender: spenderTo('bcrt1psomevaultaddress', 39800n, 200n),
      destination: 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser',
    });
    expect(sweep.sovereign).toBe(false);
    expect(sweep.label).toBe('unverified-spend');
    expect(sweep.amountSats).toBeNull();
  });

  it('refuses the sovereign label when any output pays a third party', () => {
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const mixed: FundingSpender = {
      ...spenderTo(dest, 10n, 200n),
      outputs: [
        { address: dest, valueSats: 10n },
        { address: 'bcrt1qattacker', valueSats: 39790n },
      ],
    };
    const sweep = buildSweepEvidence({ funding: FUNDING, spender: mixed, destination: dest });
    expect(sweep.sovereign).toBe(false);
    expect(sweep.label).toBe('unverified-spend');
  });

  it('amountSats is the full amount paid to the destination', () => {
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const sweep = buildSweepEvidence({ funding: FUNDING, spender: spenderTo(dest, 39800n, 200n), destination: dest });
    expect(sweep.amountSats).toBe(39800n);
  });

  it('requires the exit leaf in the spending witness when one is supplied', () => {
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const withLeaf = buildSweepEvidence({
      funding: FUNDING,
      spender: spenderTo(dest, 39800n, 200n),
      destination: dest,
      expectedLeafScriptHex: 'deadbeef',
    });
    expect(withLeaf.sovereign).toBe(true);
    const wrongLeaf = buildSweepEvidence({
      funding: FUNDING,
      spender: spenderTo(dest, 39800n, 200n),
      destination: dest,
      expectedLeafScriptHex: 'cafebabe',
    });
    expect(wrongLeaf.sovereign).toBe(false);
    expect(wrongLeaf.note).toContain('cooperative');
  });

  it('refuses the sovereign label when the input is not exactly the funding outpoint', () => {
    const sweep = buildSweepEvidence({
      funding: FUNDING,
      spender: { ...spenderTo('bcrt1quseruseruseruseruseruseruseruseruseruseruseruser', 39800n, 200n), inputs: [{ txid: FUNDING.txid, vout: 1 }] },
      destination: 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser',
    });
    expect(sweep.sovereign).toBe(false);
  });
});

describe('buildExitCertificate reports the confirmed sweep', () => {
  const swept: ExitReadiness = {
    status: 'spent',
    confirmations: 0,
    requiredConfirmations: 2,
    confirmationsRemaining: 0,
    reason: 'Funding outpoint is spent',
    spentBy: { txid: 'cc'.repeat(32) as never, confirmations: 110, destination: 'bcrt1quser', amountSats: 39800n, feeSats: null },
  };

  it('tree-proof passes for a spent vault from the stored proof, no dry run', () => {
    const { record } = makeVault();
    const proof = proveExitTree(record);
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      swept,
      { network: 'regtest', treeProof: proof, sweep: null, fundingOutpoint: `${FUNDING.txid}:0` },
    );
    expect(cert.checks.find(c => c.id === 'tree-proof')?.pass).toBe(true);
    expect(cert.maturity.status).toBe('spent');
  });

  it('fills the sweep fields from node evidence and the explorer URL', () => {
    const { record } = makeVault();
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const sweep = buildSweepEvidence({ funding: FUNDING, spender: spenderTo(dest, 39800n, 200n), destination: dest });
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      swept,
      { network: 'regtest', treeProof: proveExitTree(record), sweep, fundingOutpoint: `${FUNDING.txid}:0` },
    );
    expect(cert.sweep?.exitTxid).toBe(sweep.exitTxid);
    expect(cert.sweep?.exitRawHex).toBeTruthy();
    expect(cert.sweep?.spentOutpoint).toBe(`${FUNDING.txid}:0`);
    expect(cert.sweep?.destination).toBe(dest);
    expect(cert.sweep?.amountSats).toBe(39800n);
    expect(cert.sweep?.feeSats).toBe(200n);
    expect(cert.sweep?.blockHash).toBeTruthy();
    expect(cert.sweep?.confirmations).toBe(110);
    expect(cert.sweep?.explorerUrl).toBe('');
    expect(cert.exitCompleted).toBe(true);
    expect(cert.maturity.confirmations).toBe(110);
  });

  it('summary names the sweep transaction and amounts', () => {
    const { record } = makeVault();
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const sweep = buildSweepEvidence({ funding: FUNDING, spender: spenderTo(dest, 39800n, 200n), destination: dest });
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      swept,
      { network: 'regtest', treeProof: proveExitTree(record), sweep, fundingOutpoint: `${FUNDING.txid}:0` },
    );
    const text = certificateSummaryText(cert);
    expect(text).toContain(sweep.exitTxid);
    expect(text).toContain('39800');
  });

  it('labels csvBlocks 2 as demo-only against the production default of 1008', () => {
    const { record } = makeVault(2);
    const cert = buildExitCertificate(
      { csvBlocks: 2, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      null,
      { network: 'regtest', treeProof: proveExitTree(record) },
    );
    expect(cert.csvBlocksNote).toContain('Demo-only');
    expect(cert.csvBlocksNote).toContain('1008');
    expect(cert.csvBlocks).toBe(2);
  });

  it('does not claim completion for a mempool (0-conf) sovereign sweep', () => {
    const { record } = makeVault();
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const sweep = buildSweepEvidence({
      funding: FUNDING,
      spender: { ...spenderTo(dest, 39800n, 200n), confirmations: 0, blockHash: null },
      destination: dest,
    });
    expect(sweep.sovereign).toBe(true);
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      swept,
      { network: 'regtest', treeProof: proveExitTree(record), sweep, fundingOutpoint: `${FUNDING.txid}:0` },
    );
    expect(cert.exitCompleted).toBe(false);
    expect(certificateSummaryText(cert)).toContain('waiting for confirmation');
  });

  it('mirrors the mandated export fields at the top level of the JSON', () => {
    const { record } = makeVault();
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const sweep = buildSweepEvidence({ funding: FUNDING, spender: spenderTo(dest, 39800n, 200n), destination: dest });
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      swept,
      { network: 'regtest', treeProof: proveExitTree(record), sweep, fundingOutpoint: `${FUNDING.txid}:0` },
    );
    const parsed = JSON.parse(certificateToJson(cert)) as Record<string, unknown>;
    expect(parsed.exitTxid).toBe(sweep.exitTxid);
    expect(typeof parsed.exitRawHex).toBe('string');
    expect(parsed.spentOutpoint).toBe(`${FUNDING.txid}:0`);
    expect(parsed.destination).toBe(dest);
    expect(parsed.amountSats).toBe(39800);
    expect(parsed.feeSats).toBe(200);
    expect(parsed.blockHash).toBeTruthy();
    expect(parsed.confirmations).toBe(110);
  });

  it('top-level export fields are null before any spend', () => {
    const { record } = makeVault();
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      null,
      { network: 'regtest', treeProof: proveExitTree(record), fundingOutpoint: `${FUNDING.txid}:0` },
    );
    expect(cert.exitTxid).toBeNull();
    expect(cert.confirmations).toBeNull();
    expect(cert.sweep).toBeNull();
  });

  it('certificateToJson serializes bigint sweep fields without throwing', () => {
    const { record } = makeVault();
    const dest = 'bcrt1quseruseruseruseruseruseruseruseruseruseruseruser';
    const sweep = buildSweepEvidence({ funding: FUNDING, spender: spenderTo(dest, 39800n, 200n), destination: dest });
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      swept,
      { network: 'regtest', treeProof: proveExitTree(record), sweep, fundingOutpoint: `${FUNDING.txid}:0` },
    );
    const json = certificateToJson(cert);
    const parsed = JSON.parse(json) as { sweep?: { amountSats?: number; feeSats?: number; exitTxid?: string; explorerUrl?: string } };
    expect(parsed.sweep?.amountSats).toBe(39800);
    expect(parsed.sweep?.feeSats).toBe(200);
    expect(parsed.sweep?.exitTxid).toBe(sweep.exitTxid);
    expect(parsed.sweep?.explorerUrl).toBe('');
  });

  it('never tells a spent vault to run a dry run that can never succeed', () => {
    const { record } = makeVault();
    const cert = buildExitCertificate(
      { csvBlocks: record.csvBlocks, exitScript: record.exitLeaf ?? '', userKeyHex: USER.slice(2), address: record.address },
      swept,
      { network: 'regtest', treeProof: { ...proveExitTree(record), verified: false, reason: 'Stored taproot bundle failed re-derivation: x' } },
    );
    const tree = cert.checks.find(c => c.id === 'tree-proof');
    expect(tree?.pass).toBe(false);
    expect(tree?.detail).not.toContain('Run the exit dry-run');
  });
});
