# @ripcord/core

Verified TypeScript core library for Tachi/Taurus Bitcoin regtest wallet mechanics.

## Scope

This package contains the protocol boundary used by RIPCORD, including key derivation, quorum discovery, vault construction, deposits, recovery, VTXO payments, live indexing, proof retrieval, public-state storage, and unilateral-exit assessment.

The current release is **experimental and regtest-only**. It is not production custody software and must not be used with funds that matter.

## Install

```bash
npm install @ripcord/core
```

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

The package exports the root API and focused subpaths for `types`, `store`, `health`, `exit`, `vault`, `indexer`, `keys`, `quorum`, `recovery`, `payment`, and `lifecycle`.

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

Unit tests, linting, typechecking, and architecture checks complete within seconds. The full end-to-end integration test (`test/e2e-full-flow.test.ts`) runs against the live public Tachi regtest network without mocks and takes **15 to 20 minutes**. This is expected behavior: the public Bitcoin regtest chain produces blocks on an approximate 10-minute cadence, and the test asserts real on-chain confirmations across the deposit and registration lifecycle.

## License

MIT. See the repository `LICENSE` file.

## Links

- Repository: https://github.com/Jayanng/ripcord
- Issues: https://github.com/Jayanng/ripcord/issues
- Tachi: https://tachibtc.com/

RIPCORD is experimental software. Review the repository's verified API and current test results before relying on any behavior.

