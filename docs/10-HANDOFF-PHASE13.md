# Phase 13 Handoff: Browser-Wipe Cold-Start Recovery

**Status:** ready to start
**Previous phase:** Phase 12 complete and pushed in commit `c4c7192`
**Branch:** `main`
**Repository:** `https://github.com/Jayanng/ripcord`
**Updated:** 2026-08-24

## Objective

Prove that the wallet can recover from a completely fresh browser state using only the original 12-word mnemonic, with no prior localStorage or IndexedDB state.

Phase 12 verified mnemonic reload while preserving public IndexedDB records. Phase 13 must verify the stronger case: a complete browser-storage wipe followed by recovery from the live chain.

Do not begin Phase 14 until the Phase 13 checklist is green.

## Current baseline

Phase 12 is complete and live-verified:

- Browser-funded onboarding and vault registration
- `LIVE` Ripcord maturity and dry-run
- Test-pull destination displayed in the evidence panel
- Three real user-key VTXO sends with pending and committed activity
- HAT/RIP proof evidence
- Known vault-address rejection
- Mnemonic reload recovery without new broadcasts
- Full live lifecycle: funding, deposit, mint, registration, recovery
- Uninterrupted test suite: **19 test files passed, 277 tests passed; 1 env-gated file and 2 env-gated tests skipped**
- `npm run typecheck` passed
- `npm run build` passed
- `npm run check:rules` passed

The worktree was clean and synchronized after the Phase 12 commit. Pull first on the local machine and verify the commit before starting.

## Important live state and safety rules

- Network: `tachi-regtest-1`
- RPC: `https://rpc-regtest.tachibtc.com`
- Faucet: `https://faucet.tachibtc.com`
- Explorer: `https://explorer-regtest.tachibtc.com`
- Quorum: live `5 of 7`
- The previously funded browser vault must not be funded again.
- Do not rebroadcast deposit, mint, or registration for the existing vault.
- Do not request another faucet payout to the same settlement address.
- Never store or commit the mnemonic.
- Never put the mnemonic in screenshots, logs, docs, fixtures, browser storage, or handoff text.
- Use a fresh mnemonic and fresh key index only if a new live test is genuinely required and the faucet budget allows it.
- Vaults are atomic. One deposit per vault. Use a fresh `userKeyIndex` for any new funded run.
- Do not test cooperative third-party VTXO cosigning. Tachi confirmed that no public client endpoint exists for it. `cosignRefund` is refund-to-self only.
- Keep the supported package pair: `taurus-vault-core@0.3.3` and `taurus-wallet-aggregator@0.4.1`. Do not upgrade to `0.4.5` before Tachi announces the compatible release.

## Scope

### Task 13.1: Recovery screen and execution stepper

Implement or refine:

- `apps/wallet/src/screens/RecoveryScreen.tsx`
- `apps/wallet/src/components/RecoveryProgress.tsx`

If the current code already has equivalent onboarding or recovery components, audit and reuse them rather than duplicating behavior.

The recovery flow must display these six live steps in order:

1. Derive BIP84/BIP340 identity keys
2. Fetch the authoritative 5-of-7 consensus quorum
3. Scan for on-chain vaults across candidate CSV parameters
4. Validate `addressMatchesRebuild === true`
5. Verify proof of reserves on L1 through exact funding-script matching
6. Reconnect the WSS indexer and restore public receipts

Each step must have explicit states such as pending, active, passed, and failed. Errors must stop the flow and explain the recovery action. Do not show success before the underlying live operation completes.

## Required browser-wipe test

Use a funded test wallet only when its mnemonic is available privately to the operator. Do not record the words.

1. Start the wallet development server.
2. Complete or use the existing funded Phase 12 wallet state.
3. Record only public evidence needed for comparison:
   - identity receive address
   - vault address
   - L1 funding outpoint
   - public balance and VTXO IDs, if appropriate
   - receipt count
4. Close or reload the browser context.
5. Clear all wallet localStorage.
6. Delete all wallet IndexedDB databases, including the public store database.
7. Confirm that no wallet public state remains locally.
8. Reload the app.
9. Enter the original mnemonic privately, with the correct key index and CSV value.
10. Run the recovery stepper.
11. Confirm all six steps pass using live daemon responses.
12. Confirm the recovered vault address, funding outpoint, reserve binding, balances, spendable VTXOs, and receipts match the pre-wipe public evidence.
13. Confirm the WSS indexer reconnects and that no deposit, mint, registration, or faucet broadcast occurred during recovery.

## Acceptance criteria

Phase 13 is complete only when all of these are true:

- A complete localStorage and IndexedDB wipe has been performed.
- Recovery starts from the mnemonic and no prior public browser state.
- All six recovery steps pass visibly in sequence.
- The recovered vault address matches the live funded vault.
- The funding outpoint and exact funding script match live daemon data.
- Proof-of-reserves verification passes against the live Bitcoin RPC.
- The recovered balance and spendable VTXOs match the live chain.
- Public receipts are restored or rebuilt from verified live evidence.
- The WSS indexer reconnects without duplicate subscriptions or duplicate activity rows.
- Recovery performs no new faucet, deposit, mint, registration, or payment broadcast.
- A bad mnemonic fails safely without mutating wallet state.
- Typecheck, build, and `npm run check:rules` pass.
- The live browser evidence and exact verification counts are recorded in this handoff before commit.

## What not to claim

Do not claim full wipe recovery from a mnemonic merely because a normal reload works. Do not claim a recovery step passed because a UI timer completed. Do not use mock daemon responses, fabricated txids, simulated confirmations, or hard-coded balances. If a path cannot be verified live, mark it untested and explain why.

## Suggested first audit

Before writing code, inspect:

- `apps/wallet/src/screens/OnboardingScreen.tsx`
- `apps/wallet/src/context/WalletContext.tsx`
- `apps/wallet/src/hooks/useBalance.ts`
- `apps/wallet/src/hooks/useActivity.ts`
- `packages/core/src/recovery.ts`
- `packages/core/src/deposit.ts`
- `packages/core/src/register.ts`
- `packages/core/src/proofs.ts`
- `apps/wallet/src/components/RipcordPanel.tsx`

Confirm the exact persistence boundary: which state is local-only, which state can be reconstructed from the live daemon, and which receipts require an explicit public-store rebuild.

## Final handoff

After Phase 13 passes, update this document with:

- Actual browser-wipe evidence
- Recovery timestamps or commit references, without secrets
- Recovered public identifiers
- Exact test and gate counts
- Any verified limitation

Then prepare Phase 14: Playwright live E2E coverage, submission dossier, README final review, and demo script.

No Phase 14 implementation should begin until this Phase 13 acceptance checklist is complete.

## Commands

```bash
git pull --ff-only
npm run typecheck
npm run build
npm run check:rules
npm test
npm run dev --workspace=apps/wallet
```

The live lifecycle suite is intentionally slow because Tachi's public Bitcoin regtest mines automatically on an approximately 10-minute cadence. Do not shorten its confirmation assertion to make it pass.

## Phase 13 rule

**Erase the browser state, not the evidence. Recover from the chain, not from assumptions.**

Do not store the mnemonic anywhere. Avoid em dashes in future edits and documentation.
