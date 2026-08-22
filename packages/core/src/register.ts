import * as vc from '@tachibtc/taurus-vault-core';
import type { Vault as SdkVaultShape } from '@tachibtc/taurus-vault-core';
import { VaultRecord, toSdkVault } from './types.js';
import { mapDaemonError } from './errors.js';

export interface RegisterVaultParams {
  vault: VaultRecord | SdkVaultShape;
  /** Funding txid in display order when supplied as hex; Buffer means SDK internal order. */
  fundingTxid?: string | Buffer;
  txid?: string | Buffer;
  fundingVout?: number;
  vout?: number;
  userSigner: vc.TaprootSigner;
  vtxoId: string | Buffer;
  owner?: string | Buffer;
  xOnly?: string | Buffer;
  userXOnly?: string | Buffer;
  amount?: bigint;
  amountSats?: bigint;
  /** SDK account/query base URL, without a path suffix. */
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
    let fundingTxid: Buffer;
    if (Buffer.isBuffer(txid)) {
      if (txid.length !== 32) {
        throw new Error(`fundingTxid Buffer must be 32 bytes, got ${txid.length}`);
      }
      fundingTxid = txid;
    } else {
      if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
        throw new Error('fundingTxid must be a 64-character display-order hex string');
      }
      fundingTxid = Buffer.from(txid, 'hex').reverse();
    }

    const fundingVout =
      params.fundingVout ??
      params.vout ??
      rec.funding?.vout ??
      0;
    if (!Number.isInteger(fundingVout) || fundingVout < 0 || fundingVout > 0xffff_ffff) {
      throw new Error(`fundingVout must be a non-negative u32, got ${fundingVout}`);
    }

    let vtxoIdBuf: Buffer;
    if (Buffer.isBuffer(params.vtxoId)) {
      if (params.vtxoId.length !== 32) {
        throw new Error(`vtxoId Buffer must be 32 bytes, got ${params.vtxoId.length}`);
      }
      vtxoIdBuf = params.vtxoId;
    } else {
      if (!/^[0-9a-fA-F]{64}$/.test(params.vtxoId)) {
        throw new Error('vtxoId must be a 64-character hex string');
      }
      vtxoIdBuf = Buffer.from(params.vtxoId, 'hex');
    }

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

    let xOnlyBuf: Buffer;
    if (Buffer.isBuffer(rawOwner)) {
      xOnlyBuf = rawOwner;
    } else {
      if (!/^[0-9a-fA-F]{64}$/.test(rawOwner)) {
        throw new Error('owner must be a 64-character x-only hex string');
      }
      xOnlyBuf = Buffer.from(rawOwner, 'hex');
    }
    if (xOnlyBuf.length !== 32) {
      throw new Error(`owner must be 32 bytes, got ${xOnlyBuf.length}`);
    }

    const amount = params.amount ?? params.amountSats;
    if (amount === undefined) {
      throw new Error('amount is required (sats)');
    }
    if (amount <= 0n) {
      throw new Error(`amount must be positive, got ${amount}`);
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
