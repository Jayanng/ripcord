import {
  VaultRecord,
  VaultAddress,
  DisplayTxid,
  CompressedHex,
  Identity,
  asCompressedHex,
  asVaultAddress,
} from './types.js';
import { QuorumInfo, computeFingerprint } from './quorum.js';
import { toUserKeyDescriptor } from './keys.js';
import { toDisplayTxid } from './bytes.js';
import * as vc from '@tachibtc/taurus-vault-core';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as btc from 'bitcoinjs-lib';
import { RipcordError, RipcordCode } from './errors.js';

export interface RecoverVaultsParams {
  identity: Identity;
  quorum: QuorumInfo;
  /**
   * Candidate CSV values to scan. The daemon redacts `csv_delay` (and
   * threshold/quorum_keyset) without an API key, so every vault must be
   * rebuilt under each candidate until the rebuilt address agrees with the
   * daemon-registered one; only the matching candidate resolves the vault.
   * Defaults to the csv=2 regtest fixture plus every CSV tier the daemon's
   * CSVForBalance can pick (toSelfDelayForBalance: 144/432/1008/2016).
   */
  knownCsvBlocks?: number[];
  baseUrl: string;
  /** First receive-key index to scan (SDK default 0). */
  startIndex?: number;
  /** Stop after this many consecutive empty indices (SDK default 3). */
  gapLimit?: number;
  /** Hard cap on scanned indices (SDK default 100). */
  maxIndex?: number;
}

/** Default CSV candidates: regtest fixture (2) + every daemon CSV tier. */
/**
 * Default CSV delay candidates for recovery.
 *
 * The daemon redacts `csv_delay` without an API key, so we must rebuild the
 * vault under every possible CSV value and keep the one whose address matches
 * the daemon-registered address.
 *
 * These values are derived from the daemon's `toSelfDelayForBalance` tiers:
 * 144 (1 day), 432 (3 days), 1008 (1 week), 2016 (2 weeks), plus the regtest
 * fixture value 2. If the daemon adds new tiers, this list must be updated.
 * Without an API key, there is no way to discover the tiers dynamically.
 */
export const DEFAULT_RECOVERY_CSV_BLOCKS: readonly number[] = [2, 144, 432, 1008, 2016];

interface FundingBinding {
  txid: DisplayTxid;
  vout: number;
  valueSats: bigint;
}

/**
 * Fetch the funding output over Bitcoin RPC and bind it to the rebuilt vault.
 *
 * `vault.p2tr.output` vs the on-chain scriptPubKey of `fundingTxid:fundingVout`
 * is the ONLY check that binds a rebuilt vault to real money: the daemon's
 * recorded address proves parameter agreement, and `verified` only proves
 * internal VaultID consistency, neither touches the chain. Any disagreement
 * here throws rather than returning a vault that cannot be trusted to spend
 * the funds it names.
 */
async function fetchFundingBinding(
  baseUrl: string,
  internalTxidHex: string,
  vout: number,
  expectedOutputScriptHex: string
): Promise<FundingBinding> {
  // The daemon stores funding txids in internal byte order; convert to the
  // display order Bitcoin RPC expects.
  const displayTxid = toDisplayTxid(internalTxidHex);

  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getrawtransaction',
      params: [displayTxid, true],
    }),
  });

  if (!response.ok) {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      `Funding transaction fetch failed: ${response.statusText}`,
      { hint: `getrawtransaction for ${displayTxid} returned HTTP ${response.status}` }
    );
  }

  const data = await response.json();
  if (data.error) {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      `Funding transaction lookup failed: ${data.error.message}`,
      { hint: `The daemon record references ${displayTxid}:${vout}, which is not retrievable` }
    );
  }

  const tx = data.result;
  const out = (
    tx.vout as Array<{ n: number; value: number; scriptPubKey: { hex: string } }>
  ).find((o) => o.n === vout);
  if (!out) {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      `Funding output ${displayTxid}:${vout} not found`,
      { hint: 'Daemon record references a vout the funding transaction does not have' }
    );
  }

  if (out.scriptPubKey.hex.toLowerCase() !== expectedOutputScriptHex.toLowerCase()) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Funding output ${displayTxid}:${vout} does not pay the rebuilt vault script`,
      {
        hint: `On-chain scriptPubKey ${out.scriptPubKey.hex} differs from rebuilt vault.p2tr.output ${expectedOutputScriptHex}. The daemon record does not bind to this vault; do not spend against it.`,
      }
    );
  }

  // Exact satoshis: decode the raw transaction instead of trusting the float
  // `value` field. The decoded integer is cross-checked against the verbose
  // float so an index or decode mistake can never slip through silently.
  let valueSats: bigint;
  if (typeof tx.hex === 'string' && tx.hex.length > 0) {
    const decoded = btc.Transaction.fromHex(tx.hex);
    valueSats = BigInt(decoded.outs[vout]?.value ?? 0);
    if (Math.round(out.value * 1e8) !== Number(valueSats)) {
      throw new RipcordError(
        RipcordCode.AMOUNT_MISMATCH,
        `Funding value decode disagreement for ${displayTxid}:${vout}`,
        {
          hint: `Raw decode says ${valueSats} sats, verbose field implies ${Math.round(
            out.value * 1e8
          )}`,
        }
      );
    }
  } else {
    valueSats = BigInt(Math.round(out.value * 1e8));
  }

  return { txid: displayTxid, vout, valueSats };
}

/**
 * Cold-start vault recovery from the mnemonic alone.
 *
 * Rebuilds every vault the daemon has registered for the wallet's receive
 * keys, resolving the redacted `csv_delay` by rebuilding under each candidate
 * CSV and keeping only vaults whose rebuilt address the daemon agrees with.
 * Every returned record is bound to real money: its funding output's on-chain
 * scriptPubKey must equal the rebuilt `vault.p2tr.output`.
 *
 * Notes:
 * - Only REGISTERED vaults are daemon-indexed and discoverable; an empty result
 *   means "nothing registered and indexed", not "no vaults exist".
 * - Without an API key the rebuild uses the caller's current quorum. If the
 *   quorum rotated since registration, the rebuilt address will not match and
 *   the vault is filtered out (honestly undiscoverable, never misreported).
 * - `requireAddressMatch` is deliberately OFF: a wrong CSV guess must surface
 *   as `addressMatchesRebuild === false` to be filtered, not as a throw.
 * - Throws on records that pass the address check but fail the on-chain
 *   scriptPubKey binding, that is daemon-side data corruption and must not
 *   be silently dropped, or the user would never know funds are unaccounted.
 */
export async function recoverVaults(params: RecoverVaultsParams): Promise<VaultRecord[]> {
  const { identity, quorum, baseUrl, startIndex, gapLimit, maxIndex } = params;

  if (identity.network !== 'regtest') {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Unsupported network: ${identity.network}`,
      { hint: 'Recovery currently supports regtest only' }
    );
  }

  const csvCandidates = [...new Set(params.knownCsvBlocks ?? DEFAULT_RECOVERY_CSV_BLOCKS)];
  if (csvCandidates.length === 0) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'knownCsvBlocks must contain at least one candidate',
      { hint: 'Pass explicit CSV candidates or omit for the default tier set' }
    );
  }
  for (const csv of csvCandidates) {
    if (!Number.isInteger(csv) || csv < 1) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Invalid CSV candidate: ${csv}`,
        { hint: 'CSV blocks must be positive integers' }
      );
    }
  }

  // Wallet for the gap scan: discovery re-derives receive keys from the same
  // mnemonic, so a wiped client rebuilds the exact keys the vaults were
  // registered under. No wallet sync, discovery only derives keys and reads
  // daemon state; it never touches wallet UTXOs.
  const rpcClient = new agg.BitcoinCoreRpcClient({ url: baseUrl });
  const aggregator = await agg.WalletAggregator.fromMnemonic(identity.mnemonic, {
    network: 'regtest',
    rpc: rpcClient,
  });
  const wallet = aggregator.addAccount({ addressType: 'p2wpkh' });

  const byVaultId = new Map<string, VaultRecord>();

  for (const csvBlocks of csvCandidates) {
    const discovered = await vc.discoverVaults({
      network: 'regtest',
      userWallet: wallet,
      nodePubkeys: quorum.nodePubkeys,
      threshold: quorum.threshold,
      csvBlocks,
      query: { baseUrl },
      ...(startIndex !== undefined ? { startIndex } : {}),
      ...(gapLimit !== undefined ? { gapLimit } : {}),
      ...(maxIndex !== undefined ? { maxIndex } : {}),
    });

    for (const d of discovered) {
      // Strict gates per the build plan: internal VaultID consistency AND
      // parameter agreement with the daemon-registered address.
      if (!d.verified) continue;
      if (d.addressMatchesRebuild !== true) continue;
      if (byVaultId.has(d.summary.vaultId)) continue;

      // When the daemon discloses its own snapshot (API key present), those
      // values are authoritative and the csvBlocks candidate above was
      // ignored by the rebuild, record the daemon's own values instead.
      const fromDaemon = d.paramSource === 'daemon';
      const resolvedCsv =
        fromDaemon && typeof d.summary.csvDelay === 'number' ? d.summary.csvDelay : csvBlocks;
      const recordNodePubkeys = (
        fromDaemon && d.summary.quorumKeyset ? [...d.summary.quorumKeyset] : quorum.nodePubkeys
      ).map((pk) => asCompressedHex(pk));
      const quorumFingerprint =
        fromDaemon && d.summary.quorumKeyset
          // The daemon disclosed its own keyset for this vault. The threshold is
          // not part of that snapshot, so the live quorum's threshold is used;
          // it is the only threshold this daemon will enforce.
          ? computeFingerprint(recordNodePubkeys, quorum.threshold)
          : quorum.fingerprint;

      // The user key at the index the vault was found at, same derivation
      // path the SDK's discovery itself used.
      const descriptor = vc.userKeyDescriptorFromWallet(wallet, { index: d.userKeyIndex });

      // Money binding: the funding output's on-chain scriptPubKey must equal
      // the rebuilt P2TR output. Throws on any disagreement.
      const funding = await fetchFundingBinding(
        baseUrl,
        d.summary.fundingTxid,
        d.summary.fundingVout,
        Buffer.from(d.vault.p2tr.output).toString('hex')
      );

      const record: VaultRecord = {
        vaultIdHex: d.summary.vaultId,
        address: asVaultAddress(d.vault.p2tr.address),
        csvBlocks: resolvedCsv,
        userKeyIndex: d.userKeyIndex,
        userKeyDescriptor: toUserKeyDescriptor(descriptor),
        nodePubkeys: recordNodePubkeys,
        quorumThreshold: quorum.threshold,
        quorumFingerprint,
        p2tr: d.vault.p2tr,
        exitLeaf: Buffer.from(d.vault.p2tr.exitLeaf.script).toString('hex'),
        cooperativeLeaf: Buffer.from(d.vault.p2tr.cooperativeLeaf.script).toString('hex'),
        funding,
        registered: true, // daemon-indexed: only registered vaults are discoverable
        createdAt: Date.now(),
      };

      byVaultId.set(d.summary.vaultId, record);
    }
  }

  return [...byVaultId.values()];
}
