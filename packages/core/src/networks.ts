import { networks as btcNetworks, type Network as BitcoinJsNetwork } from 'bitcoinjs-lib';

/**
 * Tachi network profiles (phase 1 of the Signet plan, 2026-10-14).
 *
 * Every network-derived value in Ripcord resolves from THIS map and nowhere
 * else. Values were live-probed against the daemons on 2026-10-14 (chain ids
 * from `/tachi_status`, endpoints reachable, signet quorum 7 nodes) and match
 * the SDKs' own network objects (`agg.REGTEST` / `agg.SIGNET`).
 *
 * REGTEST INVARIANCE: `regtest` is the default everywhere and its values are
 * exactly the previously hardcoded ones — no behavior change for regtest.
 */
export type TachiNetwork = 'regtest' | 'signet';

export interface TachiNetworkConfig {
  network: TachiNetwork;
  /** CometBFT chain id the daemon must report (health guard). */
  chainId: string;
  /** Daemon REST + Bitcoin JSON-RPC base. */
  daemonRest: string;
  /** Daemon WSS endpoint (`subscribeVaultEvents`). */
  daemonWs: string;
  /** Tachi-ledger explorer base for user-facing links. */
  explorerBase: string;
  /** Faucet hand-off page (claims are made on the faucet site). */
  faucetUrl: string;
  /** bech32 HRP for this network's addresses. */
  bech32: string;
  /** bitcoinjs-lib network used for address encode/decode. */
  bitcoinjsNetwork: BitcoinJsNetwork;
}

export const NETWORKS: Record<TachiNetwork, TachiNetworkConfig> = {
  regtest: {
    network: 'regtest',
    chainId: 'tachi-regtest-1',
    daemonRest: 'https://rpc-regtest.tachibtc.com',
    daemonWs: 'wss://rpc-regtest.tachibtc.com/tachi_ws',
    explorerBase: 'https://regtest.tachibtcscan.com',
    faucetUrl: 'https://faucet.tachibtc.com/regtest',
    bech32: btcNetworks.regtest.bech32,
    bitcoinjsNetwork: btcNetworks.regtest,
  },
  signet: {
    network: 'signet',
    chainId: 'tachi-signet-1',
    daemonRest: 'https://rpc-signet.tachibtc.com',
    daemonWs: 'wss://rpc-signet.tachibtc.com/tachi_ws',
    explorerBase: 'https://signet.tachibtcscan.com',
    faucetUrl: 'https://faucet.tachibtc.com/signet',
    bech32: btcNetworks.testnet.bech32,
    bitcoinjsNetwork: btcNetworks.testnet,
  },
};

/**
 * Records created before network selection existed carry no `network` field.
 * They are all regtest — that is what they were created on. (Migration rule
 * from the build plan; keep this default forever.)
 */
export const DEFAULT_NETWORK: TachiNetwork = 'regtest';

export function networkConfig(network: TachiNetwork = DEFAULT_NETWORK): TachiNetworkConfig {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(`Unsupported Tachi network: ${String(network)}`);
  }
  return config;
}

/** Network of a stored record/identity, defaulting legacy records to regtest. */
export function networkOf(record: { network?: string } | undefined): TachiNetwork {
  // Fail-safe by design: records predating network selection (and any record
  // with an unrecognized value) map to regtest — the only network that existed
  // when those records were created. Never throws on stored data.
  return record?.network === 'signet' ? 'signet' : DEFAULT_NETWORK;
}
