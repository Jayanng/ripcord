# RIPCORD: Architecture

> Read `01-VERIFIED-API.md` first. Every capability referenced here was executed live.

## 1. What we are building

A production-grade self-custodial Bitcoin wallet on Tachi where the user can **prove their money is
there** and **prove their escape hatch works before they need it**.

Target: OP_FREEDOM Bounty #1 (TAURUS Non-Custodial Wallet / Custody). All four required bullets are
verified working; the optional SatVM bullet is verifiably unavailable on the public daemon.

| Requirement | How | Verified by |
|---|---|---|
| TAURUS vault creation and management | `createVault` + `verifyVaultP2tr` + `registerVault` + `discoverVaults` | vaultId `0d4e138c…`, deterministic re-derivation |
| Smooth off-chain sending and receiving via VTXOs | TachiTx envelope path + filtered WSS | committed epoch 416525 / 417568; recipient re-spent 416527 / 417570 |
| Clear on-chain vs off-chain balance | `gettxout` on funding outpoints vs `getAddress` ledger balance | 40,000 on-chain / 0 off-chain observed simultaneously |
| Unilateral exit with timelock status | build → verify → sign → finalize → broadcast, plus dry-run maturity probe | L1 txids `99974a15…` and `e4840102…` |

## 2. Non-negotiable design rules

These come from failures we actually hit. Each is enforced in code, not left to discipline.

| # | Rule | Enforcement |
|---|---|---|
| R1 | Change and payments go to a **user key** address, never a vault address | `buildPayment()` takes only x-only keys and derives addresses itself; vault addresses are a distinct branded type that cannot be passed |
| R2 | **Never** call `addressTransactions` / `listTransactions` | lint rule + CI grep gate; `@ripcord/core` exposes no such method |
| R3 | **Never** call `finalizeVtxoPsbt` on the send path | not re-exported from `@ripcord/core`; CI grep gate |
| R4 | Byte order converted **once**, at the boundary | branded `DisplayTxid` / `InternalTxid` types; conversion only in `bytes.ts` |
| R5 | `csvBlocks` persisted per vault and always passed to `discoverVaults` | part of the `VaultRecord` schema; recovery throws if absent |
| R6 | Fee floor 1 sat, never 0 | `MIN_FEE_SATS = 1n` constant, asserted in every builder |
| R7 | One deposit per vault | `createVault` bumps `userKeyIndex`; deposit refuses a funded vault |
| R8 | Sends are **serialised**, never concurrent | single-writer async queue in `TxQueue`; nonce is not a guard |
| R9 | `code === 0` at `FinalizeBlock` is the only success | `waitForCommit()` is mandatory in every mutating path |
| R10 | CSV maturity shown as confirmations, never a timer | UI has no countdown component for exits |
| R11 | Local state is a **cache**, never authoritative | cold-start test wipes IndexedDB in CI |
| R12 | Every bigint crosses the wire as a string | `serialize()` / `deserialize()` in `json.ts` |

## 3. Repository layout

```
ripcord/
├── package.json                  # npm workspaces root
├── tsconfig.base.json
├── .github/workflows/ci.yml
├── docs/
│   ├── 01-VERIFIED-API.md
│   ├── 02-ARCHITECTURE.md
│   ├── 03-DESIGN-SYSTEM.md
│   └── 04-BUILD-PLAN.md
├── packages/
│   └── core/                     # @ripcord/core - publishable
│       ├── src/
│       │   ├── index.ts
│       │   ├── config.ts         # network config, endpoints, constants
│       │   ├── types.ts          # branded types, VaultRecord, Vtxo, …
│       │   ├── errors.ts         # RipcordError hierarchy + daemon code map
│       │   ├── bytes.ts          # byte order, bigint JSON, toBuf/bytesEqual
│       │   ├── keys.ts           # derivation, signer construction
│       │   ├── quorum.ts         # fetchConsensusQuorum wrapper + cache
│       │   ├── vault.ts          # create, verify, describe, register
│       │   ├── deposit.ts        # L1 deposit + onboarding
│       │   ├── recovery.ts       # discoverVaults with csvBlocks handling
│       │   ├── ledger.ts         # reads: balances, vtxos, nonce, fees
│       │   ├── payment.ts        # transfer build/sign/broadcast
│       │   ├── coinselect.ts     # VTXO selection + local spent tracking
│       │   ├── queue.ts          # single-writer send queue
│       │   ├── indexer.ts        # WSS subscription → local store
│       │   ├── store.ts          # persistence interface + memory impl
│       │   ├── proofs.ts         # HAT/RIP fetch + HAT⊂RIP verification
│       │   ├── exit.ts           # unilateral exit + dry-run
│       │   ├── refund.ts         # cooperative refund (secondary)
│       │   ├── watchtower.ts     # status + receipts
│       │   └── health.ts         # daemon/quorum preflight
│       └── test/
├── apps/
│   └── wallet/                   # Vite + React + TS PWA
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── store/            # IndexedDB adapter for @ripcord/core
│       │   ├── hooks/
│       │   ├── screens/
│       │   ├── components/
│       │   └── styles/
│       ├── public/manifest.webmanifest
│       └── index.html
└── e2e/                          # Playwright specs
```

## 4. Layering

```
┌─────────────────────────────────────────────────────────┐
│ apps/wallet  - React PWA. No SDK imports. No fetch.     │
├─────────────────────────────────────────────────────────┤
│ @ripcord/core - the only place Tachi SDKs are imported  │
├─────────────────────────────────────────────────────────┤
│ @tachibtc/{taurus-vault-core, wallet-aggregator, sdk-ts}│
├─────────────────────────────────────────────────────────┤
│ tachid REST + WSS  |  Bitcoin JSON-RPC proxy            │
└─────────────────────────────────────────────────────────┘
```

Dependency flow is one way. The wallet never imports a `@tachibtc/*` package directly. CI enforces it
with a grep gate. This is what makes the core publishable and the UI testable with a fake store.

## 5. Domain model

```ts
// Branded primitives: make the byte-order and address-kind traps unrepresentable.
type DisplayTxid  = string & { readonly __brand: "DisplayTxid" };
type InternalTxid = Buffer & { readonly __brand: "InternalTxid" };
type XOnlyHex     = string & { readonly __brand: "XOnlyHex" };      // 64 chars
type CompressedHex= string & { readonly __brand: "CompressedHex" }; // 66 chars
type UserAddress  = string & { readonly __brand: "UserAddress" };   // bech32m of a USER key
type VaultAddress = string & { readonly __brand: "VaultAddress" };  // bech32m of a VAULT key

interface VaultRecord {
  vaultIdHex: string;
  address: VaultAddress;
  csvBlocks: number;              // R5: required for recovery
  userKeyIndex: number;
  userKeyDescriptor: UserKeyDescriptor;
  quorumFingerprint: string;      // sha256 of sorted nodePubkeys
  funding?: { txid: DisplayTxid; vout: number; valueSats: bigint };
  registered: boolean;
  registrationTxHash?: string;
  createdAt: number;
}

interface LedgerVtxo {
  id: string;
  ownerXOnly: XOnlyHex;
  amountSats: bigint;
  height: number;
  spent: boolean;
  locked: boolean;
  vaultAddress?: VaultAddress;
  localSpentAt?: number;          // R8: set optimistically on broadcast
}

interface BalanceSnapshot {
  onChainSats: bigint;            // Σ unspent vault funding UTXOs
  offChainSats: bigint;           // ledger balance
  vtxoCount: number;
  pendingIncomingSats: bigint;    // WSS state:"pending" not yet committed
  asOfHeight: number;
}

interface ExitReadiness {
  status: "live" | "maturing" | "unfunded" | "spent";
  confirmations: number;
  requiredConfirmations: number;  // vault.csvBlocks
  confirmationsRemaining: number;
  dryRun?: { txid: DisplayTxid; vsize: number; sequence: number; rawHex: string };
  reason?: string;                // e.g. "non-BIP68-final"
}

interface PaymentReceipt {
  txHash: string;
  epoch: number;
  code: number;
  fromXOnly: XOnlyHex;
  toXOnly: XOnlyHex;
  amountSats: bigint;
  feeSats: bigint;
  hat?: { vtxoId: string; proof: string; btcHeight: number };
  rip?: { originEpoch: number; finalEpoch: number; chainLength: number;
          finalRoot: string; hatInStateDiff: boolean };
}
```

## 6. Core module contracts

### health.ts: preflight
```ts
preflight(cfg): Promise<{
  daemonOk: boolean; chainId: string; version: string; synced: boolean;
  liveValidators: number; quorumThreshold: number; quorumSize: number;
  l1Height: number; feeRecommendedSats: bigint;
}>
```
Runs on app boot. Asserts `chainId === "tachi-regtest-1"` and refuses to proceed on mismatch, so a
signet URL can never silently talk to a regtest wallet.

### quorum.ts
```ts
getQuorum(cfg): Promise<{ nodePubkeys: CompressedHex[]; threshold: number; fingerprint: string }>
```
Cached for the session. `fingerprint` is stored on every `VaultRecord` so a quorum change is detectable
rather than producing a silently different address.

### keys.ts
```ts
deriveIdentity(mnemonic, network): Identity              // descriptor + xOnly + userAddress
makeSigner(mnemonic, network, index): TaprootSigner
userAddressFor(xOnly, network): UserAddress              // bech32m of the user key (R1)
```

### vault.ts
```ts
createVault(id: Identity, q: Quorum, csvBlocks: number, index: number): Promise<VaultRecord>
describeVault(rec): { exitScript: string; coopScript: string; csvBlocks: number;
                      internalKeyIsNums: boolean; controlBlockBytes: number }
registerVault(rec, funding, feeVtxo, signer): Promise<{ vaultIdHex; txHash; committed: true }>
```
`registerVault` internally: fetch nonce → build → sign → broadcast → **waitForCommit** (R9). Refuses
if no ledger VTXO is available and tells the caller to onboard first.

### deposit.ts
```ts
depositToVault(rec, wallet, amountSats, feeRateSatVb): Promise<{ txid: DisplayTxid; vout: number }>
onboardToLedger(id, amountSats, signer): Promise<{ vtxoId: string; txHash: string }>
verifyReserves(rec): Promise<{ ok: boolean; onChainSpk: string; derivedSpk: string; valueSats: bigint }>
```
`verifyReserves` is the spk comparison, the only check that binds a rebuild to real money.

### recovery.ts
```ts
recoverVaults(id, q, knownCsvBlocks: number[]): Promise<VaultRecord[]>
```
Tries each known `csvBlocks` value and keeps results where `addressMatchesRebuild === true` (R5).
Defaults to `[2, 1008]`. Throws a typed error naming the fix if nothing matches.

### coinselect.ts
```ts
selectInputs(vtxos: LedgerVtxo[], targetSats: bigint, feeSats: bigint):
  { inputs: LedgerVtxo[]; changeSats: bigint } | InsufficientFunds
```
Largest-first with dust absorption. Excludes anything with `localSpentAt` set (R8) or `locked === true`.

### payment.ts
```ts
buildPayment(from: Identity, vault: VaultRecord, toXOnly: XOnlyHex,
             amountSats: bigint, feeSats: bigint): Promise<PreparedPayment>
sendPayment(prepared, signer): Promise<PaymentReceipt>
```
`toXOnly` is an x-only key, so R1 is structurally enforced: a `VaultAddress` cannot be passed. Change
goes to `from.userAddress`. Internally mirrors PSBT outputs to envelope outputs exactly, signs the PSBT
as user, **never finalizes it**, signs the envelope, broadcasts, waits for commit.

### queue.ts
```ts
class TxQueue { enqueue<T>(fn: () => Promise<T>): Promise<T> }
```
Serialises every mutating operation for one identity (R8). Marks selected VTXOs `localSpentAt` on
enqueue and rolls back on failure.

### indexer.ts
```ts
class Indexer {
  start(filters: { address?: string; vault?: string; blocks?: boolean }): void
  stop(): void
  on(evt: "pending" | "committed" | "block" | "error", cb): void
}
```
The **only** source of activity data (R2). Subscribes to the recipient's user address so incoming
payments surface at `state:"pending"` and again at `state:"committed"`. Reconnects with jittered
backoff, resyncs from `getAddressVtxos` on reconnect, and bounds its queue.

### proofs.ts
```ts
fetchHat(txHash): Promise<Hat | null>                      // null for deposits (no spent VTXO)
fetchRip(txHash, originEpoch, window = 50): Promise<Rip>    // window ≤ 256, we cap at 50
verifyHatInRip(hat, rip): boolean                          // stem-suffix-65 comparison
```

### exit.ts
```ts
assessExit(rec, id): Promise<ExitReadiness>                // the dry-run: builds, verifies, signs, discards
executeExit(rec, id, signer, destination): Promise<{ txid: DisplayTxid }>
```
`assessExit` is the RIPCORD test-pull: full build → verify (`expectedUserKey`, `minCsvBlocks`) → sign →
finalize → `decoderawtransaction` for structural proof, then reads live confirmations to decide
`live` vs `maturing`. Never broadcasts. Costs nothing.

## 7. Data flow: send

```
UI SendScreen
  → useSend() hook
    → TxQueue.enqueue
      → coinselect.selectInputs           (excludes localSpent + locked)
      → payment.buildPayment              (PSBT mirrors envelope; change → own key)
      → payment.sendPayment               (sign PSBT as user, sign envelope, broadcast)
      → waitForCommit                     (code 0 or throw)
      → proofs.fetchHat                   (receipt upgrade, non-blocking)
      → store.markSpent + store.addReceipt
    ← Indexer also observes committed event and reconciles
```

## 8. Data flow: receive

```
Indexer (WSS ?address=<user address>)
  → "pending"   → optimistic incoming row, amber
  → "committed" → refetch getAddressVtxos, update BalanceSnapshot, green
  → fetchHat(txHash) in background → receipt gains a proof
```

## 9. Data flow: cold start

```
User enters mnemonic (nothing else)
  → keys.deriveIdentity
  → quorum.getQuorum
  → recovery.recoverVaults(id, q, [2, 1008])
      for each candidate csvBlocks: discoverVaults({network, nodePubkeys, csvBlocks, query:{baseUrl}})
      keep where addressMatchesRebuild === true
  → for each vault: deposit.verifyReserves (spk binding)
  → ledger.getBalances
  → indexer.start
  → fully restored, zero prior local state
```

## 10. Error model

```ts
class RipcordError extends Error { code: RipcordCode; cause?: unknown; hint?: string }
```

Daemon codes mapped to actionable hints:

| Daemon | RipcordCode | Hint surfaced to the user |
|---|---|---|
| 3 | `INVALID_SIGNATURE` | "Signature rejected. Re-derive the signer." |
| 5 | `VTXO_ALREADY_SPENT` | "Those funds were already spent. Refreshing." (triggers resync) |
| 6 | `NOT_OWNER` | "This balance belongs to a different key." (R1 violation guard) |
| 8 | `FEE_TOO_LOW` | "Minimum fee is 1 sat." |
| 12 | `INVALID_FORMAT` | "Transaction structure rejected." |
| - | `AMOUNT_MISMATCH` | "Inputs and outputs don't balance." |
| `non-BIP68-final` | `EXIT_IMMATURE` | "Exit needs N more confirmations." |
| `bad-txns-inputs-missingorspent` | `FUNDING_MISSING` | Byte-order or already-exited guard |

## 11. Security posture

- Mnemonic never leaves the device. Held in memory only; IndexedDB stores **no** secret material.
  Cache holds vault records, receipts and VTXO snapshots (all public data).
- `keystore.lock()` wipes seed and account private key bytes; called on tab hide and on explicit lock.
- No backend, no telemetry, no analytics. The app talks only to the configured daemon and faucet.
- `verifyVaultP2tr` on every load and every recovery: a substituted vault fails closed.
- `verifyUnilateralExitPsbt` always passes `expectedUserKey` and `minCsvBlocks`, so a self-consistent
  but substituted vault cannot redirect the exit or collapse the timelock.
- Fee ceilings: every builder passes `maxFeeSats`; the SDK's `maxFeeRateSatVb` default (5000 sat/vB)
  is left in place to catch unit-scaling mistakes.
- Vault display names are **not** used (public, unescaped, set-once).
- This is a regtest wallet. The README says so at the top, and the UI carries a persistent network
  badge reading `REGTEST`.

## 12. Testing strategy

**Unit (vitest, in `packages/core/test`)**: byte-order round trips, bigint JSON, coin selection
including dust and insufficient-funds, error-code mapping, HAT⊂RIP comparison against a captured
fixture, branded-type guards.

**Integration (vitest, live daemon, `RIPCORD_LIVE=1`)**: preflight; create/verify/deterministic
re-derive; deposit + `verifyReserves`; onboard; register + commit; recover with and without `csvBlocks`
(asserting the without-case fails, proving R5 matters); pay a second identity and assert the recipient
can re-spend; HAT and RIP fetch plus link verification; `assessExit` on both an immature and a mature
vault; WSS pending-then-committed for a receive.

**E2E (Playwright, `e2e/`)**: onboarding, deposit, send, receive, **wipe IndexedDB and recover**,
exit dry-run, exit broadcast. The wipe test is the one that proves R11.

**CI gates**: typecheck, lint, unit, plus grep gates that fail the build on any occurrence of
`addressTransactions`, `listTransactions`, or `finalizeVtxoPsbt` outside `docs/`, any mock or
simulation API (`vi.mock`, `vi.fn`, `nock`, `msw`, `sinon`, `proxyquire`, `mock*`) anywhere in
`packages/` or `apps/`, and any unconditional `.skip()`. The mock and skip bans are the
enforcement half of `AGENTS.md` Rule 2 (hard rule: live daemon, real transactions, end to end,
no mocks, no simulations, docs are field notes not truth).

## 13. Deliverables

1. `@ripcord/core` published to public npm, MIT, with a README documenting every corrected signature.
2. Ripcord Wallet deployed as a static PWA (Netlify or Vercel).
3. Demo video following the golden path.
4. Root README: what works, what doesn't, and why, with real txids for every claim.
5. An issue filed on `tachibtc/tachi-sdk-ts` for the `getTransaction` HAT/RIP param bug.
