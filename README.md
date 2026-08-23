# RIPCORD

**A self-custodial Bitcoin vault wallet for the Tachi / TAURUS network.**

RIPCORD is an open-source TypeScript monorepo for building a Bitcoin wallet around Tachi's vault and VTXO protocols. It is designed to make custody visible and recoverable rather than hiding protocol behavior behind a conventional wallet balance.

The project targets **OP_FREEDOM Bounty #1: TAURUS non-custodial wallet / custody**.

> **Current status:** Phases 1 through 10 are implemented. Phase 9's `assessExit` dry-run is live-verified; mature `executeExit` broadcast remains env-gated (`RIPCORD_LIVE_EXIT=1`) because L1 confirmations are activity-driven. Phase 10 provides the responsive React/Vite PWA shell, live preflight truth rail, IndexedDB public-data store, and wallet hooks. This repository currently targets **Tachi regtest only**.

## What RIPCORD is designed to provide

- Self-custodial key derivation from a BIP-39 mnemonic
- Per-vault BIP-84 user-key indexes so each atomic vault can use a distinct key
- Deterministic 5-of-7 Tachi vault construction
- Taproot vault outputs with a provably unusable NUMS internal key
- Bitcoin L1 deposits with proof-of-reserves binding through an exact `scriptPubKey` comparison
- Cold-start recovery from mnemonic plus persisted public vault metadata
- Multi-candidate CSV recovery with exact on-chain funding-script binding
- Scan-bound validation and vault-ID deduplication during recovery
- Phase 5 recovery audit coverage for invalid bounds, placeholder lifecycle fields, and persisted quorum metadata
- VTXO coin selection with duplicate-ID and invalid-amount rejection
- Single-writer transaction serialization with fail-closed overlapping reservations
- Tachi transfers with sender-ownership validation and change returned to the sender's own user P2TR address
- SDK query-error mapping at the initial VTXO lookup boundary
- Phase 6 audit coverage for queue contention and fail-closed payment validation
- Live pending-to-committed activity through the Tachi WebSocket stream with stale-socket protection
- Public-data persistence through memory and IndexedDB store adapters with defensive reads
- Phase 7 audit coverage for stale socket callbacks, duplicate reconnect timers, terminal overflow, and mutable store objects
- HAT and RIP proof fetching and normalized HAT-in-Verkle-diff linking (`proofs.ts`)
- Unilateral-exit dry-run (`assessExit`) and L1 broadcast (`executeExit`) with BIP68 maturity from live `gettxout` confirmations

## Important limitations

RIPCORD is not production-ready and should not be used with funds that matter.

- The current implementation is **regtest-only**.
- There is no signet or mainnet support.
- The browser PWA shell is implemented, but onboarding, transaction flows, proof surfaces, and recovery UI remain later phases.
- `@ripcord/core` currently exports the implemented phases, including `proofs.ts` and `exit.ts`.
- HAT/RIP proofs on regtest are daemon-attested inclusion evidence. The current regtest response does not provide a usable PSBT payload for local HAT commitment recomputation.
- There is no L1 anchoring in the sampled regtest proof responses. Bitcoin height and timestamp fields are zero or unavailable in those proof responses.
- The IPA proof is carried as daemon-attested evidence. RIPCORD does not currently verify the Verkle/IPA commitment locally.
- The full registration lifecycle has a known environmental failure: the L1 confirmation step can time out because regtest block production is activity-driven rather than scheduled. This is not represented as a passing end-to-end gate.
- `IndexedDbStore` is intended for browsers and is not exercised in Node; it reports a clear error when IndexedDB is absent.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ apps/wallet                                                │
│ Future React/Vite PWA. No direct @tachibtc/* imports.       │
└──────────────────────────────┬──────────────────────────────┘
                               │ @ripcord/core
┌──────────────────────────────▼──────────────────────────────┐
│ packages/core                                               │
│ Keys, quorum, vaults, deposits, recovery, payments,         │
│ queue, live indexer, public-data stores, health and bytes.   │
└──────────────────────────────┬──────────────────────────────┘
                               │ verified SDK boundary
┌──────────────────────────────▼──────────────────────────────┐
│ Tachi / Taurus / Bitcoin                                    │
│ REST: https://rpc-regtest.tachibtc.com                     │
│ WSS:  wss://rpc-regtest.tachibtc.com/tachi_ws              │
└─────────────────────────────────────────────────────────────┘
```

The UI boundary is intentional: application code must consume `@ripcord/core`, while Tachi and Taurus SDK imports remain inside the core package. The architecture gate checks this layering and also blocks unsafe API calls on the send path.

## Repository layout

```text
ripcord/
├── packages/core/
│   ├── src/
│   │   ├── bytes.ts       # txid byte order and lossless bigint/byte JSON
│   │   ├── errors.ts      # RipcordError and daemon error mapping
│   │   ├── health.ts      # daemon, quorum, fee and L1 preflight
│   │   ├── keys.ts        # BIP-84 derivation and Taproot signers
│   │   ├── quorum.ts      # live quorum validation and fingerprint cache
│   │   ├── vault.ts       # deterministic vault creation and inspection
│   │   ├── deposit.ts     # L1 deposit and reserve binding
│   │   ├── register.ts    # vault registration
│   │   ├── recovery.ts    # cold-start vault discovery and reconstruction
│   │   ├── coinselect.ts  # VTXO selection
│   │   ├── queue.ts       # single-writer mutation queue
│   │   ├── payment.ts     # VTXO transfers
│   │   ├── indexer.ts     # WSS events with reconnect and bounded queue
│   │   ├── store.ts       # MemoryStore and IndexedDbStore
│   │   ├── proofs.ts      # HAT/RIP fetch and normalized Verkle inclusion
│   │   ├── exit.ts        # unilateral exit dry-run and L1 broadcast
│   │   └── index.ts       # public package barrel
│   └── test/              # live-regtest test suite (proofs.test.ts, verkle.test.ts, …)
├── docs/
│   ├── 01-VERIFIED-API.md # live-probed API contract
│   ├── 02-ARCHITECTURE.md # module contracts and boundaries
│   ├── 03-DESIGN-SYSTEM.md # UI and verification language
│   ├── 04-BUILD-PLAN.md   # phase-by-phase implementation plan
│   ├── 05-HANDOFF-PHASE7.md
│   └── 06-HANDOFF-PHASE8.md
└── scripts/
    └── check-architecture-rules.sh
```

## Implemented phases

| Phase | Status | Result |
|---|---|---|
| 1 | Complete | Monorepo and TypeScript foundation |
| 2 | Complete and audited | Core types, byte serialization, error taxonomy, health preflight |
| 3 | Complete and audited | Key derivation, per-index signers, quorum validation and cache |
| 4 | Complete | Vault creation, deposits, proof-of-reserves binding, registration |
| 5 | Complete | Cold-start recovery and public metadata reconstruction |
| 6 | Complete | VTXO coin selection, queue and transfers |
| 7 | Complete and audited | WSS indexer, reconnect lifecycle, bounded event queue, stores |
| 8 | Complete | HAT/RIP fetch, normalized Verkle inclusion, live `proofs` + `verkle` tests |
| 9 | Implemented; mature broadcast env-gated | `assessExit` dry-run live-verified; `executeExit` needs 2 L1 confs (`RIPCORD_LIVE_EXIT=1`) |
| 10 | Complete | Responsive PWA shell, live preflight, public IndexedDB state, hooks, manifest and offline shell |
| 11-14 | Planned | High-assurance components, transaction flows, browser-wipe recovery, final verification |

## Getting started

### Requirements

- Node.js **22 or newer** is recommended. The SDK's WebSocket support uses the global `WebSocket` implementation.
- npm with workspace support
- Network access to the Tachi regtest daemon
- No credentials are required for the public regtest SDK endpoints documented here.

The root package declares Node `>=20`, but the verified SDK environment uses Node 22. Use Node 22 for the closest match to the live-tested setup.

### Install

```bash
git clone https://github.com/Jayanng/ripcord.git
cd ripcord
npm install
```

The pinned protocol dependencies are:

```text
@tachibtc/taurus-vault-core       0.3.3
@tachibtc/taurus-wallet-aggregator 0.4.3
@tachibtc/tachi-sdk-ts            0.2.1
bitcoinjs-lib                     ^7.0.1
```

Do not upgrade these protocol packages without re-probing the live daemon and reviewing the verified API contract.

### Build and typecheck

Run workspace commands from the repository root:

```bash
npm run check:rules
npm run typecheck
npm run build
```

`check:rules` is not optional. It enforces the no-mocks policy, layering rules, and prohibited send-path API calls.

### Run the tests

The tests are live-regtest tests, not mock-based unit tests:

```bash
cd packages/core
npm test
```

Useful targeted runs:

```bash
npx vitest run test/keys.test.ts
npx vitest run test/quorum.test.ts
npx vitest run test/vault.test.ts
npx vitest run test/recovery.test.ts
npx vitest run test/payment.test.ts
npx vitest run test/indexer.test.ts
npx vitest run test/store.test.ts
```

The full suite can take several minutes because it performs real network operations. It may include one known failure in `e2e-full-flow.test.ts` when the activity-driven regtest chain does not produce the L1 confirmation within the test timeout. Report that failure honestly; do not convert it into a passing result by weakening the assertion.

## Core usage examples

The examples below use the implemented `@ripcord/core` surface and the verified regtest daemon. They are intentionally small: production callers must handle the returned errors, persistence, queueing, and lifecycle states.

### Derive an identity and signer

```ts
import { deriveIdentity, makeSigner } from '@ripcord/core';

const mnemonic = process.env.RIPCORD_MNEMONIC;
if (!mnemonic) throw new Error('Set RIPCORD_MNEMONIC for a local test only');

const identity = deriveIdentity(mnemonic, 'regtest', 0);
const signer = makeSigner(mnemonic, 'regtest', identity.userKeyDescriptor.index);

console.log(identity.userKeyDescriptor.path); // m/84'/1'/0'/0/0
console.log(identity.userAddress);             // user P2TR payment address
console.log(identity.l1Address);               // BIP-84 P2WPKH settlement address
```

Never log or persist the mnemonic. It is shown only to explain the API shape. Stores contain public records only.

### Fetch and validate the live quorum

```ts
import { getQuorumWithCache } from '@ripcord/core';

const quorum = await getQuorumWithCache('https://rpc-regtest.tachibtc.com');

console.log(quorum.threshold);    // 5 on the verified regtest daemon
console.log(quorum.nodePubkeys);  // 7 distinct compressed keys
console.log(quorum.fingerprint);  // threshold-aware canonical fingerprint
```

The cached quorum is frozen. Treat the fingerprint as the identity of the exact node set plus threshold used to construct a vault.

### Create a deterministic vault

```ts
import { createVault } from '@ripcord/core';

const vault = await createVault({
  network: 'regtest',
  nodePubkeys: quorum.nodePubkeys,
  csvBlocks: 2,
  userKeyDescriptor: identity.userKeyDescriptor,
  threshold: quorum.threshold,
});

console.log(vault.address);
console.log(vault.userKeyIndex);
console.log(vault.quorumThreshold);
console.log(vault.quorumFingerprint);
```

Vaults are atomic: one deposit per vault. Use a new receive index for a new funded vault. Change must go to the sender's user P2TR, never the vault address.

### Run preflight

```ts
import { preflight } from '@ripcord/core';

const health = await preflight('https://rpc-regtest.tachibtc.com');
if (!health.daemonOk) {
  for (const failure of health.probeFailures) {
    console.error(failure.probe, failure.message);
  }
}
```

`unreachable` means every daemon-facing probe failed. A degraded daemon may have some successful fields and some `probeFailures`. Never interpret zero values as verified state.

### Subscribe to live activity

```ts
import { VaultIndexer } from '@ripcord/core';

const indexer = new VaultIndexer({
  url: 'wss://rpc-regtest.tachibtc.com/tachi_ws?address=<user-address>&blocks=true',
  onEvent(event) {
    if (event.kind === 'tx:pending') console.log('pending', event.txHash);
    if (event.kind === 'tx:committed') console.log('committed', event.txHash, event.height);
    if (event.kind === 'block:new') console.log('block', event.height);
  },
  onStatus(status) {
    console.log(status.kind);
  },
  onError(error) {
    console.error(error.code, error.message);
  },
});

indexer.start();
// Later: indexer.close();
```

The indexer adds reconnect behavior around the SDK's push-only subscription. It emits `connecting`, `connected`, `reconnecting`, and `closed`. It uses a bounded queue and raises `QUEUE_OVERFLOW` rather than silently dropping events.

Normalize transaction hashes before joining WSS events to REST receipts: WSS hashes are lowercase while REST responses can be uppercase. Treat `vout[].owner` as opaque hex because both 64-character x-only and 66-character compressed keys have been observed.

### Persist public records

```ts
import { MemoryStore } from '@ripcord/core';

const store = new MemoryStore();
await store.saveVault(vault);
const snapshot = store.exportSnapshot();

// After a process/browser restart:
const restored = MemoryStore.fromSnapshot(snapshot);
const vaults = await restored.getVaults();
```

Use `serializeJson` and `deserializeJson` through the store boundary. They preserve bigint, Buffer, and Uint8Array values. Do not hand-roll `JSON.stringify` for vault records because `Buffer.toJSON()` runs before a replacer and can silently corrupt P2TR data.

## Security and custody model

RIPCORD's security boundary is deliberately explicit:

1. The mnemonic is used to derive user keys and sign locally.
2. Public descriptors, node pubkeys, vault outputs, receipts, and VTXO metadata may be persisted.
3. Private keys and mnemonics must never enter `MemoryStore`, `IndexedDbStore`, JSON snapshots, logs, or UI state intended for persistence.
4. The vault's NUMS internal key makes the Taproot key path provably unusable; spending paths are the unilateral exit leaf and cooperative quorum leaf.
5. The cooperative path depends on the configured threshold and exact node key set. Both are represented by the vault's quorum metadata and fingerprint.
6. Recovery rebuilds vaults from the mnemonic, persisted/public parameters, and live daemon state. `csvBlocks` must be persisted per vault; otherwise discovery can silently search the wrong parameter and find nothing.

This project is self-custodial in the sense that the user key and signing material remain under the user's control. That does not mean every protocol operation is unilateral: cooperative actions depend on the Tachi validator quorum, while unilateral exit is intended to provide the user-controlled recovery path.

## Verified protocol facts

The authoritative live-probed contract is [`docs/01-VERIFIED-API.md`](docs/01-VERIFIED-API.md). Some high-impact facts are repeated here for convenience:

- Network: `tachi-regtest-1`, daemon v0.39.0 at the verified probe date
- Quorum: 5-of-7 on the verified regtest daemon
- Regtest daemon REST: `https://rpc-regtest.tachibtc.com`
- Regtest WebSocket: `wss://rpc-regtest.tachibtc.com/tachi_ws`
- Faucet: `https://faucet.tachibtc.com`, 0.5 BTC per address per rolling 24 hours
- L1 funding txids from the daemon are internal byte order and must be reversed at display boundaries
- Deposit receipts preserve actual amount, fee, change, vault address, and consumed input accounting from the SDK
- Reserve verification is an exact on-chain output-script comparison, not an address-only check
- Registration inputs are locally validated before SDK submission, including txid, VTXO id, owner, amount, and outpoint index
- The full funded deposit, onboarding, and registration loop remains env-gated and is not claimed as complete
- CometBFT failures can arrive inside HTTP 200 responses; inspect the embedded result code
- Proof endpoints use real HTTP status codes such as 404, 400, and 502, unlike the CometBFT envelope paths
- Every new API claim must be probed against the live daemon before being added to documentation or code

## Development rules

This repository intentionally has stricter rules than a typical application:

- Live daemon is the source of truth.
- No mocks or network simulations in `packages/` or `apps/`.
- No fabricated txids, witness data, or truncated values presented as real fixtures.
- New features require an end-to-end regtest path where possible.
- Run all repository gates before committing:

```bash
npm run check:rules
npm run typecheck
npm run build
cd packages/core && npm test
```

- If a path cannot be verified live, mark it as untested or blocked. Do not paper over it.

## Documentation map

- [`docs/01-VERIFIED-API.md`](docs/01-VERIFIED-API.md): live API behavior and corrections
- [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md): module contracts, layering, and data flow
- [`docs/03-DESIGN-SYSTEM.md`](docs/03-DESIGN-SYSTEM.md): UI language, components, and proof presentation
- [`docs/04-BUILD-PLAN.md`](docs/04-BUILD-PLAN.md): implementation phases and audit outcomes
- [`docs/05-HANDOFF-PHASE7.md`](docs/05-HANDOFF-PHASE7.md): Phase 7 handoff and lessons
- [`docs/06-HANDOFF-PHASE8.md`](docs/06-HANDOFF-PHASE8.md): Phase 8 proof handoff and verified traps
- [`docs/07-HANDOFF-PHASE10.md`](docs/07-HANDOFF-PHASE10.md): Phase 10 PWA shell handoff and browser boundary notes
- [`AGENTS.md`](AGENTS.md): mandatory engineering and verification rules

## License and project maturity

The repository is currently private and the root package is private. `@ripcord/core` is version `0.1.0` and is structured as a publishable package, but this project should be treated as experimental until the remaining phases and end-to-end verification are complete.

Before relying on any behavior, check the live-probed API contract and the current test results. Protocol packages and daemon behavior can change; pinned dependencies are not a substitute for re-verification.

## License

No license has been declared in the repository yet. Do not assume the project is licensed for redistribution until a license file and package metadata are added.

---

**RIPCORD is a verification-first wallet project: if the chain has not confirmed it, the README should not claim it.**

## Compatibility note for the current README

This README was written against the implemented Phases 1 through 10. Phase 9's mature L1 broadcast is env-gated because regtest block production is activity-driven. Phase 10's browser shell and live preflight were verified through the local same-origin proxy. The README distinguishes implemented code from verified gates.
