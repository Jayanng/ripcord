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
- The production deployment `ripcord-wallet.vercel.app` keeps serving the
  regtest default untouched; signet ships as a separate deployment variant.
- The full core suite passes green in every round (485-491 passed, 0 failed).
- The strict "signet is permanent" sweep passes on every screen at phone width:
  after the network selection, no `regtest`/`bcrt1` string appears anywhere in
  text, placeholders, tooltips, links, metadata, or the tab title.

## Faucet

The app hands off to the official faucet, it does not wrap it:

- Regtest: `https://faucet.tachibtc.com/regtest`, anonymous, 0.5 BTC per
  address per rolling 24h, chains the vault deposit automatically.
- Signet: `https://faucet.tachibtc.com/signet`, requires GitHub or X sign-in,
  caps 0.005 BTC per account per day. The wallet copies its address and the
  user claims in the faucet site; the app detects the funds and continues the
  funding pipeline automatically.

## Honest scoping

- **CSV = 2 blocks is a demo parameter.** The production Tachi default is 1008.
  Exports and the exit UI label it as such.
- **L1 anchoring fields on signet are not yet verified.** `BTCHeight` /
  `BTCTimestamp` behave as documented in `01-VERIFIED-API.md` §16.6 for regtest;
  the signet daemon build is not yet characterized for anchoring. UI copy says
  so instead of asserting.
- **Instant push is not available on static hosting.** Vercel rewrites do not
  proxy WebSocket upgrades, so the live indexer socket cannot connect on the
  deployed build. The wallet's own 5-second poller is the live channel there
  (verified: 12 daemon fetches per 16-second window) and the UI copy says
  "refreshing every few seconds" instead of alarming "paused" text.
- **Not production custody software** on either network. Do not use with funds
  that matter.

## Test matrix (plan phase 5)

The live suite is parameterized: `TACHI_TEST_NETWORK=signet npm test` runs it
against signet; the default run is regtest and is byte-identical to the
previous release's suite (491 passed, 0 failed, verified after the change).

Verified runs (2026-10-15): the regtest suite passes **490 / 0 failed / 8
skipped**; the signet suite passes **475 / 0 failed / 23 skipped** (the full
signet run showed 475/21 with the final two fixture gates landing after; both
gated tests verified green in targeted signet reruns, 11 passed / 2 skipped).

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
- Regtest production (untouched): `https://ripcord-wallet.vercel.app`

Both serve the same codebase; the difference is which network the user picks
(or the legacy default for records created before selection existed).
