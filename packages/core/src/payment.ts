/**
 * Envelope transfer builder and signer for TachiTx transfers.
 * Builds, signs, broadcasts, and waits for commit.
 *
 * Ownership rules, live-proven on regtest 2026-08-22:
 * - Recipient and change outputs go to USER P2TR addresses (x-only-key owned).
 * - A change output sent to the vault address is owned by the vault's tweaked
 *   output key and is permanently unspendable by the user (daemon rejects with
 *   code=6 unauthorized: pubkey does not own vtxo). Never send change there.
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
import { userAddressForXOnly } from './keys.js';
import { isUserAddress } from './types.js';
import type { TxQueue } from './queue.js';

export interface TransferParams {
  /** Vault whose cooperative leaf commits the sender's user key. */
  readonly vault: Vault;
  /** Sender's x-only pubkey (hex). Must match vault.userKey.xOnly. */
  readonly senderXOnly: string;
  /** Recipient's user P2TR address (bech32m). */
  readonly recipientAddress: string;
  readonly amountSats: bigint;
  readonly feeSats: bigint;
  readonly baseUrl: string;
  readonly userSigner: TaprootSigner;
  /** Optional queue whose reservations are skipped during coin selection. */
  readonly queue?: TxQueue;
  /** Callback with selected input ids before broadcast (for reservation). */
  readonly onInputsSelected?: (vtxoIds: readonly string[]) => void;
}

export interface TransferResult {
  readonly txHash: string;
  readonly epoch: number;
  readonly code: number;
}

export async function sendTransfer(params: TransferParams): Promise<TransferResult> {
  if (!isUserAddress(params.recipientAddress)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Recipient must be a user P2TR address, got: ${params.recipientAddress}`,
      { hint: 'User and vault P2TR addresses are structurally identical; the recipient must not be the sender vault address' },
    );
  }
  if (params.recipientAddress === params.vault.p2tr.address) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Recipient cannot be the sender\'s vault address: change sent there is unspendable by the user',
    );
  }
  if (params.amountSats <= 0n) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `amountSats must be positive, got ${params.amountSats}`,
    );
  }
  if (params.feeSats < 1n) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `feeSats must be >= 1, got ${params.feeSats}`,
    );
  }

  const vtxoResult = await getAddressVtxos(params.senderXOnly, { baseUrl: params.baseUrl });
  const spendable: SpendableVtxo[] = vtxoResult.vtxos.map(v => {
    const reserved = params.queue?.isReserved(v.id) ?? false;
    return {
      id: v.id,
      amountSats: v.amountSats,
      spent: v.spent,
      locked: v.locked,
      localSpentAt: reserved ? Date.now() : undefined,
    };
  });

  const selection = selectCoins(spendable, params.amountSats, params.feeSats);
  params.onInputsSelected?.(selection.inputs.map(v => v.id));

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
    // Change goes to the SENDER's user P2TR address so the user owns it.
    const changeAddress = userAddressForXOnly(params.senderXOnly, 'regtest');
    outputs.push({ address: changeAddress, valueSats: selection.changeSats });
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
