# Running and deploying the wallet

The wallet is a static SPA with **no backend**. It talks to live services
through **same-origin paths**, and the host serving the app must proxy them.
Get this wrong and the app fails in exactly the confusing ways this document
exists to prevent (silent 404 probes, bare "Failed to fetch" on broadcasts).

## The host-proxy contract

The wallet fetches these same-origin paths. Proxy each one as follows:

| Path | Proxies to | Used for |
| --- | --- | --- |
| `/health` | `https://rpc-regtest.tachibtc.com/health` | boot preflight |
| `/tachi*` (all `/tachi_*` REST paths, incl. nested like `/tachi_validators/live`) | `https://rpc-regtest.tachibtc.com/...` (path preserved) | quorum, vtxos, tx broadcast (`tachi_txBroadcastSync`), sign ceremony (`tachi_signTransaction`), proofs |
| `/rpc` | `https://rpc-regtest.tachibtc.com/` (the `/rpc` prefix is STRIPPED) | bitcoind JSON-RPC proxy (`scantxoutset`, `getrawtransaction`, `sendrawtransaction`, ...) |
| `/faucet` | `https://faucet.tachibtc.com/` (prefix stripped) | regtest faucet |

The WebSocket indexer is exempt: it connects directly to
`wss://rpc-regtest.tachibtc.com/tachi_ws` (WebSockets are not subject to CORS).

## Why a same-origin proxy is mandatory in browsers

Verified live against the public daemon on 2026-09-27 (re-probe if the daemon
version moves):

- **GET** responses carry `access-control-allow-origin: *` (cross-origin GETs work).
- **POST and OPTIONS** responses carry **no** `access-control-*` headers at all.
  Cross-origin POSTs (tx broadcast, the sign ceremony, the bitcoind JSON-RPC
  proxy at `/`) are therefore blocked by every browser with a bare
  "Failed to fetch".

Tachi's own browser RPC tool has the same limitation (its error text says
"daemon may be unreachable or CORS-blocked"), so there is no CORS-free direct
path to rely on. The proxy is the fix, in dev and in production alike.

## Reference setups

- **Dev and `npm run preview`**: `apps/wallet/vite.config.ts` (`SERVICE_PROXY`,
  applied to both `server` and `preview`).
- **Vercel (production)**: `apps/wallet/vercel.json`. The wallet build copies
  it into `dist/` automatically, so deploying `apps/wallet/dist` always carries
  the rewrites (a plain `vite build` wipes `dist/` and used to silently drop
  them). This is what runs `ripcord-wallet.vercel.app`.
- **nginx** (static hosting):

  ```nginx
  location /health  { proxy_pass https://rpc-regtest.tachibtc.com/health; }
  location /tachi   { proxy_pass https://rpc-regtest.tachibtc.com; }   # path preserved
  location /rpc/    { proxy_pass https://rpc-regtest.tachibtc.com/; }  # /rpc prefix stripped
  location /rpc     { proxy_pass https://rpc-regtest.tachibtc.com/; }
  location /faucet/ { proxy_pass https://faucet.tachibtc.com/; }
  ```

Keep the reference setups in sync. Drift between dev and production proxies is
the failure class that shipped a wallet whose probes silently 404'd in
production while dev looked fine.

## Environment overrides

| Var | Default | Meaning |
| --- | --- | --- |
| `VITE_DAEMON_URL` | `window.location.origin` | daemon REST base. Only set it when the daemon is reachable cross-origin (it will not be, for POSTs, from a browser) or when the proxy serves at a subpath. |
| `VITE_BITCOIN_RPC_URL` | `<origin>/rpc` | bitcoind JSON-RPC base. |
| `VITE_FAUCET_URL` | `/faucet/api/faucet` | faucet endpoint. |
| `VITE_INDEXER_URL` | `wss://rpc-regtest.tachibtc.com/tachi_ws` | indexer WebSocket. |

Path-prefixed bases (e.g. `https://host/proxy`) are fully supported inside
ripcord: all ripcord call sites join URLs by string concat
(`joinDaemonUrl` in `@ripcord/core/net`). Note that
`@tachibtc/tachi-sdk-ts`'s `TachiClient` does NOT support them: it resolves
with `new URL('/health', base)`, which silently drops the base path. Do not
hand a path-prefixed base to that client.

## How failures are surfaced

Misconfiguration is reported, not swallowed:

- `preflight()` returns per-probe failures whose messages name the likely cause
  and point back to this document.
- `describeDaemonFailure()` (exported from `@ripcord/core/net`) enriches any
  fetch failure: 404 on daemon paths means the host is not proxying; a POST
  "Failed to fetch" in a browser means the CORS gap; timeouts say so. The
  wallet routes every error surface through it.
- `npm run check:rules` bans `new URL('/...', base)` URL-joining in
  `packages/`, the pattern that caused the silent path-drop.
