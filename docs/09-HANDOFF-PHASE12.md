# Phase 12 Handoff: Interactive Transaction Flows

**Status:** browser lifecycle verified; final destination evidence and uninterrupted full-suite completion remain
**Updated:** 2026-08-23

## Resume Point

The browser wallet completed the real regtest onboarding lifecycle. Do not request more faucet funds, create another vault at key index 0, or rebroadcast deposit/mint/registration for this wallet.

The mnemonic is intentionally not stored. On reload, enter the same 12 words with key index `0` and CSV `2`. Never place the mnemonic in source, docs, screenshots, commits, or handoffs.

```powershell
npm.cmd run dev --workspace=apps/wallet
```

Open `http://127.0.0.1:4173`.

## Live-Verified State

- Chain: `tachi-regtest-1`
- Quorum: `5 of 7`
- Identity receive address: `bcrt1peghde6w8...erus8sxdf8`
- L1 settlement address: `bcrt1qaygy8xx9...7fh80hzzck`
- Vault: `bcrt1peyfskj5nzfjz3m9thwcleq04eevj68jh9pgaqnugcm5f4fzmrs5s3vr42f`
- L1 funding: `40,000 sats`
- Funding outpoint: `ca73775464930bfdbec48c395a3e21c7442b41b1134f3819cdb680fb87ab56a2:0`
- Registration: daemon-confirmed and recovered by funding outpoint
- Reserve: `SPK BOUND`
- Off-chain balance after three real 1,000-sat sends: `76,994 sats` across two live VTXOs
- Ripcord: `LIVE`, CSV `2` (`24` confirmations observed after reload recovery)
- Indexer: connected
- Saved browser receipts: `3`, restored after mnemonic re-entry

The two VTXOs are real daemon state. Earlier non-idempotent retries minted an extra `39,999-sat` VTXO before recovery was fixed. Do not hide this balance. Current code checks live funding, VTXOs, and registration before broadcasting, preventing further duplicates.

## Implemented Fixes

- Resumable faucet confirmation per settlement address.
- Existing L1 funds can continue without the original faucet txid.
- Bound browser `fetch` fixes Chromium `Illegal invocation`.
- Plaintext HTTP is allowed only for loopback regtest proxies.
- Live `scantxoutset` recovers and script-binds existing vault funding.
- Existing VTXOs and registered vaults are recovered before mint/register.
- Registration output correctly subtracts its 1-sat fee.
- Live VTXO balances refresh every five seconds behind `@ripcord/core`.
- Strict Mode indexer cleanup and event deduplication prevent repeat rows.
- Zero-transaction Tachi block heartbeats are hidden from Activity.
- PWA updates activate immediately.
- L1 height and Ripcord maturity refresh automatically without constructing an exit.
- Ripcord readiness is bound to the exact identity-matched vault; broadcast stays disabled until a fresh test-pull succeeds.
- User and vault P2TR addresses are treated as structurally identical; Send rejects only vault addresses actually known to the wallet.
- Loopback daemon calls pass the SDK's explicit `allowInsecureHttp` and browser-bound `fetch` options through the entire transfer path.
- Activity merges pending/committed daemon events with saved receipts by case-normalized tx hash, showing payment or owned-output amounts rather than total transaction outputs.
- Deterministic mnemonic re-entry recovers funding and registration from `scantxoutset` plus `listVaults` without deposit, mint, registration, or faucet broadcasts.

## Browser Verification Results

1. **Passed:** Ripcord advanced to `LIVE` from live `gettxout.confirmations`.
2. **Partial:** test-pull produced a real txid, `125 vB`, `nSequence=2`, CSV exit leaf, user `CHECKSIG`, and 5-of-7 cooperative leaf. The destination is used by core but is not yet displayed in the evidence panel.
3. **Passed:** `PULL RIPCORD` remained unused; no unilateral exit was broadcast.
4. **Passed:** a second mnemonic/browser profile produced a distinct `bcrt1p...` user receive address.
5. **Passed:** real 1,000-sat user-key transfers committed. One recorded full hash is `A314DA548E9BCAD970EB14A45089FE5D96685D0E7036D7E181FE93490F8EE306` at epoch `449843`, code `0`.
6. **Passed:** pending and committed activity appeared once per lifecycle state on sender and receiver.
7. **Passed:** three sends reduced `79,997` to `76,994 sats`, exactly `3 * (1,000 + 1)`; receiver received 1,000 sats per tested transfer and change remained sender-owned.
8. **Passed:** sender proof sheet showed HAT, RIP self-proof, matching transaction evidence, closed epochs, final root, and `hatInStateDiff: true`.
9. **Passed:** reload plus the same mnemonic/index restored the 40,000-sat funding binding, `SPK BOUND`, `LIVE`, 76,994-sat VTXO balance, and three receipts without new broadcasts.
10. **Passed:** the known vault address was rejected before transaction construction or broadcast.

## Protocol Limitation

Tachi clarified that `cosignRefund` is refund-to-self only, `VaultCosignAnnouncement` is internal P2P gossip, and no public RPC currently collects 5-of-7 partials for arbitrary third-party vault-cosigned transfers. Do not present refund cosigning as a general payment cosigner. Verify the user-key VTXO send path independently.

## Gate Status

- Full workspace typecheck passed on 2026-08-23.
- Full workspace production/PWA build passed on 2026-08-23.
- Architecture and zero-mock rules passed when the CRLF shell file was executed through an LF-normalized stream. Direct `npm run check:rules` on this Windows checkout still fails before the checks at `set -o pipefail` because the script has CRLF endings.
- The final live `npm test` run passed types, errors, bytes, indexer, payment, proofs, vault, store, quorum, exit dry-run, Verkle, and recovery suites before the long-running process was interrupted. Do not claim the final invocation completed successfully; rerun it uninterrupted before commit.
- `exit-run.test.ts` remained correctly env-gated/skipped because mature L1 exit broadcast intentionally spends the vault.

Before commit, rerun all repository gates because the worktree is uncommitted and contains the complete Phase 12 implementation.

## Honest Completion Boundary

Funding, L1 deposit, VTXO minting, vault registration, reserve binding, live balance, Ripcord maturity/dry-run, browser send, pending-to-committed transition, proof sheet, mnemonic reload recovery, receipt persistence, and vault-address rejection were exercised against regtest. Phase 12 should remain open only until the test-pull panel displays its destination and the final live suite completes uninterrupted.
