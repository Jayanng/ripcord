import * as vc from '@tachibtc/taurus-vault-core';
import { depositFromMnemonic, type DepositResult } from './deposit.js';
import { makeSigner } from './keys.js';
import { registerVault, isCode17VaultExists, adoptVaultOnCode17 } from './register.js';
import { mapDaemonError } from './errors.js';
import { joinDaemonUrl, describeDaemonFailure } from './net.js';
import type { VaultRecord } from './types.js';

export const DAEMON_SLOW_NOTE = 'The daemon is slow to answer. Your setup continues safely; status will refresh shortly.';

export function isDaemonSlowError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|timed?\s*out|deadline|context deadline exceeded|502|slow or down/i.test(msg);
}

/**
 * User-facing note for a hard network failure ("Failed to fetch"): plain words,
 * says what to do, keeps the user's progress claim accurate (2026-09-28: a raw
 * describeDaemonFailure wall of CORS diagnostics reached a real user's screen).
 */
const NETWORK_RETRY_NOTE = "The network didn't answer just now. Your progress is saved, try again in a moment.";

export function composeFlowErrorMessage(err: unknown): string {
  if (isDaemonSlowError(err)) {
    return DAEMON_SLOW_NOTE;
  }
  const described = describeDaemonFailure(err);
  if (isDaemonSlowError(described)) {
    return DAEMON_SLOW_NOTE;
  }
  if (/^Failed to fetch\b/i.test(described)) {
    return NETWORK_RETRY_NOTE;
  }
  return described.replace(/^Unknown error:\s*/i, '');
}

export interface ListedVaultSummary {
  vaultId: string;
  fundingTxid: string;
  fundingVout: number;
  address?: string;
}

export interface QueryListVaultsOptions {
  baseUrl: string;
  pageSize?: number;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Query daemon /tachi_listVaults using the X-ONLY key (avoiding compressed-key/parity issues).
 * Raises default per-attempt timeout for these non-critical lookups to 20s.
 */
export async function queryListVaults(
  userKey: string,
  options: QueryListVaultsOptions,
): Promise<{ user: string; vaults: ListedVaultSummary[] }> {
  const ownerXOnly = (userKey.length === 66 ? userKey.slice(2) : userKey).toLowerCase();
  const pageSize = options.pageSize ?? 100;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${joinDaemonUrl(options.baseUrl, 'tachi_listVaults')}?user=${ownerXOnly}&page_size=${pageSize}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await Promise.race([
      fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
      }),
      new Promise<Response>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new DOMException(`listVaults: query to ${url} timed out after ${timeoutMs}ms`, 'AbortError'));
        });
      }),
    ]);

    if (!response.ok) {
      throw new Error(`listVaults: HTTP ${response.status} from ${url}`);
    }

    const data = (await response.json()) as {
      user?: string;
      vaults?: Array<{
        vault_id?: string;
        vaultId?: string;
        funding_txid?: string;
        fundingTxid?: string;
        funding_vout?: number;
        fundingVout?: number;
        address?: string;
      }>;
    };

    const vaults: ListedVaultSummary[] = (data.vaults ?? []).map(item => ({
      vaultId: item.vault_id ?? item.vaultId ?? '',
      fundingTxid: (item.funding_txid ?? item.fundingTxid ?? '').toLowerCase(),
      fundingVout: item.funding_vout ?? item.fundingVout ?? 0,
      address: item.address,
    }));

    return {
      user: data.user ?? ownerXOnly,
      vaults,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`listVaults: query to ${url} timed out after ${timeoutMs}ms`);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/timeout|aborted/i.test(message)) {
      throw new Error(`listVaults: query to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface FundVaultLifecycleParams {
  vault: VaultRecord;
  mnemonic: string;
  bitcoinRpcBaseUrl: string;
  daemonBaseUrl: string;
  amountSats: bigint;
  feeRateSatVb?: number;
  confirmationPollMs?: number;
  explicitInput?: import('./types.js').ExplicitSpendableInput;
  existingDepositTxid?: string;
  /**
   * Outpoints (`txid:vout`, lowercase txid) already claimed by other funding
   * records at this vault address. Sibling records may share one address, so
   * the funding scan must skip them (audit fix: a second round must never
   * adopt a sibling's funding).
   */
  claimedOutpoints?: ReadonlyArray<string>;
  onProgress?: (stage: 'depositing' | 'confirming-deposit' | 'minting' | 'registering') => void;
  onDepositBroadcast?: (deposit: DepositResult) => void;
  onConfirmationPoll?: (confirmations: number) => void;
  onFallback?: (error: unknown, diagnosis: string) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface FundVaultLifecycleResult {
  deposit: { txid: import('./types.js').DisplayTxid; vout: number; amountSats: bigint; source: 'broadcast' | 'recovered' };
  vtxoId: string;
  mintTxHash: string;
  mintEpoch: number;
  vaultId: string;
}

type LifecycleDeposit = FundVaultLifecycleResult['deposit'];

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

export interface RecoverVaultLifecycleStateParams {
  vault: VaultRecord;
  bitcoinRpcBaseUrl: string;
  daemonBaseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Outpoints claimed by sibling funding records at the same address (audit fix). */
  claimedOutpoints?: ReadonlyArray<string>;
}

/** Restore an existing vault's public funding and registration evidence without broadcasting. */
export async function recoverVaultLifecycleState(
  params: RecoverVaultLifecycleStateParams,
): Promise<VaultRecord> {
  const deposit = params.vault.funding
    ? {
        txid: params.vault.funding.txid,
        vout: params.vault.funding.vout,
        amountSats: params.vault.funding.valueSats,
        source: 'recovered' as const,
      }
    : await findExistingVaultFunding(
        params.bitcoinRpcBaseUrl,
        params.vault,
        params.fetchImpl ?? globalThis.fetch.bind(globalThis),
        new Set((params.claimedOutpoints ?? []).map(item => item.toLowerCase())),
      );
  if (!deposit) return params.vault;

  const daemonUrl = new URL(params.daemonBaseUrl);
  const allowInsecureHttp = daemonUrl.protocol === 'http:'
    && (daemonUrl.hostname === '127.0.0.1' || daemonUrl.hostname === 'localhost' || daemonUrl.hostname === '::1');

  let listed: { vaults: ListedVaultSummary[] } | null = null;
  try {
    listed = await retryDaemonQuery(() =>
      queryListVaults(params.vault.userKeyDescriptor.publicKey, {
        baseUrl: params.daemonBaseUrl,
        pageSize: 100,
        timeoutMs: params.timeoutMs ?? 20_000,
        allowInsecureHttp,
        fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis),
      }),
    );
  } catch (_err) {
    // Soft-fail: treat registration state as unknown-but-not-registered and continue with local state
    return params.vault;
  }

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
  return result.vtxos.map(item => ({ id: item.id, amountSats: item.amountSats, spent: item.spent, locked: item.locked, height: item.height ?? 0 }));
}

/**
 * Query full VTXO history for an address or x-only key, including spent VTXOs.
 * Endpoint: GET /tachi_addressVtxos?address=<pubkey>&include_spent=true
 */
export async function getAddressVtxosHistory(ownerXOnly: string, daemonBaseUrl: string) {
  const url = new URL(daemonBaseUrl);
  const allowInsecureHttp = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');
  const result = await vc.getAddressVtxos(ownerXOnly, {
    baseUrl: daemonBaseUrl,
    includeSpent: true,
    allowInsecureHttp,
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
  return result.vtxos.map(item => ({
    id: item.id,
    amountSats: item.amountSats,
    spent: item.spent,
    locked: item.locked,
    height: item.height ?? 0,
    owner: item.owner,
  }));
}

/**
 * Query all VTXOs locked to a given vault address.
 * Endpoint: GET /tachi_vtxoLocked?vault=<vaultAddress>
 */
export async function getLockedVaultVtxos(vaultAddress: string, daemonBaseUrl: string) {
  const url = new URL(daemonBaseUrl);
  const allowInsecureHttp = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');
  const result = await vc.getLockedVtxos(vaultAddress, {
    baseUrl: daemonBaseUrl,
    allowInsecureHttp,
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
  return result.vtxos.map(item => ({
    id: item.id,
    amountSats: item.amountSats,
    spent: item.spent,
    locked: true,
    height: item.height ?? 0,
    vaultAddress,
  }));
}

async function findExistingVaultFunding(
  baseUrl: string,
  vault: VaultRecord,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  // Outpoints already claimed by sibling funding records at this address.
  // Sibling vault records MAY share one address (one per funding outpoint), so
  // the scan must never adopt another record's funding.
  excludeOutpoints: ReadonlySet<string> = new Set(),
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'scantxoutset', params: ['start', [`addr(${vault.address})`]] }) });
      if (!response.ok) {
        if ([502, 503, 504, 429].includes(response.status) && attempt < 3) {
          await new Promise(r => setTimeout(r, attempt * 1000));
          continue;
        }
        throw new Error(`Bitcoin RPC HTTP ${response.status}`);
      }
      const payload = await response.json() as { result?: { unspents?: Array<{ txid: string; vout: number; scriptPubKey: string; amount: number }> }; error?: { message?: string } };
      if (payload.error) throw new Error(payload.error.message ?? 'Vault UTXO scan failed');
      const expectedScript = vault.p2tr ? Buffer.from(vault.p2tr.output).toString('hex').toLowerCase() : '';
      const found = payload.result?.unspents?.find(item =>
        item.scriptPubKey.toLowerCase() === expectedScript
        && !excludeOutpoints.has(`${item.txid.toLowerCase()}:${item.vout}`),
      );
      if (!found || !/^[0-9a-f]{64}$/i.test(found.txid)) return null;
      return { txid: found.txid as import('./types.js').DisplayTxid, vout: found.vout, amountSats: BigInt(Math.round(found.amount * 1e8)), source: 'recovered' as const };
    } catch (err) {
      if (attempt < 3 && err instanceof Error && /502|503|504|fetch failed|UND_ERR/i.test(err.message)) {
        await new Promise(r => setTimeout(r, attempt * 1000));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function findBroadcastVaultFunding(
  baseUrl: string,
  vault: VaultRecord,
  txid: string,
  // Outpoints already claimed by other funding records at this address. The
  // resume txid may belong to a sibling round (stale resume state), so the
  // adoption must honor the same exclusion as the funding scan: adopting a
  // claimed outpoint would give two records one funding identity.
  excludeOutpoints: ReadonlySet<string> = new Set(),
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
) {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) return null;
  // Contract: return a deposit ONLY when the resumed tx provably pays this
  // vault's script; return null ONLY when the chain definitively says the
  // resumed tx is unknown (a dropped broadcast is safe to replace with a fresh
  // deposit). Any indeterminate failure (HTTP error, network error, bad
  // payload) MUST throw: falling through to a fresh broadcast there would
  // double-deposit while the original tx is still in flight.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const backoff = async () => { if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000)); };
    let response: Response;
    try {
      response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'getrawtransaction',
          params: [txid, true],
        }),
      });
    } catch (err) {
      // Network-level failure: indeterminate, retry then throw.
      await backoff();
      if (attempt < 3) continue;
      throw new Error(`Resumed deposit lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      if ([502, 503, 504, 429].includes(response.status)) {
        await backoff();
        if (attempt < 3) continue;
      }
      throw new Error(`Bitcoin RPC HTTP ${response.status}`);
    }
    let payload: {
      result?: {
        txid: string;
        vout: Array<{ n: number; value: number; scriptPubKey: { hex: string } }>;
      };
      error?: { code?: number; message?: string };
    };
    try {
      payload = await response.json();
    } catch {
      // Malformed body (e.g. a proxy's HTML error page with status 200):
      // indeterminate, retry then throw.
      await backoff();
      if (attempt < 3) continue;
      throw new Error('Resumed deposit lookup failed: malformed RPC response');
    }
    if (payload.error || !payload.result) {
      // getrawtransaction code -5 ("No such mempool or blockchain
      // transaction") is a definitive answer: the resumed broadcast is gone
      // (evicted or never relayed) and a fresh deposit is the correct recovery.
      if (payload.error?.code === -5) return null;
      const rpcMessage = payload.error?.message ?? 'malformed RPC response';
      if (/warming|loading|try again|timeout/i.test(rpcMessage)) {
        await backoff();
        if (attempt < 3) continue;
      }
      throw new Error(`Resumed deposit lookup failed: ${rpcMessage}`);
    }
    const expectedScript = vault.p2tr
      ? Buffer.from(vault.p2tr.output).toString('hex').toLowerCase()
      : '';
    const match = payload.result.vout?.find(
      v => v.scriptPubKey.hex.toLowerCase() === expectedScript
        && !excludeOutpoints.has(`${payload.result!.txid.toLowerCase()}:${v.n}`)
    );
    // The tx exists but does not pay this vault (stale/foreign resume state):
    // definitively not this round's funding, so a fresh deposit is correct.
    if (!match) return null;
    return {
      txid: payload.result.txid as import('./types.js').DisplayTxid,
      vout: match.n,
      amountSats: BigInt(Math.round(match.value * 1e8)),
      source: 'broadcast' as const,
    };
  }
  // Unreachable: the loop either returns or throws on its final attempt.
  throw new Error('Resumed deposit lookup failed after retries');
}

async function waitForBitcoinConfirmation(
  baseUrl: string,
  txid: string,
  pollMs: number,
  onPoll?: (confirmations: number) => void,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<void> {
  for (;;) {
    try {
      const response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'getrawtransaction', params: [txid, true] }),
      });
      if (response.ok) {
        const payload = await response.json() as { result?: { confirmations?: number }; error?: { message?: string } };
        const confirmations = payload.result?.confirmations ?? 0;
        onPoll?.(confirmations);
        if (confirmations > 0) return;
        if (payload.error && !/no such mempool|not found/i.test(payload.error.message ?? '')) throw new Error(payload.error.message ?? 'Bitcoin RPC lookup failed');
      } else if (![502, 503, 504, 429].includes(response.status)) {
        throw new Error(`Bitcoin RPC HTTP ${response.status}`);
      }
    } catch (error) {
      if (error instanceof Error && /Bitcoin RPC HTTP (502|503|504|429)|fetch failed|network|timeout|UND_ERR/i.test(error.message)) {
        // Transient network or reverse-proxy hiccup; wait and retry on the next cycle
      } else {
        throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

export interface FlowStepDecision {
  action: 'deposit' | 'confirm-deposit' | 'mint' | 'register' | 'complete';
  shouldRegister: boolean;
  stage?: 'depositing' | 'confirming-deposit' | 'minting' | 'registering';
}

/**
 * Pure step resolution logic for the vault funding pipeline.
 * Guarantees that if the local store or vault record already has vaultId recorded
 * (or is marked registered), NO registration attempt is emitted.
 */
export function evaluateFundingStep(state: {
  vault?: Partial<VaultRecord> | null;
  deposit?: { txid: string; vout: number } | null;
  hasConfirmedDeposit?: boolean;
  hasVtxo?: boolean;
  registrationState?: 'registered' | 'unregistered' | 'unknown';
}): FlowStepDecision {
  if (state.registrationState === 'registered' || state.vault?.vaultIdHex || state.vault?.registered) {
    return {
      action: 'complete',
      shouldRegister: false,
    };
  }
  if (!state.deposit && !state.vault?.funding) {
    return {
      action: 'deposit',
      shouldRegister: false,
      stage: 'depositing',
    };
  }
  if (!state.hasConfirmedDeposit && !state.vault?.funding) {
    return {
      action: 'confirm-deposit',
      shouldRegister: false,
      stage: 'confirming-deposit',
    };
  }
  if (!state.hasVtxo) {
    return {
      action: 'mint',
      shouldRegister: false,
      stage: 'minting',
    };
  }
  return {
    action: 'register',
    shouldRegister: true,
    stage: 'registering',
  };
}

export interface FundingStepState {
  label: string;
  done: boolean;
}

export function computeFundingSteps(params: {
  vault?: Partial<VaultRecord> | null;
  flow: 'ready' | 'depositing' | 'confirming-deposit' | 'minting' | 'registering' | 'complete' | 'error';
  depositTxid?: string | null;
  pendingFaucetTxid?: string | null;
}): FundingStepState[] {
  const { vault, flow, depositTxid, pendingFaucetTxid } = params;
  const vaultReady = Boolean((vault?.funding || vault?.vaultIdHex) && (vault?.registered || vault?.vaultIdHex));
  const isDepositBroadcast = Boolean(depositTxid || vault?.funding);
  const isDepositConfirmed = ['minting', 'registering', 'complete'].includes(flow) || vaultReady;

  return [
    { label: 'Faucet funds broadcast', done: Boolean(pendingFaucetTxid) || isDepositBroadcast || flow !== 'ready' || vaultReady },
    { label: 'Vault deposit broadcast', done: isDepositBroadcast || ['confirming-deposit', 'minting', 'registering', 'complete'].includes(flow) || vaultReady },
    { label: 'Faucet confirmed on L1', done: isDepositConfirmed },
    { label: 'Deposit confirmed on L1', done: isDepositConfirmed },
    { label: 'Spendable VTXO minted', done: ['registering', 'complete'].includes(flow) || vaultReady },
    { label: 'Vault registered', done: flow === 'complete' || vaultReady },
  ];
}

/** Live deposit → L1 confirmation → VTXO mint → vault registration. */
export async function fundVaultLifecycle(params: FundVaultLifecycleParams): Promise<FundVaultLifecycleResult> {
  const daemonUrl = new URL(params.daemonBaseUrl);
  const allowInsecureHttp = daemonUrl.protocol === 'http:' && (daemonUrl.hostname === '127.0.0.1' || daemonUrl.hostname === 'localhost' || daemonUrl.hostname === '::1');

  const claimed = new Set((params.claimedOutpoints ?? []).map(item => item.toLowerCase()));
  // The flow's resolved deposit, visible to the code=17 catch below. Without
  // it the catch could only see params.vault.funding, which is UNSET on a fresh
  // funding round: the adoption would then run against an empty txid and the
  // result would carry a fake `funding: { txid: '' }` binding that poisons
  // every later scan (truthy funding short-circuits the on-chain lookup).
  let resolvedDeposit: LifecycleDeposit | null = null;
  const rememberDeposit = <T extends LifecycleDeposit | null>(d: T): T => {
    resolvedDeposit = d;
    return d;
  };
  try {
    // FIX 2: If the local store already records the vaultId for this deposit, skip registration entirely!
    const decision = evaluateFundingStep({ vault: params.vault });
    if (!decision.shouldRegister && params.vault.vaultIdHex) {
      const owner = params.vault.userKeyDescriptor.publicKey.slice(2);
      const current = await vc.getAddressVtxos(owner, { baseUrl: params.daemonBaseUrl, allowInsecureHttp, fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis) });
      const evidence = current.vtxos.find(item => !item.spent);
      let dep: LifecycleDeposit;
      if (params.vault.funding) {
        dep = { txid: params.vault.funding.txid, vout: params.vault.funding.vout, amountSats: params.vault.funding.valueSats, source: 'recovered' };
      } else {
        const found = await findExistingVaultFunding(params.bitcoinRpcBaseUrl, params.vault, params.fetchImpl ?? globalThis.fetch.bind(globalThis), claimed);
        dep = found ?? {
          txid: '' as import('./types.js').DisplayTxid,
          vout: 0,
          amountSats: 0n,
          source: 'recovered',
        };
      }
      return {
        deposit: dep,
        vtxoId: evidence?.id ?? '',
        mintTxHash: '',
        mintEpoch: evidence?.height ?? 0,
        vaultId: params.vault.vaultIdHex,
      };
    }

    let deposit: LifecycleDeposit | null = rememberDeposit(params.vault.funding
      ? { txid: params.vault.funding.txid, vout: params.vault.funding.vout, amountSats: params.vault.funding.valueSats, source: 'recovered' as const }
      : await findExistingVaultFunding(params.bitcoinRpcBaseUrl, params.vault, params.fetchImpl ?? globalThis.fetch.bind(globalThis), claimed));

    if (!deposit && params.existingDepositTxid) {
      deposit = rememberDeposit(await findBroadcastVaultFunding(params.bitcoinRpcBaseUrl, params.vault, params.existingDepositTxid, claimed, params.fetchImpl ?? globalThis.fetch.bind(globalThis)));
      if (deposit) {
        params.onProgress?.('confirming-deposit');
        await waitForBitcoinConfirmation(params.bitcoinRpcBaseUrl, deposit.txid, params.confirmationPollMs ?? 5_000, params.onConfirmationPoll, params.fetchImpl ?? globalThis.fetch.bind(globalThis));
      }
    }

    if (!deposit) {
      // Register-only mode: amountSats 0 means "this vault was funded
      // directly; register what is already on-chain". Never broadcast a new
      // deposit in that mode even if the scan came up empty.
      if (params.amountSats <= 0n) {
        throw new Error(
          'No deposit found on this vault address. Register-only mode (0 sats) never broadcasts: send BTC to the vault address first, then retry.',
        );
      }
      params.onProgress?.('depositing');
      let broadcast: DepositResult | null = null;
      if (params.explicitInput) {
        try {
          broadcast = await depositFromMnemonic({
            vault: params.vault,
            mnemonic: params.mnemonic,
            rpc: { baseUrl: params.bitcoinRpcBaseUrl },
            amountSats: params.amountSats,
            feeRateSatVb: params.feeRateSatVb,
            explicitInput: params.explicitInput,
          });
        } catch (chainedError) {
          const { describeDaemonFailure } = await import('./net.js');
          const diagnosis = describeDaemonFailure(chainedError, {
            url: params.bitcoinRpcBaseUrl,
            method: 'POST',
          });
          params.onFallback?.(chainedError, diagnosis);
          // Fall back to legacy path: wait for payout confirmation
          params.onProgress?.('confirming-deposit');
          await waitForBitcoinConfirmation(
            params.bitcoinRpcBaseUrl,
            params.explicitInput.txid,
            params.confirmationPollMs ?? 5_000,
            params.onConfirmationPoll,
            params.fetchImpl ?? globalThis.fetch.bind(globalThis)
          );
          // Legacy deposit with confirmed UTXO selection
          params.onProgress?.('depositing');
          broadcast = await depositFromMnemonic({
            vault: params.vault,
            mnemonic: params.mnemonic,
            rpc: { baseUrl: params.bitcoinRpcBaseUrl },
            amountSats: params.amountSats,
            feeRateSatVb: params.feeRateSatVb,
          });
        }
      } else {
        broadcast = await depositFromMnemonic({
          vault: params.vault,
          mnemonic: params.mnemonic,
          rpc: { baseUrl: params.bitcoinRpcBaseUrl },
          amountSats: params.amountSats,
          feeRateSatVb: params.feeRateSatVb,
        });
      }

      params.onDepositBroadcast?.(broadcast);
      deposit = rememberDeposit({ txid: broadcast.txid, vout: broadcast.vout, amountSats: broadcast.amountSats, source: 'broadcast' as const });
      params.onProgress?.('confirming-deposit');
      await waitForBitcoinConfirmation(params.bitcoinRpcBaseUrl, deposit.txid, params.confirmationPollMs ?? 5_000, params.onConfirmationPoll, params.fetchImpl ?? globalThis.fetch.bind(globalThis));
    }

    let registered: ListedVaultSummary | undefined;
    try {
      const listed = await retryDaemonQuery(() =>
        queryListVaults(params.vault.userKeyDescriptor.publicKey, {
          baseUrl: params.daemonBaseUrl,
          pageSize: 100,
          timeoutMs: params.timeoutMs ?? 20_000,
          allowInsecureHttp,
          fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis),
        }),
      );
      const internalFundingTxid = Buffer.from(deposit.txid, 'hex').reverse().toString('hex');
      registered = listed.vaults.find(item => item.fundingTxid.toLowerCase() === internalFundingTxid && item.fundingVout === deposit.vout);
    } catch (_err) {
      // Soft-fail: when listVaults ultimately fails, treat registration state as
      // UNKNOWN-but-not-registered and continue step machine (do NOT throw).
      registered = undefined;
    }

    if (registered) {
      const current = await retryDaemonQuery(() => vc.getAddressVtxos(params.vault.userKeyDescriptor.publicKey.slice(2), { baseUrl: params.daemonBaseUrl, allowInsecureHttp, fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis) }));
      const evidence = current.vtxos.find(item => !item.spent);
      return { deposit, vtxoId: evidence?.id ?? '', mintTxHash: '', mintEpoch: evidence?.height ?? 0, vaultId: registered.vaultId };
    }

    params.onProgress?.('minting');
    const signer = makeSigner(params.mnemonic, 'regtest', params.vault.userKeyIndex);
    const mintAmount = deposit.amountSats - 1n;
    const owner = params.vault.userKeyDescriptor.publicKey.slice(2);
    const existing = await retryDaemonQuery(() => vc.getAddressVtxos(owner, { baseUrl: params.daemonBaseUrl, allowInsecureHttp, fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis) }));
    const recoveredVtxo = existing.vtxos.find(item => !item.spent && item.amountSats === mintAmount);
    let vtxoId: string;
    let mintTxHash = '';
    let mintEpoch = 0;
    if (recoveredVtxo) {
      vtxoId = recoveredVtxo.id;
      mintEpoch = recoveredVtxo.height;
    } else {
      const nonce = await retryDaemonQuery(() => vc.getAccountNonce(Buffer.from(owner, 'hex'), { baseUrl: params.daemonBaseUrl, allowInsecureHttp, fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis) }));
      const draft = vc.buildTachiTxDeposit({ userXOnly: Buffer.from(owner, 'hex'), amountSats: mintAmount, nonce, feeSats: 1n });
      const signed = await vc.signTachiTx(draft, signer);
      const broadcast = await vc.broadcastTachiTx(signed, { url: params.daemonBaseUrl + '/tachi_txBroadcastSync', allowInsecureHttp, fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis) });
      const commit = await vc.waitForTachiTxCommit(broadcast.tendermintTxHash, { baseUrl: params.daemonBaseUrl, overallTimeoutMs: 120_000, allowInsecureHttp, fetchImpl: params.fetchImpl ?? globalThis.fetch.bind(globalThis) });
      if (commit.code !== 0) throw mapDaemonError(commit);
      vtxoId = Buffer.from(vc.vtxoIdFromDeposit(signed, 0)).toString('hex');
      mintTxHash = commit.hash;
      mintEpoch = commit.epoch;
    }
    params.onProgress?.('registering');
    const registrationAmount = mintAmount - 1n;
    const registration = await registerVault({
      vault: params.vault,
      fundingTxid: deposit.txid,
      fundingVout: deposit.vout,
      userSigner: signer,
      vtxoId,
      owner: params.vault.userKeyDescriptor.publicKey.slice(2),
      amount: registrationAmount,
      baseUrl: params.daemonBaseUrl,
      allowInsecureHttp,
      fetchImpl: params.fetchImpl,
      timeoutMs: params.timeoutMs,
    });
    return { deposit, vtxoId, mintTxHash, mintEpoch, vaultId: registration.vaultId };
  } catch (error) {
    if (isCode17VaultExists(error)) {
      const owner = params.vault.userKeyDescriptor.publicKey.slice(2);
      // Prefer the deposit THIS flow actually resolved (fresh rounds have no
      // params.vault.funding yet); fall back to the stored binding.
      const known = resolvedDeposit
        ?? (params.vault.funding
          ? { txid: params.vault.funding.txid, vout: params.vault.funding.vout, amountSats: params.vault.funding.valueSats, source: 'recovered' as const }
          : null);
      if (!known) {
        // The daemon says the vault exists but this flow never resolved which
        // outpoint funds it. Reporting a fabricated empty binding would poison
        // every later scan; surface the original error instead.
        throw mapDaemonError(error);
      }
      const depTxid = known.txid;
      const fundingTxidBuf = Buffer.from(depTxid, 'hex').reverse();
      const fundingVout = known.vout;
      const adopted = await adoptVaultOnCode17({
        fundingTxid: fundingTxidBuf,
        fundingVout,
        ownerXOnly: owner,
        baseUrl: params.daemonBaseUrl,
        allowInsecureHttp,
        fetchImpl: params.fetchImpl,
        timeoutMs: params.timeoutMs,
      });
      return {
        deposit: { txid: depTxid, vout: fundingVout, amountSats: known.amountSats, source: 'recovered' },
        vtxoId: '',
        mintTxHash: '',
        mintEpoch: 0,
        vaultId: adopted.vaultId,
      };
    }
    throw mapDaemonError(error);
  }
}
