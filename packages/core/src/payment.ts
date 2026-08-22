/**
 * Envelope transfer builder and signer for TachiTx transfers.
 * Builds, signs, broadcasts, and waits for commit.
 * Recipient must be a user x-only key (P2TR address), never a VaultAddress.
 * Does NOT call the banned PSBT finalization function (architecture rule).
 */

import type { Vault } from '@tachibtc/taurus-vault-core';
import {
  buildVtxoPsbt,
  buildTachiTxTransfer,
  signVtxoPsbtAsUser,
  signTachiTx,
  broadcastTachiTx,
  waitForTachiTxCommit,
  getAddressVtxos,
  getAccountNonce,
  type TaprootSigner,
  type VtxoInput,
  type VtxoOutput,
} from '@tachibtc/taurus-vault-core';
import { selectCoins, type SpendableVtxo } from './coinselect.js';
import { RipcordError, RipcordCode, mapDaemonError } from './errors.js';
import { isVaultAddress } from './types.js';

export interface TransferParams {
  readonly vault: Vault;
  readonly senderXOnly: string;
  readonly recipientAddress: string;
  readonly amountSats: bigint;
  readonly feeSats: bigint;
  readonly baseUrl: string;
  readonly userSigner: TaprootSigner;
}

export interface TransferResult {
  readonly txHash: string;
  readonly epoch: number;
  readonly code: number;
}

export async function sendTransfer(params: TransferParams): Promise<TransferResult> {
  if (isVaultAddress(params.recipientAddress)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Recipient cannot be a vault address',
    );
  }

  const vtxoResult = await getAddressVtxos(params.senderXOnly, { baseUrl: params.baseUrl });
  const spendable: SpendableVtxo[] = vtxoResult.vtxos.map(v => ({
    id: v.id,
    amountSats: v.amountSats,
    spent: v.spent,
    locked: v.locked,
  }));

  const selection = selectCoins(spendable, params.amountSats, params.feeSats);

  const inputs: VtxoInput[] = selection.inputs.map(v => ({
    txid: v.id,
    vout: 0,
    valueSats: v.amountSats,
    scriptPubKey: Buffer.from(params.vault.p2tr.output).toString('hex'),
    vtxoId: Buffer.from(v.id, 'hex'),
  }));

  const outputs: VtxoOutput[] = [
    { address: params.recipientAddress, valueSats: params.amountSats },
  ];
  if (selection.changeSats > 0n) {
    outputs.push({ address: params.vault.p2tr.address, valueSats: selection.changeSats });
  }

  const built = buildVtxoPsbt({
    vault: params.vault,
    inputs,
    outputs,
    feeSats: params.feeSats,
  });

  await signVtxoPsbtAsUser(built.psbt, params.userSigner, params.vault, {
    maxFeeSats: params.feeSats,
  });

  const nonce = await getAccountNonce(
    Buffer.from(params.senderXOnly, 'hex'),
    { baseUrl: params.baseUrl },
  );

  const tachiTx = buildTachiTxTransfer({
    vault: params.vault,
    inputs,
    outputs,
    feeSats: params.feeSats,
    nonce,
    psbt: built.psbt,
  });

  const signedTx = await signTachiTx(tachiTx, params.userSigner);

  let broadcastResult;
  try {
    broadcastResult = await broadcastTachiTx(signedTx, {
      url: params.baseUrl + '/tachi_txBroadcastSync',
    });
  } catch (err) {
    throw mapDaemonError(err);
  }

  try {
    const status = await waitForTachiTxCommit(broadcastResult.tendermintTxHash, {
      baseUrl: params.baseUrl,
      overallTimeoutMs: 120_000,
    });

    if (status.code !== 0) {
      throw new RipcordError(
        RipcordCode.UNKNOWN,
        `Transfer failed: code=${status.code}, log=${status.log}`,
        { daemonCode: status.code },
      );
    }

    return {
      txHash: status.hash,
      epoch: status.epoch,
      code: status.code,
    };
  } catch (err) {
    if (err instanceof RipcordError) throw err;
    throw mapDaemonError(err);
  }
}
