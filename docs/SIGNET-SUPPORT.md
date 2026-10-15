# Signet Support

RIPCORD runs on two Tachi networks, chosen by the user before any key material
exists:

- **Tachi regtest** (default, unchanged): the original private network. `bcrt1`
  addresses, anonymous faucet, root-path RPC proxy. Every behavior here is
  byte-identical to the pre-signet build.
- **Tachi signet** (the second layer): Bitcoin's public signet-backed Tachi
  chain. `tb1` addresses (Tachi SDK encoding: `networks.testnet`, HRP `tb`,
  coin type 1), sign-in faucet, `/signet`-prefixed RPC proxy.

A wallet is bound to the network it was created on. The choice is stamped on the
identity and on every vault record; legacy records without a stamp are regtest.

## What is verified live (2026-10-15)

The full money path ran end to end on Tachi signet, every hop checked against
the node and the daemon. Test identity and addresses below are throwaway
signet-only values.

| Hop | Evidence |
|---|---|
| Faucet claim | `8cadec9aa429a33cf1715b3b78ee1038f50620f2f3caa006c6e57a7d562c428d`, block 326353, 0.005 BTC to `tb1q3g08…7fw7` (the first claim `ef801d59d1a2…bfd206`, block 326349, went to an earlier test wallet `tb1qdg5w…` and is not part of this path) |
| Vault deposit | `5e9c37d3d3a2a305450794e3d8fa9c93c84d546389c5b433fc9fb424b793660a`, block 326357: 40,000 sats to vault `tb1pl27eysxxku…mpdq7tl3xc`, 459,718 change, 282 fee |
| Vault ID | `6c2961d8bf22df3f03543b2ede4c2adbe991def3531b129966b0379d360bb04c`, equals `deriveVaultIdFromOutpoint(funding_txid, 0)` |
| Mint | 39,998 sats, 1 VTXO (40,000 minus the 1-2 sat protocol fee line) |
| Registration | live 5-of-7 quorum on `tachi-signet-1` (5-of-7 is also live-verified on regtest) |
| Off-chain transfer | `daa56b5320845db095945436ff1094123b80c3a67c6e0b800eb8139798fcc7ac`, epoch 1223756, `state: committed`, 10,000 out + 29,997 change + 1 fee, HAT proof present in the daemon record |
| Second transfer | 5,000 sats to the same receiver (daemon shows both VTXOs: `a3da62f6…` 10,000 and `6d9f6e01…` 5,000, both unspent) |
| Sovereign exit | `1c04bec43a43082d67fcb4b557841c3d86b794ec19cb842702d893c7dc4eaed0`: dry-run txid matched the broadcast txid exactly (deterministic signing), sole input `5e9c37d3…:0` with nSequence 2, 39,800 sats to `tb1q3g08…7fw7`, 200 fee, witness = [signature, exit leaf `52b27520…`, control block `c15092…`] proving the leaf inside the on-chain vault address |

Regtest invariance (the hard constraint) is proven, not promised:

- Same phrase derives the same frozen regtest addresses byte-for-byte before and
  after every change (checked independently three times; the settlement value is
  `bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk`).
- Since the 2026-10-15 cutover the production deployment
  `ripcord-wallet.vercel.app` serves the network-selection build (both
  networks; the user picks at create) and `ripcord-signet.vercel.app` remains
  as the signet-only variant. Regtest DERIVATION and behavior are untouched
  (byte-identical suite invariance).
- The full core suite passes green (regtest reproduces exactly: 490 / 8
  skipped / 0 failed. The signet run is 450 / 48 skipped / 0 failed when the
  shared public node is quiet; when other users hold its one-at-a-time
  scantxoutset lock, 1-2 tests historically flaked red on 'Scan already in
  progress' - since round 8 the affected calls ride that condition out with a
  bounded busy-retry, and every affected test passes in isolation).
- The strict "signet is permanent" rule is enforced by two automated gates in
  `scripts/dom-sweep.mjs`: (1) a DOM sweep (text, placeholders, tooltips, links,
  metadata, tab title) that fails on any `regtest`/`bcrt1` string after the
  network selection, and (2) a request-stream audit that fails on any
  regtest-targeted request in a signet journey and refuses hollow passes. The
  request-stream half is deterministic; the DOM-walk half needs a fresh browser
  profile per run (shared profiles carry locked-wallet state that stalls the
  scripted journey).

## Faucet

The app hands off to the official faucet, it does not wrap it:

- Regtest: `https://faucet.tachibtc.com/regtest`, anonymous, 0.5 BTC per
  address per rolling 24h, chains the vault deposit automatically.
- Signet: `https://faucet.tachibtc.com/signet`, requires GitHub or X sign-in,
  caps 0.005 BTC per account per day. The wallet copies its address and the
  the user claims in the faucet site, then taps "Check and register deposit"
  once in the app; from that tap the funding pipeline (deposit, confirmations,
  mint, registration) runs automatically to completion.

## Honest scoping

- **CSV = 2 blocks is a demo parameter.** The production Tachi default is 1008.
  Exports and the exit UI label it as such.
- **L1 anchoring fields on signet are not yet verified.** `BTCHeight` /
  `BTCTimestamp` behave as documented in `01-VERIFIED-API.md` §16.6 for regtest;
  the signet daemon build is not yet characterized for anchoring. UI copy says
  so instead of asserting.
- **Proxy rules are mirrored for every path the app uses** (verified live on
  both deployed domains: `/rpc`, `/signet/rpc`, `/signet/health`,
  `/signet/tachi_*`, `/faucet/*` behave identically in dev and production).
  Unused edge shapes (some trailing-slash variants) differ between the Vite
  and Vercel matchers and are documented as drift, not relied on.
- **Instant push rides the daemon's own WebSocket, and it wobbles.** The
  indexer socket connects directly (cross-origin) to the daemon's
  `/tachi_ws` endpoint - static hosting does not block it - and streams when
  the daemon's WebSocket is up. When it is not (observed both ways in live
  probes), the wallet's own 5-second poller is the guaranteed channel. The UI
  copy reflects the live state: "connected" when the socket is up,
  "polling every few seconds" when it is not - never alarming "paused" text.
- **Not production custody software** on either network. Do not use with funds
  that matter.

## Test matrix (plan phase 5)

The live suite is parameterized: `TACHI_TEST_NETWORK=signet npm test` runs it
against signet; the default run is regtest and is byte-identical to the
previous release's suite (490 passed / 8 skipped / 0 failed, verified after the change).

Verified runs (2026-10-15, final): regtest **490 passed / 8 skipped / 0 failed**
and signet **450 passed / 48 skipped / 0 failed**. Skips are named (regtest
chain-state fixtures, sign-in-faucet money gates, fixture economics) and the
fixture-economics skips print their reason in the run output; `skipIf` skips
appear as counts in the summary. These numbers supersede any earlier count in
older docs.

- **Regtest run**: the full suite, including the frozen-constant tests (they
  pin the regtest invariance: fixed derivation values, fixture vault addresses,
  seed proof artifacts) and the live money-path tests (fixtures self-heal via
  the anonymous faucet).
- **Signet run**: all derivation, validation, pure-logic and daemon tests run
  green against the live signet daemon. Per-network frozen constants are
  cross-checked against the Tachi SDK's own derivation. Regtest-constant and
  regtest-chain-state tests skip with an explicit reason. Live-money tests
  (deposit 40k, assessRefund on a live deposit, assessExit on a live deposit,
  SDK-scan routing) require pre-funded fixtures because the signet faucet needs
  human sign-in: they run only with `TACHI_SIGNET_FUNDED=1` and otherwise skip
  with the fixture note. Their signet behavior is evidenced live in this
  document's money-path table.

## Deployed variant

- Signet-capable build (network selection at create): `https://ripcord-signet.vercel.app`
- Unified production (network selection at create, both networks): `https://ripcord-wallet.vercel.app`

Both deployments now serve the network-selection build (production cut over
2026-10-15 on the user's approval; the signet-only variant remains for
signet-only links). Existing wallets are unaffected by design: records without
a network stamp fail-safe to regtest (`networkOf`), verified live with a
seeded legacy record opening straight to the unlock screen. Rollback is one
alias swap to the pinned pre-signet deployment (see docs/DEPLOY-LOG.md).
