# Phase 10 Handoff: PWA Shell, Design System and Core State

**Status:** complete  
**Verified:** 2026-08-23

## Delivered

- React 18 + Vite + Tailwind wallet workspace at `apps/wallet`.
- Installable dark-first PWA manifest, SVG icon, generated service worker, and offline shell.
- Responsive instrument-panel surface with persistent `REGTEST` badge.
- `WalletProvider` with live preflight, IndexedDB public state, lifecycle state, and in-memory identity/exit state.
- `useBalance`, `useVaults`, `useActivity`, and `useRipcord` hooks consuming only `@ripcord/core`.
- Probe-specific boot failures; unavailable chain values are never displayed as verified zeroes.

## Browser Verification

The browser shell reported `tachi-regtest-1`, a `5 of 7` quorum, a live Bitcoin regtest height, and all preflight probes answered. Empty balances, zero vaults, a closed indexer, and zero receipts are honest first-run state until later identity and wallet flows load public records.

The public daemon has no browser CORS headers. Local development uses Vite as a same-origin reverse proxy: `/health` and `/tachi*` forward REST calls, while `/rpc/` forwards Bitcoin JSON-RPC. Production needs the equivalent boundary behind HTTPS.

## Gates

- `npm run check:rules` passed, including a planted-violation proof of the changed gate.
- Root and wallet typechecks passed.
- Root production build and PWA generation passed.

## Follow-ups

- The initial browser bundle is approximately 1.15 MB because the core barrel and pinned SDK graph are eagerly bundled.
- npm reports transitive vulnerabilities requiring review; do not apply a blind breaking `npm audit fix --force`.
- Phase 11 supplies the high-assurance components and real wallet interaction surfaces.
