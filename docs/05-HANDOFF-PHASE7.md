# RIPCORD: Phase 7 Handoff

> For the next session. Read this first, then `AGENTS.md`, `docs/01-VERIFIED-API.md`,
> `docs/02-ARCHITECTURE.md`, and `docs/04-BUILD-PLAN.md` before writing any code.

## 1. What this project is

**RIPCORD** is a self-custodial Bitcoin vault wallet on the Tachi (TAURUS) network.
Target: **OP_FREEDOM Bounty #1** (TAURUS non-custodial wallet / custody).

- Repo: `github.com/Jayanng/ripcord` (private), branch `main`
- Root on disk: `/home/ubuntu/ripcord`
- Monorepo: `packages/core` (`@ripcord/core`, the publishable library) + `apps/*` (arrives in Phase 10)
- Build model: the library wraps `@tachibtc/*` SDKs. The UI (apps/wallet) may NOT import `@tachibtc/*` directly (layering, enforced by `check:rules`).

## 2. Current state: Phases 1-6 DONE

| Phase | Delivered |
|-------|-----------|
| 1 | Workspace & monorepo foundation |
| 2 | `@ripcord/core` primitives (`types.ts`, `bytes.ts`, `errors.ts`) |
| 3 | Key derivation (`keys.ts`) + quorum engine (`quorum.ts`) |
| 4 | Vault lifecycle (`vault.ts`), PoR deposit (`deposit.ts`), registration (`register.ts`) |
| 5 | Cold-start recovery (`recovery.ts`) |
| 6 | VTXO coin selection (`coinselect.ts`), single-writer queue (`queue.ts`), transfers (`payment.ts`) |

`packages/core/src/` modules: `index.ts`, `types.ts`, `bytes.ts`, `errors.ts`, `health.ts`,
`keys.ts`, `quorum.ts`, `vault.ts`, `deposit.ts`, `register.ts`, `recovery.ts`,
`coinselect.ts`, `queue.ts`, `payment.ts`.

## 3. Git state (as of handoff)

- Last commit: **`659d6c8`**, "fix(core): audit fixes - deposit txid reversal, recovery csv docs, e2e lifecycle test"
- Pushed to `origin/main`. Working tree **clean**.

## 4. Remaining phases (7 to 14)

| Phase | Work | Notes |
|-------|------|-------|
| **7** | Real-Time WSS Indexer & Activity Store | **START HERE** |
| 8 | Cryptographic Proofs & Verkle Linker (HAT/RIP) | `proofs.ts` |
| 9 | Unilateral Exit & Dry-Run Engine | `exit.ts`, only a builder exists today, not committed |
| 10 | PWA Shell, Design System, Core State | `apps/wallet` scaffold |
| 11 | High-Assurance UI Components | |
| 12 | Interactive Transaction Flows | |
| 13 | Browser-Wipe Cold-Start Recovery Flow | |
| 14 | End-to-End Verification, Docs, Video Script | |

## 5. Phase 7 spec (from `04-BUILD-PLAN.md`)

### Task 7.1: Filtered WSS Indexer (`src/indexer.ts` + `test/indexer.test.ts`)
- Connect to `wss://rpc-regtest.tachibtc.com/tachi_ws` with `?address=<UserAddress>&blocks=true`.
- Emit typed events: `tx:pending` (height=0), `tx:committed` (height>0), `block:new`.
- Auto-reconnect with exponential backoff and a bounded event queue.
- The SDK exposes `subscribeVaultEvents({ url, onEvent, onError })`, verified in `01-VERIFIED-API.md` §14.
  At least one filter is required (address/vault/vaultId/blocks); a filterless connection is rejected.
  `maxQueuedEvents` default 10000; the stream throws past the bound rather than dropping.

### Task 7.2: Persistence store (`src/store.ts` + `test/store.test.ts`)
- `RipcordStore` interface: `getVaults()`, `saveVault()`, `getReceipts()`, `saveReceipt()`, `clear()`.
- `MemoryStore` (node/test) and `IndexedDbStore` (browser).
- Store only public data (vault records, receipts, VTXO snapshots). **Never secret keys** (mnemonic/seed live in memory only).

### Phase 7 verification gates (from the plan)
1. WSS fires `tx:pending` within ~500 ms of broadcast.
2. WSS fires `tx:committed` with a valid block height on FinalizeBlock.
3. Store persists receipts and restores them cleanly across simulated reboots.

## 6. Verified environment facts (do NOT re-discover)

- Daemon REST: `https://rpc-regtest.tachibtc.com`
- WSS: `wss://rpc-regtest.tachibtc.com/tachi_ws`
- Faucet API: `POST https://faucet.tachibtc.com/api/faucet` with JSON `{ "address": "<bcrt1…>", "amountBtc": 0.5 }`
  (the root path and `{address}`-only body return errors; amount field is `amountBtc`, not `amount`/`amountSats`).
  Faucet capacity: `GET /api/capacity?address=…`; status: `GET /api/faucet-status`.
- Chain id `tachi-regtest-1`, daemon v0.39.0. Quorum is 5-of-7 (threshold 5, 7 node pubkeys).
- All SDK reads verified (§13 of `01-VERIFIED-API.md`): `getAddressVtxos`, `getBalance`, `getAccountNonce`,
  `listVaults`, `listVtxos`, `getLockedVtxos`, `getFeeEstimate`, `subscribeVaultEvents`.

## 7. Hard traps (from memory, these cost days to re-learn)

1. **User P2TR and vault P2TR addresses are structurally identical.** `isVaultAddress` accepts both.
   NEVER gate recipients on it. The only correct check is `recipientAddress === vault.p2tr.address`.
2. **Change MUST go to the sender's own user P2TR.** Change sent to the vault address is owned by the
   vault's tweaked key and is `code=6` unspendable forever.
3. **Recipients re-spend via their OWN vault** (their own user key), not the sender's.
4. **`csvBlocks` must be persisted per vault** and passed to `discoverVaults`, or the rebuild silently
   defaults to 1008 and matches nothing.
5. **L1 blocks are activity-driven**, no scheduled miner. A csv=2 vault matures in minutes of traffic,
   never show a wall-clock countdown.
6. **Vaults are atomic (one deposit each).** Use a fresh `userKeyIndex` per funded run.
7. **SDK pin:** `taurus-vault-core@0.3.3` + `taurus-wallet-aggregator@0.4.3` + `tachi-sdk-ts@0.2.1`.
   Do NOT bump without re-probing.
8. **SDK errors carry a string `.code`** (e.g. `"VTXO_BROADCAST"`); the real CometBFT code is in
   `.tendermintCode`. `mapDaemonError` in `errors.ts` already handles this.
9. **`funding_txid` from the daemon is internal byte order**; reverse at display boundaries. `bytes.ts`
   has `toDisplayTxid`/`toInternalTxid`.
10. **CometBFT errors arrive inside HTTP 200**, inspect `result.code`, not HTTP status.
11. **Never call** `addressTransactions`, `listTransactions` (full unindexed scans), or
    `finalizeVtxoPsbt` on the send path. Enforced by `check:rules`.
12. `getAccountNonce` is **not** a replay guard (returns 0n before and after). Double-spend protection
    comes from VTXO state (`code=5`) plus the local `TxQueue`.

## 8. Unproven / blocked items (honest state)

- **Full registration loop** (`e2e-full-flow.test.ts`): proven up to funding-commit. The funding tx
  committed (1 confirmation), but the full loop is blocked by a **degraded shared faucet** (~992 BTC
  stuck in its own unconfirmed change output) and slow regtest block production (~1 block/min).
  Retry later when the faucet recovers. Not a code bug.
- **Cooperative refund**: structurally impossible to do alone (needs the 5-of-7 quorum node keys).
- **Unilateral exit broadcast**: only a PSBT builder exists; not committed. Needs a mature funding
  UTXO (2+ confirmations). Defer to Phase 9.

## 9. Working principles (from AGENTS.md + memory)

- **Live daemon is the only source of truth.** Probe before building on any SDK behavior. Docs are
  field notes; the probe wins.
- **Zero mocks / simulations** anywhere in `packages/` or `apps/`. Tests hit the real daemon.
- **End-to-end or it didn't happen:** build → sign → broadcast → wait for commit → read back.
- **Gates before any commit:** full suite green, `typecheck` green (src + `tsconfig.test.json`),
  `build` green, `npm run check:rules` green (run at REPO ROOT).
- **Zero-fault policy:** fix every issue immediately, never defer.
- No em dashes in prose (use commas/periods/parens). Regtest only; honest README.

## 10. Commands cheat-sheet

```bash
cd /home/ubuntu/ripcord
npm run check:rules                      # architecture grep gates (ROOT only)
npm run typecheck                        # workspaces
npm run build                            # workspaces

cd packages/core
npm test                                 # full vitest suite (live daemon)
npx tsc --noEmit                         # src typecheck
npx tsc --noEmit -p tsconfig.test.json   # test typecheck
```

Live probes exceed the 600s foreground terminal limit, so run them as `background=true` + wait on the
process handle. SDK `node_modules` are hoisted to the repo root (no package-level `node_modules/@tachibtc`).
