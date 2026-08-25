import * as vc from '@tachibtc/taurus-vault-core';
import { depositFromMnemonic, type DepositResult } from './deposit.js';
import { makeSigner } from './keys.js';
import { registerVault } from './register.js';
import { mapDaemonError } from './errors.js';
import type { VaultRecord } from './types.js';

export interface FundVaultLifecycleParams {
  vault: VaultRecord;
  mnemonic: string;
  bitcoinRpcBaseUrl: string;
  daemonBaseUrl: string;
  amountSats: bigint;
  feeRateSatVb?: number;
  confirmationPollMs?: number;
  onProgress?: (stage: 'depositing' | 'confirming-deposit' | 'minting' | 'registering') => void;
  onDepositBroadcast?: (deposit: DepositResult) => void;
  onConfirmationPoll?: (confirmations: number) => void;
}

export interface FundVaultLifecycleResult {
  deposit: { txid: import('./types.js').DisplayTxid; vout: number; amountSats: bigint; source: 'broadcast' | 'recovered' };
  vtxoId: string;
  mintTxHash: string;
  mintEpoch: number;
  vaultId: string;
}

type LifecycleDeposit = FundVaultLifecycleResult['deposit'];

export interface RecoverVaultLifecycleStateParams {
  vault: VaultRecord;
  bitcoinRpcBaseUrl: string;
  daemonBaseUrl: string;
}

/** Restore an existing vault's public funding and registration evidence without broadcasting. */
export async function recoverVaultLifecycleState(
  params: RecoverVaultLifecycleStateParams,
): Promise<VaultRecord> {
  const deposit = await findExistingVaultFunding(params.bitcoinRpcBaseUrl, params.vault);
  if (!deposit) return params.vault;

  const daemonUrl = new URL(params.daemonBaseUrl);
  const allowInsecureHttp = daemonUrl.protocol === 'http:'
    && (daemonUrl.hostname === '127.0.0.1' || daemonUrl.hostname === 'localhost' || daemonUrl.hostname === '::1');
  const listed = await vc.listVaults(params.vault.userKeyDescriptor.publicKey, {
    baseUrl: params.daemonBaseUrl,
    pageSize: 100,
    allowInsecureHttp,
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
  const internalFundingTxid = Buffer.from(deposit.txid, 'hex').reverse().toString('hex');
  const registered = listed.vaults.find(item =>
    item.fundingTxid.toLowerCase() === internalFundingTxid && item.fundingVout === deposit.vout,
  );
  return {
    ...params.vault,
    funding: { txid: deposit.txid, vout: deposit.vout, valueSats: deposit.amountSats },
    registered: Boolean(registered),
    ...(registered ? { vaultIdHex: registered.vaultId } : {}),
  };
}

export async function getLiveVtxos(ownerXOnly: string, daemonBaseUrl: string) {
  const url = new URL(daemonBaseUrl);
  const allowInsecureHttp = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');
  const result = await vc.getAddressVtxos(ownerXOnly, { baseUrl: daemonBaseUrl, allowInsecureHttp, fetchImpl: globalThis.fetch.bind(globalThis) });
  return result.vtxos.map(item => ({ id: item.id, amountSats: item.amountSats, spent: item.spent, locked: item.locked }));
}

async function findExistingVaultFunding(baseUrl: string, vault: VaultRecord) {
  const response = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'scantxoutset', params: ['start', [`addr(${vault.address})`]] }) });
  if (!response.ok) throw new Error(`Bitcoin RPC HTTP ${response.status}`);
  const payload = await response.json() as { result?: { unspents?: Array<{ txid: string; vout: number; scriptPubKey: string; amount: number }> }; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? 'Vault UTXO scan failed');
  const expectedScript = vault.p2tr ? Buffer.from(vault.p2tr.output).toString('hex').toLowerCase() : '';
  const found = payload.result?.unspents?.find(item => item.scriptPubKey.toLowerCase() === expectedScript);
  if (!found || !/^[0-9a-f]{64}$/i.test(found.txid)) return null;
  return { txid: found.txid as import('./types.js').DisplayTxid, vout: found.vout, amountSats: BigInt(Math.round(found.amount * 1e8)), source: 'recovered' as const };
}

async function waitForBitcoinConfirmation(baseUrl: string, txid: string, pollMs: number, onPoll?: (confirmations: number) => void): Promise<void> {
  for (;;) {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'getrawtransaction', params: [txid, true] }),
    });
    if (!response.ok) throw new Error(`Bitcoin RPC HTTP ${response.status}`);
    const payload = await response.json() as { result?: { confirmations?: number }; error?: { message?: string } };
    const confirmations = payload.result?.confirmations ?? 0;
    onPoll?.(confirmations);
    if (confirmations > 0) return;
    if (payload.error && !/no such mempool|not found/i.test(payload.error.message ?? '')) throw new Error(payload.error.message ?? 'Bitcoin RPC lookup failed');
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

/** Live deposit → L1 confirmation → VTXO mint → vault registration. */
export async function fundVaultLifecycle(params: FundVaultLifecycleParams): Promise<FundVaultLifecycleResult> {
  try {
    const daemonUrl = new URL(params.daemonBaseUrl);
    const allowInsecureHttp = daemonUrl.protocol === 'http:' && (daemonUrl.hostname === '127.0.0.1' || daemonUrl.hostname === 'localhost' || daemonUrl.hostname === '::1');
    let deposit: LifecycleDeposit | null = await findExistingVaultFunding(params.bitcoinRpcBaseUrl, params.vault);
    if (!deposit) {
      params.onProgress?.('depositing');
      const broadcast = await depositFromMnemonic({ vault: params.vault, mnemonic: params.mnemonic, rpc: { baseUrl: params.bitcoinRpcBaseUrl }, amountSats: params.amountSats, feeRateSatVb: params.feeRateSatVb });
      params.onDepositBroadcast?.(broadcast);
      const expectedScript = params.vault.p2tr ? Buffer.from(params.vault.p2tr.output).toString('hex').toLowerCase() : '';
      const bitcoin = await import('bitcoinjs-lib');
      const decoded = bitcoin.Transaction.fromHex(broadcast.rawTxHex);
      const fundingVout = decoded.outs.findIndex(output => Buffer.from(output.script).toString('hex').toLowerCase() === expectedScript);
      if (fundingVout < 0) throw new Error('Broadcast deposit transaction does not contain the expected vault output');
      deposit = { txid: broadcast.txid, vout: fundingVout, amountSats: broadcast.amountSats, source: 'broadcast' as const };
      params.onProgress?.('confirming-deposit');
      await waitForBitcoinConfirmation(params.bitcoinRpcBaseUrl, deposit.txid, params.confirmationPollMs ?? 5_000, params.onConfirmationPoll);
    }

    const listed = await vc.listVaults(params.vault.userKeyDescriptor.publicKey, { baseUrl: params.daemonBaseUrl, pageSize: 100, allowInsecureHttp, fetchImpl: globalThis.fetch.bind(globalThis) });
    const internalFundingTxid = Buffer.from(deposit.txid, 'hex').reverse().toString('hex');
    const registered = listed.vaults.find(item => item.fundingTxid.toLowerCase() === internalFundingTxid && item.fundingVout === deposit.vout);
    if (registered) {
      const current = await vc.getAddressVtxos(params.vault.userKeyDescriptor.publicKey.slice(2), { baseUrl: params.daemonBaseUrl, allowInsecureHttp, fetchImpl: globalThis.fetch.bind(globalThis) });
      const evidence = current.vtxos.find(item => !item.spent);
      return { deposit, vtxoId: evidence?.id ?? '', mintTxHash: '', mintEpoch: evidence?.height ?? 0, vaultId: registered.vaultId };
    }

    params.onProgress?.('minting');
    const signer = makeSigner(params.mnemonic, 'regtest', params.vault.userKeyIndex);
    const mintAmount = deposit.amountSats - 1n;
    const owner = params.vault.userKeyDescriptor.publicKey.slice(2);
    const existing = await vc.getAddressVtxos(owner, { baseUrl: params.daemonBaseUrl, allowInsecureHttp, fetchImpl: globalThis.fetch.bind(globalThis) });
    const recoveredVtxo = existing.vtxos.find(item => !item.spent && item.amountSats === mintAmount);
    let vtxoId: string;
    let mintTxHash = '';
    let mintEpoch = 0;
    if (recoveredVtxo) {
      vtxoId = recoveredVtxo.id;
      mintEpoch = recoveredVtxo.height;
    } else {
      const nonce = await vc.getAccountNonce(Buffer.from(owner, 'hex'), { baseUrl: params.daemonBaseUrl, allowInsecureHttp, fetchImpl: globalThis.fetch.bind(globalThis) });
      const draft = vc.buildTachiTxDeposit({ userXOnly: Buffer.from(owner, 'hex'), amountSats: mintAmount, nonce, feeSats: 1n });
      const signed = await vc.signTachiTx(draft, signer);
      const broadcast = await vc.broadcastTachiTx(signed, { url: params.daemonBaseUrl + '/tachi_txBroadcastSync', allowInsecureHttp, fetchImpl: globalThis.fetch.bind(globalThis) });
      const commit = await vc.waitForTachiTxCommit(broadcast.tendermintTxHash, { baseUrl: params.daemonBaseUrl, overallTimeoutMs: 120_000, allowInsecureHttp, fetchImpl: globalThis.fetch.bind(globalThis) });
      if (commit.code !== 0) throw mapDaemonError(commit);
      vtxoId = Buffer.from(vc.vtxoIdFromDeposit(signed, 0)).toString('hex');
      mintTxHash = commit.hash;
      mintEpoch = commit.epoch;
    }
    params.onProgress?.('registering');
    const registrationAmount = mintAmount - 1n;
    const registration = await registerVault({ vault: params.vault, fundingTxid: deposit.txid, fundingVout: deposit.vout, userSigner: signer, vtxoId, owner: params.vault.userKeyDescriptor.publicKey.slice(2), amount: registrationAmount, baseUrl: params.daemonBaseUrl, allowInsecureHttp });
    return { deposit, vtxoId, mintTxHash, mintEpoch, vaultId: registration.vaultId };
  } catch (error) {
    throw mapDaemonError(error);
  }
}
