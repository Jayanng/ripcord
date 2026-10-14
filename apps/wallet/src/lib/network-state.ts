/**
 * Active Tachi network for the running wallet session (Phase 2 signet work).
 *
 * WHY A MODULE: 24 explorer-link call sites and several daemon-base reads live
 * in leaf components that have no context access. The wallet's network is fixed
 * at CREATION time (the user picks regtest or signet before any key material
 * exists) and stamped on the identity + every vault record, so one session has
 * exactly one network. WalletContext calls setActiveNetwork(identity.network)
 * when an identity loads; helpers read it here.
 *
 * REGTEST INVARIANCE: the default is 'regtest' and stays 'regtest' for every
 * legacy wallet (records without a network field are regtest by migration).
 */
import type { TachiNetwork } from '@ripcord/core';

let active: TachiNetwork = 'regtest';

export function setActiveNetwork(network: TachiNetwork): void {
  active = network;
}

export function getActiveNetwork(): TachiNetwork {
  return active;
}

/**
 * Same-origin daemon base for the active network. REGTEST IS ADDITIVE-UNIQUE:
 * regtest keeps the exact root-path shape of the deployed app (the /health,
 * /tachi*, /rpc proxy contract — see docs/DEPLOYMENT.md), so every existing
 * request URL stays byte-identical. Signet rides a `/signet` prefix mirrored by
 * vite proxy + vercel rewrites (all SDK join paths in this stack are
 * prefix-safe — live-probed 2026-10-14: vault-core concatenates,
 * BitcoinCoreRpcClient and the aggregator post to the base URL as-is).
 */
export function daemonBaseFor(network: TachiNetwork, origin: string): string {
  return network === 'signet' ? `${origin.replace(/\/+$/, '')}/signet` : origin;
}

/**
 * Bitcoin JSON-RPC proxy URL for the ACTIVE network, for direct fetch() calls
 * (audit C1 2026-10-14: five call sites hardcoded '/rpc', which is the REGTEST
 * proxy — on signet a gettxout against the wrong chain returns null and the app
 * cached "spent" forever, voiding real backing).
 */
export function bitcoinRpcUrl(): string {
  return bitcoinRpcBaseFor(active, window.location.origin);
}

/** Bitcoin JSON-RPC proxy base (bitcoind POST / behind /rpc, per network). */
export function bitcoinRpcBaseFor(network: TachiNetwork, origin: string): string {
  return network === 'signet'
    ? `${origin.replace(/\/+$/, '')}/signet/rpc`
    : `${origin.replace(/\/+$/, '')}/rpc`;
}
