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
│   ├── 04-BUILD-PLAN.md
│   ├── 05-HANDOFF-PHASE7.md
│   └── 06-HANDOFF-PHASE8.md
├── packages/
│   └── core/                     # @ripcord/core - publishable
│       ├── src/
│       │   ├── index.ts
│       │   ├── config.ts         # network config, endpoints, constants
│       │   ├── types.ts          # branded types, VaultRecord, Vtxo, …
│       │   ├── errors.ts         # RipcordError hierarchy + daemon code map
│       │   ├── bytes.ts          # byte order, bigint+Buffer JSON, toBuf/bytesEqual
│       │   ├── keys.ts           # derivation, signer construction
│       │   ├── quorum.ts         # fetchConsensusQuorum wrapper + cache
│       │   ├── vault.ts          # create, verify, describe, register
│       │   ├── deposit.ts        # L1 deposit + onboarding
│       │   ├── recovery.ts       # discoverVaults with csvBlocks handling
│       │   ├── ledger.ts         # reads: balances, vtxos, nonce, fees
│       │   ├── payment.ts        # transfer build/sign/broadcast
│       │   ├── coinselect.ts     # VTXO selection + local spent tracking
│       │   ├── queue.ts          # single-writer send queue
│       │   ├── indexer.ts        # WSS subscription → typed events
│       │   ├── store.ts          # persistence: RipcordStore + Memory/IndexedDb
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

> **Status note (23 Aug).** Sections written before a module shipped are pre-build sketches and can
> drift from the real API. Where a section is marked **"As-built"** it was rewritten against the
> committed code (`indexer.ts`, `store.ts` after Phase 7). `proofs.ts` and `exit.ts` remain
> pre-build, with their live-probed constraints noted inline. `config.ts`, `ledger.ts`, `refund.ts`,
> and `watchtower.ts` in the layout above are **planned, not yet written**; the shipped module list
> is in `06-HANDOFF-PHASE8.md` §2.

### health.ts: preflight

**As-built** (Phase 2, revised by the 23 Aug audit):

```ts
preflight(baseUrl: string): Promise<{
  daemonOk: boolean; chainId: string; version: string; synced: boolean;
  liveValidators: number; quorumThreshold: number; quorumSize: number;
  feeRecommendedSats: bigint; feeMinSats: bigint;
  l1Height: number | null; l1HeightSource: 'bitcoin-rpc' | 'unavailable';
  probeFailures: ProbeFailure[];   // which probe failed and why
  unreachable: boolean;            // true when NOTHING answered
}>
type ProbeName = 'health' | 'nodeInfo' | 'liveValidators' | 'bitcoinRpc' | 'quorum' | 'feeEstimate';
interface ProbeFailure { probe: ProbeName; message: string }
```

Runs on app boot. Asserts `chainId === "tachi-regtest-1"` and refuses to proceed on mismatch, so a
signet URL can never silently talk to a regtest wallet. The guard fires **immediately after the chain
id is known**, before the remaining probes are sent, so a wrong-chain daemon is refused rather than
fully interrogated first.

**Audit fixes (2026-08-23):**
- **`probeFailures` is new.** Every probe used to sit behind a bare `catch {}` (six of them), so
  `daemonOk: false` carried no information: a DNS failure, an HTTP 500, a quorum change, and a
  fee-endpoint outage were indistinguishable. `03-DESIGN-SYSTEM.md` requires the raw daemon text for
  the error details disclosure, and boot is exactly when a user needs it.
- **`unreachable` distinguishes an outage from a degraded daemon.** True only when every
  daemon-facing probe failed.
- **`l1Height` is `number | null`**, not `number`. It is `null` with
  `l1HeightSource: 'unavailable'` when the Bitcoin RPC proxy does not answer. Never substitute the
  CometBFT height (~437k) for the Bitcoin L1 height (~9k).
- Zero values on failure are deliberate and must never read as verified: `quorumSize: 0` is not a
  verified quorum, and `chainId: ''` means `getNodeInfo` failed rather than a chain mismatch.

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

**As-built in Phase 7** (this section was a pre-build sketch; the shipped API differs, so what follows
is the real surface):

```ts
class VaultIndexer {
  constructor(o: { url: string; address?; vault?; vaultId?; blocks?; validators?;
                   maxQueuedEvents?; reconnectBaseDelayMs?; reconnectMaxDelayMs?; reconnectJitter?;
                   onEvent?: (e: IndexerEvent) => void | Promise<void>;
                   onError?: (e: RipcordError) => void;
                   onStatus?: (s: IndexerStatus) => void })
  start(): void
  close(): void
  get isConnected(): boolean      // true only after the WS handshake completes
  get queuedCount(): number
  get socket(): WebSocketLike | undefined
}
type IndexerEvent = IndexerTxEvent | IndexerBlockEvent    // kind: tx:pending | tx:committed | block:new
export function mapVaultEvent(raw: VaultEvent): IndexerEvent | null   // pure, unit-testable
class BoundedEventQueue<T>        // throws QUEUE_OVERFLOW past the bound, never drops
```

The **only** source of activity data (R2). Subscribes to the recipient's user address so incoming
payments surface as `tx:pending` and again as `tx:committed`. Wraps the SDK's `subscribeVaultEvents`,
which has **no reconnect of its own**, and adds exponential backoff with full jitter plus a
`connecting` / `connected` / `reconnecting` / `closed` status stream. A caller that reconnects must
re-query state (`getAddressVtxos`) because the stream is push-only and replays nothing.

**Live-verified:** `tx:pending` ~300 ms after broadcast, `tx:committed` on finalize with a positive
height, `block:new` ~5 s cadence, reconnect after a socket drop in ~807 ms.

**Two joining traps (§14):** the WSS `txHash` is lowercase while REST returns uppercase (normalize
before joining), and `vout[].owner` is not fixed width (64-char x-only and 66-char compressed both
observed in one transfer).

### store.ts

**As-built in Phase 7.** Absent from the original contracts list; documented here now.

```ts
interface RipcordStore {
  getVaults(): Promise<VaultRecord[]>;   saveVault(v: VaultRecord): Promise<void>
  getReceipts(): Promise<PaymentReceipt[]>; saveReceipt(r: PaymentReceipt): Promise<void>
  clear(): Promise<void>
}
class MemoryStore implements RipcordStore {      // node/test
  exportSnapshot(): string
  static fromSnapshot(json: string): MemoryStore
}
class IndexedDbStore implements RipcordStore {}  // browser; throws if indexedDB is absent
```

**Public data only.** Vault records, receipts, and VTXO snapshots. No mnemonic, seed, or private key
ever enters a store; those live in memory only (`keys.ts` / the signer).

Persistence goes through `bytes.ts` `serializeJson` / `deserializeJson`, which are **bigint- and
Buffer-safe**. This is load-bearing: `VaultRecord.p2tr` carries `Buffer` fields (P2TR `output`, control
blocks, leaf hashes), and `Buffer.toJSON()` runs **before** a `JSON.stringify` replacer, so a naive
implementation silently degrades them to `{type:'Buffer',data:[…]}` objects and the restored vault is
unspendable. That was a real Phase 7 bug, found by audit and fixed. **Never hand-roll `JSON.stringify`
on daemon payloads or vault records.**

`Buffer` and `Uint8Array` both encode to one compact `"__bytes:<base64>"` string (Phase 2 audit fix:
they used to encode two different ways, and a `Buffer` inflated ~50% over base64 because it went out as
a per-byte `data` array). On read, a `{type:'Buffer',data:[…]}` object is only coerced back to a Buffer
when every element is a byte-range integer and the object has exactly those two keys, so a foreign
daemon payload sharing that shape is left untouched.

Receipt keys are canonicalised to lowercase `txHash` in both implementations, because the daemon emits
the hash in two different cases (WSS lowercase, REST uppercase).

### proofs.ts
```ts
fetchHat(txHash): Promise<Hat | null>                      // null for deposits (no spent VTXO)
fetchRip(txHash, originEpoch, window = 0): Promise<Rip>     // see window rule below
verifyHatInRip(hat, rip): HatRipLink                       // normalized value match + key identity
```

**Corrected 2026-08-23 by live probe** (evidence in `01-VERIFIED-API.md` §16.3 / §16.5):

- **`window` defaults to 0, not 50.** Every epoch in `[origin, final]` must already be CLOSED or the
  daemon returns `502 … epoch <N> not closed (chain gap)`. Measured: 0/1/2/3/5 succeed on a fresh tx;
  10/25/50 fail. Clamp `final_epoch` to the newest `status:"closed"` epoch from `listEpochs` when a
  window is requested. The 256-epoch cap is a separate, looser limit. `Chain` is `null` at window 0.
- **There is no fixed "suffix 65".** Measured 204, 250, and 148 on three real transfers. The 32-byte
  Verkle key is `stem(31) || suffix(1)`, so the suffix is the key's last byte and varies per VTXO.
- **`verifyHatInRip` must normalize before comparing.** `StateDiff[].suffixDiffs[].currentValue` is
  `0x`-prefixed hex; `hat.proof` is bare hex. A strict `===` is false on every valid proof. It returns
  a structured `HatRipLink` (matched value, stem, suffix, key-identity flag) rather than a bare boolean
  so the ProofSheet can render what was actually checked.
- **Scope:** `rip.PSBTPayload` is `null` on regtest, so the HAT commitment cannot be recomputed
  locally. This is an inclusion proof of the daemon's HAT value in the daemon's Verkle diff. The IPA
  proof is carried as daemon-attested evidence, not verified client-side.
- **The SDK wrapper is not broken.** The old "it drops the query params" warning was false; it needs
  **camelCase** `originEpoch` / `finalEpoch` (snake_case is silently dropped and the daemon 400s).
  Raw `fetch` is still preferred here to keep `proofs.ts` dependency-free.
- **Two error surfaces.** These routes use real HTTP status codes (404 / 400 / 502), unlike the ledger
  routes where CometBFT failures arrive inside HTTP 200. Check both. See §10.

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
| (client-side) | `QUEUE_OVERFLOW` | "Event backlog exceeded. Reconnecting." (Phase 7, `indexer.ts`) |

**Where the reason actually lives (audit 2026-08-23).** `mapDaemonError` must read the rejection text
from every field the daemon really uses, not just `message`:

| Source | Code field | Reason field |
|---|---|---|
| `waitForTachiTxCommit` (`TachiTxCommitStatus`) | `code` | **`log`** (there is no `message`) |
| `VtxoBroadcastError` (SDK) | `tendermintCode` (`.code` is the string `"VTXO_BROADCAST"`) | **`tendermintLog`** |
| Bitcoin JSON-RPC proxy | `error.code` (negative) | **`error.message`** |

A message-only extractor left every text-based mapping dead in production while its tests passed.
`amount mismatch` is the worst case: it has **no numeric code** at all, so text is the only signal.
`daemonCode` is threaded through every mapping including `UNKNOWN`, and the `UNKNOWN` message keeps the
raw daemon text so the details disclosure has something to show. Every non-zero commit status goes
through `mapDaemonError`; never construct `UNKNOWN` at a call site.

**Two error surfaces, not one.** Ledger operations return CometBFT failures **inside HTTP 200**, so
`result.code` is the authority there. The proof routes (`/tachi_tx?hat=`/`&rip=`) are different: they
use **real HTTP status codes**, verified 23 Aug: `404 transaction not found` for an unknown hash,
`400` for missing epoch params or a window past the 256 cap, and `502 … not closed (chain gap)` for a
window reaching unclosed epochs. `proofs.ts` must check the HTTP status **and** the body, or a 404's
error text gets JSON-parsed into a bogus proof object.

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
