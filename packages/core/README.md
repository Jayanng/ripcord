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

## Development

From the repository root:

```bash
npm run typecheck
npm run build
npm run check:rules
npm test
```

The repository tests use live regtest behavior and may take several minutes.

## License

MIT. See the repository `LICENSE` file.

## Links

- Repository: https://github.com/Jayanng/ripcord
- Issues: https://github.com/Jayanng/ripcord/issues
- Tachi: https://tachibtc.com/

RIPCORD is experimental software. Review the repository's verified API and current test results before relying on any behavior.

