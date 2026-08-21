---
version: alpha
name: Ripcord
description: Dark instrument-panel wallet. Verifiability over reassurance. You can always leave, alone.
colors:
  primary: "#EEEEEE"
  secondary: "#B4B4B4"
  tertiary: "#8E2428"
  neutral: "#111111"
  on-primary: "#111111"
  on-tertiary: "#FFFFFF"
  raised: "#191919"
  overlay: "#222222"
  inset: "#2A2A2A"
  muted: "#8D8D8D"
  confirmed: "#115E59"
  pending: "#FFC53D"
  info: "#0090FF"
  live: "#115E59"
typography:
  h1:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h2:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.3
  body-md:
    fontFamily: Inter
    fontSize: 0.9375rem
    lineHeight: 1.5
  display:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  label-caps:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: 500
    letterSpacing: "0.08em"
  mono:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    lineHeight: 1.5
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.sm}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  button-live:
    backgroundColor: "{colors.live}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.sm}"
    padding: 12px
  card:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 24px
  badge-network:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.pending}"
    rounded: "{rounded.full}"
    padding: 8px
  panel-ripcord:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: 24px
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
  well:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    padding: 12px
  chip-confirmed:
    backgroundColor: "{colors.confirmed}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    padding: 8px
  timestamp:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.muted}"
  link:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.info}"
---

## Overview

Ripcord is a self-custodial Bitcoin wallet on Tachi whose claim is verifiability, not reassurance. The interface reads as a control surface: two honest balances, cryptographic receipts, and an escape hatch you can test-pull before you ever need it. Dark-first, high contrast, no Bitcoin orange. The name is the product: you pull the ripcord to leave, alone, without anyone's permission.

## Colors

- **Primary ({colors.primary}):** High-emphasis text and amounts.
- **Secondary ({colors.secondary}):** Body copy.
- **Tertiary ({colors.tertiary}):** The ripcord. Irreversible or high-stakes action only. One high-emphasis control per screen.
- **Neutral ({colors.neutral}):** Page background (`#111111`).
- **Confirmed ({colors.confirmed}):** Chain-committed only (`code: 0` or an L1 confirmation). Never optimistic UI.
- **Pending ({colors.pending}):** Seen but not final (WSS `pending`, unconfirmed L1). Also the REGTEST badge.
- **Live ({colors.live}):** Exit is mature and broadcastable now. Reserved for that one meaning.

## Typography

Inter for UI. JetBrains Mono for sats, txids, hashes, addresses, tapscript, proofs, heights, epochs. Sats grouped with thin spaces every three digits. Never lead with a decimal BTC figure.

## Layout

Mobile-first, max 480px content column. Bottom tabs: Balance, Send, Activity, Ripcord. Desktop ≥900px: two columns, same components. 4px spacing baseline. Confirmations, never countdown clocks.

## Elevation & Depth

No decorative shadows. Depth is surface steps: base `#111111`, raised `#191919`, overlay `#222222`, inset `#2A2A2A`. Borders use gray-6 through gray-8.

## Shapes

Modest radii. `sm` on buttons, `md` on cards, `lg` on the Ripcord panel, `full` on the network badge.

## Components

- `button-primary` is Pull Ripcord (hold-to-confirm 1.2s).
- `button-live` is the mature-exit state of that same control.
- `card` is default grouping.
- `badge-network` is persistent, non-dismissible REGTEST.
- `panel-ripcord` is the signature surface: LIVE / MATURING / UNFUNDED plus test-pull.

## Do's and Don'ts

- **Do** show on-chain and off-chain as two figures. Never sum them.
- **Do** name absence: no channels, no inbound liquidity, no force closes.
- **Do** make every chain-sourced number clickable to evidence.
- **Don't** use Bitcoin orange.
- **Don't** use jade for optimistic or local-only numbers.
- **Don't** show a wall-clock CSV countdown. L1 blocks are activity-driven.
- **Don't** nest component variants. Hover states are sibling keys.
