# RIPCORD: Design System

Dark-first, high-contrast, instrument-panel aesthetic. The product's claim is *verifiability*, so the
interface should read like a control surface that tells you the truth, not a consumer finance app that
reassures you.

## 1. Principles

**Show the proof, not a promise.** Every number that came from the chain is clickable through to its
evidence: a txid, a scriptPubKey comparison, a HAT commitment. Numbers we computed locally are visually
distinct from numbers the chain confirmed.

**Absence is a feature.** The bounty's own success criterion is "no channel management, no
force-closure risks." So we name what isn't there. A dedicated panel lists the things the user does not
have to manage. Competitors will show channel graphs; we show their absence deliberately.

**Confirmations, never clocks.** L1 blocks are activity-driven on this network. Any countdown timer
would be a lie. Exit state is always "N more confirmations".

**Two balances, never one.** On-chain and off-chain are different things with different settlement
guarantees. Blending them into a single figure would misrepresent custody.

**Fail loud, fail specific.** Daemon error codes map to plain-language causes with the actual next step.
No generic "something went wrong".

## 2. Colour

Radix Colors 3.0 (`@radix-ui/colors`), dark scales, as the semantic foundation. 12-step scales, 1 is
darkest in dark mode. Accessibility-tested and composes predictably.

```css
@import "@radix-ui/colors/gray-dark.css";
@import "@radix-ui/colors/amber-dark.css";
@import "@radix-ui/colors/jade-dark.css";
@import "@radix-ui/colors/red-dark.css";
@import "@radix-ui/colors/blue-dark.css";

:root {
  /* surfaces */
  --bg-base:      var(--gray-1);    /* #111111 page */
  --bg-raised:    var(--gray-2);    /* #191919 cards */
  --bg-overlay:   var(--gray-3);    /* #222222 modals, sheets */
  --bg-inset:     var(--gray-4);    /* #2a2a2a wells, code blocks */

  /* lines */
  --line-subtle:  var(--gray-6);
  --line:         var(--gray-7);
  --line-strong:  var(--gray-8);

  /* text */
  --text-hi:      var(--gray-12);   /* #eeeeee primary */
  --text:         var(--gray-11);   /* #b4b4b4 body */
  --text-lo:      var(--gray-9);    /* #6e6e6e muted, timestamps */

  /* semantic state */
  --confirmed:    var(--jade-9);    /* committed on chain, proven */
  --pending:      var(--amber-9);   /* mempool, state:"pending" */
  --danger:       var(--red-9);     /* errors, exit warnings */
  --info:         var(--blue-9);    /* neutral emphasis, links */

  /* the ripcord itself */
  --ripcord:      var(--red-9);
  --ripcord-live: var(--jade-9);    /* exit is spendable right now */
}
```

**Semantic rules, enforced in review:**

- `--confirmed` (jade) means *the chain committed this*: `code: 0` at FinalizeBlock, or an L1
  confirmation. Never used for optimistic UI.
- `--pending` (amber) means *seen but not final*: WSS `state: "pending"`, unconfirmed L1.
- `--ripcord-live` is reserved for exactly one thing: the exit is mature and broadcastable now.
- Bitcoin orange is deliberately **not** in the palette. Every Bitcoin product uses it; a
  precision-instrument look is more credible for a verification tool.

## 3. Type

```css
--font-sans: "Inter var", Inter, system-ui, -apple-system, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
```

**Monospace is mandatory** for: sats amounts, txids, hashes, addresses, tapscript, proof hex, block
heights, epoch numbers. Anything a user might compare character by character.

```css
--t-display: 2rem/1.1   700;   /* balance hero */
--t-h1:      1.5rem/1.2 600;
--t-h2:      1.125rem/1.3 600;
--t-body:    0.9375rem/1.5 400;
--t-small:   0.8125rem/1.4 400;
--t-mono:    0.875rem/1.5 400;
--t-micro:   0.6875rem/1.3 500;  /* labels, uppercase, 0.08em tracking */
```

Sats are grouped with thin spaces every three digits from the right: `1 234 567 sats`. Never a decimal
BTC figure in the primary position; this is a sats-native product.

## 4. Space, radius, motion

```css
--s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
--s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;

--r-sm: 6px; --r-md: 10px; --r-lg: 14px; --r-full: 999px;

--ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--d-fast: 120ms; --d-base: 200ms; --d-slow: 360ms;
```

Motion is functional only: state transitions, arrival of a confirmation, the ripcord pull. No decorative
animation. All motion respects `prefers-reduced-motion`.

## 5. Components

### NetworkBadge
Persistent, top-right, always visible. `REGTEST` in `--pending` amber with a dot. Non-dismissible. The
user should never be confused about which network their money is on.

### BalanceHero
```
┌──────────────────────────────────────────────┐
│ OFF-CHAIN · SPENDABLE NOW                    │
│ 1 234 567 sats                    [jade dot] │
│ across 3 VTXOs                               │
│ ──────────────────────────────────────────── │
│ ON-CHAIN · IN VAULTS          40 000 sats    │
│ 2 vaults · proof verified ✓         [detail] │
└──────────────────────────────────────────────┘
```
Two figures, visually separated, never summed. "proof verified" links to the spk comparison.

### RipcordPanel: the signature component
```
┌──────────────────────────────────────────────┐
│  ⟋ RIPCORD                                   │
│                                              │
│  EXIT STATUS          ● LIVE                 │
│  Your funds can leave to mainnet right now,  │
│  with your signature alone.                  │
│                                              │
│  vault      bcrt1pmph2q…jgfaqg               │
│  timelock   2 confirmations (2 of 2) ✓       │
│  route      exit leaf · user CHECKSIG only   │
│  test-pull  verified 4 min ago  [run again]  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │        PULL RIPCORD                    │  │
│  │   broadcast the real exit to L1        │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

Three states:
- **LIVE** (`--ripcord-live`): mature, broadcastable. Test-pull produced a valid tx and
  `sendrawtransaction` would succeed.
- **MATURING** (`--pending`): shows `confirmationsRemaining`. Explicit copy: *"Bitcoin regtest produces
  blocks on activity, so this advances with network traffic, not with time."*
- **UNFUNDED** (`--text-lo`): no funding UTXO.

The **test-pull** is the differentiator and needs to feel substantial. Running it reveals the built
transaction: txid, vsize, `nSequence`, the exit tapscript rendered via `describeTapscript`, and the
65-byte control block. Then it says, plainly, *"Nothing was broadcast. No sats moved."*

Pulling the real ripcord requires hold-to-confirm (1.2 s), not a click. Irreversible actions should
take deliberate physical effort.

### WhatYouDontManage
```
┌──────────────────────────────────────────────┐
│  NOT YOUR PROBLEM                            │
│  ✕ payment channels        none to open      │
│  ✕ inbound liquidity       not a concept     │
│  ✕ force closes            cannot happen     │
│  ✕ watchtower fees         node-side, free   │
│  ✓ unilateral exit         always yours      │
└──────────────────────────────────────────────┘
```
The bounty's success criterion, made literal. Each row has a one-tap explanation of why.

### ActivityRow
Amber left-border while `pending`, jade once `committed`. Shows amount, counterparty x-only key
(truncated, mono), epoch, and a proof chip. The chip is dimmed until the HAT arrives, then becomes
clickable.

**Data-contract notes (live-probed 2026-08-22, `01-VERIFIED-API.md` §14):**
- The WSS frame's `txHash` is **lowercase**; REST (`waitForTachiTxCommit`) returns **uppercase**.
  Joining a row to its receipt or proof requires case-normalizing, or the chip never lights up.
- `vout[].owner` is **not fixed width** (a 64-char x-only key and a 66-char compressed key appeared
  in the same transfer). Truncate for display, never slice at a fixed offset assuming one width.
- Anything cached for offline render goes through `bytes.ts` `serializeJson` / `deserializeJson`.
  A naive `JSON.stringify` degrades `Buffer` fields into `{type:'Buffer',data:[…]}` (Phase 7 bug), which
  would render a tapscript or scriptPubKey panel as `[object Object]` or worse, as plausible garbage.
- Proof fetches surface real HTTP failures (`404` unknown hash, `400` bad params, `502` chain gap), so
  the chip needs a distinct "proof unavailable" state, not just dimmed-vs-clickable. If the wallet ever
  reads proofs through the SDK client instead of raw `fetch`, the options are **camelCase**
  (`originEpoch` / `finalEpoch`); snake_case is silently dropped and 400s.

### ProofSheet
Bottom sheet on mobile, side panel on desktop. Renders the actual verification chain:
```
TRANSACTION   f5bd7d7f…d4e749        epoch 437193  code 0
     ↓
HAT           daemon commitment over the finalized PSBT
              f631ef7a…098713e2
     ↓
VERKLE        stem e24a6715…e50d2f  suffix 250
              StateDiff.currentValue matches HAT ✓
              key = stem || suffix ✓
     ↓
RIP CHAIN     self-proof (epoch 437193)   ·  or N epochs when closed
              IPA proof · 8 cl + 8 cr commitments (daemon-attested)
     ↓
FINAL ROOT    7XsCxbB8OhcnzHmllTo31XBkB31f5gG4s3bBcsdz…

PSBT PAYLOAD  null on regtest (HAT cannot be recomputed locally)
L1 ANCHOR     not populated on regtest (btc_height 0)
```
The last two lines are deliberately present. Showing the gap honestly is more persuasive than hiding it.

**Corrected 2026-08-23 by live probe** (see `01-VERIFIED-API.md` §16.3 / §16.5 / §16.6):
- The suffix is **not** a constant 65. It is the Verkle key's last byte and varies per VTXO (measured
  204, 250, and 148 across three transfers). Render whatever the proof carries; never hardcode.
- The "matches HAT ✓" row is a **normalized** comparison. `currentValue` is `0x`-prefixed hex while
  `hat.proof` is bare hex, so a strict equality check is false on every valid proof. If the chip ever
  shows a permanent ✗, suspect the normalization before suspecting the chain.
- Do not label HAT as a locally recomputed `SHA256d`. `rip.PSBTPayload` is `null` on regtest, so the
  commitment cannot be recomputed client-side. This is an **inclusion** proof: the daemon's HAT value
  appears in the daemon's Verkle state diff. Word the UI accordingly.
- **Never promise a fixed chain length** (the old copy said "50 epochs"). Every epoch in the requested
  window must already be CLOSED or the daemon answers `502 … not closed (chain gap)`. On a fresh
  transfer only a self-proof (window 0, `Chain: null`) is guaranteed. Render "self-proof" or the actual
  `Chain.length`, and let the sheet grow as epochs close rather than showing a broken promise.
- `FinalRoot` and the other root/commitment fields are **base64**, while stems and diff values are
  `0x`-hex. Truncate for display but do not imply a single encoding.

### VaultCard
Address, `csvBlocks`, registration state, funding outpoint, spk-verified badge, and an expandable
tapscript inspector showing both leaves plus `internalKey is NUMS ✓`.

### SendSheet
Recipient field accepts a bech32m user address or a raw 64-char x-only key, and **rejects a vault
address with an explanatory error**. R1 surfaced as UX rather than a silent failure. Shows selected
VTXOs, fee (1 sat), and change destination (own key) before confirming.

### RecoveryFlow
Mnemonic entry, then a live progress list:
```
deriving identity                    ✓ m/84'/1'/0'/0/0
reading quorum from consensus         ✓ 5 of 7
scanning for registered vaults        ✓ 2 found
rebuilding at csvBlocks 2             ✓ address matches
verifying reserves on L1              ✓ spk binding confirmed
restoring activity                    ✓ 14 receipts
```
This screen *is* the demo. It has to feel like a machine proving something.

**Recovery data must be labeled precisely:** the daemon's listed `state` and `latestStateNum` are
placeholders on the verified build (`open` and `0`), not lifecycle truth. Show the exact funding script
binding as the evidence that the recovered vault names real money. Show the recovered CSV candidate,
user-key index, quorum threshold, and fingerprint as reconstruction parameters, not as fresh on-chain
claims.

**Notes from the Phase 3 audit (2026-08-23):**
- **The derivation path is per vault, not global.** Vaults are atomic (one deposit each), so each vault
  carries its own `userKeyIndex` and the row above should render the index actually recovered
  (`m/84'/1'/0'/0/3`), not a hardcoded `/0/0`. A multi-vault recovery may legitimately show several paths.
  `deriveIdentity` takes the index explicitly (the SDK's own `deriveUserKey` needs an options **object**,
  `{ index }`, not positional args), so the UI can always show the real path.
- **"5 of 7" is two facts, both fingerprinted.** The quorum fingerprint covers the node keys *and* the
  threshold, so a change to either is a real quorum change. If a rebuilt vault's fingerprint disagrees
  with the live quorum, say which part moved (threshold vs node set) rather than a bare
  "quorum changed"; the two have very different consequences for the user.
- **A quorum-change warning must never be a false alarm.** Before the audit, `createVault` and
  `recovery.ts` computed the fingerprint two different ways, so every created vault would have compared
  unequal. There is now one canonical `computeFingerprint`, and a cached quorum is a **frozen** object so
  no view code can accidentally mutate the 5-of-7 that later screens read. If the UI ever shows this
  warning, treat it as real.
- Mnemonic entry errors now arrive as `RipcordError` with `code: INVALID_FORMAT` (the SDK's
  `InvalidMnemonicError` is wrapped), so the field can show one consistent "that phrase isn't valid"
  message with the raw reason in the details disclosure.

## 6. Layout

Mobile-first, single column, max 480px content width. Bottom tab bar: Balance, Send, Activity, Ripcord.

Desktop (≥ 900px): two columns. Left is balance, vaults and the ripcord panel. Right is activity with an
inline proof panel. Same components, no separate codebase.

PWA: installable, standalone display, dark theme colour `#111111`, maskable icon.

## 7. Accessibility

WCAG AA minimum on all text (Radix dark scales 11 and 12 on surfaces 1 through 4 clear it).
Full keyboard operation. Hold-to-confirm has a keyboard equivalent (hold Enter) and an accessible
progress announcement. Every state colour is paired with a shape or label, never colour alone. Live
regions announce arriving confirmations. `prefers-reduced-motion` removes all non-essential motion.

## 8. Empty and error states

Every empty state names the next action: no vaults → "create your first vault"; no balance → "fund from
the faucet" with the address pre-filled and copyable.

Errors show the mapped hint from the core error model plus a "details" disclosure carrying the raw
daemon message. Never swallow the original text; a builder reading our error should be able to search
it.

**This is load-bearing, not decorative (audit 2026-08-23).** `mapDaemonError` was found returning the
bare string `'Unknown error'` for any unmapped rejection, with the daemon's own text buried in
`.cause`, which left the details disclosure with nothing to show. It now keeps the raw text in the
message and preserves `daemonCode` even when the code is unmapped, so the UI can always render
"what the daemon said" beneath the friendly hint. Note where that text comes from: the daemon has no
`message` field. The reason lives in `log` (commit status), `tendermintLog` (SDK broadcast error), or
`error.message` (Bitcoin RPC proxy). Some rejections, `amount mismatch` among them, have **no numeric
code** at all, so the text is the only thing to show and the UI must not key off a code being present.

**Boot failures need the same treatment.** `preflight` returns
`probeFailures: { probe, message }[]` plus `unreachable: boolean`. A boot error screen should name the
failed probe (health, nodeInfo, liveValidators, bitcoinRpc, quorum, feeEstimate) rather than a generic
"cannot connect", and should distinguish `unreachable` (nothing answered) from a degraded daemon where
some probes succeeded. Never render a zero as a verified value: `quorumSize: 0` means the quorum probe
failed, not a 0-of-0 quorum, and `l1Height: null` must not display as height 0.

**Phase 4 data display rules:** a deposit receipt must render the actual `amountSats`, `feeSats`,
`changeSats`, and `vaultAddress` returned by the SDK. Never render `feeSats: 0n` as a placeholder; that
was a real wrapper bug, not a legitimate zero-fee result. A reserve proof is exact `scriptPubKey` binding,
not an address-only claim. Registration errors from malformed txids, VTXO ids, owners, output amounts,
or outpoint indexes should be rendered as preflight validation errors before any network submission.

The full funded deposit, onboarding, and registration loop remains env-gated. The UI must not show a
successful registration badge from the local builder alone; it needs the committed daemon result.

**Connection states (Phase 7 `VaultIndexer`, live-verified).** The indexer emits a
`connecting` / `connected` / `reconnecting` / `closed` status stream, so the UI needs all four, not a
binary online/offline dot:
- `reconnecting` carries `attempt` and `delayMs`. Show "reconnecting" rather than silence; the WSS
  stream is push-only and replays nothing, so a gap means the activity feed is stale until a resync.
- On reconnect the app must re-query (`getAddressVtxos`) rather than trust the feed. Anything rendered
  from a pre-gap snapshot should be marked stale, not shown as current.
- `RipcordCode.QUEUE_OVERFLOW` means the consumer drained slower than the daemon published and the
  indexer stopped deliberately rather than dropping events. Surface it as a recoverable "event backlog
  exceeded, reconnecting" state, never as a silent no-op.
- `isConnected` flips only after the real WebSocket handshake, so it is safe to gate a "live" badge on
  it. Do not gate on "subscription created".
