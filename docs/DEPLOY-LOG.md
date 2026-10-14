# Deployment Log

## 2026-10-15 — Phase 3: Signet deployment variant (preview)

- **Variant URL:** https://ripcord-wallet-iqr0vnyo8-jayanngs-projects.vercel.app
- **Deployment id:** dpl_DTxkF1BowboBwCaCTEB2jLP9nH6t (project `ripcord-wallet`, preview target; built from e4586bc429)
- **Commit:** `e4586bc` (branch `signet-support`, pushed and verified: remote head == local HEAD)
- **Production:** ripcord-wallet.vercel.app untouched (main `9c6a065048`, regtest default)

Proxy path-class gate (deployed variant, 2026-10-15):

| Path class | Result |
|---|---|
| `/app.html` | 200, "Ripcord" marker |
| `POST /rpc` | `chain: regtest` (real regtest bitcoind) |
| `POST /faucet/api/regtest/faucet` | routed to faucet.tachibtc.com (Cloudflare browser-only gate for non-browser UAs, as known) |
| `GET /signet/health` | `{"status":"ok","validators":1}` |
| `POST /signet/rpc` | `chain: signet` (real signet bitcoind) |
| `GET /signet/tachi_status` | signet daemon JSON-RPC |
| `POST /signet/`, `POST /signet/rpc/` | 200 (trailing-slash variants) |
| `POST /faucet/api/regtest/faucet/` | 404 from upstream exact-route (same as dev; app never calls it) |
| `GET /app/wallet` (SPA deep link) | 200 app shell |

User invariants (re-proven on the deployed variant):

1. Signet session 100% regtest-free — strict DOM sweep (any "regtest"/"bcrt1" in
   text, placeholders, errors, attributes after selection = violation):
   clean at every step (post-selection, funding screen with live `tb1` address,
   send screen). GATE PASS.
2. Regtest untouched — production still serves the regtest default
   (`chain: regtest` + Ripcord marker), and regtest derivation byte-identity
   HOLDS (same phrase -> frozen `bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk`).
3. RPC routing hard-separated — `/rpc` -> regtest chain, `/signet/rpc` -> signet
   chain, on both dev proxy and deployed variant.

Note: project preview protection (Vercel Authentication) disabled via
`PATCH /v9/projects` (`ssoProtection: null`) so the variant is viewable without
an account (required for manual verification and judges). Production auth
posture unchanged.
