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
  // Once a network is selected the whole UI is that network - stamp the page
  // description too (static HTML ships network-neutral).
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', `A verification-first self-custodial wallet for ${networkLabel()}.`);
  // Tab title too (the browser chrome showed "Ripcord · Regtest wallet" in
  // signet sessions - caught by the user's page review 2026-10-15).
  document.title = `Ripcord · ${networkLabel()} wallet`;
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
/** Display label for the ACTIVE network (Tachi Signet / Tachi Regtest). */
export function networkLabel(): string {
  return active === 'signet' ? 'Tachi Signet' : 'Tachi Regtest';
}

/** Bech32 prefix for the ACTIVE network (UI placeholders/examples). */
export function addressPrefix(): string {
  return active === 'signet' ? 'tb1' : 'bcrt1';
}

export function bitcoinRpcUrl(): string {
  return bitcoinRpcBaseFor(active, window.location.origin);
}

/** Bitcoin JSON-RPC proxy base (bitcoind POST / behind /rpc, per network). */
export function bitcoinRpcBaseFor(network: TachiNetwork, origin: string): string {
  return network === 'signet'
    ? `${origin.replace(/\/+$/, '')}/signet/rpc`
    : `${origin.replace(/\/+$/, '')}/rpc`;
}
