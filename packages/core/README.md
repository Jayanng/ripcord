# @ripcord/core

Verified TypeScript core library for Tachi/Taurus Bitcoin regtest wallet mechanics.

## Scope

This package contains the protocol boundary used by RIPCORD, including key derivation, quorum discovery, vault construction, deposits, recovery, VTXO payments (per-input witness scripts, tx serialization queue), live indexing with payment receipts and balance cross-checks, watchtower breach receipts, proof retrieval (HAT/RIP with window clamping), public-state storage, and unilateral-exit assessment.

## Modules

| Import | What lives there |
| --- | --- |
| `@ripcord/core` | Core API (keys, quorum, vault, deposit, register, lifecycle, payment, coinselect, queue, indexer, proofs, health, exit, refund, recovery, net, errors, store, types, bytes, search). Modules marked "subpath only" require direct subpath imports. |
| `./keys` `./quorum` `./vault` `./deposit` `./register` `./lifecycle` | Identity, quorum discovery, vault lifecycle (incl. idempotent re-registration adoption), flow orchestration |
| `./payment` `./coinselect` `./queue` | VTXO sends with per-input scripts, coin selection, serializing TxQueue |
| `./indexer` `./proofs` `./health` | Live indexing + receipts, HAT/RIP proofs, daemon health/watchtower reads |
| `./exit` `./refund` `./recovery` | Unilateral exit assessment/execution, cooperative refunds, recovery |
| `./net` `./errors` `./store` `./types` `./bytes` `./search` | Daemon URL joining & fetch failure diagnosis, friendly error mapping, pluggable stores, txid byte order + JSON serialization, types, live chain search |
| `./sentinel` `./exit-certificate` `./spend-conscience` **(subpath only)** | Watch-only vault health scoring, the exportable Exit Readiness Certificate, and the pure pre-send rule engine. Import via `@ripcord/core/sentinel`, `@ripcord/core/exit-certificate`, `@ripcord/core/spend-conscience` — not re-exported from the root. |
| `./idle-timer` `./address-safety` `./units` | Injectable idle timer, address highlight and mangled-paste checks, sats/BTC formatting |

The current release is **fully functional on Tachi regtest**. It is not production custody software and must not be used with funds that matter.

## Install

```bash
npm install @ripcord/core
```

The package is ESM-only (`"type": "module"`). CommonJS consumers should use dynamic `import()`.

## Basic usage

```ts
import { deriveIdentity, getQuorumWithCache } from '@ripcord/core';

const identity = deriveIdentity(process.env.RIPCORD_MNEMONIC!, 'regtest', 0);
const quorum = await getQuorumWithCache('https://rpc-regtest.tachibtc.com');

console.log(identity.userAddress);
console.log(`${quorum.threshold} of ${quorum.nodePubkeys.length}`);
```

Never log or persist a mnemonic or signing key. The example requires the mnemonic to be supplied privately at runtime.

## Public subpaths

The package exports the root API and focused subpaths for `types`, `bytes`, `net`, `store`, `health`, `exit`, `refund`, `vault`, `deposit`, `lifecycle`, `payment`, `coinselect`, `queue`, `proofs`, `quorum`, `recovery`, `indexer`, `keys`, `register`, `search`, `sentinel`, `exit-certificate`, `spend-conscience`, `idle-timer`, `address-safety`, `units`, and `errors`.

## Releases

- **0.2.1** (2026-10-05) — current release, published to npm. Exit
  certificate reports the real sweep (top-level mandated export fields,
  tree-proof gate before broadcast), spend reconciliation against L1
  reserves, recoverVaults binding fix, activity feed dedupe helpers, and the
  explorer base rewired to `regtest.tachibtcscan.com`. Post-tag fixes included:
  L1/Tachi link separation (Tachi-native ids link to the explorer, L1 ids are
  click-to-copy), auto-lock removed (keys never stored, dropped at session end),
  honest proof handling (background retry when epoch closes, no false "Self-proof"
  labels), send race guards (request-ID checks on all completion paths),
  vault links route to `/vtxo/` with correct ID format, and certificate export
  with no broken URLs. Source: tag `v0.2.1`, npm `0.2.1`.
- **0.2.0** (2026-09-28) — previous release. Money-path
  hardening: resume-path money contract, `code=17` binding truth, refresh-race
  fix, record-keyed vault storage, sibling-safe funding scans, key-state fixes.
  Ships alongside the RIPCORD wallet phases 1-10 (send, vaults, exit console,
  receive, watchtower, search, polish, trust). Source: tag `v0.2.0`.
- **0.1.1**, **0.1.0** — earlier experimental releases.

## Verified environment

- Network: `tachi-regtest-1`
- Daemon: `https://rpc-regtest.tachibtc.com`
- WebSocket indexer: `wss://rpc-regtest.tachibtc.com/tachi_ws`
- Node.js: 22 or newer recommended

## Limitations

- No mainnet or signet support.
- Live behavior depends on the public Tachi regtest daemon.
- HAT/RIP and Verkle data are daemon-attested where local recomputation is unavailable.
- Unilateral-exit maturity depends on live Bitcoin confirmation state.
- Protocol dependencies are pinned and should not be upgraded without re-probing the live daemon.

## Browser usage & deployment

A browser app using this package must reach the daemon through a **same-origin
proxy** (`/health`, `/tachi_*`, `/rpc`): the public Tachi daemon CORS-enables
GETs but not POSTs (verified live 2026-09-27), so broadcasts and the sign
ceremony fail cross-origin. Dev and production configs that implement the
contract live in `apps/wallet/vite.config.ts` and `apps/wallet/vercel.json`;
the full contract is in `docs/DEPLOYMENT.md`.

Path-prefixed bases (e.g. `https://host/proxy`) are safe throughout this
package (URLs are joined with `joinDaemonUrl` from `@ripcord/core/net`), but
do not pass one to `@tachibtc/tachi-sdk-ts`'s `TachiClient`: it resolves
absolute paths with `new URL(path, base)` and silently drops the base path.
`describeDaemonFailure()` (same module) turns fetch failures into messages
that name the likely cause (host not proxying, CORS gap on POST, timeout).

## Development & verification

From the repository root:

```bash
npm run check:rules
npm run typecheck
npm run build
npm test
```

### Test execution duration

Unit tests, linting, typechecking, and architecture checks complete within seconds. The full end-to-end integration test (`packages/core/test/e2e-full-flow.test.ts`) runs against the live public Tachi regtest network without mocks and takes **15 to 20 minutes**. This is expected behavior: the public Bitcoin regtest chain produces blocks on an approximate 10-minute cadence, and the test asserts real on-chain confirmations across the deposit and registration lifecycle.

## License

MIT. See the repository `LICENSE` file.

## Links

- Repository: https://github.com/Jayanng/ripcord
- Issues: https://github.com/Jayanng/ripcord/issues
- Tachi: https://tachibtc.com/

RIPCORD is live on Tachi regtest. Review the repository's verified API and current test results before relying on any behavior.

