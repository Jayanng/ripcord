# Signet Support: Submission Note

The Tachi team invited hackathon entries to add Signet support:

> "Signet Support for Hackathon Projects. As you may know, Tachi is live on
> Signet. To enhance testing and implementation for the hackathon, we're
> encouraging all qualified entries to add Signet support to their projects.
> [...] Access our Signet faucet here: faucet.tachibtc.com. We'd love to see
> your projects running on Signet!" (Tachi team message, 2026-10-14)

RIPCORD took that invitation and ran the full protocol on Signet.

## What RIPCORD demonstrates on Signet

The complete non-custodial money path, live and verified hop by hop:

1. **Faucet funding** through the official sign-in faucet (the app hands off,
   it does not wrap the faucet).
2. **L1 deposit** into a deterministic 5-of-7 TAURUS vault with the funding
   outpoint bound to the vault address.
3. **Mint** of a spendable VTXO and **registration** with the live quorum.
4. **Off-chain transfers** with HAT proofs, committed at a real epoch, verified
   against the daemon (sender and receiver sides).
5. **Sovereign exit**: a unilateral, user-signature sweep back to L1 through the
   CSV exit leaf, where the dry-run transaction id matched the broadcast
   transaction id exactly and the witness provably carries the exit leaf inside
   the on-chain vault address.

Every hop's transaction ids, block heights, epochs, and proof artifacts are
listed in `SIGNET-SUPPORT.md` and reproducible from the public signet chain.

## Design notes the judges may care about

- **Network selection precedes all key material.** A user opening the app picks
  Tachi regtest or Tachi Signet first; the choice is stamped on the identity and
  every vault record. A wallet is permanently bound to its network: in a signet
  session no regtest string, address, RPC path, or label appears anywhere in
  the UI. Enforced by `scripts/dom-sweep.mjs`, an automated gate that sweeps
  every screen (text, tooltips, links, metadata, tab title) and the request
  stream of a live signet journey, and refuses hollow passes.
- **Regtest is untouched.** Signet support is a second layer on a separate
  branch and deployment; the regtest derivation output is byte-identical to the
  previous release and the regtest production deployment keeps serving as
  before.
- **Proof before promise.** Exit certificates carry the raw transaction, the
  spent outpoint, the destination, amounts, fees, the block hash, and an
  explorer link at the top level, with the exit-leaf/control-block evidence in
  the certificate's evidence block, and the UI labels demo parameters (CSV = 2
  blocks vs the production default of 1008) as demo-only.

## Try it

- Signet build: https://ripcord-signet.vercel.app
- Regtest build (unchanged): https://ripcord-wallet.vercel.app
- Faucet: https://faucet.tachibtc.com/signet (GitHub or X sign-in, 0.005 BTC
  per account per day)
