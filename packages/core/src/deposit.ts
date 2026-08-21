import { VaultRecord } from './types.js';
import * as vc from '@tachibtc/taurus-vault-core';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import { RipcordError, RipcordCode } from './errors.js';

export interface DepositParams {
  vault: VaultRecord;
  userWallet: agg.Wallet;
  rpc: { baseUrl: string };
  amountSats: bigint;
  feeRateSatVb: number;
}

export interface DepositResult {
  txid: string;
  rawTxHex: string;
}

export async function depositToVault(params: DepositParams): Promise<DepositResult> {
  const { vault, userWallet, rpc, amountSats, feeRateSatVb } = params;

  const bitcoinRpcClient = new agg.BitcoinCoreRpcClient({ url: rpc.baseUrl });

  const sdkVault = vault as any;

  const dep = await vc.depositToVault({
    vault: sdkVault,
    userWallet,
    rpc: bitcoinRpcClient,
    amountSats,
    feeRateSatVb,
  });

  if (!dep.txid || !dep.rawTxHex) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Deposit result missing txid or rawTxHex',
      { hint: 'vc.depositToVault returned unexpected result' }
    );
  }

  return {
    txid: dep.txid,
    rawTxHex: dep.rawTxHex,
  };
}

export async function verifyDepositProofOfReserves(
  baseUrl: string,
  txid: string,
  expectedOutputScriptHex: string
): Promise<boolean> {
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
      RipcordCode.INVALID_FORMAT,
      `Failed to fetch transaction: ${response.statusText}`,
      { hint: 'Bitcoin RPC getrawtransaction failed' }
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `RPC error: ${data.error.message}`,
      { hint: 'Bitcoin RPC returned error' }
    );
  }

  const tx = data.result;
  const vout = tx.vout.find((o: any) => o.scriptPubKey.hex === expectedOutputScriptHex);

  if (!vout) {
    return false;
  }

  return vout.scriptPubKey.hex === expectedOutputScriptHex;
}