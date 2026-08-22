# RIPCORD: Phase 8 Handoff

> For the next session. Read this first, then `AGENTS.md`, `docs/01-VERIFIED-API.md` **§16**
> (rewritten 23 Aug, several earlier claims were wrong), `docs/02-ARCHITECTURE.md`, and
> `docs/04-BUILD-PLAN.md`.
>
> **`04-BUILD-PLAN.md` Task 8.2 contained a factually wrong instruction.** It has been corrected in
> place (along with `02-ARCHITECTURE.md` and `03-DESIGN-SYSTEM.md`), but read §6 Task 8.2 below before
> writing a line of `verifyHatInRip` so you know *why*.

## 1. What this project is

**RIPCORD** is a self-custodial Bitcoin vault wallet on the Tachi (TAURUS) network.
Target: **OP_FREEDOM Bounty #1** (TAURUS non-custodial wallet / custody).

- Repo: `github.com/Jayanng/ripcord` (private), branch `main`
- Root on disk: `/home/ubuntu/ripcord`
- Monorepo: `packages/core` (`@ripcord/core`, the publishable library) + `apps/*` (arrives in Phase 10)
- The UI may NOT import `@tachibtc/*` directly (layering, enforced by `check:rules`)

## 2. Current state: Phases 1-8 DONE

| Phase | Delivered |
|-------|-----------|
| 1 | Workspace & monorepo foundation |
| 2 | `@ripcord/core` primitives (`types.ts`, `bytes.ts`, `errors.ts`, `health.ts`) |
| 3 | Key derivation (`keys.ts`) + quorum engine (`quorum.ts`) |
| 4 | Vault lifecycle (`vault.ts`), PoR deposit (`deposit.ts`), registration (`register.ts`) |
| 5 | Cold-start recovery (`recovery.ts`) |
| 6 | VTXO coin selection (`coinselect.ts`), single-writer queue (`queue.ts`), transfers (`payment.ts`) |
| 7 | **Real-time WSS indexer (`indexer.ts`) + persistence store (`store.ts`)** |
| 8 | **HAT/RIP fetchers + normalized Verkle inclusion (`proofs.ts`, `proofs.test.ts`, `verkle.test.ts`)** |

`packages/core/src/`: `index.ts`, `types.ts`, `bytes.ts`, `errors.ts`, `health.ts`, `keys.ts`,
`quorum.ts`, `vault.ts`, `deposit.ts`, `register.ts`, `recovery.ts`, `coinselect.ts`, `queue.ts`,
`payment.ts`, `indexer.ts`, `store.ts`, `proofs.ts`.

18 test files, all live against the real daemon (zero mocks).

## 3. Git state (as of handoff)

- Last commit: **`1ae9da4`**, "fix(core): audit round - lossless Buffer serialization + indexer reconnect/state fixes"
- Previous: `2446d54`, "feat(core): phase 7 - real-time WSS indexer + persistence store"
- Both pushed to `origin/main`. Working tree clean apart from the handoff docs.

## 4. What Phase 7 shipped, and what its audit found

### Delivered

**`src/indexer.ts`**: `VaultIndexer` wraps the SDK's `subscribeVaultEvents` (which has **no**
reconnect of its own) and adds:
- typed events: `tx:pending` (height 0), `tx:committed` (height > 0), `block:new`
- exponential-backoff auto-reconnect with full jitter, and a
  `connecting` / `connected` / `reconnecting` / `closed` status stream
- `BoundedEventQueue` that **throws `QUEUE_OVERFLOW`** past the bound instead of silently dropping
- fails fast on a filterless config (also accepts a filter carried in the URL query string)
- `mapVaultEvent` is exported as a pure function, so mapping is unit-testable without a socket

**`src/store.ts`**: `RipcordStore` contract (`getVaults`/`saveVault`/`getReceipts`/`saveReceipt`/`clear`)
with `MemoryStore` (explicit `exportSnapshot` / `fromSnapshot` reboot persistence) and
`IndexedDbStore` (browser). Public data only; no mnemonic/seed/private key ever enters a store. Store
reads and writes use defensive lossless copies, so callers cannot mutate internal vault or receipt state
through returned objects.

### Live-verified (real daemon, real transfers)

**Phase 7 audit follow-up:** the indexer now rejects stale socket callbacks after reconnect and suppresses duplicate reconnect timers. `MemoryStore` returns defensive lossless copies, preventing callers from mutating stored public state through read results.

- `block:new` fires on every committed block, ~5 s cadence under live traffic
- `tx:pending` arrived **~300 ms** after broadcast (gate asked for ~500 ms)
- `tx:committed` carried a valid positive height, strictly after pending, with the recipient's
  output present in `vout`
- auto-reconnect: dropped the socket client-side, reconnected in **807 ms**
- store snapshot round-trip preserves bigints **and Buffers** intact

### Bugs the post-Phase-7 audit found and fixed (all in `1ae9da4`)

1. **MemoryStore snapshots silently corrupted vault data.** `VaultRecord.p2tr` carries `Buffer`
   fields (P2TR `output`, control blocks, leaf hashes). `serializeJson` only handled bigint, so
   every Buffer came back as a plain `{type:'Buffer',data:[…]}` object and the restored vault was
   unspendable. Root cause is subtle: **`Buffer.toJSON()` runs BEFORE the JSON replacer**, so the
   replacer never sees a Buffer. Fixed by detecting the `toJSON` shape in the reviver plus a
   `__bytes:` prefix for plain `Uint8Array` (bitcoinjs-lib v7 output).
2. **Reconnect backoff never escalated.** `reconnectAttempt` was reset in `open()` before the
   handshake, so under sustained connect failure the delay stayed pinned at base (1 s) forever
   instead of climbing to the 30 s cap. Reset moved to the real `open` event.
3. **`isConnected` lied.** It was true once the subscription object existed, not once the socket
   opened. A caller could broadcast before the push-only stream was live and miss the pending event.
4. Receipt `txHash` case handling differed between `MemoryStore` and `IndexedDbStore`; both now
   canonicalise to lowercase.
5. Double `closed` status emission, and a misleading "closed by caller" reason on queue overflow.
6. A throwing `onError` callback could break the overflow close path. Guarded.

**Lesson to carry into Phase 8:** the original store test used a fixture with **no `p2tr`**, which is
why a data-corrupting bug passed a green suite. When you write `proofs.test.ts`, assert against
**real daemon payloads**, not hand-built objects that dodge the hard fields.

## 5. Remaining phases

Phase 8 is complete. Next is Phase 9.

| Phase | Work | Notes |
|-------|------|-------|
| 9 | Unilateral Exit & Dry-Run Engine (`exit.ts`) | a builder exists in probe form only, not committed |
| 10 | PWA Shell, Design System, Core State | `apps/wallet` scaffold |
| 11 | High-Assurance UI Components | |
| 12 | Interactive Transaction Flows | |
| 13 | Browser-Wipe Cold-Start Recovery Flow | |
| 14 | End-to-End Verification, Docs, Video Script | |

## 6. Phase 8 spec, corrected against a fresh live probe

Everything in this section was measured on **2026-08-23** against daemon v0.39.0 using three
transfers I committed for the purpose:

- `D501919DD9914D453163B36F5C89BB187E3E802C0780310A5FD1C1B97EDA0476` @ epoch **437172**
- `F5BD7D7FB0F4BDA75C6C2D46117F0EAB8D5B07403B53392520A121C9E1D4E749` @ epoch **437193**
- `FB650479B490DA680776E4F1EBA4B5700FCAD1F1DE68D180634FF35DF1E31095` @ epoch **437326**

The third one was used as a clean-room re-assertion of every claim below: **32 mechanical checks,
32 passed, 0 failed.** Full evidence is in `docs/01-VERIFIED-API.md` §16.1 to §16.6.

### Task 8.1: HAT & RIP fetchers (`src/proofs.ts` + `test/proofs.test.ts`)

```ts
// HAT
GET /tachi_tx?hash=<txHash>&hat=true
// → { vtxo_id, btc_timestamp: 0, btc_height: 0, proof: "<64-char bare lowercase hex>" }
```

- `hat.proof` is **bare hex, no `0x`**.
- `hat.vtxo_id` equals the **spent input's** VTXO id (verified on both probes).
- The hash is **case-insensitive** here; uppercase (as `waitForTachiTxCommit` returns) works.
- Unknown hash → **HTTP 404 `transaction not found`**. Map it to a real `RipcordError`, don't let a
  404 body get JSON-parsed into a bogus proof.

```ts
// RIP. BOTH params mandatory
GET /tachi_tx?hash=<txHash>&rip=true&origin_epoch=<o>&final_epoch=<f>
```

**The old "window ≤ 50" guidance is wrong and will 502 you.** The real rule: *every epoch in
`[origin_epoch, final_epoch]` must already be CLOSED.* On a just-committed tx, `origin + 50` fails
with `HTTP 502 … chain proof: epoch <N> not closed (chain gap)`. Measured sweep from 437172:
windows 0/1/2/3/5 OK; 10/25/50 → 502.

So `fetchRip` must either use **window 0** (self-proof, available the instant the tx commits) or
clamp `final_epoch` to the newest `status: "closed"` epoch from `listEpochs`. Recommendation: default
to 0, accept an optional window, and clamp it. Never hardcode 50.

The 256-epoch ceiling is a separate, looser limit
(`400 … exceeds max chain length of 256 epochs`).

**Bonus correction: the SDK wrapper is not broken.** `01-VERIFIED-API.md` used to warn that
`client.getTransaction(hash, {hat:true})` "drops the query params and returns a `hat` key with no
data". False. Reading the JS shows it forwards them; it just expects **camelCase**
`originEpoch` / `finalEpoch`. Verified live: camelCase returns the full `rip`, while snake_case
`origin_epoch` / `final_epoch` is silently dropped and the daemon answers
`400 rip=true requires origin_epoch and final_epoch`. Either transport works, so `proofs.ts` uses raw
`fetch` to stay dependency-free, but do not repeat the old "SDK is broken" warning.

### Task 8.2: Verkle linker (`verifyHatInRip`)

**Two hard corrections to the build plan. Read both.**

**(a) A strict `===` comparison ALWAYS FAILS.**

```
hat.proof                                           =   f631ef7a…13e2   (bare hex)
rip.Origin.StateDiff[0].suffixDiffs[0].currentValue = 0xf631ef7a…13e2   (0x-prefixed)
strict ===              → FALSE
normalized (strip 0x, lowercase)  → TRUE  ✅
```

`04-BUILD-PLAN.md` Task 8.2 says *"Validate `rip.Origin.StateDiff[0].suffixDiffs` contains
`currentValue === hat.proof`"*. Implemented literally, that returns `false` on every valid proof and
would ship as a permanently broken verifier that looks like it works. Normalize both sides.

**(b) The Verkle suffix is NOT 65.** Three transfers, three different suffixes:

| tx | suffix |
|---|---|
| `D501919D…0476` | **204** (`0xcc`) |
| `F5BD7D7F…E749` | **250** (`0xfa`) |
| `FB650479…1095` | **148** (`0x94`) |

What actually holds, on all three probes:

```
Buffer.from(rip.Origin.Keys[0], "base64").toString("hex")
  === stateDiff.stem.replace(/^0x/, "") + suffix.toString(16).padStart(2, "0")
```

The 32-byte Verkle key is `stem(31 bytes) || suffix(1 byte)`; the suffix is just the key's last byte
and **varies per VTXO**. Locate the diff by matching the normalized `currentValue` to `hat.proof`,
then cross-check the stem+suffix against `Origin.Keys[0]` as the structural assertion. Never assert
`suffix === 65`.

(`Origin.Keys[0]` is not `sha256(vtxo_id)` (checked, no match). Treat the key as opaque.)

### Encoding table: the sharpest trap in Phase 8

| Field | Encoding |
|---|---|
| `Origin.Root`, `Origin.Commitment`, `FinalRoot`, `Chain[i].Root` | **base64**, 44 chars → 32 bytes |
| `Origin.Keys[i]` | **base64** → 32 bytes |
| `StateDiff[].stem` | **`0x`-hex**, 31 bytes |
| `StateDiff[].suffixDiffs[].currentValue` | **`0x`-hex**, 32 bytes |
| `Proof.commitmentsByPath[]`, `Proof.d`, `ipaProof.cl/cr/finalEvaluation` | **`0x`-hex**, 32 bytes |
| `hat.proof` | **bare hex**, no `0x` |
| `rip.VTXOID`, `rip.PSBTPayload` | **JSON byte array** (`[122, 85, …]`), NOT a string |

`rip.VTXOID` decodes byte-for-byte to the spent VTXO id and to `hat.vtxo_id`. Reading it as base64 or
hex silently yields garbage. `rip.Chain` is **`null`** at window 0, an array otherwise, and
`FinalRoot === Chain[Chain.length - 1].Root` (at window 0, `FinalRoot === Origin.Root`).

### Phase 8 verification gates (revised from the plan)

The plan's original three gates assumed facts that turned out false. Use these:

1. `fetchHat(txHash)` on a **freshly committed live transfer** returns a 64-char bare-hex `proof` and
   a `vtxo_id` equal to the input VTXO the transfer actually spent.
2. `fetchHat` on an unknown hash surfaces a mapped `RipcordError`, not a parsed 404 body.
3. `fetchRip(txHash, epoch)` at **window 0** returns `Origin` with `EpochNum === tx epoch`,
   `Chain === null`, and `FinalRoot === Origin.Root`.
4. `fetchRip` with a window reaching into **unclosed** epochs surfaces a mapped error naming the
   chain gap, not an unhandled 502.
5. `fetchRip` at a window whose epochs are all closed returns `Chain.length === window` and
   `FinalRoot === Chain[last].Root`.
6. `verifyHatInRip(hat, rip)` returns **true** for a real matched pair, and **false** when handed a
   `hat.proof` from a different transfer (negative control, prove the verifier can fail).
7. The structural identity holds: `Origin.Keys[0]` (base64→hex) `=== stem || suffix`.
8. `PaymentReceipt` assembled end to end and persisted/restored through `MemoryStore` with all
   fields intact (this is where the Phase 7 Buffer bug would have bitten).

### What Phase 8 must NOT claim

- **`rip.PSBTPayload` is `null` on regtest.** The spec sentence *"Proof is the SHA256d commitment over
  the raw finalized PSBT payload"* is therefore **not locally checkable**. I confirmed the wrong turn:
  `sha256("")` and `sha256d("")` are neither equal to `hat.proof`. `proofs.ts` must **not** claim to
  recompute the HAT commitment. It proves **inclusion** of the daemon's HAT value in the daemon's
  Verkle state diff. Label it that way in code comments and in the UI.
- **No L1 anchoring.** `hat.btc_height = 0`, `hat.btc_timestamp = 0`, `rip.BTCHeight = 0`,
  `rip.BTCTimestamp = 0`, `epoch.bitcoin_block_height = null`, `hat_count: 0`. The chain is complete
  up to the Verkle root and stops there on regtest. Say so in the ProofSheet UI.
- **The IPA proof is not verified client-side.** Carry `Origin.Proof` / `ipaProof` through as evidence,
  call it "daemon-attested", and never imply local cryptographic verification of the commitment.

### Suggested `proofs.ts` surface

```ts
export interface HatProof { vtxoId: string; proof: string; btcHeight: number; btcTimestamp: number; }
export interface RipProof { originEpoch: number; finalEpoch: number; chainLength: number;
                            finalRoot: string; originRoot: string; stateDiff: RipStateDiff[];
                            keys: string[]; vtxoId: string; psbtPayloadPresent: boolean; }
export interface HatRipLink { verified: boolean; stem: string; suffix: number;
                              matchedValue: string; keyIdentityHolds: boolean; reason?: string; }

export async function fetchHat(txHash: string, opts: { baseUrl: string }): Promise<HatProof>;
export async function fetchRip(txHash: string, originEpoch: number,
                               opts: { baseUrl: string; window?: number }): Promise<RipProof>;
export function verifyHatInRip(hat: HatProof, rip: RipProof): HatRipLink;
export async function buildPaymentReceipt(...): Promise<PaymentReceipt>;
```

`PaymentReceipt` already exists in `types.ts` with `hat?` and `rip?` sub-objects
(`rip.hatInStateDiff: boolean`). Fill them; don't redefine the type.

Add `export * from './proofs.js';` to `src/index.ts`.

## 7. Verified environment facts (do NOT re-discover)

- Daemon REST: `https://rpc-regtest.tachibtc.com` · WSS: `wss://rpc-regtest.tachibtc.com/tachi_ws`
- Faucet: `POST https://faucet.tachibtc.com/api/faucet`, body `{ "address": "<bcrt1…>", "amountBtc": 0.5 }`
  Status: `GET /api/faucet-status`. As of 23 Aug it is **healthy** (`degraded: false`, ~1090 BTC
  spendable, 6 confirmed UTXOs). The Phase 7 handoff's "degraded faucet" note is stale.
- Chain id `tachi-regtest-1`, daemon v0.39.0, quorum 5-of-7.
- Node v22.23.2. SDK pin: `taurus-vault-core@0.3.3` + `taurus-wallet-aggregator@0.4.3` +
  `tachi-sdk-ts@0.2.1`. Do not bump without re-probing.
- SDK `node_modules` are hoisted to the **repo root**. A scratch script must live inside the repo
  (e.g. `scratch/`) or Node cannot resolve `@tachibtc/*`. **Delete `scratch/` before committing.**
- Epochs close ~every 5 s under live traffic; L1 Bitcoin blocks are **activity-driven** (~9,039 at
  last check), no scheduled miner.

## 8. Hard traps (carried forward, still true)

1. **User P2TR and vault P2TR are structurally identical.** `isVaultAddress` accepts both. Never gate
   recipients on it; the only correct check is `recipientAddress === vault.p2tr.address`.
2. **Change MUST go to the sender's own user P2TR.** Change to the vault address is owned by the
   vault's tweaked key and is `code=6` unspendable forever.
3. Recipients re-spend via their **own** vault (their own user key), not the sender's.
4. **`csvBlocks` must be persisted per vault** and passed to `discoverVaults`, or the rebuild silently
   defaults to 1008 and matches nothing.
5. L1 blocks are activity-driven. A csv=2 vault matures in minutes of traffic; never show a wall-clock
   countdown, show "needs N more confirmations".
6. **Vaults are atomic (one deposit each).** Use a fresh `userKeyIndex` per funded run.
7. **SDK errors carry a string `.code`** (e.g. `"VTXO_BROADCAST"`); the real CometBFT code is in
   `.tendermintCode`. `mapDaemonError` handles this.
8. **`funding_txid` from the daemon is internal byte order**; reverse at display boundaries
   (`toDisplayTxid` / `toInternalTxid`).
9. **CometBFT errors arrive inside HTTP 200**, inspect `result.code`, not the HTTP status. But note
   the proof routes **do** use real HTTP status codes (404 / 400 / 502), so `proofs.ts` must check both.
10. **Never call** `addressTransactions`, `listTransactions`, or `finalizeVtxoPsbt` on the send path.
    Enforced by `check:rules`.
11. `getAccountNonce` is **not** a replay guard (returns 0n before and after). Double-spend protection
    is VTXO state (`code=5`) plus the local `TxQueue`.
12. **New (Phase 7):** `Buffer.toJSON()` runs before a `JSON.stringify` replacer. Any new
    serialization path must go through `bytes.ts` `serializeJson`/`deserializeJson`, which now handle
    Buffer and `Uint8Array` losslessly. Do not hand-roll `JSON.stringify` on daemon payloads.
13. **New (Phase 7):** WSS `txHash` is **lowercase**; REST (`waitForTachiTxCommit`, `broadcastTachiTx`)
    returns **uppercase**. Always case-normalize before joining the two.
14. **New (Phase 7):** WSS `vout[].owner` is **not fixed width** (a 64-char x-only key and a 66-char
    compressed key appeared in the same transfer). Treat it as an opaque hex pubkey.
15. **New (Phase 2 audit, 23 Aug):** the daemon's rejection reason is **not** in a field called
    `message`. `waitForTachiTxCommit` puts it in `log`, the SDK's `VtxoBroadcastError` in
    `tendermintLog`, and the Bitcoin RPC proxy in `error.message` (with a negative `error.code`). Route
    every non-zero status through `mapDaemonError`; never construct `RipcordCode.UNKNOWN` at a call
    site, and never assume a numeric code exists (`amount mismatch` has **no numeric code** at all).
    `mapDaemonError` preserves `daemonCode` even when the code is unmapped, so a caller can tell a
    daemon rejection from a client-side failure.
16. **New (Phase 2 audit, 23 Aug):** `preflight` now returns `probeFailures[]` and `unreachable`. Do
    not read a zero as verified: `quorumSize: 0` means the quorum probe failed, and `l1Height: null`
    means the Bitcoin RPC proxy did not answer.
17. **New (Phase 3 audit, 23 Aug):** there is exactly **one** quorum fingerprint definition,
    `quorum.ts` `computeFingerprint(nodePubkeys, threshold)`. Never recompute it inline. `vault.ts`
    used to hand-roll a second one, so a created vault could never match its own quorum and the
    `VaultRecord` quorum-change check false-alarmed on every vault. The fingerprint lowercases keys
    (the daemon's hex case is not canonical) and covers the threshold (a 3-of-7 and a 5-of-7 over the
    same nodes are different vaults). Quorum keysets must also be asserted **distinct**; a repeated
    key still has length 7 but is not a real 5-of-7.
18. **New (Phase 3 audit, 23 Aug):** `deriveIdentity(mnemonic, network, index)` takes a key index, and
    it matters: vaults are atomic, so each funded run needs a fresh `userKeyIndex`. The SDK's
    `deriveUserKey` third argument is an options **object** (`{ index }`), not positional indices;
    omitting it pins everything to index 0. `getQuorumWithCache` returns a **frozen** object, so do not
    try to mutate a cached quorum.
19. **Phase 4 audit:** the SDK's `depositToVault` returns actual accounting fields (`amountSats`,
    `feeSats`, `changeSats`, `vaultAddress`, `inputs`). The RIPCORD wrapper now preserves them; it must
    never substitute `feeSats: 0n` or claim the fee is unavailable. Proof of reserves is an exact
    `scriptPubKey` comparison against the vault's P2TR output, not an address-only assertion.
    Registration validation rejects malformed txids, VTXO ids, owners, output amounts, and outpoint
    indexes before submission. The full funded registration loop remains env-gated and unproven.
20. **Phase 5 audit:** `recoverVaults` validates CSV candidates and scan bounds before daemon discovery,
    maps malformed `startIndex`, `gapLimit`, and `maxIndex` to `RipcordError(INVALID_FORMAT)`, deduplicates
    repeated CSV candidates by `vaultId`, and persists `quorumThreshold` with the recovered fingerprint.
    The daemon's listed `state`/`latestStateNum` are placeholders (`open`/`0`) on the verified build;
    lifecycle UI must rely on L1 and vault data instead.
21. **Phase 6 audit:** coin selection rejects duplicate VTXO IDs, empty IDs, and non-positive amounts.
    Queue reservations reject overlaps and deduplicate IDs. `sendTransfer` validates regtest network and
    sender ownership before VTXO reads and maps initial query errors. `onInputsSelected` is advisory;
    atomic local reservation requires `TxQueue.enqueueReserved`. Live send/re-spend and queue paths pass,
    while the full suite still has the known activity-driven L1 confirmation failure.
22. **Phase 7 audit:** indexer subscription generations reject stale socket callbacks after reconnect and
    only one reconnect timer may be scheduled at once. Queue overflow remains terminal until explicit
    close/restart. `MemoryStore` returns defensive lossless copies so callers cannot mutate stored vault or
    receipt objects through read results.

**Phase 6 implementation boundary:** `sendTransfer` does not automatically call `enqueueReserved`; callers must enqueue the complete send task or explicitly reserve selected IDs. The `onInputsSelected` callback is advisory only.

## 9. Known-failing / blocked (honest state)

- **`e2e-full-flow.test.ts` fails**: `Transaction <txid> did not confirm within timeout`. This is the
  L1 funding confirmation waiting on activity-driven regtest block production, not a code bug and not
  caused by Phase 4 or Phase 7. Full suite is therefore not an all-green gate.
- **Full registration loop remains blocked:** the repository's live suite has not completed a full
  funded deposit, onboarding, and registration path in one committed test. The `register.ts` live test
  is env-gated because it requires a real funding txid and VTXO id. Do not describe Phase 4 registration
  as fully end-to-end verified until that gate passes.
- **Cooperative refund**: structurally impossible alone (needs the 5-of-7 node keys). `cosignRefund`
  is refund-to-self only, team-confirmed.
- **Unilateral exit broadcast**: probe-proven historically, but no committed `exit.ts`. Phase 9.
- **`IndexedDbStore` is unexercised in Node** (throws a clear error when `indexedDB` is absent). Real
  browser verification lands in Phase 10.
- **Phase 8 parser audit:** `fetchRip` now fails closed if the daemon's `Chain.length` does not equal
  `finalEpoch - originEpoch`, preventing a truncated or mismatched chain from being presented as a valid
  proof.

## 10. Working principles

- **Live daemon is the only source of truth.** Probe before building. Docs are field notes; the probe
  wins, and you update the doc with the evidence.
- **Zero mocks / simulations** in `packages/` or `apps/`. Tests hit the real daemon.
- **End to end or it did not happen:** build, sign, broadcast, wait for commit, read back.
- **Gates before any commit:** full suite, `typecheck` (src + `tsconfig.test.json`), `build`,
  `npm run check:rules` (at REPO ROOT).
- **Zero-fault policy:** fix every issue immediately, never defer.
- No em dashes in prose. Regtest only; honest README.

## 11. Commands cheat-sheet

```bash
cd /home/ubuntu/ripcord
npm run check:rules                      # architecture grep gates (ROOT only)
npm run typecheck                        # workspaces (src + test)
npm run build                            # workspaces

cd packages/core
npm test                                 # full vitest suite (live daemon, ~370s)
npx vitest run test/proofs.test.ts        # single file
npx tsc --noEmit                         # src typecheck
npx tsc --noEmit -p tsconfig.test.json   # test typecheck
```

The full suite takes ~6 minutes and exceeds the 600 s foreground limit when the daemon is slow, so run
it as a background process and wait on the handle. Scratch probes must live inside the repo for
`@tachibtc/*` resolution, and must be deleted before committing.
