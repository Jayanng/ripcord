import {
  VaultRecord,
  DisplayTxid,
  asDisplayTxid,
  isVaultAddress,
  asVaultAddress,
} from './types.js';
import { RipcordError, RipcordCode } from './errors.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as vc from '@tachibtc/taurus-vault-core';
import type { Utxo } from '@tachibtc/taurus-wallet-aggregator';

export interface DepositToVaultParams {
  vault: VaultRecord;
  userWallet: agg.Wallet;
  rpc: { baseUrl: string };
  amountSats: bigint;
  /** Optional fee rate in sats/vbyte. Defaults to 2 (the verified regtest rate). */
  feeRateSatVb?: number;
}

export interface DepositResult {
  txid: DisplayTxid;
  rawTxHex: string;
  vaultAddress: string;
  amountSats: bigint;
  feeSats: bigint;
  changeSats: bigint;
  inputs: readonly Utxo[];
}

/**
 * Deposit funds from the user's L1 wallet into the vault.
 */
export async function depositToVault(
  params: DepositToVaultParams
): Promise<DepositResult> {
  const { vault, userWallet, rpc, amountSats, feeRateSatVb } = params;
  // The SDK requires feeRateSatVb; default to the verified regtest rate when
  // the caller omits it rather than passing undefined through.
  const effectiveFeeRateSatVb = feeRateSatVb ?? 2;

  if (!vault.p2tr) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Vault missing P2TR data',
      { hint: 'Vault must have been created with p2tr field' }
    );
  }

  const address = vault.address;
  if (!isVaultAddress(address)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Invalid vault address: ${address}`,
      { hint: 'Address must be a valid vault P2TR' }
    );
  }

  const bitcoinRpcClient = new agg.BitcoinCoreRpcClient({
    url: rpc.baseUrl,
    fetchImpl: globalThis.fetch.bind(globalThis),
  });

  const dep = await vc.depositToVault({
    vault: {
      p2tr: vault.p2tr,
      userKey: {
        compressedHex: vault.userKeyDescriptor.publicKey,
        xOnly: Buffer.from(vault.userKeyDescriptor.publicKey.slice(2), 'hex'),
        derivationPath: vault.userKeyDescriptor.path,
        address: vault.userKeyDescriptor.address,
      },
      nodeKeys: vault.nodePubkeys.map(pk => ({
        pubkeyHex: pk.slice(2),
        compressedHex: pk,
      })),
    },
    userWallet,
    rpc: bitcoinRpcClient,
    amountSats,
    feeRateSatVb: effectiveFeeRateSatVb,
  });

  if (!dep.txid || !dep.rawTxHex) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Deposit result missing txid or rawTxHex',
      { hint: 'vc.depositToVault returned unexpected result' }
    );
  }

  // The SDK returns these values explicitly. Dropping amount/change/inputs here
  // made the public Phase 4 result falsely claim that fee accounting was
  // unavailable, and forced later callers to reparse raw transaction bytes.
  return {
    txid: asDisplayTxid(dep.txid),
    rawTxHex: dep.rawTxHex,
    feeSats: dep.feeSats,
    amountSats: dep.amountSats,
    changeSats: dep.changeSats,
    vaultAddress: asVaultAddress(dep.vaultAddress),
    inputs: dep.inputs,
  };
}

export async function verifyDepositProofOfReserves(
  baseUrl: string,
  txid: string,
  expectedOutputScriptHex: string
): Promise<boolean> {
  // The txid must be in display order (the order used by Bitcoin RPC).
  // Ensure it's a 64-character hex string.
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Invalid txid format: ${txid}`,
      { hint: 'Expected a 64-character hex string in display order' }
    );
  }
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getrawtransaction',
      params: [txid, true],
    }),
  });

  if (!response.ok) {
    throw new RipcordError(
      RipcordCode.DAEMON_UNREACHABLE,
      `Failed to fetch transaction: ${response.statusText}`,
      { hint: 'Daemon may be down' }
    );
  }

  const data = await response.json();
  if (data.error) {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      `Transaction not found: ${data.error.message}`,
      { hint: 'The deposit may not have been confirmed or broadcast' }
    );
  }

  const tx = data.result;
  const output = tx.vout.find((o: any) => o.scriptPubKey.hex === expectedOutputScriptHex);
  if (!output) {
    return false;
  }

  return true;
}

export interface DepositFromMnemonicParams {
  vault: VaultRecord;
  mnemonic: string;
  rpc: { baseUrl: string };
  amountSats: bigint;
  feeRateSatVb?: number;
}

/** Build the SDK wallet inside core, sync it against live Bitcoin RPC, then deposit. */
export async function depositFromMnemonic(params: DepositFromMnemonicParams): Promise<DepositResult> {
  // The aggregator stores the supplied fetch function and invokes it later as
  // a plain callback. Chromium requires Window.fetch to retain its receiver,
  // otherwise it throws "Illegal invocation" before any RPC request is sent.
  const boundFetch = globalThis.fetch.bind(globalThis);
  const rpcClient = new agg.BitcoinCoreRpcClient({ url: params.rpc.baseUrl, fetchImpl: boundFetch });
  const aggregator = await agg.WalletAggregator.fromMnemonic(params.mnemonic, {
    network: 'regtest',
    rpc: rpcClient,
  });
  const userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
  await userWallet.sync();
  return depositToVault({
    vault: params.vault,
    userWallet,
    rpc: params.rpc,
    amountSats: params.amountSats,
    feeRateSatVb: params.feeRateSatVb,
  });
}
