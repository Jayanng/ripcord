# RIPCORD Agent Rules (HARD RULES)

These rules bind every coding agent working in this repo (Codex, OpenCode, Claude Code,
Antigravity, or any other). They override habits, defaults, and general-purpose training.
They exist because a passing test that never touched the network once shipped here and
was presented as done. Never again.

## Rule 1: Live is the only source of truth

- The live regtest daemon at `https://rpc-regtest.tachibtc.com` is the ONLY authority on
  behavior. `docs/`, SDK `.d.ts` files, SDK READMEs, and your own priors are field notes.
- Before building on any SDK function, endpoint, type, or documented behavior, probe it
  live: real wallet, real transaction, real daemon response.
- If a live probe contradicts docs, types, or `.d.ts` declarations, the probe wins. Record
  the correction in `docs/01-VERIFIED-API.md` with the evidence (request + response).
- Type signatures are not behavior. When semantics matter, read the SDK JS internals
  (`fn.toString()` in `node_modules/.../dist/index.js`).
- Docs entries carry probe dates. If the daemon version moved since the probe, re-probe
  before relying on the entry.

## Rule 2: Zero mocks, zero simulations

- Forbidden anywhere in `packages/` or `apps/` (src AND test): `vi.mock`, `vi.fn`,
  `jest.mock`, `nock`, `msw`, `sinon`, `proxyquire`, and any
  `mockImplementation` / `mockReturnValue` / `mockResolvedValue` / `mockRejectedValue`.
- Tests hit the real daemon with real transactions. A green test that never touched the
  network proves nothing and will not be accepted as verification.
- No fabricated fixtures: no invented txids, no truncated hex placeholders, no
  `Buffer.alloc` standing in for real witness data. Every fixture value must be captured
  from a real response and annotated with where it came from.
- Unconditional `.skip()` is banned. Env-gated `.skipIf()` is allowed only for tests that
  spend scarce live resources (faucet budget), e.g. `RIPCORD_LIVE=1` plus explicit
  funding env vars.

## Rule 3: End to end or it didn't happen

- A feature is done when it has been exercised end to end on regtest: build, sign,
  broadcast, wait for commit, read the result back from the daemon.
- Typecheck plus unit tests alone never marks a phase or feature complete.
- If a path cannot be verified live (e.g. it needs an API key we do not have), say so
  plainly and mark it untested in code comments and reports. Never paper over it, never
  approximate it.
- Ground-truth first: before writing an assertion, probe the daemon and lock the expected
  values from the response. If you cannot state where an expected value came from, you
  invented it.

## Rule 4: Gates

- `npm run check:rules` (REPO ROOT, not package level) must stay green. It mechanically
  enforces Rule 2 plus the API-call bans (`addressTransactions`, `listTransactions`,
  `finalizeVtxoPsbt`) and the wallet layering ban on `@tachibtc/*` imports.
- Before any commit: full suite green, typecheck green (src + test via
  `tsconfig.test.json`), build green, `check:rules` green.
- If you change the rules script, prove the changed gate fires: plant a violation in a
  scratch file, watch the gate fail, delete the file, watch it pass.

## Environment quirks (verified, do not rediscover)

- SDK `node_modules` are hoisted to the repo root. Package-level
  `node_modules/@tachibtc/...` paths do not exist.
- Live probes can exceed the 600s foreground terminal limit: run them as background
  processes and wait on the process handle.
- Faucet: 0.5 BTC per address per rolling 24h. Vaults are atomic (one deposit each):
  use a fresh `userKeyIndex` per funded run.
- Byte order: daemon `funding_txid` is internal order; reverse at display boundaries.
- CometBFT errors arrive inside HTTP 200: inspect `result.code`, not the HTTP status.
