# RIPCORD — Verified API Contract

Every signature below was executed against the live Tachi daemon at
`https://rpc-regtest.tachibtc.com` on 21 Aug 2026. Nothing here is inferred from documentation.
Where the official docs disagree, the docs are wrong — this file is the source of truth for the build.

Legend: **VERIFIED** = executed successfully. **BLOCKED** = executed and failed, do not use.

---

## 0. Install

```bash
npm install @tachibtc/taurus-vault-core@0.3.3 \
            @tachibtc/taurus-wallet-aggregator@0.4.3 \
            @tachibtc/tachi-sdk-ts@0.2.1 \
            bitcoinjs-lib@^7.0.1
```

- These are on **public npm**. No `.npmrc`, no GitHub Packages, no PAT. The package README claiming
  otherwise is wrong.
- The README's pin of `taurus-wallet-aggregator@0.4.1` **does not exist**. Published versions are
  0.4.3 / 0.4.4 / 0.4.5. `vault-core@0.3.3` declares `0.4.3`. Use 0.4.3.
- `package.json` must contain `"type": "module"`.
- `tsconfig.json` must use `"target": "ES2022"` or the aggregator's `.d.ts` fails with TS18028
  (private identifiers). Also set `"skipLibCheck": true`.
- bitcoinjs-lib v7 returns `Uint8Array`, not `Buffer`. Use the SDK's exported `toBuf` and `bytesEqual`
  at every PSBT boundary. `sig.pubkey.toString("hex")` silently yields `"1,2,3,…"`.
- Node >= 22 (the SDK's WSS support uses the global `WebSocket`).

## 1. Endpoints

| Thing | Value |
|---|---|
| Daemon REST | `https://rpc-regtest.tachibtc.com` |
| WSS | `wss://rpc-regtest.tachibtc.com/tachi_ws` |
| Bitcoin JSON-RPC proxy | `POST https://rpc-regtest.tachibtc.com/` |
| Broadcast | `https://rpc-regtest.tachibtc.com/tachi_txBroadcastSync` |
| Faucet | `https://faucet.tachibtc.com` — 0.5 BTC per address per rolling 24h, accepts any `bcrt1…` |
| Chain id | `tachi-regtest-1`, daemon v0.39.0 |

Every route is namespaced `tachi_` **except** `/health` and the Bitcoin proxy at `POST /`.
SDK versions before 0.2.0 used unprefixed paths and 404 against the current daemon.

Signet is **not** usable: the faucet and the permitted wallet RPCs are regtest-only.

## 2. Quorum

```ts
const q = await vc.fetchConsensusQuorum({ baseUrl: DAEMON });
// → { nodePubkeys: string[7], threshold: 5, source: "consensus", validators: [...] }
```

**VERIFIED.** `baseUrl`, not `endpoint`. This is the authoritative quorum, read from the genesis
CometBFT validator set. An env-var node list is a guess.

Lower-level alternative:

```ts
const raw = await vc.fetchValidatorNodeKeys({ endpoint: `${DAEMON}/tachi_validators` });
// → [{ pubkeyHex: "d3a1…", compressedHex: "02d3a1…" }, …]
const nodePubkeys = raw.map(v => v.compressedHex);   // MUST use compressedHex
```

`getHealth()` returns `{status:"ok", validators:1}` — that `1` is this node's peer count, **not** the
consensus set size. `getLiveValidators()` returns all **7**. Do not read health as a quorum signal.

## 3. Key derivation

```ts
const netObj = agg.getNetwork("regtest");            // a network OBJECT, not the string
const desc = vc.deriveUserKey(MNEMONIC, netObj);
// → { version:1, scheme:"bip84-p2wpkh", purpose:84, coinType:1, network:"regtest",
//     account:0, change:false, index:0, path:"m/84'/1'/0'/0/0",
//     publicKey:"02e7ab…" (66-char compressed), masterFingerprint, address:"bcrt1q…",
//     addressType:"p2wpkh" }
```

**VERIFIED.** Passing the string `"regtest"` throws
`Invalid format: … received "m/84'/undefined'/0'"`. The docs show the string form. The docs are wrong.

Signer construction that works:

```ts
const ks = agg.Keystore.fromMnemonic(MNEMONIC, "", netObj, "p2wpkh", 0);
const node = ks.signerFor(false, 0);                 // (change, index)
const userSigner = vc.normalizeTaprootSigner({
  publicKey:   Buffer.from(node.publicKey),
  sign:        (h: Buffer) => Buffer.from(node.sign(h)),
  signSchnorr: (h: Buffer) => Buffer.from(node.signSchnorr(h)),
});
```

x-only key = `desc.publicKey.slice(2)` (drop the compression byte).

## 4. L1 wallet

```ts
const rpc  = new agg.BitcoinCoreRpcClient({ url: `${DAEMON}/` });
const aggr = agg.WalletAggregator.fromMnemonic(MNEMONIC, { network: "regtest", rpc });
const w    = aggr.addAccount({ addressType: "p2wpkh" });
await w.sync();
```

**VERIFIED.** Wallet fields are **accessors, not properties**:

| Use | Do not use |
|---|---|
| `w.receiveAddress` | `w.address` (always `undefined`) |
| `w.changeAddress` | — |
| `w.balance` → `{confirmed, unconfirmed, total}` bigints | — |
| `w.utxos` → array | — |
| `w.info` → full record incl. `addressType`, `accountPath`, `accountXpub` | `w.addressType` (undefined) |

**BLOCKED — `vc.importUserWallet(...)`** → `RPC scantxoutset failed: bitcoin rpc error -5: Address is
not valid`. Use `WalletAggregator.fromMnemonic().addAccount()` instead.

**BLOCKED — `w.send({to, amountSats, feeRateSatVb})`** → `feeRate must be a finite number ≥ 1 sat/vB,
got undefined`. Correct argument name not discovered. Do all L1 movement through `depositToVault` and
the Bitcoin proxy's `sendrawtransaction`.

Only p2wpkh (BIP84) is supported by the aggregator's HD signer. p2pkh, p2sh-p2wpkh and p2tr were
removed in 0.3.x. Every doc sample using `addressType: "p2pkh"` fails at `depositToVault`.

## 5. Vault creation

```ts
const vault = await vc.createVault({
  network: "regtest",
  nodePubkeys: q.nodePubkeys,
  csvBlocks: 2,                       // omit for the 1008 default
  userKeyDescriptor: desc,            // or userWallet: w
});
vc.verifyVaultP2tr(vault.p2tr);       // re-derives both leaves, NUMS key, tweaked output key
```

**VERIFIED**, and deterministic: identical `(network, userKey, nodeKeys, csvBlocks)` reproduces the
identical address.

`vault.p2tr` fields: `address`, `output`, `taprootOutputKey`, `internalKey`, `cooperativeLeaf`,
`exitLeaf`, `cooperativeLeafHash`, `exitLeafHash`, `cooperativeControlBlock`, `exitControlBlock`,
`network`, `leafVersion`.

Verified tapscript via `vc.describeTapscript(script)`:

```
exit  (csv=2)     OP_2  OP_NOP3 OP_DROP <userXOnly> OP_CHECKSIG
exit  (csv=1008)  f003  OP_NOP3 OP_DROP <userXOnly> OP_CHECKSIG
coop              <userXOnly> OP_CHECKSIGVERIFY <n1> OP_CHECKSIG <n2..n7> OP_CHECKSIGADD
```

`OP_NOP3` is `OP_CHECKSEQUENCEVERIFY`. `f003` is 1008 little-endian. Cooperative leaf carries exactly
6 `OP_CHECKSIGADD` + 1 `OP_CHECKSIG` = user + 7 node keys. `exitControlBlock` is **65 bytes**.
`internalKey` equals `vc.NUMS_INTERNAL_KEY`, so the key path is provably unusable.

**Vaults are atomic — one deposit each.** A second `depositToVault` on a funded vault is rejected:
*"vault … is already funded (1 UTXO(s), 40000 sats) — vaults are atomic (one deposit per vault);
create a new vault for another deposit."* Use a fresh `userKeyIndex` per vault.

## 6. Deposit (L1 → vault)

```ts
const dep = await vc.depositToVault({
  vault, userWallet: w, rpc,
  amountSats: 40000n,
  feeRateSatVb: 2,
});
// → { txid, rawTxHex, … }
```

**VERIFIED.** Rejects any non-p2wpkh wallet by design, so the deposit txid stays non-malleable for the
pre-signed refund and exit paths.

Proof of reserves — the only check that binds a rebuild to real money:

```ts
const tx = await btcRpc("getrawtransaction", [dep.txid, true]);
const vout = tx.result.vout.find(o => o.scriptPubKey.address === vault.p2tr.address);
vout.scriptPubKey.hex === vault.p2tr.output.toString("hex");   // VERIFIED true
```

**Deposits are not idempotent.** Re-signing a retry mints a second deposit. Sign once, cache the exact
bytes, resubmit those bytes.

## 7. Ledger onboarding (mint a spendable VTXO)

```ts
const nonce = await vc.getAccountNonce(Buffer.from(desc.publicKey, "hex"), { baseUrl: DAEMON });
const draft = vc.buildTachiTxDeposit({
  userXOnly: xOnlyBuf,
  amountSats: 40000n,
  nonce,
  feeSats: 1n,                        // 0n → code=8 fee below minimum
});
const signed = await vc.signTachiTx(draft, userSigner);
const vtxoId = Buffer.from(vc.vtxoIdFromDeposit(signed, 0)).toString("hex");
const b = await vc.broadcastTachiTx(signed, { url: `${DAEMON}/tachi_txBroadcastSync` });
// → { accepted: true, tendermintTxHash: "CEBB58…", log: "" }
const st = await vc.waitForTachiTxCommit(b.tendermintTxHash, { baseUrl: DAEMON, timeoutMs: 90000 });
// → { code: 0, state: "committed", epoch: 415925, … }
```

**VERIFIED.** `accepted: true` is a **mempool verdict only**. Quorum, threshold and fee-balance checks
run at `FinalizeBlock`. Always wait for `code === 0`.

`getAccountNonce` takes a **Buffer**, not a hex string.

## 8. Vault registration (makes it discoverable)

```ts
const txidBuf = Buffer.from(dep.txid, "hex").reverse();   // INTERNAL byte order
const reg = await vc.registerVault({
  vault,
  outpoint: { fundingTxid: txidBuf, fundingVout: vout.n },
  userSigner,
  inputs:  [{ vtxoId: Buffer.from(vtxoId, "hex") }],      // MUST spend a ledger VTXO
  outputs: [{ owner: xOnlyBuf, amount: 40000n - 1n }],    // note: `amount`, not `valueSats`
  feeSats: 1n,
  account:   { baseUrl: DAEMON },
  broadcast: { url: `${DAEMON}/tachi_txBroadcastSync` },
  confirm:   { baseUrl: DAEMON },                          // mandatory in spirit
});
// → { vaultId, vaultIdHex, nonce, signedTx, broadcast, commit }
```

**VERIFIED.** Registration is a **ledger spend**, so you must onboard a `TxDeposit` first to have a
VTXO to spend. The docs never mention `registerVault` at all. `feeSats: 0n` is rejected despite the
type doc calling it common.

Registration is per funding outpoint; re-registering fails with `CodeVaultAlreadyExists`.

Optional `name` (1–64 printable ASCII) is set-once, not unique, public, unescaped, and a daemon
predating names rejects the whole open. Omit it.

## 9. Cold-start recovery

```ts
const vaults = await vc.discoverVaults({
  userPubkey: desc.publicKey,          // 66-char compressed hex
  network: "regtest",                  // omitting → "unknown vault network undefined"
  nodePubkeys: q.nodePubkeys,          // or validators: { endpoint }, or query.apiKey
  csvBlocks: 2,                        // CRITICAL — see below
  query: { baseUrl: DAEMON },          // nested, not top-level
});
// → [{ vault, summary, userKeyIndex, verified, paramSource, addressMatchesRebuild }]
```

**VERIFIED.** Four separate traps, all found the hard way:

1. `network` is required or it throws.
2. A quorum source is required (`nodePubkeys`, `validators`, or `query.apiKey`).
3. `baseUrl` must be nested under `query`.
4. **`csvBlocks` must match the vault or the rebuild is silently wrong.** The daemon **redacts
   `csv_delay`** from `listVaults` without an apiKey, so `discoverVaults` defaults to 1008. Measured:
   without `csvBlocks` → 0/2 vaults matched; with `csvBlocks: 2` → 2/2 and
   `addressMatchesRebuild: true`. **Persist each vault's `csvBlocks` locally, or pass an apiKey.**

`summary` carries `vaultId`, `state`, `latestStateNum`, `fundingTxid` (**internal** byte order),
`fundingVout`, `address`.

## 10. Off-chain transfer — the load-bearing discovery

The Tachi team told a builder there is no public path for third-party VTXO transfers, and the README
says the 5-of-7 quorum signs "out-of-band". **Both statements are about the Bitcoin PSBT layer and do
not apply to the ledger layer.** Value on Tachi moves by a TachiTx envelope committed through CometBFT
on the strength of the owner's BIP-340 signature alone.

```ts
// Recipient address = bech32m of the recipient's OWN x-only key.
const payAddr = btc.address.fromOutputScript(
  Buffer.concat([Buffer.from([0x51, 0x20]), recipientXOnly]),
  btc.networks.regtest,
);

const inputs = [{ vtxoId, txid: L1_TXID, vout, valueSats }];   // txid+vout+valueSats REQUIRED
const outputs = [
  { address: payAddr,  valueSats: pay    },                    // `valueSats`, not `amount`
  { address: ownAddr,  valueSats: change },                    // change to OUR OWN key
];

const built = vc.buildVtxoPsbt({
  vault,
  inputs: [{ txid: L1_TXID, vout, valueSats, scriptPubKey: vaultSpkHex }],
  outputs,                                    // MUST MIRROR the envelope outputs exactly
  feeSats,
});
await vc.signVtxoPsbtAsUser(built.psbt, userSigner, vault, { maxFeeSats });
// DO NOT call finalizeVtxoPsbt — needs 5 node sigs and is NOT required.

const draft = vc.buildTachiTxTransfer({ vault, inputs, outputs, feeSats, nonce, psbt: built.psbt });
const signed = await vc.signTachiTx(draft, userSigner);
const b = await vc.broadcastTachiTx(signed, { url: `${DAEMON}/tachi_txBroadcastSync` });
const st = await vc.waitForTachiTxCommit(b.tendermintTxHash, { baseUrl: DAEMON });
// VERIFIED: code 0, epoch 416525. Recipient re-spent independently at epoch 416527.
```

### The two rules that make or break this

**Pay to the recipient's user key, never to a vault address.** A ledger VTXO is owned by whatever
x-only key is in its `owner` field, and only a signer for that exact key can spend it. Paying a vault
address sets `owner` to the vault's tweaked taproot key, which the user's key cannot sign for →
`code=6 unauthorized: pubkey does not own vtxo`. **Change follows the same rule** or the change is
unspendable.

**PSBT outputs must mirror envelope outputs exactly**, foreign P2TR included → otherwise
`code=12 invalid transaction format`.

### Why this is legitimate, not a bypass

Adversarial probes, all rejected by consensus:

| Attack | Daemon response |
|---|---|
| Corrupted `psbtPayload` (64 bytes XOR-flipped) | `code=12 invalid transaction format` |
| Value inflation (12,000 in → 501,000 out) | `amount mismatch: sum(inputs)=12000 sum(outputs)=501000 fee=1` |
| Wrong signer (Bob signs Alice's tx) | `signer pubkey … does not match tx.pubKey …` |
| Forged envelope signature (64 × `0x11`) | `code=3 invalid signature` |
| Spending someone else's VTXO | `code=6 unauthorized: pubkey does not own vtxo` |
| Double spend | 1st commits, 2nd `code=5 vtxo already spent` |

And the decisive test: a transfer whose PSBT carried **no signatures at all** still committed
(`code 0`, hash `47A6D7FA…`). The PSBT is validated for structure; the ledger authorisation is the
envelope signature checked against `tx.pubKey` checked against the VTXO's `owner`.

Keep calling `signVtxoPsbtAsUser` anyway so the settlement artifact is as complete as a client can make
it. Never call `finalizeVtxoPsbt` on the send path.

## 11. Unilateral exit

```ts
const built = vc.buildUnilateralExitPsbt({
  vault,
  funding: {
    txid: DISPLAY_TXID,                 // DISPLAY order — see byte-order note
    vout, valueSats,
    scriptPubKey: vaultSpkHex,          // REQUIRED
  },
  outputs: [{ address: segwitAddr, valueSats: valueSats - feeSats }],   // must be SegWit
  feeSats,
});
// → { psbt, controlBlock (65 bytes), sequence }

const vopts = { maxFeeSats, expectedUserKey: vault.userKey.xOnly, minCsvBlocks: 2 };
vc.verifyUnilateralExitPsbt(built.psbt, vault, vopts);
await vc.signUnilateralExitPsbtAsUser(built.psbt, userSigner, vault, vopts);
const raw = vc.finalizeUnilateralExitPsbt(built.psbt, vault, vopts);   // returns a raw BUFFER
const hex = raw.toString("hex");
await btcRpc("sendrawtransaction", [hex]);
```

**VERIFIED end to end.** Real L1 broadcasts: `99974a15b78326811e93c66c540306f84950323f53fbee1b0966b787c95c71dc`
and `e4840102e6bca4d9f5e0b4a7dfe44577a75e8bc50f3b3b0441322f8c4c2d08d9`.

`finalizeUnilateralExitPsbt` returns a **Buffer**, not `{hex}`.

`verifyUnilateralExitPsbt` requires `expectedUserKey` and `minCsvBlocks` — these stop a substituted
but self-consistent vault from redirecting the exit or collapsing the timelock.

### CSV maturity

Immature → `sendrawtransaction` returns `bitcoin rpc error -26: non-BIP68-final`. This is exactly the
signal the dry-run uses.

Measured transition: deposit at L1 height 8865 → 1 conf at 8866 → **rejected** → activity pushed 8867
→ 2 confs → **accepted**.

**L1 regtest has no scheduled miner. Blocks are produced by activity.** So a `csvBlocks: 2` vault
matures in minutes of network traffic, and 1008 is not demo-viable. Never show a wall-clock countdown;
show "needs N more confirmations".

### Byte-order trap

`listVaults` returns `funding_txid` in **internal** order. `getrawtransaction` and
`buildUnilateralExitPsbt.funding.txid` want **display** order. They are exact reverses. Using the wrong
one gives `bad-txns-inputs-missingorspent`, which reads like a missing UTXO rather than a byte bug.

```ts
const display  = Buffer.from(internalHex, "hex").reverse().toString("hex");
const internal = Buffer.from(displayHex,  "hex").reverse();
```

## 12. Cooperative refund (secondary exit)

`vc.cosignRefund` → `POST /tachi_signTransaction` collects the quorum's tapScriptSig partials, but it is
**structurally refund-to-self only**: each quorum member independently rebuilds the vault's canonical
`to_local` output and signs only if `outputs[0]` matches. It cannot be pointed at a third party. Team-
confirmed.

Chain: `buildRefundPsbt` → `verifyRefundPsbt` → `signRefundPsbtAsUser` → `cosignRefund` →
`applyRefundCosignPartials` → `finalizeRefundPsbt` → broadcast → later
`buildToLocalSelfExitPsbt` → sign → finalize → broadcast after `toSelfDelay`.

Not on the critical path for RIPCORD. Implement behind the same `ExitStrategy` interface as the
unilateral path and label it clearly.

## 13. Reads

```ts
await vc.getFeeEstimate({ baseUrl });                       // { minFeeSats:1n, avgFeeSats:0n, recommendedFeeSats:1n }
await vc.getAddressVtxos(addrOrPubkeyHex, { baseUrl });      // { pubkey, count, vtxos[] }
await vc.getBalance(pubHex, { baseUrl });                    // { pubkey, balanceSats: bigint }
await vc.getAccountNonce(pubBuf, { baseUrl });               // bigint
await vc.listVaults(pubHex, { baseUrl });                    // { user, vaults[], total, page, pageSize, totalPages }
await vc.getLockedVtxos(vaultAddr, { baseUrl });             // { vault, count, vtxos[] }
await vc.listVtxos({ baseUrl });                             // { vtxos[] }
```

Positional value first, options object second. All return **bigints** where relevant, so a plain
`JSON.stringify` throws — use a replacer.

`TachiClient` (sdk-ts) — all 15 reads verified: `getHealth`, `getNodeInfo`, `getStats`, `getSupply`,
`getFeeEstimate`, `getValidators`, `getLiveValidators`, `getWatchtowerStatus`, `getWatchtowerReceipts`,
`listEpochs`, `listBlocks`, `listVtxos`, `listVaults`, `getAddress`, `getMempool`.

`getAddress(pubkey)` → `{ pubkey, balance_sat, nonce, vtxo_count }`.

### Never call these

`getAddressTransactions` and `listTransactions` are **full unindexed chain scans**. Tachi's own
engineer measured **17.1 s** for an address with 2 matching transactions (`scanned_from_height: 115115,
scanned_to_height: 1`) and `listTransactions` exceeding an 8 s timeout, and wrote "impractically slow"
in `tachi-sdk-ts` issue #21. RIPCORD must contain **zero** call sites for either.

### Do not trust

`validateTachiTxOnDaemon` (`/tachi_txValidate`) reports **false negatives** — it rejects transactions
the daemon then commits. Use `decodeTachiTxOnDaemon` to inspect, never gate a broadcast on validate.

## 14. Live events (WSS)

```ts
const sub = vc.subscribeVaultEvents({
  url: `${WSS}?address=${encodeURIComponent(addrOrXOnlyHex)}`,
  onEvent: (ev) => { … },
  onError: (e) => { … },
});
```

**VERIFIED.** Both filter forms work: bech32m P2TR address, or raw x-only pubkey hex.

Two-phase delivery, verified:

```
event=tx state=pending    type=transfer txHash=768f0244… height=0
event=tx state=committed  type=transfer txHash=768f0244… height=417193
```

So the UI shows "incoming" instantly and "confirmed" on commit, with no polling.

Filters: `address`, `vault`, `vaultId`, `blocks`, `validators`. **At least one filter is required** —
the daemon rejects a filterless connection. Block events verified via `?blocks=true`.

Backpressure: events buffer up to `maxQueuedEvents` (default 10,000), then the stream throws rather
than silently dropping. Leaving the loop by any means closes the socket.

## 15. Watchtower

```ts
await client.getWatchtowerStatus();
// → { mode: "detection", last_scanned_height: 8880, receipt_count: 0,
//     sweep_threshold: 5, bounty_configured: false }
await client.getWatchtowerReceipts();   // → { count: 0, receipts: [] }
```

**VERIFIED.** `mode` escalates `detection` → `responder` (co-signs peers' sweeps) → `initiator`
(originates sweeps). Breach receipts are observed L1 vault spends.

## 16. HAT / RIP proofs

**The SDK wrapper drops the query params.** `client.getTransaction(hash, {hat:true})` returns a `hat`
key with no data. Hit the REST route directly.

```ts
// HAT — requires a SPENT VTXO. Deposits are rejected:
//   "400 — tx has no inputs; hat/rip proofs require a spent VTXO"
const r = await fetch(`${DAEMON}/tachi_tx?hash=${txHash}&hat=true`);
const { hat } = await r.json();
// → { vtxo_id, btc_timestamp: 0, btc_height: 0,
//     proof: "f5a780b95eefe297a9d0b8d4f31fcae07a6bfd36ec7b6f92069714791ba86ecf" }
```

Spec: *"Proof is the hex-encoded SHA256d commitment over the raw finalized PSBT payload."*

```ts
// RIP — max 256 epochs, both params required
const r = await fetch(
  `${DAEMON}/tachi_tx?hash=${txHash}&rip=true&origin_epoch=${o}&final_epoch=${o + 50}`);
const { rip } = await r.json();
```

**VERIFIED**, 114,538 characters of real proof:
- `Origin`: `EpochNum`, `Keys`, Verkle `Proof` with `commitmentsByPath`, `d`, and an `ipaProof`
  carrying 8 `cl` + 8 `cr` commitments and `finalEvaluation`; plus `StateDiff`, `Root`, `Commitment`
- `Chain`: 50 sequential per-epoch Verkle proofs
- `FinalRoot`

**The cryptographic link verifies:**

```
rip.Origin.StateDiff[0].suffixDiffs[0].currentValue = 0xf5a780b9…1ba86ecf
hat.proof                                           =   f5a780b9…1ba86ecf   → MATCH
```

So: our tx → HAT over its finalized PSBT → inserted at Verkle stem suffix 65 in the origin epoch →
chained recursively → single `FinalRoot`.

Limits: `final_epoch - origin_epoch > 256` → `exceeds max chain length of 256 epochs`. Near the ceiling
the daemon's own ABCI query times out. Keep windows small (≤ 50).

**Known gap:** `btc_height: 0`, `btc_timestamp: 0`, and `epoch.bitcoin_block_height: null` on every
epoch. The chain is complete up to the Verkle root but **not L1-anchored** on regtest. State this.

## 17. Error codes

| Code | Meaning | Cause |
|---|---|---|
| 3 | invalid signature | envelope signature doesn't verify |
| 5 | vtxo already spent | double spend |
| 6 | unauthorized: pubkey does not own vtxo | signer key ≠ VTXO `owner` |
| 8 | fee below minimum | `feeSats: 0n` |
| 12 | invalid transaction format | PSBT corrupt, or PSBT outputs don't mirror envelope outputs |
| — | amount mismatch | `sum(inputs) - sum(outputs) ≠ fee` |

## 18. Nonce is not enforced

`getAccountNonce` returned `0n` before and after every committed transfer, and two sequential sends
both used `0n` and both committed. **Nonce is not a replay guard today.** Double-spend protection comes
from VTXO state (`code=5`).

Consequence: the wallet must track spent VTXOs locally and serialise its own sends. Do not rely on
nonce for ordering or idempotency.

## 19. Confirmed unavailable

| Capability | Evidence |
|---|---|
| **SatVM** | 0 hits for `satvm`/`evm`/`wasm`/`contract`/`runtime`/`execute` across all 46 daemon paths and 57 definitions. 0 of 60 live VTXOs carry a non-empty `script`. No spec, no repo, no testnet. DuckDuckGo `"SatVM" whitepaper OR docs OR spec` → no results. Report as unavailable. |
| Third-party **cooperative refund** | `cosignRefund` is structurally refund-to-self. Team-confirmed. |
| Privileged bitcoind RPCs | `generatetoaddress`, `getnewaddress`, `listwallets` → `method not permitted: not in the common read-only set and no API key authorizes it` |
| Vault state machine | Always `state: "open"`, `latest_state_num: 0`. `VAULT_STATE_ADVANCE`/`CLOSE`/`BREACH` unexercised. |
| Epoch → L1 anchoring | `bitcoin_block_height: null`, `hat_count: 0` on all sampled epochs |
| Signet / mainnet | Faucet and permitted wallet RPCs are regtest-only |

Permitted read-only Bitcoin RPCs (all verified working): `getblockchaininfo`, `getrawtransaction`,
`decoderawtransaction`, `sendrawtransaction`, `getmempoolinfo`, `getnetworkinfo`, `gettxout`,
`scantxoutset`.

## 20. Undocumented tx types

```
TACHI_TX_TYPE_TRANSFER            = 1
TACHI_TX_TYPE_DEPOSIT             = 4
TACHI_TX_TYPE_WITHDRAW            = 5    ← committed successfully, hash 37B7B1E9…51347A8A
TACHI_TX_TYPE_VAULT_OPEN          = 16
TACHI_TX_TYPE_VAULT_STATE_ADVANCE = 17
TACHI_TX_TYPE_VAULT_CLOSE         = 18
TACHI_TX_TYPE_VAULT_BREACH        = 19
```

A `WITHDRAW`-typed envelope **committed with code 0**. Semantics are undocumented; treat as an
exploratory finding, not a product path, until the team clarifies.
