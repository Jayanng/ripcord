# RIPCORD Submission Dossier

## Scope

RIPCORD is a self-custodial Bitcoin vault wallet targeting Tachi regtest (`tachi-regtest-1`). The browser never imports Tachi SDK packages directly; `@ripcord/core` owns the verified SDK boundary.

## Verified capabilities

- Deterministic BIP-84/BIP-340 identity derivation and per-vault key indexes.
- Live 5-of-7 quorum validation and deterministic fingerprinting.
- Vault creation, L1 funding, exact script-based proof-of-reserves binding, and registration.
- Cold-start recovery across CSV candidates from mnemonic-derived identity.
- Real VTXO sends with ownership validation, queue serialization, and pending-to-committed WSS activity.
- HAT/RIP receipt retrieval and normalized Verkle inclusion linking.
- Unilateral-exit dry-run with BIP68 maturity assessment.
- Browser storage wipe recovery, restoring public vault state from the live chain.

## Live evidence

The verified API record includes real funding and transfer evidence, including transfer `A314DA548E9BCAD970EB14A45089FE5D96685D0E7036D7E181FE93490F8EE306` at epoch `449843`, code `0`. See `docs/01-VERIFIED-API.md` and `docs/09-HANDOFF-PHASE12.md` for the complete evidence trail.

## Honest limitations

Regtest only. HAT/RIP data is daemon-attested; local PSBT recomputation and IPA verification are not currently available. The public Bitcoin regtest chain mines on an approximately ten-minute cadence.

## Verification commands

```text
npm run typecheck
npm run build
npm run check:rules
npm test
npm run test:e2e
```

The Playwright recovery journey is deliberately environment-gated and requires a privately supplied `RIPCORD_E2E_MNEMONIC`; secrets are never stored in the repository.

## Final verification

- Typecheck passed across core source/tests and the wallet.
- Production/PWA build passed.
- Architecture rules passed; a temporary `vi.fn()` scratch violation was detected, removed, and the gate passed again.
- Live core suite passed uninterrupted: 19 test files and 278 tests passed; 1 env-gated file and 2 env-gated tests skipped.
- Playwright live browser suite passed: 2 tests passed, including full storage-wipe recovery, in 29.4 seconds.
