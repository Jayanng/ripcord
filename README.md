# RIPCORD

[![npm version](https://img.shields.io/npm/v/@ripcord/core?logo=npm&label=%40ripcord%2Fcore)](https://www.npmjs.com/package/@ripcord/core)
[![Release](https://img.shields.io/badge/release-v0.2.0-blue)](https://github.com/Jayanng/ripcord/releases/tag/v0.2.0)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/network-Tachi%20regtest-orange)](https://tachibtc.com/)
[![Status](https://img.shields.io/badge/status-experimental-yellow)](https://github.com/Jayanng/ripcord)

> **Proof before promise.**

RIPCORD is a self-custodial Bitcoin vault wallet for the Tachi and TAURUS ecosystem. It gives users a transparent way to onboard BTC into a 5-of-7 vault, manage spendable VTXOs, make off-chain transfers, inspect proof evidence, and understand the conditions for a unilateral exit.

RIPCORD targets **OP_FREEDOM Bounty #1: TAURUS-based Non-Custodial Wallet / Custody**.

## Current status

RIPCORD is experimental software targeting **Tachi regtest only**. It is not production custody software and must not be used with funds that matter.

- `@ripcord/core@0.2.0` is published on npm.
- GitHub release `v0.2.0` is available.
- Core wallet mechanics and the responsive wallet application have been exercised against the live Tachi regtest environment.
- Browser-wipe recovery has been manually exercised from a mnemonic against live regtest data.
- The project has no signet or mainnet support.

## Highlights

- Self-custodial BIP-39 mnemonic-based key derivation
- Per-vault BIP-84 receive-key indexes for atomic vaults
- Deterministic 5-of-7 Tachi vault construction
- Taproot vaults using a provably unusable NUMS internal key
- L1 deposits with exact funding-script proof-of-reserves binding
- VTXO coin selection and off-chain transfers
- Single-writer transaction serialization and local spend reservations
- Live WebSocket activity with pending-to-committed transitions
- HAT and RIP receipt retrieval with normalized inclusion linking
- Unilateral-exit dry runs with live BIP68 maturity status
- Mnemonic-based cold-start recovery after browser storage deletion
- Public-data persistence through memory and IndexedDB adapters
- A responsive React/Vite web application for desktop and mobile browsers
- **Sentinel vault health**: a watch-only score (0-100) with plain-English findings and breach alerts
- **Exit Readiness Certificate**: four exportable checks proving the exit is enforced by Bitcoin consensus
- **Spend Conscience**: the user's own pre-send limits and warnings, off by default
- **Fee transparency**: Slow / Normal / Fast presets from live daemon estimates plus a custom fee
- **Self-healing app**: stuck-database recovery, stale-service-worker purge, and honest degradation states

## What makes RIPCORD different

Four features exist here that a judge can verify in minutes:

1. **Exit Readiness Certificate.** The unilateral exit is not a promise in a doc: the wallet renders the four checks (timelock committed in the leaf, the leaf commits the user's own key, the sovereign script shape, the tree proof) and exports them as JSON with the raw public evidence, so anyone can re-verify every claim independently.
2. **Proof receipts.** Transfers carry HAT and RIP chain evidence that auto-populates in the receipt sheet. Where the daemon cannot attest something, the UI says so instead of decorating the gap.
3. **Sentinel Health Score.** A single watch-only score over vault state, exit maturity, balance cross-checks against the live chain, quorum health, and watchtower receipts. It reads the network and signs nothing.
4. **Self-healing app.** Local database jams, stale service workers, and unreadable storage are detected and recovered from, with honest screens that say what happened and how to restore (Recover wallet with the phrase). Exits are visible everywhere: a completion dialog, an Activity trail, and balances that report zero on purpose after the sweep.

## Why RIPCORD exists

Conventional wallet interfaces often collapse custody, settlement, and availability into one balance. RIPCORD exposes those boundaries instead:

- **On-chain reserves** show BTC held in the vault.
- **Off-chain VTXOs** show spendable ledger balance.
- **Proof panels** show the evidence behind custody and payment claims.
- **Exit status** shows whether a unilateral recovery transaction is mature.
- **Live activity** distinguishes pending events from committed events.

The goal is a Lightning-like spending experience without hiding the custody model or recovery conditions.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ apps/wallet                                                  │
│ React + Vite responsive web application                      │
│ Balance, onboarding, sending, recovery, proofs, and exit UI │
└──────────────────────────────┬──────────────────────────────┘
                               │ @ripcord/core
┌──────────────────────────────▼──────────────────────────────┐
│ packages/core                                                │
│ Keys, quorum, vaults, deposits, recovery, payments,         │
│ queue, indexer, public stores, proofs, health, and exits     │
└──────────────────────────────┬──────────────────────────────┘
                               │ verified SDK boundary
┌──────────────────────────────▼──────────────────────────────┐
│ Tachi / TAURUS / Bitcoin                                     │
│ REST: https://rpc-regtest.tachibtc.com                       │
│ WSS:  wss://rpc-regtest.tachibtc.com/tachi_ws                │
└─────────────────────────────────────────────────────────────┘
```

The wallet application consumes `@ripcord/core`. Tachi and TAURUS SDK imports remain inside the core package so protocol-specific behavior stays behind one audited boundary.

## `@ripcord/core`

The reusable TypeScript library is published as:

```bash
npm install @ripcord/core
```

Package links:

- [npm package](https://www.npmjs.com/package/@ripcord/core)
- [npm v0.2.0](https://www.npmjs.com/package/@ripcord/core/v/0.2.0)
- [GitHub release v0.2.0](https://github.com/Jayanng/ripcord/releases/tag/v0.2.0)

The package exposes the root API and focused subpaths for:

```text
/types       /store       /health       /exit
/vault       /indexer     /keys         /quorum
/recovery    /payment     /lifecycle    /proofs
/deposit     /register    /coinselect   /queue
/bytes       /net         /errors       /search
/refund
```

### Minimal example

```ts
import { deriveIdentity, getQuorumWithCache } from '@ripcord/core';

const mnemonic = process.env.RIPCORD_MNEMONIC;
if (!mnemonic) throw new Error('Set RIPCORD_MNEMONIC privately for a local test');

const identity = deriveIdentity(mnemonic, 'regtest', 0);
const quorum = await getQuorumWithCache('https://rpc-regtest.tachibtc.com');

console.log(identity.userAddress);
console.log(`${quorum.threshold} of ${quorum.nodePubkeys.length}`);
```

Never log or persist a mnemonic, seed, or signing key.

## Verified capabilities

### Vault and custody

- BIP-39 mnemonic-derived identity keys
- BIP-84 L1 settlement addresses and BIP-340 signing support
- Deterministic TAURUS vault derivation
- 5-of-7 quorum validation with duplicate-key rejection
- Threshold-aware quorum fingerprints
- NUMS internal-key verification
- Exact on-chain `scriptPubKey` binding for vault funding
- Vault registration and VTXO onboarding

### VTXO payments

- Largest-first spendable-VTXO selection
- Duplicate-ID and invalid-amount rejection
- Single-writer transaction queue
- Overlapping-input reservation protection
- Sender ownership validation
- Change returned to the sender's user P2TR address
- Live broadcast and commit handling
- Pending and committed WebSocket activity

### Recovery and evidence

- Multi-candidate CSV discovery
- Vault address reconstruction checks
- Funding outpoint verification against Bitcoin RPC
- BigInt and byte-safe public-state persistence
- HAT and RIP retrieval
- HAT-in-RIP StateDiff inclusion linking
- BIP68 unilateral-exit maturity assessment
- Browser localStorage and IndexedDB wipe recovery

## Custody and security model

RIPCORD is self-custodial in the sense that user signing material is derived and used locally. This does not mean every protocol operation is unilateral. Cooperative actions depend on the Tachi validator quorum, while unilateral exit provides the user-controlled recovery path after the configured timelock.

The project follows these boundaries:

1. Mnemonics and signing keys are never written to storage. No persistent key material exists.
2. Public vault records, funding outpoints, VTXO metadata, transaction hashes, and proof commitments may be persisted.
3. Every send validates the sender key, recipient format, amount, fee, and selected inputs.
4. Change is sent to the sender's user key, never to the vault address.
5. Recovery binds reconstructed vaults to live daemon data and exact Bitcoin funding scripts.
6. The wallet refuses to describe unverified data as confirmed custody.

### The storage contrast, stated plainly

Most wallet apps keep key material on the device: a seed file, a keystorage
blob, or an encrypted vault unlocked by a PIN or biometrics. RIPCORD keeps
none of it. There is no plaintext or encrypted key material at rest at any
time, and unlocking is phrase-based: the 12 words are the wallet, typed in
when needed and dropped from memory when the session or auto-lock ends. If
the browser wipes every byte the app stored, nothing is lost: "Recover
wallet" with the phrase rebuilds the vault records from live chain data.
That recovery was exercised live by wiping the browser and restoring from
the mnemonic against regtest.

## Network and dependencies

The verified environment is:

```text
Network:      tachi-regtest-1
Daemon:       https://rpc-regtest.tachibtc.com
WebSocket:    wss://rpc-regtest.tachibtc.com/tachi_ws
Faucet:       https://faucet.tachibtc.com
Explorer:     https://explorer-regtest.tachibtc.com
Quorum:       5 of 7 validators
```

Pinned protocol dependencies:

```text
@tachibtc/taurus-vault-core        0.3.3
@tachibtc/taurus-wallet-aggregator 0.4.3
@tachibtc/tachi-sdk-ts             0.2.1
```

Do not upgrade protocol dependencies without re-probing the live daemon and reviewing the verified API contract.

## Development setup

### Requirements

- Node.js 22 or newer recommended
- npm workspaces
- Network access to the Tachi regtest daemon
- No credentials for the public regtest endpoints documented above

### Install

```bash
git clone https://github.com/Jayanng/ripcord.git
cd ripcord
npm install
```

### Run the wallet locally

```bash
npm run dev --workspace=apps/wallet
```

Open the localhost URL printed by Vite, usually:

```text
http://localhost:4173
```

### Verification commands

Run these from the repository root:

```bash
npm run check:rules
npm run typecheck
npm run build
npm test
```

### Execution time and Bitcoin L1 block cadence

- **Fast checks (`check:rules`, `typecheck`, `build`)**: Complete in seconds.
- **Live full-lifecycle E2E tests (`npm test` / `vitest run test/e2e-full-flow.test.ts`)**: Typically take **15 to 20 minutes**.
  - RIPCORD adheres to a strict **zero-mock, live-only verification rule** (`scripts/check-architecture-rules.sh`).
  - Tests interact with the live public Tachi regtest Bitcoin daemon (`https://rpc-regtest.tachibtc.com`).
  - The public regtest network mines Bitcoin blocks automatically on an approximate **10-minute cadence**.
  - A full cold-start lifecycle requires two sequential on-chain confirmations (faucet funding tx + vault deposit tx), which legitimately takes two block cycles (~10 to 20 minutes).

### Onboarding and background funding architecture

- **Instant wallet entry (< 300 ms)**: Key derivation (BIP-39, BIP-84) and deterministic Taproot vault computation occur entirely on-device in under a third of a second. Users are never trapped behind a 20-minute loading gate.
- **Ambient background settlement**:
  - When test funds are requested, the transaction is broadcast to the Bitcoin mempool immediately.
  - The wallet monitors the transaction in the background (polling every 10 seconds) while leaving all tabs (Wallet, Exit, Proofs, Activity) fully interactive.
  - After the L1 block confirms, the user completes funding with one tap: "Check and register deposit". Registration mints the spendable VTXO on Tachi and records the vault with consensus validators. Until this step, the deposit is visible under on-chain vault balances only.
  - In-flight transaction IDs are persisted in `localStorage` and resume automatically across page reloads.

## TAURUS vs. Lightning: Superior UX & Stronger Sovereignty

The hackathon bounty requires proving that Tachi and TAURUS vaults deliver a superior user experience compared to the Lightning Network without compromising Bitcoin's sovereign custody guarantees.

Conventional layer-2 Bitcoin solutions (primarily Lightning) introduced significant operational friction that frequently forces end-users into custodial compromises. TAURUS eliminates these trade-offs at the protocol layer:

| Dimension | TAURUS Vaults (Tachi) | Lightning Network | Custodial Services / Rollups |
|---|---|---|---|
| **Key Ownership** | User holds BIP-39 seed (never stored) | User holds node private keys | Operator holds private keys |
| **Channel Management** | **None.** Single vault backs arbitrary VTXOs | Continuous manual channel capacity rebalancing | None (centralized ledger) |
| **Inbound Liquidity** | **Zero friction.** Receive any amount immediately | Requires pre-allocated inbound channel liquidity | Unlimited (centralized) |
| **Receiver Online Requirement** | Non-interactive; receive without active session | Lightning node must remain continuously online | Dependent on custodian uptime |
| **State Security** | Consensus-anchored History Authenticity Trees | Watchtower required to prevent toxic state fraud | None (custodian trusted) |
| **Unilateral Exit** | **BIP68 relative timelock (CSV)** sweep to L1 | Complex force-close with dispute penalties | None (custodian approval required) |
| **Routing Failures** | Zero routing hops; single-hop consensus | Multi-hop routing failure and fee spikes | None (centralized routing) |

### 1. No Inbound Liquidity Deadlocks
On the Lightning Network, a newly generated wallet cannot receive satoshis until inbound liquidity is created, either by spending outgoing sats first or paying a liquidity provider for a leased channel. In TAURUS, Virtual UTXOs (VTXOs) are self-contained cryptographic commitments. Any user can receive sats instantly to their user Taproot address with zero pre-existing channels or inbound liquidity provisioning.

### 2. Elimination of Force-Closure Penalties and Toxic State
Lightning channels require constant surveillance. If a node loses state synchronization (e.g., from backup restoration or crash) and broadcasts an outdated commitment transaction, justice penalty mechanisms can confiscate the user's entire channel balance. In TAURUS, off-chain state updates are committed to validator consensus trees. There are no penalty games, no toxic states, and no danger of losing funds through outdated state broadcast.

### 3. Deterministic Unilateral Timelock Exit
If Tachi consensus validators go offline or refuse coordination, the user does not need to participate in high-stakes fee-bumping dispute races. The TAURUS Taproot exit leaf is hardcoded to the user's single-key `CHECKSIG` with an on-chain relative timelock (`OP_CHECKSEQUENCEVERIFY`). Once the timelock elapses, the user executes a standard single-transaction sweep directly to Bitcoin L1.

## Bounty #1 requirements

RIPCORD targets **OP_FREEDOM Bounty #1: TAURUS-based Non-Custodial Wallet / Custody**. The bounty asks builders to create a mobile and desktop wallet experience that enables sovereign Bitcoin custody and spending through TAURUS vaults and VTXOs, with clear balances and a unilateral exit path.

What the bounty asked for and where it lives:

| Requirement | Where it lives | Evidence |
|---|---|---|
| TAURUS-based non-custodial wallet | The whole app, with TAURUS/Tachi mechanics behind the `@ripcord/core` boundary | `npm run check:rules`; 444 tests passing on the live regtest daemon (6 gated, 1 pending a faucet refill) |
| Create TAURUS/Tachi vaults | Create and Recover flows (Wallet tab) | Deterministic construction with the live 5-of-7 regtest quorum; fixture-address checks in the vault tests |
| Onboard BTC into a vault | Two-step funding: L1 deposit then register (Wallet tab) | `deposit.test.ts`, `register.test.ts`, `lifecycle-*.test.ts`; exact funding-script proof-of-reserves binding |
| Manage VTXOs | VTXO inventory card with spendable / locked / spent views | `coinselect.test.ts`, `indexer.test.ts`; live balance and ownership checks |
| Spend sats off-chain | Send flow with review, Spend Conscience, and fee chooser | `payment.test.ts` live end-to-end transfers; `spend-conscience.test.ts` (13 tests) |
| Smooth, Lightning-like experience | Instant sends, live activity stream, success moments, clear fees | Live regtest runs; pending-to-committed transitions in Activity |
| Superior UX vs. Lightning | No channels, no inbound liquidity, no toxic state; clean CSV exit | `exit.test.ts`, `refund.test.ts` (dual exit paths) |
| Clear balance displays | Balance card: vault reserves, spendable VTXOs, and the L1 settlement address verified on-chain | Live chain cross-checks (`health.test.ts`); zeroed balances after exit |
| Unilateral exit flow | Exit tab: Ripcord exit with dry run, hold-to-confirm, and the Exit Readiness Certificate | `exit.test.ts`, `exit-run.test.ts`, `exit-certificate.test.ts` (16 tests); live-verified exit broadcast on regtest |
| Timelock status | Exit tab maturity meter and certificate countdown | Live `unfunded` / `maturing` / `live` / `spent` states (`sentinel.test.ts` maturity wording) |
| Mobile and desktop wallet experience | Responsive web app for mobile and desktop browsers | 390px mobile pass; it is not a separate native iOS, Android, Windows, or macOS application |
| Vault monitoring and safety | Sentinel vault health (Wallet tab), watchtower drawer, auto-lock, address safety | `sentinel.test.ts` (20 tests), `phase4-polish.test.ts` (11 tests) |
| SatVM Smart Contracts (Grant Scope) | Forward-compatible types in `@ripcord/core` | `SatVmCallParams` and `SatVmExecutionReceipt` with documentation |

## SatVM Smart Contract Programmability & Grant Roadmap

The bounty rubric highlights SatVM integration as an optional differentiator for ecosystem grants. RIPCORD includes forward-compatible architecture for SatVM smart contract interactions built directly on top of TAURUS off-chain VTXOs:

### Architecture: How SatVM Extends TAURUS

```text
┌─────────────────────────────────────────────────────────────┐
│ Bitcoin L1 (Base Layer)                                      │
│ Custody of satoshis in 5-of-7 Taproot vaults                │
│ Enforces BIP68 timelock (CSV) unilateral exit leaf          │
└──────────────────────────────┬──────────────────────────────┘
                               │ Backs off-chain state
┌──────────────────────────────▼──────────────────────────────┐
│ Tachi Consensus & TAURUS Ledger                              │
│ 5-of-7 validator threshold signatures                       │
│ History Authenticity Tree (HAT) double-spend prevention     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Evaluates contract transitions
┌──────────────────────────────▼──────────────────────────────┐
│ SatVM Execution Engine                                       │
│ Evaluates Turing-complete state machines against VTXOs      │
│ Commits state roots to rollup blocks; issues output VTXOs   │
└─────────────────────────────────────────────────────────────┘
```

### Verified TypeScript Core Interfaces

The `@ripcord/core` SDK exports `SatVmCallParams` and `SatVmExecutionReceipt`:

```ts
import { SatVmCallParams, SatVmExecutionReceipt } from '@ripcord/core';

// Prepare a contract invocation against a spendable VTXO
const callParams: SatVmCallParams = {
  contractAddress: 'satvm1qq...escrow_vault',
  method: 'releaseConditional',
  args: ['oracle_attestation_hex', 50_000n],
  inputVtxoId: 'vtxo:9a4b2c...',
  maxFeeSats: 250n,
};

// Returns attested execution receipt with state root and output VTXO commitments
// type SatVmExecutionReceipt = {
//   txHash: string;
//   contractAddress: string;
//   method: string;
//   stateRoot: string;
//   outputVtxoIds: readonly string[];
//   gasUsedSats: bigint;
//   status: 'committed' | 'rejected';
// };
```

### Grant Roadmap Milestones

1. **Phase 1 (Completed in RIPCORD)**: Core types, transaction sequencing interfaces, and documentation in `@ripcord/core`.
2. **Phase 2 (Grant Target - Smart Escrow & Atomic Swaps)**: Programmatic VTXO releases contingent on external multi-oracle or DLC attestations evaluated in SatVM.
3. **Phase 3 (Grant Target - Decentralized Orderbook Matching)**: Sub-second limit order settlement using SatVM state diffs without touching Bitcoin L1.
4. **Phase 4 (Grant Target - Client-Side ZK Verification)**: Verifying SatVM state transitions on-device via zero-knowledge proofs.

### Mainnet requirement

The bounty description does **not** require Bitcoin mainnet, signet, real BTC, or production deployment. RIPCORD therefore uses the official Tachi regtest environment for safe, live verification without risking real funds.

The accurate scope is:

```text
Live-verified Tachi regtest wallet prototype
Responsive mobile and desktop browser web application
No mainnet or signet support
No production custody claim
```

Regtest is a deliberate safety and verification boundary, not a substitute claim for mainnet readiness. RIPCORD should not be used with funds that matter.

## Known limitations

RIPCORD is not production-ready. The honest list:

- Regtest only. There is no signet or mainnet support.
- L1 confirmations run at the regtest cadence (about 10 minutes on mainnet-like timing; regtest blocks advance with network activity).
- Epoch L1 settlement is not implemented daemon-side yet: payment receipts are daemon-attested, and the UI says exactly that.
- VTXO expiry and rotation are unspecified in the protocol today; the wallet does not invent policy for them.
- An exit sweeps the whole funding UTXO to the settlement address, minus the fixed exit fee. Partial exits do not exist.
- The 24-hour Spend Conscience window counts sends made since that feature existed on the device; it is a device-local log, labeled as such in the UI.
- The confirmation counter polls the chain while the row is visible; when the chain cannot be reached it says so instead of guessing.
- The public daemon and its availability are external dependencies.
- HAT/RIP data is daemon-attested where local commitment recomputation is unavailable.
- The sampled regtest proof responses do not provide a usable PSBT payload for local HAT commitment recomputation.
- RIPCORD does not currently verify the Verkle/IPA commitment locally.
- Sampled proof responses do not provide reliable L1 anchoring fields.
- Unilateral exit maturity depends on live Bitcoin confirmation state.
- Native iOS and Android applications are not included. The wallet is a responsive browser web application.
- Protocol dependencies are tied to the verified versions above.

## Evidence and documentation

The public repository contains the source code, package documentation, and executable test suite. Internal build plans, handoffs, operational instructions, detailed verification records, and submission planning are intentionally kept outside the public repository.

Start with:

- [npm package documentation](packages/core/README.md)
- [Published package](https://www.npmjs.com/package/@ripcord/core)
- [GitHub release v0.2.0](https://github.com/Jayanng/ripcord/releases/tag/v0.2.0)

## Project tags

`bitcoin` `tachi` `taurus` `vtxo` `taproot` `self-custody` `non-custodial` `typescript` `react` `vite` `web-app` `regtest` `wallet` `bitcoin-wallet` `proof-of-reserves`

## License

MIT. See [LICENSE](LICENSE).

RIPCORD is experimental software. Verify live behavior and review the current evidence before relying on any protocol or custody claim.

---

**RIPCORD is a verification-first wallet: if the chain has not confirmed it, the README should not claim it.**
