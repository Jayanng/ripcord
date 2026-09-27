import * as vc from '@tachibtc/taurus-vault-core';
import type { Vault as SdkVaultShape } from '@tachibtc/taurus-vault-core';
import { VaultRecord, toSdkVault } from './types.js';
import { mapDaemonError, RipcordError, RipcordCode } from './errors.js';
import { joinDaemonUrl } from './net.js';

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
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function registerVault(params: RegisterVaultParams): Promise<{ vaultId: string }> {
  let parsedFundingTxid: Buffer | undefined;
  let parsedFundingVout = 0;
  let parsedOwnerXOnly = '';
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
    const { vault, userSigner, baseUrl, allowInsecureHttp } = params;

    const sdkVault = (vault as SdkVaultShape | VaultRecord) && ('userKey' in vault && vault.userKey !== undefined)
      ? (vault as SdkVaultShape)
      : toSdkVault(vault as VaultRecord);

    parsedFundingTxid = fundingTxid;
    parsedFundingVout = fundingVout;
    parsedOwnerXOnly = xOnlyBuf.toString('hex');

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
      account: { baseUrl, allowInsecureHttp, fetchImpl: params.fetchImpl, requestTimeoutMs: params.timeoutMs },
      broadcast: { url: baseUrl + '/tachi_txBroadcastSync', allowInsecureHttp, fetchImpl: params.fetchImpl, timeoutMs: params.timeoutMs },
      confirm: { baseUrl, allowInsecureHttp, fetchImpl: params.fetchImpl, requestTimeoutMs: params.timeoutMs },
    });

    return { vaultId: reg.vaultIdHex };
  } catch (err) {
    if (isCode17VaultExists(err) && parsedFundingTxid && parsedOwnerXOnly) {
      return await adoptVaultOnCode17({
        fundingTxid: parsedFundingTxid,
        fundingVout: parsedFundingVout,
        ownerXOnly: parsedOwnerXOnly,
        baseUrl: params.baseUrl,
        allowInsecureHttp: params.allowInsecureHttp,
        fetchImpl: params.fetchImpl,
        timeoutMs: params.timeoutMs,
      });
    }
    throw mapDaemonError(err);
  }
}

export interface DaemonVaultLookupRecord {
  vault_id?: string;
  vaultId?: string;
  user?: string;
  owner?: string;
  user_key?: string;
  userKey?: string;
  funding_txid?: string;
  fundingTxid?: string;
  funding_vout?: number;
  fundingVout?: number;
}

export function isCode17VaultExists(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'string') {
    return err.includes('17') && err.toLowerCase().includes('vault already exists for this funding outpoint');
  }
  if (typeof err !== 'object') return false;
  const anyErr = err as Record<string, unknown>;
  const code = anyErr.tendermintCode ?? anyErr.daemonCode ?? anyErr.code;
  const is17 = code === 17 || code === '17';
  const text = [
    typeof anyErr.message === 'string' ? anyErr.message : '',
    typeof anyErr.tendermintLog === 'string' ? anyErr.tendermintLog : '',
    typeof anyErr.log === 'string' ? anyErr.log : '',
  ].join(' ').toLowerCase();

  return (is17 || text.includes('code=17') || text.includes('code: 17')) &&
    text.includes('vault already exists for this funding outpoint');
}

export function verifyVaultForAdoption(
  daemonVault: DaemonVaultLookupRecord | undefined | null,
  daemonUser: string | undefined | null,
  expectedVaultId: string,
  expectedOwnerXOnly: string,
): { vaultId: string } {
  if (!daemonVault) {
    throw new RipcordError(
      RipcordCode.NOT_OWNER,
      'vault exists on our funding outpoint but does not match our keys — possible front-run; refusing to adopt',
      { daemonCode: 17, hint: 'Vault not found under our owner key on daemon' }
    );
  }

  const actualVaultId = (daemonVault.vault_id ?? daemonVault.vaultId ?? '').toLowerCase();
  const expVaultId = expectedVaultId.toLowerCase();

  if (actualVaultId !== expVaultId) {
    throw new RipcordError(
      RipcordCode.NOT_OWNER,
      'vault exists on our funding outpoint but does not match our keys — possible front-run; refusing to adopt',
      { daemonCode: 17, hint: `Vault ID mismatch: expected ${expVaultId}, got ${actualVaultId}` }
    );
  }

  const actualOwner = (daemonVault.user_key ?? daemonVault.userKey ?? daemonVault.owner ?? daemonUser ?? '').toLowerCase();
  const expOwner = expectedOwnerXOnly.toLowerCase();

  const ownersMatch = actualOwner === expOwner ||
    (actualOwner.length === 66 && actualOwner.slice(2) === expOwner) ||
    (expOwner.length === 66 && expOwner.slice(2) === actualOwner);

  if (!ownersMatch) {
    throw new RipcordError(
      RipcordCode.NOT_OWNER,
      'vault exists on our funding outpoint but does not match our keys — possible front-run; refusing to adopt',
      { daemonCode: 17, hint: `Owner key mismatch: expected ${expOwner}, got ${actualOwner}` }
    );
  }

  return { vaultId: expVaultId };
}

export interface AdoptVaultOnCode17Params {
  fundingTxid: Buffer;
  fundingVout: number;
  ownerXOnly: string;
  baseUrl: string;
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function retryDaemonQuery<T>(fn: () => Promise<T>, attempts = 4, delayMs = 1500): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (
        i >= attempts ||
        !(
          err instanceof Error &&
          /timeout|timed?\s*out|502|503|504|AbortError|deadline|context deadline exceeded|network|UND_ERR|fetch failed|ECONNRESET|ECONNREFUSED/i.test(
            err.message,
          )
        )
      ) {
        throw err;
      }
      await new Promise(r => setTimeout(r, delayMs * i));
    }
  }
}

export async function adoptVaultOnCode17(params: AdoptVaultOnCode17Params): Promise<{ vaultId: string }> {
  const { fundingTxid, fundingVout, ownerXOnly, baseUrl } = params;
  const timeoutMs = params.timeoutMs ?? 20_000;
  const fetchImpl = params.fetchImpl ?? globalThis.fetch.bind(globalThis);

  // a. compute expectedVaultId from our fundingTxid+fundingVout
  const expectedVaultIdBuf = vc.deriveVaultId(fundingTxid, fundingVout);
  const expectedVaultId = Buffer.from(expectedVaultIdBuf).toString('hex').toLowerCase();

  // b. look up the daemon-side vault (/tachi_listVaults?user=<our x-only key>)
  const normalizedOwner = ownerXOnly.toLowerCase();
  const listUrl = `${joinDaemonUrl(baseUrl, 'tachi_listVaults')}?user=${normalizedOwner}&page_size=100`;

  let response: Response;
  try {
    response = await retryDaemonQuery(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await Promise.race([
          fetchImpl(listUrl, { signal: controller.signal }),
          new Promise<Response>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new DOMException(`adoptVault: query timed out after ${timeoutMs}ms`, 'AbortError'));
            });
          }),
        ]);
        if (!res.ok) {
          throw new Error(`listVaults: HTTP ${res.status} from ${listUrl}`);
        }
        return res;
      } finally {
        clearTimeout(timer);
      }
    }, 4, 1500);
  } catch (netErr) {
    const isSlow = /timeout|timed?\s*out|deadline|context deadline exceeded|502|503|504|slow or down/i.test(
      netErr instanceof Error ? netErr.message : String(netErr),
    );
    const msg = isSlow
      ? 'The daemon is slow to answer. Your setup continues safely; status will refresh shortly.'
      : `Failed to query daemon vaults for adoption: ${netErr instanceof Error ? netErr.message : String(netErr)}`;
    throw new RipcordError(
      RipcordCode.DAEMON_UNREACHABLE,
      msg,
      { cause: netErr, daemonCode: 17 }
    );
  }

  const data = (await response.json()) as {
    user?: string;
    vaults?: Array<DaemonVaultLookupRecord>;
  };

  const internalTxidHex = fundingTxid.toString('hex').toLowerCase();
  const daemonVault = data.vaults?.find(v => {
    const vId = (v.vault_id ?? v.vaultId ?? '').toLowerCase();
    const vTxid = (v.funding_txid ?? v.fundingTxid ?? '').toLowerCase();
    const vVout = v.funding_vout ?? v.fundingVout;
    return vId === expectedVaultId || (vTxid === internalTxidHex && vVout === fundingVout);
  });

  // c. ADOPT ONLY IF vault_id equals expectedVaultId AND owner equals our x-only key
  // d. If not found or mismatched: throw typed error
  return verifyVaultForAdoption(daemonVault, data.user, expectedVaultId, normalizedOwner);
}

export function deriveVaultIdFromOutpoint(
  fundingTxidDisplayOrInternal: string | Buffer,
  fundingVout: number,
  isDisplayOrder = true,
): string {
  let buf: Buffer;
  if (Buffer.isBuffer(fundingTxidDisplayOrInternal)) {
    buf = fundingTxidDisplayOrInternal;
  } else if (isDisplayOrder) {
    buf = Buffer.from(fundingTxidDisplayOrInternal, 'hex').reverse();
  } else {
    buf = Buffer.from(fundingTxidDisplayOrInternal, 'hex');
  }
  return Buffer.from(vc.deriveVaultId(buf, fundingVout)).toString('hex');
}

