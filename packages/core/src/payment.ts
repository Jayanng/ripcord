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
  /** Vault (SDK shape) whose cooperative leaf commits the sender's user key. */
  readonly vault: Vault;
  /** Sender's x-only pubkey (hex). Must match vault.userKey.xOnly. */
  readonly senderXOnly: string;
  /** Recipient's user P2TR address (bech32m). */
  readonly recipientAddress: string;
  /** Chain the transfer is signed for. Currently regtest only. */
  readonly network: 'regtest';
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
  const daemonUrl = new URL(params.baseUrl);
  const allowInsecureHttp = daemonUrl.protocol === 'http:'
    && (daemonUrl.hostname === '127.0.0.1' || daemonUrl.hostname === 'localhost' || daemonUrl.hostname === '::1');
  const sdkOptions = {
    baseUrl: params.baseUrl,
    allowInsecureHttp,
    fetchImpl: globalThis.fetch.bind(globalThis),
  };
  if (params.network !== 'regtest') {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Unsupported network: ${params.network}`,
      { hint: 'Transfers currently support regtest only' },
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(params.senderXOnly)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'senderXOnly must be a 64-character hex string',
      { hint: 'Use the sender vault user key x-only public key' },
    );
  }
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
  if (params.senderXOnly.toLowerCase() !== params.vault.userKey.xOnly.toString('hex').toLowerCase()) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'senderXOnly does not match vault.userKey.xOnly',
      { hint: 'Use the user key that owns the sender vault' },
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

  let vtxoResult;
  try {
    vtxoResult = await getAddressVtxos(params.senderXOnly, sdkOptions);
  } catch (err) {
    throw mapDaemonError(err);
  }
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
    const changeAddress = userAddressForXOnly(params.senderXOnly, params.network);
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
    sdkOptions,
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
      allowInsecureHttp,
      fetchImpl: globalThis.fetch.bind(globalThis),
    });
  } catch (err) {
    throw mapDaemonError(err);
  }

  try {
    const status = await waitForTachiTxCommit(broadcastResult.tendermintTxHash, {
      baseUrl: params.baseUrl,
      overallTimeoutMs: 120_000,
      allowInsecureHttp,
      fetchImpl: globalThis.fetch.bind(globalThis),
    });

    if (status.code !== 0) {
      // AUDIT FIX (2026-08-23): this used to construct RipcordCode.UNKNOWN
      // directly, so a transfer rejected at FinalizeBlock with code 5 reported
      // UNKNOWN instead of VTXO_ALREADY_SPENT and the caller lost its recovery
      // hint. Route it through mapDaemonError, which reads both `code` and the
      // reason text in `log`.
      throw mapDaemonError(status);
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
