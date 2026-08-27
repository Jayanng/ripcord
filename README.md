# RIPCORD

[![npm version](https://img.shields.io/npm/v/@ripcord/core?logo=npm&label=%40ripcord%2Fcore)](https://www.npmjs.com/package/@ripcord/core)
[![Release](https://img.shields.io/badge/release-v0.1.0-blue)](https://github.com/Jayanng/ripcord/releases/tag/v0.1.0)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/network-Tachi%20regtest-orange)](https://tachibtc.com/)
[![Status](https://img.shields.io/badge/status-experimental-yellow)](https://github.com/Jayanng/ripcord)

> **Proof before promise.**

RIPCORD is a self-custodial Bitcoin vault wallet for the Tachi and TAURUS ecosystem. It gives users a transparent way to onboard BTC into a 5-of-7 vault, manage spendable VTXOs, make off-chain transfers, inspect proof evidence, and understand the conditions for a unilateral exit.

RIPCORD targets **OP_FREEDOM Bounty #1: TAURUS-based Non-Custodial Wallet / Custody**.

## Current status

RIPCORD is experimental software targeting **Tachi regtest only**. It is not production custody software and must not be used with funds that matter.

- `@ripcord/core@0.1.0` is published on npm.
- GitHub release `v0.1.0` is available.
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
- A responsive React/Vite PWA for desktop and mobile browsers

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
│ React + Vite responsive PWA                                  │
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
- [npm v0.1.0](https://www.npmjs.com/package/@ripcord/core/v/0.1.0)
- [GitHub release v0.1.0](https://github.com/Jayanng/ripcord/releases/tag/v0.1.0)

The package exposes the root API and focused subpaths for:

```text
/types       /store       /health       /exit
/vault       /indexer     /keys        /quorum
/recovery    /payment     /lifecycle
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

1. Mnemonics and signing keys remain in memory and must never enter persistent stores.
2. Public vault records, funding outpoints, VTXO metadata, transaction hashes, and proof commitments may be persisted.
3. Every send validates the sender key, recipient format, amount, fee, and selected inputs.
4. Change is sent to the sender's user key, never to the vault address.
5. Recovery binds reconstructed vaults to live daemon data and exact Bitcoin funding scripts.
6. The wallet refuses to describe unverified data as confirmed custody.

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
http://localhost:5173
```

### Verification commands

Run these from the repository root:

```bash
npm run check:rules
npm run typecheck
npm run build
npm test
```

The tests use live regtest behavior rather than mocks. The full suite can take several minutes because the public Bitcoin regtest chain mines automatically and confirmation assertions remain real.

## Implemented phases

| Phase | Status | Scope |
|---:|---|---|
| 1 | Complete | Workspace and TypeScript foundation |
| 2 | Complete and audited | Core types, serialization, errors, and health preflight |
| 3 | Complete and audited | Key derivation and quorum engine |
| 4 | Complete | Vault lifecycle, deposits, reserves binding, and registration |
| 5 | Complete | Cold-start recovery engine |
| 6 | Complete | VTXO transfers, coin selection, and queueing |
| 7 | Complete and audited | WebSocket indexer and public-data stores |
| 8 | Complete | HAT/RIP proof retrieval and inclusion linking |
| 9 | Implemented | Exit dry run live-verified; mature broadcast remains deliberately controlled |
| 10 | Complete | Responsive PWA shell and live preflight |
| 11 | Complete | High-assurance wallet UI components |
| 12 | Complete | Onboarding, funding, sending, activity, and proof flows |
| 13 | Complete, manually live-verified | Browser-wipe recovery from mnemonic and live chain data |
| 14 | Complete | Playwright coverage, submission dossier, demo script, and release preparation |

## Known limitations

RIPCORD is not production-ready.

- Regtest only. There is no signet or mainnet support.
- The public daemon and its availability are external dependencies.
- HAT/RIP data is daemon-attested where local commitment recomputation is unavailable.
- The sampled regtest proof responses do not provide a usable PSBT payload for local HAT commitment recomputation.
- RIPCORD does not currently verify the Verkle/IPA commitment locally.
- Sampled proof responses do not provide reliable L1 anchoring fields.
- Unilateral exit maturity depends on live Bitcoin confirmation state.
- Native iOS and Android applications are not included. The wallet is a responsive browser PWA.
- Protocol dependencies are tied to the verified versions above.

## Evidence and documentation

The public repository contains the source code, package documentation, and executable test suite. Internal build plans, handoffs, operational instructions, detailed verification records, and submission planning are intentionally kept outside the public repository.

Start with:

- [npm package documentation](packages/core/README.md)
- [Published package](https://www.npmjs.com/package/@ripcord/core)
- [GitHub release v0.1.0](https://github.com/Jayanng/ripcord/releases/tag/v0.1.0)

## Project tags

`bitcoin` `tachi` `taurus` `vtxo` `taproot` `self-custody` `non-custodial` `typescript` `react` `vite` `pwa` `regtest` `wallet` `bitcoin-wallet` `proof-of-reserves`

## License

MIT. See [LICENSE](LICENSE).

RIPCORD is experimental software. Verify live behavior and review the current evidence before relying on any protocol or custody claim.

---

**RIPCORD is a verification-first wallet: if the chain has not confirmed it, the README should not claim it.**
