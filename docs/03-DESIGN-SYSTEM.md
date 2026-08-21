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

### ProofSheet
Bottom sheet on mobile, side panel on desktop. Renders the actual verification chain:
```
TRANSACTION   91013b84…f6a530        epoch 416525  code 0
     ↓
HAT           SHA256d over finalized PSBT
              f5a780b9…1ba86ecf
     ↓
VERKLE        stem ced50e9a…  suffix 65
              StateDiff.currentValue matches HAT ✓
     ↓
RIP CHAIN     50 epochs · 416526 → 416575
              IPA proof · 8 cl + 8 cr commitments
     ↓
FINAL ROOT    aduY+hs3nTOqzr3P6i35k0TDWz2Fuc…

L1 ANCHOR     not populated on regtest (btc_height 0)
```
The last line is deliberately present. Showing the gap honestly is more persuasive than hiding it.

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
