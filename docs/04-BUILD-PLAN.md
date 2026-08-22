# RIPCORD: Comprehensive Phase 1 to N Build Plan

> **For Implementation:** Execute task-by-task using strict TDD, vertical tracer bullets, and zero-compromise verified signatures.
> **Source of Truth:** `/home/ubuntu/ripcord/docs/01-VERIFIED-API.md`, `/home/ubuntu/ripcord/docs/02-ARCHITECTURE.md`, `/home/ubuntu/ripcord/docs/03-DESIGN-SYSTEM.md`, and `/home/ubuntu/ripcord/DESIGN.md`.

---

## Executive Summary & Architecture Blueprint

**Product Name:** RIPCORD (Sovereign Bitcoin Vault & Custody Assurance Wallet)  
**Target:** OP_FREEDOM Bounty #1 (TAURUS Non-Custodial Wallet / Custody)  
**Deliverables:**
1. `@ripcord/core`: Standalone, zero-bloat TypeScript library published to npm wrapping all verified Tachi & Taurus mechanics with fail-safe boundaries.
2. `apps/wallet`: Sleek, dark-mode, mobile-first responsive PWA (React + Vite + Tailwind + Radix UI) with real-time WSS indexing, proof-of-reserves verification, cryptographic HAT/RIP receipts, and the signature one-click unilateral exit test-pull.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             apps/wallet                                  │
│   (React 18 + Vite + Tailwind CSS + Radix Colors + PWA Offline Shell)     │
│  - BalanceHero (On-Chain vs Off-Chain Split)  - RipcordPanel (Dry-Run)   │
│  - Tapscript Inspector & PoR Auditor          - ProofSheet (HAT / RIP)   │
│  - WhatYouDontManage (Anti-Lightning Matrix)  - Mnemonic Cold-Start UI   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ (Clean boundary: Zero direct SDK imports)
┌────────────────────────────────────▼─────────────────────────────────────┐
│                           @ripcord/core                                  │
│  - keys.ts (BIP84/BIP340 derivation, Taproot normalization)              │
│  - vault.ts (createVault, verifyVaultP2tr, describeTapscript)            │
│  - deposit.ts (depositToVault, verifyReserves via spk match)             │
│  - recovery.ts (discoverVaults with mandatory csvBlocks persistence)     │
│  - payment.ts (BIP-340 envelope transfers, change to user key)           │
│  - coinselect.ts (VTXO coin selection, localSpentAt tracking)            │
│  - queue.ts (Single-writer async transaction serialization)              │
│  - indexer.ts (Live WSS subscription: pending -> committed stream)       │
│  - proofs.ts (Raw REST HAT/RIP fetch + normalized Verkle diff match)     │
│  - exit.ts (assessExit dry-run probe + executeExit broadcast)            │
│  - bytes.ts (DisplayTxid <-> InternalTxid byte reversal, bigint JSON)   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────┐
│                 Tachi / Taurus / Bitcoin Protocol Layer                  │
│  - @tachibtc/taurus-vault-core@0.3.3                                     │
│  - @tachibtc/taurus-wallet-aggregator@0.4.3                              │
│  - @tachibtc/tachi-sdk-ts@0.2.1                                          │
│  - bitcoinjs-lib@^7.0.1                                                  │
│  - Live Daemon: https://rpc-regtest.tachibtc.com                         │
│  - WSS Stream:  wss://rpc-regtest.tachibtc.com/tachi_ws                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Master Phase Breakdown

- **Phase 1: Workspace & Monorepo Foundation**
- **Phase 2: `@ripcord/core` Foundation & Primitives**
- **Phase 3: Key Derivation & Quorum Engine**
- **Phase 4: Vault Lifecycle, PoR & Registration**
- **Phase 5: Cold-Start Recovery Engine**
- **Phase 6: Ledger VTXO Transfers & Queue**
- **Phase 7: Real-Time WSS Indexer & Activity Store**
- **Phase 8: Cryptographic Proofs & Verkle Linker**
- **Phase 9: Unilateral Exit & Dry-Run Engine**
- **Phase 10: PWA Shell, Design System & Core State**
- **Phase 11: High-Assurance UI Components**
- **Phase 12: Interactive Transaction Flows**
- **Phase 13: Browser-Wipe Cold-Start Recovery Flow**
- **Phase 14: End-to-End Verification, Documentation & Video Script**

---

## Phase 1: Workspace & Monorepo Foundation

### Task 1.1: Root Monorepo & Toolchain Config
**Objective:** Establish root package workspace, ES2022 TypeScript base config, and package manager lockfile.
**Files:**
- Create: `/home/ubuntu/ripcord/package.json`
- Create: `/home/ubuntu/ripcord/tsconfig.base.json`
- Create: `/home/ubuntu/ripcord/.gitignore`

**Implementation Specification:**
- Set `"type": "module"`, `workspaces: ["packages/*", "apps/*"]`.
- `tsconfig.base.json`: target `ES2022`, module `NodeNext`, moduleResolution `NodeNext`, strict `true`, skipLibCheck `true` (critical for TS18028 aggregator types).
- Add scripts for `build`, `test`, `lint`, and `typecheck`.

### Task 1.2: `@ripcord/core` Package Scaffold
**Objective:** Set up `@ripcord/core` package with exact public npm dependencies and dev tooling.
**Files:**
- Create: `/home/ubuntu/ripcord/packages/core/package.json`
- Create: `/home/ubuntu/ripcord/packages/core/tsconfig.json`
- Create: `/home/ubuntu/ripcord/packages/core/src/index.ts`

**Implementation Specification:**
- Dependencies pinned: `@tachibtc/taurus-vault-core@0.3.3`, `@tachibtc/taurus-wallet-aggregator@0.4.3`, `@tachibtc/tachi-sdk-ts@0.2.1`, `bitcoinjs-lib@^7.0.1`.
- DevDependencies: `vitest@^2.0.0`, `typescript@^5.5.0`.
- Verify clean install via `npm install` without registry workarounds.

### Task 1.3: Static Architectural Grep Gates
**Objective:** Add CI/lint scripts to enforce architectural constraints (R2: no unindexed scans, R3: no finalizeVtxoPsbt on send).
**Files:**
- Create: `/home/ubuntu/ripcord/scripts/check-architecture-rules.sh`
- Modify: `/home/ubuntu/ripcord/package.json`

**Implementation Specification:**
- Grep fail if `addressTransactions` or `listTransactions` appears in `packages/` or `apps/`.
- Grep fail if `@tachibtc/*` is imported inside `apps/wallet`.

### Phase 1 Verification Checklist & Expected Results
Before proceeding to Phase 2, run these commands and confirm:
1. `npm install` completes with 0 errors and creates a clean `node_modules` tree.
2. `npm run check-rules` exits with code 0 (no forbidden API calls or leaked imports).
3. `npm run typecheck` passes cleanly across workspaces with 0 TS errors.

---

## Phase 2: `@ripcord/core` Foundation & Primitives

### Task 2.1: Branded Types & Core Interfaces (TDD)
**Objective:** Create branded types to make byte-order bugs and address-type confusion unrepresentable at compile time.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/types.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/types.ts`

**Implementation Details:**
```ts
export type DisplayTxid = string & { readonly __brand: "DisplayTxid" };
export type InternalTxid = Buffer & { readonly __brand: "InternalTxid" };
export type XOnlyHex = string & { readonly __brand: "XOnlyHex" };
export type CompressedHex = string & { readonly __brand: "CompressedHex" };
export type UserAddress = string & { readonly __brand: "UserAddress" };
export type VaultAddress = string & { readonly __brand: "VaultAddress" };
```

### Task 2.2: Byte Reversal & BigInt JSON Helpers (TDD)
**Objective:** Implement bidirectional txid byte conversion and lossless BigInt serialization.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/bytes.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/bytes.ts`

**Implementation Details:**
- `toDisplayTxid(internal: InternalTxid | string | Buffer): DisplayTxid`: reverses 32-byte hash to display hex string.
- `toInternalTxid(display: DisplayTxid | string): InternalTxid`: reverses 64-char display hex to 32-byte buffer.
- `serializeJson(data: any): string`: serializes bigints to string with `"__bigint:"` prefix.
- `deserializeJson<T>(json: string): T`: round-trip restores Native BigInts.

> **REVISED 2026-08-23 (audit).** "BigInt JSON" was too narrow: `VaultRecord.p2tr` carries `Buffer`
> fields and RIP proofs carry byte arrays, so these helpers must be **byte-safe as well as
> bigint-safe**. `Buffer` and `Uint8Array` both encode to a compact `"__bytes:<base64>"` string.
>
> The trap that cost two rounds of fixes: **`Buffer.prototype.toJSON` runs BEFORE a `JSON.stringify`
> replacer**, so the replacer receives an already-flattened `{type:'Buffer',data:[…]}` object and a
> naive `instanceof Uint8Array` check never fires for a real `Buffer`. Read the pre-`toJSON` value off
> the replacer's `this[key]` holder instead. Symptoms if you get this wrong: Buffers degrade to plain
> objects (a restored vault becomes unspendable), the same bytes encode two different ways depending
> on the declared type, and payloads inflate ~50% over base64.
>
> On read, only coerce a `{type:'Buffer',data:[…]}` object when every element is a byte-range integer
> and the object has exactly those two keys; a looser check silently mangles foreign daemon payloads
> that happen to share the shape.

### Task 2.3: Error Taxonomy & Daemon Code Mapper
**Objective:** Implement `RipcordError` and structured mapper for CometBFT/daemon error codes.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/errors.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/errors.ts`

**Implementation Details:**
Map CometBFT codes (3: INVALID_SIGNATURE, 5: VTXO_ALREADY_SPENT, 6: NOT_OWNER, 8: FEE_TOO_LOW, 12: INVALID_FORMAT) and Bitcoin RPC errors (`non-BIP68-final`, `bad-txns-inputs-missingorspent`) into actionable error objects with human-readable diagnostic messages and recovery hints.

> **REVISED 2026-08-23 (audit).** The mapper must read the reason from **every field the daemon
> actually uses**, not just `message`:
>
> - `waitForTachiTxCommit` resolves `TachiTxCommitStatus` = `{ code, log, found, … }`. The reason is in
>   **`log`**; there is no `message` field at all.
> - `VtxoBroadcastError` carries **`tendermintLog`** beside `tendermintCode`.
> - The Bitcoin JSON-RPC proxy nests **`error.message`** and **`error.code`** (negative codes, which
>   cannot collide with the CometBFT map).
>
> A message-only extractor meant every text-based mapping silently never fired in production while
> passing its tests. `amount mismatch` is the worst case: docs §17 lists it with **no numeric code**, so
> text is the only signal it exists, and it was being reported as `UNKNOWN`.
>
> Also required: thread `daemonCode` through the text-based branches and the `UNKNOWN` fallback (a
> caller must be able to tell an unmapped daemon rejection from a client-side failure), and keep the raw
> daemon text in the `UNKNOWN` message rather than discarding it into `.cause`
> (`03-DESIGN-SYSTEM.md` requires it for the error details disclosure).
>
> Every non-zero commit status must go **through `mapDaemonError`**. Constructing
> `RipcordCode.UNKNOWN` directly at a call site (as `payment.ts` did) throws away the mapping and the
> recovery hint for a perfectly well-known rejection.

### Task 2.4: Daemon Preflight & Health Probe
**Objective:** Preflight check to verify connection, chain ID (`tachi-regtest-1`), validator count, and fees.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/health.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/health.ts`

**Implementation Details:**
- Call `/health` and `getLiveValidators()`.
- Assert `chainId === "tachi-regtest-1"`.
- Fetch recommended fee floor (assert ≥ 1 sat).

> **REVISED 2026-08-23 (audit).** Three additions, all from real failure-path probing:
>
> 1. **Report which probe failed and why.** The original implementation wrapped all six probes in bare
>    `catch {}`, so `daemonOk: false` was information-free: DNS failure, HTTP 500, quorum change, and
>    fee-endpoint outage were indistinguishable. Return `probeFailures: ProbeFailure[]` naming each
>    failed probe with its message, plus `unreachable: boolean` (true only when nothing answered) to
>    separate an outage from a degraded daemon.
> 2. **Assert the chain as soon as the chain id is known**, not after every probe finishes. The guard
>    used to run last, so a signet or mainnet daemon was fully interrogated (six requests, including the
>    Bitcoin RPC proxy) before being refused.
> 3. **`l1Height` is `number | null`** with an `l1HeightSource` flag. Never substitute the CometBFT
>    height (~437k) for the Bitcoin L1 height (~9k) when the proxy is down.
>
> Zero values on failure must never read as verified: `quorumSize: 0` is not a verified quorum, and
> `chainId: ''` means `getNodeInfo` failed rather than a chain mismatch.

### Phase 2 audit outcome (2026-08-23)

Phase 2 was re-audited after Phases 3 to 7 shipped, because Phase 7 found a data-corrupting bug in
`bytes.ts` that a green suite had missed. The audit probed real daemon and SDK shapes rather than
hand-built objects and found **nine defects**, seven of them silent in production:

| # | Defect | Impact |
|---|---|---|
| 1 | `mapDaemonError` read `message` only | every text-based mapping dead in production |
| 2 | `amount mismatch` unreachable (no numeric code) | reported as `UNKNOWN` |
| 3 | `tendermintLog` ignored | SDK broadcast rejections unmapped |
| 4 | Bitcoin RPC `error.{code,message}` envelope ignored | L1 failures unmapped |
| 5 | `daemonCode` dropped on text mappings and `UNKNOWN` | cannot distinguish daemon vs client failure |
| 6 | `UNKNOWN` message discarded the daemon's text | violates the design system's details requirement |
| 7 | `payment.ts` built `UNKNOWN` directly for a non-zero commit | code 5 reported as `UNKNOWN`, no hint |
| 8 | `Buffer` vs `Uint8Array` encoded differently, ~50% size blow-up | two wire formats, wasted quota |
| 9 | Reviver coerced any `{type:'Buffer',data:[…]}` object | foreign payloads silently mangled |

**Process lesson, same as Phase 7's:** the original tests only exercised shapes the author invented.
Assert against **real** daemon and SDK payloads, and always include a negative control.

### Phase 2 Verification Checklist & Expected Results
Before proceeding to Phase 3, run and verify:
1. `npm test -- packages/core/test/bytes.test.ts` passes (reversing 32-byte txid strings and buffers matches Bitcoin display order perfectly).
2. `npm test -- packages/core/test/types.test.ts` passes (branded type guards reject invalid hex lengths and cross-assignments).
3. `npm test -- packages/core/test/health.test.ts` passes against live daemon (`status: "ok"`, `chainId: "tachi-regtest-1"`, `liveValidators: 7`).

> **EXTENDED 2026-08-23 (audit).** The three gates above are necessary but were not sufficient; they
> all passed while nine defects sat in the code. Add:
>
> 4. `bytes.test.ts`: a `Buffer` and an equivalent `Uint8Array` serialize to **byte-identical** JSON,
>    a 1 KB buffer stays under ~1.5 KB of output, and a foreign `{type:'Buffer',data:['not','numbers']}`
>    object is **not** coerced into a Buffer. Round-trip a Buffer nested in arrays and objects, an empty
>    Buffer, and a top-level (holder-less) Buffer and bigint.
> 5. `errors.test.ts`: map a rejection whose reason lives only in `log` (the real
>    `TachiTxCommitStatus` shape, no `message` field), only in `tendermintLog`, and only in a nested
>    `error.message`. Assert `daemonCode` survives every path including `UNKNOWN`, that a negative RPC
>    code cannot collide with the CometBFT map, and that a mapped numeric code beats conflicting text.
> 6. `health.test.ts`: point `preflight` at an unresolvable host and assert every daemon-facing probe is
>    **named** in `probeFailures` with a non-empty reason, `unreachable` is true, and no numeric field
>    was invented (`l1Height: null`, `quorumSize: 0`, `chainId: ''`).

---

## Phase 3: Key Derivation & Quorum Engine

### Task 3.1: BIP84 & BIP340 Key Derivation (TDD)
**Objective:** Implement standard descriptor and identity derivation using exact network objects.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/keys.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/keys.ts`

**Implementation Details:**
- Call `agg.getNetwork("regtest")` (pass network object, never raw string).
- `deriveUserKey(mnemonic, netObj, accountIndex, keyIndex)`.
- Derive x-only pubkey via `publicKey.slice(2)`.
- Construct `normalizeTaprootSigner` supporting both ECDSA `sign` and Schnorr `signSchnorr`.
- Derive `UserAddress` (bech32m) from x-only pubkey: `btc.address.fromOutputScript(concat([0x51, 0x20], xOnlyBuf), network)`.

> **CORRECTED 2026-08-23 (audit).** The signature above is wrong. The real SDK call is
> **`deriveUserKey(mnemonic, network, opts?)`** where `opts` is
> `{ account?, passphrase?, change?, index? }`, not positional `accountIndex, keyIndex`. The
> implementation passed **no options at all**, so only `m/84'/1'/0'/0/0` was reachable.
>
> That contradicts the rest of the system: `VaultRecord.userKeyIndex` exists, vaults are atomic (one
> deposit each) so trap 6 requires a **fresh `userKeyIndex` per funded run**, and `recovery.ts` already
> rebuilds descriptors at arbitrary indices via `userKeyDescriptorFromWallet`. A vault recovered at
> index 3 therefore had no matching `deriveIdentity` or `makeSigner` path. `deriveIdentity` now takes
> `index = 0`, and `deriveIdentity(index)` and `makeSigner(index)` are verified to return the same key.
>
> Two error-taxonomy holes closed at the same time:
> - `deriveUserKey` / `Keystore.fromMnemonic` throw the SDK's own **`InvalidMnemonicError`** (verified
>   live for empty, non-BIP39, and bad-checksum input), which is not a `RipcordError`. A caller
>   branching on `err.code` per the error model got a foreign class. Now wrapped, cause preserved.
> - `btc.address.fromOutputScript` throws a **bare bitcoinjs `Error`** ("OP_1 <hex> has no matching
>   Address") when the x-only value is not a valid curve point. `isXOnlyHex` only checks 64 hex chars,
>   so all-ff, all-zero, and the field prime all reached it (verified live). Now wrapped as
>   `INVALID_FORMAT`, since silently minting an unspendable P2TR address is the worst outcome here.

### Task 3.2: Quorum Manager & Fingerprint Cache
**Objective:** Fetch authoritative 5-of-7 consensus quorum and compute unique fingerprint.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/quorum.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/quorum.ts`

**Implementation Details:**
- `fetchConsensusQuorum({ baseUrl })`.
- Validate threshold = 5, nodes = 7.
- Compute SHA256 quorum fingerprint over sorted `compressedHex` node keys.

> **REVISED 2026-08-23 (audit).** "SHA256 over sorted keys" is not sufficient. The fingerprint exists so
> a `VaultRecord` can **detect a quorum change** instead of silently deriving a different vault address,
> which means it must cover everything that changes the vault and must not change for anything that
> does not. Four defects, all live-proven:
>
> 1. **Not case-stable.** `isCompressedHex` accepts uppercase hex, so the same 7-node quorum returned in
>    a different case produced a completely different fingerprint and would have read as a rotation.
>    Keys are lowercased before hashing.
> 2. **The threshold was not covered.** `sha256(sorted keys)` is identical for a 3-of-7 and a 5-of-7
>    quorum over the same node set, yet the threshold changes the cooperative leaf and therefore the
>    address. `computeFingerprint(keys, threshold)` now takes it as a required argument.
> 3. **Uniqueness was never validated.** A keyset with a repeated node key still has length 7 and passes
>    every per-key format check, but the duplicated node can satisfy two of the five required
>    cooperative signatures. `assertDistinctPubkeys` rejects it, case-insensitively.
> 4. **The cache was poisonable.** `getQuorumWithCache` returned the cached object by reference, so a
>    caller could set `threshold = 1` or push an eighth key and every later consumer saw the poisoned
>    value with validation already past. Proven live before the fix. `QuorumInfo` and its key array are
>    now frozen.
>
> The preimage is domain-tagged (`ripcord/quorum/v1`) and includes the key count, so it does not rely on
> the 66-char length invariant to keep `:` unambiguous.

### Phase 3 Verification Checklist & Expected Results
Before proceeding to Phase 4, run and verify:
1. `npm test -- packages/core/test/keys.test.ts` passes (derives `m/84'/1'/0'/0/0` p2wpkh address starting with `bcrt1q...` and x-only 64-char hex).
2. Taproot signer signs 32-byte hash with Schnorr returning 64-byte Buffer verifiable with BIP-340.
3. `npm test -- packages/core/test/quorum.test.ts` passes against live daemon (returns 7 compressed node pubkeys starting with `02...` or `03...`, threshold 5, source `"consensus"`).

> **EXTENDED 2026-08-23 (audit).** All three gates above passed while six defects sat in the code. Add:
>
> 4. `deriveIdentity(m, 'regtest', N)` for N in 0,1,2,7 yields **distinct** keys on path
>    `m/84'/1'/0'/0/N`, and `makeSigner(m, 'regtest', N).publicKey` equals that index's descriptor
>    pubkey. Index 0 must be byte-identical to the pre-fix fixture (no regression).
> 5. A bad mnemonic (empty, non-BIP39, bad checksum) and an off-curve x-only key (all-ff, all-zero,
>    field prime) each surface a **`RipcordError` with `code === INVALID_FORMAT`**, not a foreign SDK or
>    bitcoinjs error class, with the original error preserved as `cause`.
> 6. `computeFingerprint` is case-stable, order-independent, **changes** when the threshold changes, and
>    is not a bare `sha256(sorted.join(':'))`.
> 7. A duplicate node key is rejected by both `assertDistinctPubkeys` and `createVault`, including a
>    case-variant duplicate.
> 8. A cached `QuorumInfo` is frozen, and an attempt to mutate `threshold` or push a key leaves the
>    cache at 5-of-7 with 7 keys.
> 9. `createVault(...).quorumFingerprint === getQuorum(...).fingerprint`, and the record persists
>    `quorumThreshold` alongside it. One canonical definition plus persisted M means a created vault is
>    actually comparable against a freshly fetched quorum, including a threshold change.

### Phase 3 audit outcome (2026-08-23)

Audited after Phase 2, using the same method: probe the real SDK and live daemon rather than re-reading
the tests. **Six defects, five silent.**

| # | Defect | Impact |
|---|---|---|
| 1 | Two different quorum fingerprint definitions (`vault.ts` hand-rolled its own) | a created vault could NEVER match its own quorum; the change check false-alarms forever |
| 2 | Fingerprint not case-stable | the same quorum reads as a rotation |
| 3 | Fingerprint did not cover the threshold | a 3-of-7 vs 5-of-7 change is invisible |
| 4 | Duplicate node keys accepted | not a real 5-of-7; one node can sign twice |
| 5 | Quorum cache mutable by reference | any caller can poison the shared 5-of-7 for everyone |
| 6 | `deriveIdentity` had no `index` | only key index 0 reachable, contradicting `userKeyIndex` and trap 6 |

Plus two error-taxonomy holes: `InvalidMnemonicError` and a bare bitcoinjs `Error` both leaked past
`RipcordError`.

**Defect 1 is the one to remember.** Both fingerprint implementations were individually reasonable and
both were tested. The bug only exists in the *relationship* between them, which no single-module test
could see. When a value is written by one module and compared by another, test the round trip.

---

## Phase 4: Vault Lifecycle, PoR & Registration

### Task 4.1: Deterministic Vault Derivation & Tapscript Disassembler (TDD)
**Objective:** Create vaults, verify P2TR output structure, and extract human-readable tapscript trees.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/vault.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/vault.ts`

**Implementation Details:**
- `createVault({ network: "regtest", nodePubkeys, csvBlocks, userKeyDescriptor })`.
- `verifyVaultP2tr(vault.p2tr)` assertion.
- `describeTapscript(script)` to return human-readable disassembled instructions for exit leaf (`OP_2 OP_NOP3 OP_DROP <userXOnly> OP_CHECKSIG`) and cooperative leaf (`<userXOnly> OP_CHECKSIGVERIFY <n1> OP_CHECKSIG <n2..n7> OP_CHECKSIGADD`).
- Assert `internalKey === NUMS_INTERNAL_KEY`.

### Task 4.2: L1 Deposit & Proof-of-Reserves Binding (TDD)
**Objective:** Fund vault from L1 BIP84 wallet and perform cryptographic Proof-of-Reserves check.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/deposit.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/deposit.ts`

**Implementation Details:**
- Wrap `WalletAggregator.fromMnemonic().addAccount({ addressType: "p2wpkh" })`.
- Call `depositToVault({ vault, userWallet, rpc, amountSats, feeRateSatVb })`.
- Preserve the SDK's returned `amountSats`, `feeSats`, `changeSats`, `vaultAddress`, and consumed `inputs`.
- `verifyDepositProofOfReserves(baseUrl, txid, expectedOutputScriptHex)`: fetch the transaction from the Bitcoin RPC proxy and match `vout.scriptPubKey.hex === vault.p2tr.output.toString("hex")`.

> **Phase 4 audit correction:** the old wrapper returned `feeSats: 0n` even though the SDK returns the actual fee. That was false accounting data and is now fixed. The reserve proof must compare the exact output script, not only the address.

### Task 4.3: Ledger Onboarding & Registration
**Objective:** Mint spendable VTXO on ledger via `TxDeposit` and bind vault via `registerVault`.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/register.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/register.ts`

**Implementation Details:**
- Build `TxDeposit` draft with `feeSats: 1n`, sign with `userSigner`, broadcast, `waitForTachiTxCommit`.
- Extract `vtxoIdFromDeposit(signed, 0)`.
- Call `registerVault` with reversed internal `fundingTxid`, input VTXO, output matching owner key, `feeSats: 1n`.
- Wait for CometBFT `code === 0` commit at `FinalizeBlock`.

### Phase 4 Verification Checklist & Expected Results
Before proceeding to Phase 5, run and verify:
1. `createVault` derives identical `bcrt1p...` taproot address across repeated runs for identical keys.
2. `verifyDepositProofOfReserves` returns `true` only when an on-chain `vout.scriptPubKey.hex` exactly matches `vault.p2tr.output`.
3. A live deposit result preserves `amountSats`, positive `feeSats`, `changeSats`, `vaultAddress`, and consumed inputs from the SDK.
4. `registerVault` completes with `code: 0` and produces a 64-char `vaultIdHex` visible in `listVaults`.

> **Phase 4 audit status:** vault creation and the deposit/reserve path are live-tested. The full
> funded onboarding plus registration path remains env-gated and is not claimed as end-to-end complete.
> The full-suite L1 confirmation timeout is environmental: regtest block production is activity-driven.

---

## Phase 5: Cold-Start Recovery Engine

### Task 5.1: Multi-CSV Discovery & Vault Reconciliation (TDD)
**Objective:** Implement bulletproof cold-start recovery from mnemonic alone, resolving redacted `csv_delay`.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/recovery.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/recovery.ts`

**Implementation Details:**
- Implement `recoverVaults(identity, quorum, knownCsvBlocks = [2, 1008])`.
- Query `discoverVaults` across candidate CSV parameters with nested `query: { baseUrl }`.
- Filter strictly for `addressMatchesRebuild === true` and `verified === true`.
- Return fully reconstituted `VaultRecord[]` including funding outpoint, balance, and tapscript trees.

### Phase 5 Verification Checklist & Expected Results
Before proceeding to Phase 6, run and verify:
1. Running recovery with only 12 words discovers the previously registered vault.
2. Rebuilt vault has `addressMatchesRebuild: true` and `verified: true`.
3. Funding outpoint is correctly parsed into display-order txid and verified with `verifyReserves`.

---

## Phase 6: Ledger VTXO Transfers & Queue

### Task 6.1: VTXO Coin Selection & Local Spent State (TDD)
**Objective:** Implement deterministic coin selection with local spent reservation.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/coinselect.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/coinselect.ts`

**Implementation Details:**
- Largest-first selection algorithm.
- Ignore VTXOs marked `localSpentAt` or `locked: true`.
- Compute exact required change, asserting `feeSats >= 1n`.

### Task 6.2: Envelope Transfer Builder & Signer (TDD)
**Objective:** Build and sign valid TachiTx transfers ensuring change and recipient address use user x-only keys.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/payment.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/payment.ts`

**Implementation Details:**
- Convert recipient x-only key to `UserAddress` (bech32m). Reject any `VaultAddress`.
- Construct PSBT with outputs mirroring envelope outputs exactly.
- Sign PSBT as user with `signVtxoPsbtAsUser`. **Do not finalize PSBT.**
- Build `TachiTxTransfer` draft, sign with BIP-340 Schnorr signature (`signTachiTx`).
- Broadcast via `tachi_txBroadcastSync`, await `waitForTachiTxCommit(hash)` for `code: 0`.

### Task 6.3: Single-Writer Transaction Queue (TDD)
**Objective:** Queue concurrent send requests to prevent VTXO collisions in non-nonce environment.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/queue.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/queue.ts`

**Implementation Details:**
- Implement FIFO `TxQueue` executing one mutation at a time.
- Mark candidate VTXOs with `localSpentAt = Date.now()` prior to broadcast; release on failure.

### Phase 6 Verification Checklist & Expected Results
Before proceeding to Phase 7, run and verify:
1. Alice sends 5,000 sats to Bob's x-only address; transfer commits at FinalizeBlock with `code: 0`.
2. Bob's ledger balance shows +5,000 sats and `owner === bobXOnly`.
3. Bob immediately sends 2,000 sats back using his own signature; transfer commits `code: 0` (re-spend proven).
4. Enqueueing two parallel transfers executes them sequentially without `code: 5 vtxo already spent` errors.

---

## Phase 7: Real-Time WSS Indexer & Activity Store

### Task 7.1: Filtered WSS Indexer Engine (TDD)
**Objective:** Connect to `wss://.../tachi_ws` with address filter, emitting pending and committed lifecycle events.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/indexer.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/indexer.ts`

**Implementation Details:**
- Connect with `?address=<UserAddress>&blocks=true`.
- Emit typed events: `tx:pending` (height=0), `tx:committed` (height>0), `block:new`.
- Auto-reconnect with exponential backoff and queue bounds.

### Task 7.2: Persistence Store Adapter (Memory & IndexedDB)
**Objective:** Cache public vault records, receipts, and VTXO balances without storing secret keys.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/store.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/store.ts`

**Implementation Details:**
- Define `RipcordStore` interface: `getVaults()`, `saveVault()`, `getReceipts()`, `saveReceipt()`, `clear()`.
- Implement `MemoryStore` for node/testing and `IndexedDbStore` for browser.

### Phase 7 Verification Checklist & Expected Results
Before proceeding to Phase 8, run and verify:
1. WSS fires `tx:pending` within 500ms of broadcast.
2. WSS fires `tx:committed` with valid block height when CometBFT finalizes the block.
3. IndexedDB/Memory store persists receipts and restores them cleanly across simulated reboots.

> **DONE, and what it taught us (2026-08-23).** All three gates passed live: `tx:pending` at ~300 ms,
> `tx:committed` with a positive height on finalize, snapshot round-trip clean. Shipped as
> `2446d54`, then audited, which found real bugs fixed in `1ae9da4`. Three findings bind later phases:
>
> - **`Buffer.toJSON()` runs BEFORE a `JSON.stringify` replacer.** `MemoryStore` snapshots were
>   silently degrading `VaultRecord.p2tr` Buffer fields (P2TR `output`, control blocks, leaf hashes)
>   into `{type:'Buffer',data:[…]}` objects, making a restored vault unspendable. `bytes.ts`
>   `serializeJson` / `deserializeJson` now handle Buffer and `Uint8Array` losslessly. **Never
>   hand-roll `JSON.stringify` on daemon payloads or vault records.**
> - **WSS `txHash` is lowercase, REST is uppercase.** Case-normalize before joining an event to its
>   receipt or proof.
> - **`vout[].owner` is not fixed width** (64-char x-only and 66-char compressed both observed in one
>   transfer). Treat it as an opaque hex pubkey.
>
> Process lesson: the original store test used a fixture with **no `p2tr`**, so a data-corrupting bug
> passed a green suite. Later phases must assert against **real daemon payloads**, not hand-built
> objects that dodge the hard fields. `QUEUE_OVERFLOW` was added to `RipcordCode` for the bounded
> event queue.

---

## Phase 8: Cryptographic Proofs & Verkle Linker

### Task 8.1: Direct REST HAT & RIP Fetchers (TDD)
**Objective:** Fetch raw HAT and RIP proofs via REST endpoints.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/proofs.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/proofs.ts`

**Implementation Details:**
- `fetchHat(txHash)`: `GET /tachi_tx?hash=<txHash>&hat=true`. Extract `vtxo_id` and the `proof`
  (bare lowercase hex, no `0x`). An unknown hash returns **HTTP 404 `transaction not found`**; map it.
- `fetchRip(txHash, originEpoch, window = 0)`:
  `GET /tachi_tx?hash=<txHash>&rip=true&origin_epoch=<o>&final_epoch=<o+window>`.
  Extract `Origin.Proof`, `Origin.StateDiff`, `Origin.Keys`, `Origin.Root`, and `FinalRoot`.

> **CORRECTED 2026-08-23 (live probe against three committed transfers; see `01-VERIFIED-API.md`
> §16.3).** An earlier version of this plan used `window = 50`. That **502s** on a freshly committed tx:
> every epoch in `[origin_epoch, final_epoch]` must already be CLOSED, or the daemon answers
> `502 … chain proof: epoch <N> not closed (chain gap)`. Measured: windows 0/1/2/3/5 succeed,
> 10/25/50 fail. Default to **window 0** (self-proof, always available at commit) or clamp
> `final_epoch` to the newest `status: "closed"` epoch from `listEpochs`. The 256-epoch cap is a
> separate, looser limit. `Chain` is `null` at window 0.
>
> Note the SDK wrapper is **not** broken (the old claim was wrong): `client.getTransaction(hash,
> { rip: true, originEpoch, finalEpoch })` works, it just needs **camelCase** option names. Raw `fetch`
> is still preferred here to keep `proofs.ts` dependency-free.

### Task 8.2: Verkle Inclusion Verification Linker (TDD)
**Objective:** Link the HAT proof to the RIP Verkle state diff.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/verkle.test.ts`
- Modify: `/home/ubuntu/ripcord/packages/core/src/proofs.ts`

**Implementation Details:**
- `verifyHatInRip(hat, rip)`: find a `rip.Origin.StateDiff[].suffixDiffs[]` entry whose
  `currentValue` matches `hat.proof` **after normalization**, and cross-check the Verkle key identity.
- Package into a verified `PaymentReceipt` (the type already exists in `types.ts`) with the full
  audit trail.

> **TWO CORRECTIONS, 2026-08-23 (live probe, see `01-VERIFIED-API.md` §16.5).** The earlier version of
> this task was factually wrong on both counts and would have shipped a permanently-false verifier.
>
> **1. `currentValue === hat.proof` ALWAYS FAILS.** `currentValue` is `0x`-prefixed hex;
> `hat.proof` is bare hex. Strict equality is `false` on every valid proof. Strip `0x` and lowercase
> both sides before comparing.
>
> **2. The suffix is NOT the constant 65.** Measured 204 (`0xcc`), 250 (`0xfa`), and 148 (`0x94`) on
> three real transfers. The 32-byte Verkle key is `stem(31 bytes) || suffix(1 byte)`, so the suffix is
> just the key's last byte and varies per VTXO. The identity that holds is
> `Buffer.from(Origin.Keys[0], "base64").toString("hex") === stem_hex + suffixByteHex`.
> Locate the diff by the normalized value match; assert the key identity structurally. **Never assert
> `suffix === 65`.**
>
> **Scope limit:** `rip.PSBTPayload` is `null` on regtest, so the HAT commitment **cannot** be
> recomputed locally. This is an **inclusion** proof of the daemon's HAT value in the daemon's Verkle
> diff, not a recomputation, and the IPA proof is carried as daemon-attested evidence rather than
> verified client-side. Label both honestly in code and UI.

### Phase 8 Verification Checklist & Expected Results
Before proceeding to Phase 9, run and verify (revised 23 Aug; the original three gates assumed
facts the live probe disproved; the authoritative list is `06-HANDOFF-PHASE8.md` §6):
1. `fetchHat` on a freshly committed live transfer returns a 64-char bare-hex `proof` and a
   `vtxo_id` equal to the input VTXO that transfer actually spent.
2. `fetchHat` on an unknown hash surfaces a mapped `RipcordError` (404), not a parsed 404 body.
3. `fetchRip(txHash, epoch)` at window 0 returns `Origin.EpochNum === tx epoch`, `Chain === null`,
   and `FinalRoot === Origin.Root`.
4. A window reaching unclosed epochs surfaces a mapped chain-gap error, not an unhandled 502.
5. A fully-closed window returns `Chain.length === window` and `FinalRoot === Chain[last].Root`.
6. `verifyHatInRip` returns `true` for a real matched pair and `false` for a `hat.proof` taken from a
   different transfer (negative control: prove the verifier can fail).
7. `Origin.Keys[0]` (base64 → hex) equals `stem || suffix`.
8. The assembled `PaymentReceipt` survives a `MemoryStore` snapshot round-trip with every field
   intact.

---

## Phase 9: Unilateral Exit & Dry-Run Engine

### Task 9.1: Exit Builder & BIP68 Maturity Inspector (TDD)
**Objective:** Construct valid unilateral exit PSBTs and inspect L1 confirmation maturity.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/exit.test.ts`
- Create: `/home/ubuntu/ripcord/packages/core/src/exit.ts`

**Implementation Details:**
- `buildUnilateralExitPsbt` with display-order `txid`, `scriptPubKey`, SegWit payout address, `feeSats`.
- Verify with `expectedUserKey` and `minCsvBlocks`.
- Sign with `signUnilateralExitPsbtAsUser`, finalize to raw buffer.
- Query Bitcoin RPC proxy for funding outpoint confirmations against `vault.csvBlocks`.

### Task 9.2: Test-Pull Dry-Run & Broadcast Orchestrator
**Objective:** Provide safe, zero-cost exit verification and real broadcast execution.
**Files:**
- Test: `/home/ubuntu/ripcord/packages/core/test/exit-run.test.ts`
- Modify: `/home/ubuntu/ripcord/packages/core/src/exit.ts`

**Implementation Details:**
- `assessExit(vault, identity)`: Full build -> verify -> sign -> finalize -> decode -> test against BIP68. Return `status: "live" | "maturing"` without broadcasting.
- `executeExit(vault, identity, signer, destAddress)`: Finalize and execute `sendrawtransaction` to Bitcoin L1. Return `DisplayTxid`.

### Phase 9 Verification Checklist & Expected Results
Before proceeding to Phase 10, run and verify:
1. `assessExit` on a 1-conf vault returns `status: "maturing"` and reports `non-BIP68-final` reason without moving funds.
2. `assessExit` on a 2-conf vault returns `status: "live"` with decoded tx details (vsize 125, nSequence 2).
3. Real `executeExit` broadcasts to Bitcoin regtest, returning an L1 txid queryable via `getrawtransaction`.

---

## Phase 10: PWA Shell, Design System & Core State

### Task 10.1: Vite + React + Tailwind + PWA Manifest Setup
**Objective:** Scaffold mobile-first web app with Radix dark color tokens and offline manifest.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/package.json`
- Create: `/home/ubuntu/ripcord/apps/wallet/vite.config.ts`
- Create: `/home/ubuntu/ripcord/apps/wallet/tailwind.config.js`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/styles/tokens.css`
- Create: `/home/ubuntu/ripcord/apps/wallet/public/manifest.webmanifest`

**Implementation Details:**
- Configure Tailwind with Radix Colors dark theme tokens matching `DESIGN.md` (Neutral `#111111`, Primary `#EEEEEE`, Tertiary/Ripcord `#8E2428`, Confirmed `#115E59`, Pending `#FFC53D`).
- Set viewport `viewport-fit=cover`, mobile touch optimizations.

### Task 10.2: Wallet Provider & Core React Hooks
**Objective:** Provide clean React context wrapping `@ripcord/core` client, keystore, and indexer.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/context/WalletContext.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/hooks/useBalance.ts`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/hooks/useVaults.ts`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/hooks/useRipcord.ts`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/hooks/useActivity.ts`

### Phase 10 Verification Checklist & Expected Results
Before proceeding to Phase 11, run and verify:
1. `npm run dev --workspace=apps/wallet` starts local dev server cleanly.
2. Browser renders dark instrument-panel UI with persistent `REGTEST` badge.
3. Lighthouse / DevTools audit confirms valid PWA manifest and mobile viewport configuration.

---

## Phase 11: High-Assurance UI Components

### Task 11.1: Navigation, NetworkBadge & App Layout
**Objective:** Build persistent header with non-dismissible `REGTEST` badge and responsive navigation.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/Header.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/NetworkBadge.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/TabBar.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/Layout.tsx`

### Task 11.2: BalanceHero Component (Two-Balance Display)
**Objective:** Render on-chain vault reserves and spendable off-chain VTXO balances with separate proof badges.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/BalanceHero.tsx`

### Task 11.3: RipcordPanel & Exit Test-Pull Component
**Objective:** Build signature Ripcord control surface with LIVE/MATURING state indicator, test-pull trigger, and hold-to-confirm broadcast button.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/RipcordPanel.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/HoldToConfirmButton.tsx`

### Task 11.4: WhatYouDontManage Component (Anti-Lightning Matrix)
**Objective:** Highlight sovereign TAURUS advantages (no channels, no inbound liquidity, no force closes).
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/WhatYouDontManage.tsx`

### Task 11.5: Tapscript Inspector & PoR Auditor Modal
**Objective:** Provide transparent cryptographic inspection of vault leaves, NUMS internal key, and L1 scriptPubKey matching.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/TapscriptInspector.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/ProofOfReservesBadge.tsx`

### Task 11.6: ActivityFeed & ProofSheet (HAT / RIP Visualizer)
**Objective:** Render real-time transaction history with interactive Verkle/HAT cryptographic receipt inspector.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/ActivityFeed.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/ActivityRow.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/ProofSheet.tsx`

### Phase 11 Verification Checklist & Expected Results
Before proceeding to Phase 12, run and verify:
1. `BalanceHero` clearly displays On-Chain vs Off-Chain sats as two distinct numbers (never summed).
2. Clicking "Test-Pull Ripcord" reveals built exit PSBT, vsize, and CSV status without broadcasting.
3. `ProofSheet` renders the 4-tier cryptographic ladder: Tx -> HAT -> Verkle StateDiff -> RIP FinalRoot.
4. UI passes WCAG AA contrast on all elements.

---

## Phase 12: Interactive Transaction Flows

### Task 12.1: Vault Creation & Faucet Onboarding Screen
**Objective:** Guide user through vault derivation, tapscript verification, faucet funding, and ledger onboarding.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/screens/OnboardingScreen.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/FaucetModal.tsx`

### Task 12.2: SendSheet Flow (VTXO Transfer)
**Objective:** Form to send VTXO sats to user x-only addresses with input validation and instant WSS optimistic feedback.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/screens/SendScreen.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/SendForm.tsx`

### Task 12.3: ReceiveSheet Flow (QR & Address Generator)
**Objective:** Generate bech32m user-key payment addresses with QR code and active WSS listening indicator.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/screens/ReceiveScreen.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/QrCode.tsx`

### Phase 12 Verification Checklist & Expected Results
Before proceeding to Phase 13, run and verify:
1. User can create vault, copy address, request faucet funds, and onboard to ledger in under 60 seconds.
2. Sending sats to another address shows immediate amber "pending" row that turns jade "confirmed" on block commit.
3. Entering a vault address in SendSheet triggers an immediate error explaining R1 (user keys only).

---

## Phase 13: Browser-Wipe Cold-Start Recovery Flow

### Task 13.1: Cold-Start Recovery Screen & Execution Stepper
**Objective:** Enable full state recovery from 12 words with animated live audit progress stepper.
**Files:**
- Create: `/home/ubuntu/ripcord/apps/wallet/src/screens/RecoveryScreen.tsx`
- Create: `/home/ubuntu/ripcord/apps/wallet/src/components/RecoveryProgress.tsx`

**Flow Steps Displayed Live:**
1. Derive BIP84/BIP340 identity keys
2. Fetch authoritative 5-of-7 consensus quorum
3. Scan for on-chain vaults across candidate CSV parameters
4. Validate `addressMatchesRebuild === true`
5. Verify Proof-of-Reserves on L1 via scriptPubKey match
6. Reconnect WSS indexer and restore receipts

### Phase 13 Verification Checklist & Expected Results
Before proceeding to Phase 14, run and verify:
1. Clear browser localStorage and IndexedDB completely.
2. Enter the 12-word recovery mnemonic.
3. All 6 audit checkmarks light up green in sequence.
4. Vaults, balances, and spendable VTXOs are 100% restored with zero prior state.

---

## Phase 14: End-to-End Verification, Documentation & Video Script

### Task 14.1: Playwright E2E Integration Suite
**Objective:** Automate full user journey tests against live daemon.
**Files:**
- Create: `/home/ubuntu/ripcord/e2e/wallet.spec.ts`
- Create: `/home/ubuntu/ripcord/e2e/recovery.spec.ts`

**Test Cases:**
1. Generate new wallet -> create vault -> faucet fund -> onboard -> verify balances.
2. Send VTXO payment -> verify WSS pending then committed state.
3. Test-pull exit dry run -> verify non-BIP68-final / live status.
4. Wipe browser storage entirely -> input 12 words -> assert 100% state & balance restored.

### Task 14.2: Comprehensive Root README & Submission Dossier
**Objective:** Author technical README documenting all verified findings, real on-chain hashes, and architectural truths.
**Files:**
- Create: `/home/ubuntu/ripcord/README.md`
- Create: `/home/ubuntu/ripcord/docs/SUBMISSION.md`

### Task 14.3: Demo Video Script & Submission Guide
**Objective:** Write step-by-step 3-minute video presentation script demonstrating the golden path.
**Files:**
- Create: `/home/ubuntu/ripcord/docs/DEMO-SCRIPT.md`

### Phase 14 Verification Checklist & Expected Results
Final sign-off before submission:
1. `npm test` passes 100% of unit and integration tests across `@ripcord/core`.
2. `npx playwright test` runs all E2E specs green against live regtest.
3. `npm run build` compiles clean bundles for both package and web app.
4. README clearly states all verified txids, architecture invariants, and honest regtest scope.

---

## Execution Handoff & Next Steps

Plan complete and saved to `/home/ubuntu/ripcord/docs/04-BUILD-PLAN.md`.
All phases now include explicit testing commands, verification criteria, and expected results.

Ready to begin Phase 1 execution. Shall I start?
