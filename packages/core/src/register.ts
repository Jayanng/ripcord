import * as vc from '@tachibtc/taurus-vault-core';
import { mapDaemonError } from './errors.js';

export interface RegisterVaultParams {
  vault: any;
  fundingTxid?: string;
  txid?: string;
  fundingVout?: number;
  vout?: number;
  userSigner: vc.TaprootSigner;
  vtxoId: string | Buffer;
  owner?: string | Buffer;
  xOnly?: string | Buffer;
  userXOnly?: string | Buffer;
  amount?: bigint;
  amountSats?: bigint;
  baseUrl: string;
}

export async function registerVault(params: RegisterVaultParams): Promise<{ vaultId: string }> {
  try {
    const txid =
      params.fundingTxid ??
      params.txid ??
      (params as any).outpoint?.fundingTxid ??
      (params as any).funding?.txid;

    if (!txid) {
      throw new Error('fundingTxid is required');
    }

    // Display-order hex string → internal byte order. A Buffer is assumed to
    // already be internal byte order (the SDK contract); never reverse it again.
    const fundingTxid = Buffer.isBuffer(txid)
      ? txid
      : Buffer.from(txid, 'hex').reverse();

    const fundingVout =
      params.fundingVout ??
      params.vout ??
      (params as any).outpoint?.fundingVout ??
      (params as any).funding?.vout ??
      0;

    const vtxoIdBuf = Buffer.isBuffer(params.vtxoId)
      ? params.vtxoId
      : Buffer.from(params.vtxoId, 'hex');

    const rawOwner =
      params.owner ??
      params.xOnly ??
      params.userXOnly ??
      (params.vault as any)?.userKey?.xOnly ??
      (params.vault as any)?.userKeyDescriptor?.publicKey?.slice(2);

    if (!rawOwner) {
      throw new Error('owner is required');
    }

    const xOnlyBuf = Buffer.isBuffer(rawOwner)
      ? rawOwner
      : Buffer.from(rawOwner, 'hex');

    const amount = params.amount ?? params.amountSats;
    if (amount === undefined) {
      throw new Error('amount is required (sats)');
    }
    const { vault, userSigner, baseUrl } = params;

    const sdkVault = (vault as any).userKey
      ? vault
      : {
          ...vault,
          userKey: {
            compressedHex: (vault as any).userKeyDescriptor?.publicKey,
            xOnly: Buffer.from(
              (vault as any).userKeyDescriptor?.publicKey?.slice(2) ?? '',
              'hex'
            ),
          },
        };

    const reg = await vc.registerVault({
      vault: sdkVault,
      outpoint: {
        fundingTxid,
        fundingVout,
      },
      userSigner,
      inputs: [{ vtxoId: vtxoIdBuf }],
      outputs: [{ owner: xOnlyBuf, amount }],
      feeSats: 1n,
      account: { baseUrl },
      broadcast: { url: baseUrl + '/tachi_txBroadcastSync' },
      confirm: { baseUrl },
    });

    return { vaultId: reg.vaultIdHex };
  } catch (err) {
    throw mapDaemonError(err);
  }
}
