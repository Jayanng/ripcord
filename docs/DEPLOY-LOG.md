# Deployment Log

## 2026-10-16 (activity polish) — Restored-wallet credit rows + spender scan fix

- **Journal fix:** restored wallets now journal every historical credit as a
  neutral `vtxo:credited` row ("Credited to your key · height N", VTXO explorer
  link), mirroring the existing `vtxo:spent` rows. Root cause: receipts are
  device-local and the daemon indexes no tx history by address
  (`tachi_addressVtxos`/`tachi_vtxo` carry no credit-tx link), so a clean
  device silently lost every received transfer from the journal. Double-listing
  guard: credits covered by live tx-event outputs or receipts (same
  (height, amount), multiset) are suppressed. VTXO labels stop claiming
  "Deposit #N" for off-chain credits (classify by VTXO shape, not wallet
  history). 10 new pure tests (RED->GREEN).
- **Suite fix (pre-existing, chain-growth regression):** `findFundingSpender`
  capped its backward block scan at 2,000 blocks, so a real historical exit
  read as "not found" once the chain grew past the cap (fixture spender at
  depth 2,012; controlled isolation on stashed code proved pre-existing).
  Scans the full funding-height..tip span now, as documented. Suite:
  500 passed / 8 skipped (508), twice, reproducible.
- **Deployments:** production ripcord-wallet.vercel.app = git-based cloud build
  at `b3102f3`. Signet variant is now its own project `ripcord-signet`
  (prj_T5jJ4dXMCTMw77aaBnUzePlbebd8, static deploy of the docs-stripped build,
  ssoProtection off) at ripcord-signet.vercel.app — replaces the alias-onto-
  preview-deployment topology (which fought `vercel build`'s output-directory
  resolution; the repo-root settings assume root-scoped builds). Matrix
  re-verified: prod /docs 200 + /rpc regtest; signet /docs 404 + /signet/health
  ok + /signet/rpc signet; fix marker "VTXO credited" in both bundles.
- **Live proof (restored test wallet, clean device):** journal shows 2,454
  credited rows including the received transfer at height 1,167,861; the same
  credits previously rendered as nothing (and were labeled "Deposit #1").
- Rollback (production): `vercel alias set ripcord-wallet-fro5vuhj3-jayanngs-projects.vercel.app ripcord-wallet.vercel.app`
  is NOT valid for prod (that is a static variant build); production rollback
  remains the cutover handle below or a git revert + redeploy.

## 2026-10-15 (faucet fallback) — 403 hand-off fix, both surfaces

- **Change:** FaucetModal now falls back to the official-faucet hand-off when the
  claim POST fails. Root cause of the dead button (found by the new-user regtest
  cycle): the claim routes through the same-origin rewrite to faucet.tachibtc.com
  and that server-to-server hop hits the faucet's Cloudflare bot gate (403
  "Just a moment"); a direct cross-origin page call is CORS-blocked ("Failed to
  fetch"); a same-origin claim on the faucet site itself succeeds (verified:
  regtest payouts `5a0ce046…` and `dec642eb…`, 0.5 BTC each). On any failed
  request the modal shows the honest status plus Copy address and
  "Open the {network} faucet" (`networkConfig(network).faucetUrl`).
- **Verified live (functionally):** fresh-device journey to the modal, request
  -> "Faucet HTTP 403" + fallback panel with
  `https://faucet.tachibtc.com/regtest` link. Both surfaces serve the fix
  (marker grepped in the deployed chunks).
- **Deployments:** production ripcord-wallet.vercel.app -> deployment
  `dpl_FtuqMHn6fYKuPGz8E91UdpoCyHYD` (build `vmv9ox7k5-bmnv2r`, with /docs);
  signet variant ripcord-signet.vercel.app -> `ripcord-wallet-egppjjkkr` (build
  `vmv9p2u8p-3vrk3f`, /docs stripped, preview target). Matrix re-verified:
  prod /docs 200, signet /docs 404, /rpc `chain: regtest`, /signet/health ok.
- **Deploy flow note:** the cloud build failed with `npm error ENOTFOUND
  mirrors.tencentyun.com` — one `resolved` URL in package-lock.json pointed at
  a Tencent npm mirror unreachable from Vercel runners (the downstream
  symptom was tsc seeing a stale `@ripcord/core`); local builds passed because
  the mirror resolves here. Fixed: the lockfile URL now points at
  registry.npmjs.org (versions unchanged). The verified local output shipped
  via `--prebuilt` in the meantime (per vercel-deploy skill). The docs-stripped
  signet variant is a separate preview-target build (production-target output
  cannot deploy as preview — known --prebuilt mismatch).
- **Cloud build fully restored** (three stacked root causes, all fixed): (1) the
  Tencent mirror `resolved` URL above; (2) `outputDirectory` unset defaulted to
  `public` — now `apps/wallet/dist`; (3) routing in `apps/wallet/vercel.json`
  was invisible to the root-scoped project — root `vercel.json` is now a git
  symlink to the app's single file. Project settings: `installCommand: npm ci`,
  `buildCommand: npm run build`. Proven by a clean git-based build at `e347302`
  (production build `vmv9pzg4i-iy06ct`): /docs 200, /rpc regtest, /signet/rpc
  signet, /signet/health ok, /faucet proxy routes (403 at the faucet's own gate
  as known), SPA deep link 200.
- Rollback (production): `vercel alias set ripcord-wallet-3kq25n8cw-jayanngs-projects.vercel.app ripcord-wallet.vercel.app`
  (previous build `vmv9dvqv6-7yauy9`, the cutover build).

## 2026-10-15 (cutover) — Production upgraded to the merged build (user-approved)

- **Production:** ripcord-wallet.vercel.app -> ripcord-wallet-3kq25n8cw (build
  `vmv9dvqv6-7yauy9`, from `main` @ merge `600032d`). The pre-signet pin is
  released: production now serves network selection at create (both networks).
- **ROLLBACK (one command):** `vercel alias set ripcord-wallet-iivplkwcb-jayanngs-projects.vercel.app ripcord-wallet.vercel.app`
  (old pinned deployment, build `vmuufiwbi-gvj2e3`, Oct 5).
- Verified after cutover: /docs 200 (docs kept on production), /rpc ->
  `chain: regtest`, /signet/health 200, app shell 200. Legacy-wallet probe: a
  seeded pre-selection regtest record opens the UnlockScreen immediately
  (no setup gate, no network-choice screen) with regtest-scoped probes only —
  existing wallets are unaffected by design (`networkOf` fail-safes records
  without a stamp to regtest).
- The only user-visible change: NEW wallets get the network-choice screen first.

## 2026-10-15 (later) — Signet deployment: audit-fix line (current)

- **URL:** https://ripcord-signet.vercel.app (alias of project `ripcord-wallet`)
- **Deployment:** ripcord-wallet-p4xoiyv4l (round-8 build, 2026-10-15; supersedes
  `ripcord-wallet-me6pv7z2j` / build `vmv9a3fvm-26xpoq`)
- **`/docs` is stripped from the signet deployment** (404 there, verified): the
  standalone docs page is regtest-era product copy; the in-app Docs link on
  signet hosts points at the repo README instead. Production keeps its own
  `/docs` (200, verified) as part of the pinned pre-signet build.
- **Source:** branch `signet-support`; the deploy built from the working tree that
  became commit `8842b91` (round-6 fixes) and the final build above from the
  round-7 fix tree (see the commit that closes this entry).
- **Production:** ripcord-wallet.vercel.app deliberately PINNED to the pre-signet
  build (build id `vmuufiwbi-gvj2e3`, 2026-10-05; different bundle, zero signet
  UI strings - the vendored network-table identifiers in the SDK code remain,
  as they must). Current `main` is `18e27f8` (the earlier `9c6a065048` reference in
  the phase-3 entry is an ancestor; if production ever auto-tracks main it must
  stay pinned to the pre-signet build until the user decides otherwise).

Shipped gate (2026-10-15, against this build): `node scripts/dom-sweep.mjs` ->
GATE: PASS - journey exercised (12 words extracted, 3 challenge inputs filled,
funding screen reached), every screen sweep clean (post-selection, funding,
Wallet, Exit, Proofs, Activity, Send VTXO), zero regtest requests.

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
