import * as vc from '@tachibtc/taurus-vault-core';
import type { Vault as SdkVaultShape } from '@tachibtc/taurus-vault-core';
import { VaultRecord, toSdkVault } from './types.js';
import { mapDaemonError } from './errors.js';

export interface RegisterVaultParams {
  vault: VaultRecord | SdkVaultShape;
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
    const rec = params.vault as Partial<VaultRecord>;
    const txid =
      params.fundingTxid ??
      params.txid ??
      rec.funding?.txid;

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
      rec.funding?.vout ??
      0;

    const vtxoIdBuf = Buffer.isBuffer(params.vtxoId)
      ? params.vtxoId
      : Buffer.from(params.vtxoId, 'hex');

    const v = params.vault as SdkVaultShape | VaultRecord;
    const rawOwner =
      params.owner ??
      params.xOnly ??
      params.userXOnly ??
      ('userKey' in v && v.userKey ? Buffer.from(v.userKey.xOnly).toString('hex') : undefined) ??
      ('userKeyDescriptor' in v && v.userKeyDescriptor ? v.userKeyDescriptor.publicKey.slice(2) : undefined);

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

    const sdkVault = (vault as SdkVaultShape | VaultRecord) && ('userKey' in vault && vault.userKey !== undefined)
      ? (vault as SdkVaultShape)
      : toSdkVault(vault as VaultRecord);

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
