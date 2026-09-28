import {
  VaultRecord,
  DisplayTxid,
  asDisplayTxid,
  isVaultAddress,
  asVaultAddress,
  ExplicitSpendableInput,
} from './types.js';
import { RipcordError, RipcordCode } from './errors.js';
import * as agg from '@tachibtc/taurus-wallet-aggregator';
import * as vc from '@tachibtc/taurus-vault-core';
import type { Utxo } from '@tachibtc/taurus-wallet-aggregator';
import * as btc from 'bitcoinjs-lib';
import { Transaction } from 'bitcoinjs-lib';

export type { ExplicitSpendableInput };

/**
 * Convert an address to its scriptPubKey hex string on regtest or mainnet.
 * Used for matching L1 settlement outputs in 0-conf chaining without leaking @tachibtc imports into apps/.
 */
export function addressToScriptPubKeyHex(address: string, network: 'regtest' | 'bitcoin' = 'regtest'): string {
  const net = network === 'regtest' ? btc.networks.regtest : btc.networks.bitcoin;
  return Buffer.from(btc.address.toOutputScript(address, net)).toString('hex');
}

export interface DepositToVaultParams {
  vault: VaultRecord;
  userWallet: agg.Wallet;
  rpc: { baseUrl: string };
  amountSats: bigint;
  /** Optional fee rate in sats/vbyte. Defaults to 2 (the verified regtest rate). */
  feeRateSatVb?: number;
  /** Optional unconfirmed payout UTXO to spend directly (0-conf faucet chaining). */
  explicitInput?: ExplicitSpendableInput;
}

export interface DepositResult {
  txid: DisplayTxid;
  vout: number;
  rawTxHex: string;
  vaultAddress: string;
  amountSats: bigint;
  feeSats: bigint;
  changeSats: bigint;
  inputs: readonly Utxo[];
}

/**
 * Deposit funds from the user's L1 wallet into the vault.
 */
export async function depositToVault(
  params: DepositToVaultParams
): Promise<DepositResult> {
  const { vault, userWallet, rpc, amountSats, feeRateSatVb, explicitInput } = params;
  // The SDK requires feeRateSatVb; default to the verified regtest rate when
  // the caller omits it rather than passing undefined through.
  const effectiveFeeRateSatVb = feeRateSatVb ?? 2;

  if (!vault.p2tr) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Vault missing P2TR data',
      { hint: 'Vault must have been created with p2tr field' }
    );
  }

  const address = vault.address;
  if (!isVaultAddress(address)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Invalid vault address: ${address}`,
      { hint: 'Address must be a valid vault P2TR' }
    );
  }

  if (explicitInput) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicitInput.txid)) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Invalid explicitInput txid: ${explicitInput.txid}`,
        { hint: 'Expected a 64-character hex string in display order' }
      );
    }
    if (!Number.isInteger(explicitInput.vout) || explicitInput.vout < 0) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Invalid explicitInput vout: ${explicitInput.vout}`,
        { hint: 'vout must be a non-negative integer' }
      );
    }
    if (typeof explicitInput.amountSats !== 'bigint' || explicitInput.amountSats <= 0n) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Invalid explicitInput amountSats: ${explicitInput.amountSats}`,
        { hint: 'amountSats must be a positive bigint' }
      );
    }

    const expectedL1ScriptHex = addressToScriptPubKeyHex(vault.userKeyDescriptor.address, 'regtest').toLowerCase();
    if (explicitInput.scriptPubKey.toLowerCase() !== expectedL1ScriptHex) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        `Explicit input scriptPubKey mismatch: expected ${expectedL1ScriptHex}, got ${explicitInput.scriptPubKey.toLowerCase()}`,
        { hint: 'Explicit input must pay to vault.userKeyDescriptor.address' }
      );
    }

    const explicitUtxo: Utxo = {
      txid: asDisplayTxid(explicitInput.txid),
      vout: explicitInput.vout,
      valueSats: explicitInput.amountSats,
      address: vault.userKeyDescriptor.address,
      scriptPubKey: expectedL1ScriptHex,
      height: 0,
      confirmations: 0,
      coinbase: false,
      derivationPath: vault.userKeyDescriptor.path,
      change: false,
      addressIndex: vault.userKeyDescriptor.index ?? vault.userKeyIndex,
    };

    const existing = userWallet.utxos ?? [];
    const combined = [
      explicitUtxo,
      ...existing.filter(u => !(u.txid === explicitUtxo.txid && u.vout === explicitUtxo.vout)),
    ];

    Object.defineProperty(userWallet, 'utxos', {
      get: () => combined,
      configurable: true,
    });
  }

  // Ensure change output returns directly to the user's L1 settlement address
  Object.defineProperty(userWallet, 'changeAddress', {
    get: () => vault.userKeyDescriptor.address,
    configurable: true,
  });

  const bitcoinRpcClient = new agg.BitcoinCoreRpcClient({
    url: rpc.baseUrl,
    fetchImpl: globalThis.fetch.bind(globalThis),
  });

  const dep = await vc.depositToVault({
    vault: {
      p2tr: vault.p2tr,
      userKey: {
        compressedHex: vault.userKeyDescriptor.publicKey,
        xOnly: Buffer.from(vault.userKeyDescriptor.publicKey.slice(2), 'hex'),
        derivationPath: vault.userKeyDescriptor.path,
        address: vault.userKeyDescriptor.address,
      },
      nodeKeys: vault.nodePubkeys.map(pk => ({
        pubkeyHex: pk.slice(2),
        compressedHex: pk,
      })),
    },
    userWallet,
    rpc: bitcoinRpcClient,
    amountSats,
    feeRateSatVb: effectiveFeeRateSatVb,
    skipSync: explicitInput !== undefined,
  });

  if (!dep.txid || !dep.rawTxHex) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Deposit result missing txid or rawTxHex',
      { hint: 'vc.depositToVault returned unexpected result' }
    );
  }

  const decodedTx = Transaction.fromHex(dep.rawTxHex);
  const expectedScriptHex = Buffer.from(vault.p2tr.output).toString('hex').toLowerCase();
  const vout = decodedTx.outs.findIndex(
    output => Buffer.from(output.script).toString('hex').toLowerCase() === expectedScriptHex
  );
  if (vout < 0) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      'Deposit transaction does not contain the expected vault output',
      { hint: 'Deposit rawTxHex did not contain the expected vault P2TR output' }
    );
  }

  // Money path validations:
  // 1. Fee conservation: feeSats = sum(inputs) - sum(outputs) exactly
  const sumInputs = dep.inputs.reduce((acc, input) => acc + input.valueSats, 0n);
  const sumOutputs = dep.amountSats + dep.changeSats;
  const actualFee = sumInputs - sumOutputs;
  if (actualFee !== dep.feeSats) {
    throw new RipcordError(
      RipcordCode.AMOUNT_MISMATCH,
      `Fee conservation violated: sum(inputs) [${sumInputs}] - sum(outputs) [${sumOutputs}] = ${actualFee} sats, but feeSats is ${dep.feeSats}`,
      { hint: 'feeSats must exactly equal sum(inputs) - sum(outputs)' }
    );
  }

  // 2. Refusal to overspend: inputs must strictly cover amount + fee
  if (sumInputs < dep.amountSats + dep.feeSats) {
    throw new RipcordError(
      RipcordCode.AMOUNT_MISMATCH,
      `Overspend detected: total input ${sumInputs} cannot cover amount ${dep.amountSats} + fee ${dep.feeSats}`,
      { hint: 'Deposit inputs must cover amount and fee' }
    );
  }

  // 3. Change correctness: change output must return to user L1 settlement address
  if (dep.changeSats > 0n) {
    const expectedChangeScriptHex = addressToScriptPubKeyHex(vault.userKeyDescriptor.address, 'regtest').toLowerCase();
    const changeVout = decodedTx.outs.findIndex(
      (out, idx) => idx !== vout && Buffer.from(out.script).toString('hex').toLowerCase() === expectedChangeScriptHex
    );
    if (changeVout < 0) {
      throw new RipcordError(
        RipcordCode.INVALID_FORMAT,
        'Deposit transaction change output is not sent to the user L1 settlement address',
        { hint: 'Change output must return to vault.userKeyDescriptor.address' }
      );
    }
  }

  return {
    txid: asDisplayTxid(dep.txid),
    vout,
    rawTxHex: dep.rawTxHex,
    feeSats: dep.feeSats,
    amountSats: dep.amountSats,
    changeSats: dep.changeSats,
    vaultAddress: asVaultAddress(dep.vaultAddress),
    inputs: dep.inputs,
  };
}

export async function verifyDepositProofOfReserves(
  baseUrl: string,
  txid: string,
  expectedOutputScriptHex: string
): Promise<boolean> {
  // The txid must be in display order (the order used by Bitcoin RPC).
  // Ensure it's a 64-character hex string.
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new RipcordError(
      RipcordCode.INVALID_FORMAT,
      `Invalid txid format: ${txid}`,
      { hint: 'Expected a 64-character hex string in display order' }
    );
  }
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
      RipcordCode.DAEMON_UNREACHABLE,
      `Failed to fetch transaction: ${response.statusText}`,
      { hint: 'Daemon may be down' }
    );
  }

  const data = await response.json();
  if (data.error) {
    throw new RipcordError(
      RipcordCode.FUNDING_MISSING,
      `Transaction not found: ${data.error.message}`,
      { hint: 'The deposit may not have been confirmed or broadcast' }
    );
  }

  const tx = data.result;
  const output = tx.vout.find((o: any) => o.scriptPubKey.hex === expectedOutputScriptHex);
  if (!output) {
    return false;
  }

  return true;
}

export interface DepositFromMnemonicParams {
  vault: VaultRecord;
  mnemonic: string;
  rpc: { baseUrl: string };
  amountSats: bigint;
  feeRateSatVb?: number;
  /** Optional unconfirmed payout UTXO to spend directly (0-conf faucet chaining). */
  explicitInput?: ExplicitSpendableInput;
}

/** Build the SDK wallet inside core, sync it against live Bitcoin RPC, then deposit. */
/**
 * Point the SDK's built-in regtest network endpoints at OUR rpc base URL.
 *
 * WHY (root-caused live 2026-09-28 from a production "Failed to fetch"): the
 * aggregator's global helpers (rpcCall/getUtxos/broadcastTx in
 * taurus-wallet-aggregator dist chunk-V3QPXLNG.js:332/480/527) POST to
 * `network.rpc.jsonRpc` and IGNORE the per-call `rpc` client we inject. Their
 * default is the ABSOLUTE daemon URL (TAURUS_REGTEST_RPC), and the daemon only
 * CORS-enables GET /tachi_*, so in a browser those POSTs throw "Failed to
 * fetch" (live-proven on production: identical POST to the absolute daemon URL
 * threw "Failed to fetch" while the same-origin /rpc/ proxy resolved 200).
 * REGTEST is an exported, unfrozen config whose rpc fields are read at CALL
 * time, so redirecting it routes every SDK network call through the caller's
 * proxy-aware base URL (see docs/DEPLOYMENT.md same-origin proxy contract).
 */
export function useProxyAwareTaurusRpc(baseUrl: string): void {
  const rpc = (agg.REGTEST as unknown as { rpc: { jsonRpc: string; rest: string } }).rpc;
  rpc.jsonRpc = baseUrl;
  rpc.rest = baseUrl;
}

export async function depositFromMnemonic(params: DepositFromMnemonicParams): Promise<DepositResult> {
  // The aggregator stores the supplied fetch function and invokes it later as
  // a plain callback. Chromium requires Window.fetch to retain its receiver,
  // otherwise it throws "Illegal invocation" before any RPC request is sent.
  useProxyAwareTaurusRpc(params.rpc.baseUrl);
  const boundFetch = globalThis.fetch.bind(globalThis);
  const rpcClient = new agg.BitcoinCoreRpcClient({ url: params.rpc.baseUrl, fetchImpl: boundFetch });
  const aggregator = await agg.WalletAggregator.fromMnemonic(params.mnemonic, {
    network: 'regtest',
    rpc: rpcClient,
  });
  const userWallet = aggregator.addAccount({ addressType: 'p2wpkh' });
  if (!params.explicitInput) {
    await userWallet.sync();
  }
  return depositToVault({
    vault: params.vault,
    userWallet,
    rpc: params.rpc,
    amountSats: params.amountSats,
    feeRateSatVb: params.feeRateSatVb,
    explicitInput: params.explicitInput,
  });
}

