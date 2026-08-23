# Phase 11 Handoff: High-Assurance UI Components

**Status:** implementation complete; first-run browser state audited  
**Verified:** 2026-08-23

## Delivered

- Header, persistent `REGTEST` identity, responsive section/tab navigation, and shared layout.
- Separate on-chain/off-chain `BalanceHero`.
- Ripcord states (`UNFUNDED`, `MATURING`, `LIVE`, `SPENT`), real `assessExit` hook, decoded dry-run disclosure, and explicit no-broadcast copy.
- Pointer and keyboard hold-to-confirm control.
- Vault tapscript inspector and proof-of-reserves badge.
- Activity rows for pending, committed, block, and stored receipt evidence.
- Accessible proof sheet covering transaction, HAT, normalized Verkle inclusion, RIP chain, and final root.
- “Not your problem” custody-absence matrix.

## Audit outcome

The supplied desktop capture and code review found modal focus, hold announcement, target-size, hierarchy, and desktop navigation issues. Fixes now include:

- focus entry, Tab containment, Escape close, and focus restoration for the proof sheet;
- correct post-confirm hold announcements;
- visible focus on tapscript disclosure and 44px activity targets;
- stronger panel separation and more legible metadata;
- desktop section navigation and non-sticky desktop header capture behavior;
- reduced-motion support and explicit text labels alongside semantic color.

## Bundle boundary

The wallet no longer imports the broad `@ripcord/core` barrel. Core exports browser-consumable subpaths for types, store, health, exit, vault, and indexer. Preflight, exit, and tapscript logic load dynamically.

- Initial entry: 273 KB / 84.8 KB gzip.
- Health: 10.8 KB lazy chunk.
- Exit: 7.2 KB lazy chunk.
- Pinned protocol/crypto graph: deferred and absent from production HTML module preloads.
- The Node `vm` warning is removed through a safe shim that triggers `asn1.js`’s own guarded fallback.

The service worker intentionally precaches protocol chunks so cryptographic features remain available offline after installation.

## Honest verification limit

No mnemonic, vault, transaction, or proof fixture was fabricated. The browser verified the live preflight and honest empty/unfunded state. Phase 12’s real onboarding and transaction flows must exercise funded `MATURING`/`LIVE`, decoded test-pull output, real tapscript disclosure, pending/committed activity, and receipt-backed proof-sheet states.
