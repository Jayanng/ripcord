# RIPCORD Demo Script (3 minutes)

## 0:00–0:25 — The premise

“RIPCORD makes custody visible. This is a regtest wallet where every balance and recovery claim is tied to live Tachi and Bitcoin responses.”

Show the REGTEST badge and run preflight.

## 0:25–1:05 — Vault and reserves

Show the funded vault address, balance, funding outpoint, and reserve-binding state. Explain that the funding script is compared exactly against the live Bitcoin output.

## 1:05–1:45 — Live VTXO payment

Open Send, enter a user-owned regtest destination, and submit a real transfer. Show pending activity becoming committed through WSS, then open the receipt proof sheet to show HAT, RIP, and Verkle evidence.

## 1:45–2:25 — Unilateral exit safety

Open Ripcord and run the dry-run. Show the maturity state, decoded transaction size and CSV sequence, and the explicit no-broadcast boundary while the vault is immature.

## 2:25–3:00 — Browser-wipe recovery

Before recording, capture public identifiers privately. Wipe localStorage and every IndexedDB database, reload, and enter the mnemonic privately. Show all six recovery steps passing: identity, quorum, vault scan, address rebuild, reserve proof, and WSS/public receipt restoration. Close with: “The browser state was erased; the chain was the source of truth.”

Never show or record the mnemonic, and never request new faucet funds during the recovery segment.
