# RIPCORD: Verified API Contract

Every signature below was executed against the live Tachi daemon at
`https://rpc-regtest.tachibtc.com` on 21 Aug 2026. Nothing here is inferred from documentation.
Where the official docs disagree, the docs are wrong. This file is the source of truth for the build.

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
- **`Buffer.toJSON()` runs BEFORE a `JSON.stringify` replacer** (found 23 Aug, the hard way). A custom
  replacer never sees a `Buffer`, only its `{type:'Buffer',data:[…]}` form, so any naive
  `JSON.stringify` on a daemon payload or vault record silently degrades every Buffer field (P2TR
  `output`, control blocks, leaf hashes) into a plain object. Always serialize through `bytes.ts`
  `serializeJson` / `deserializeJson`, which handle bigint, `Buffer`, and `Uint8Array` losslessly and
  encode all bytes to one compact `"__bytes:<base64>"` form. (Read the pre-`toJSON` value off the
  replacer's `this[key]` holder; an `instanceof Uint8Array` check on the replacer's `value` argument
  catches plain Uint8Arrays only and produces two different encodings for the same bytes.)
- **The daemon does not use `message`.** `waitForTachiTxCommit` resolves `{ code, log, found, … }` and
  the rejection reason is in **`log`**; the SDK's `VtxoBroadcastError` uses **`tendermintLog`**; the
  Bitcoin RPC proxy nests **`error.message`** with a negative **`error.code`**. Any error mapper that
  reads `message` alone works in tests and never fires in production. `amount mismatch` has no numeric
  code at all (§17), so its text is the only signal it happened.

## 1. Endpoints

| Thing | Value |
|---|---|
| Daemon REST | `https://rpc-regtest.tachibtc.com` |
| WSS | `wss://rpc-regtest.tachibtc.com/tachi_ws` |
| Bitcoin JSON-RPC proxy | `POST https://rpc-regtest.tachibtc.com/` |
| Broadcast | `https://rpc-regtest.tachibtc.com/tachi_txBroadcastSync` |
| Faucet | `https://faucet.tachibtc.com`: 0.5 BTC per address per rolling 24h, accepts any `bcrt1…` |
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

`getHealth()` returns `{status:"ok", validators:1}`. That `1` is this node's peer count, **not** the
consensus set size. `getLiveValidators()` returns all **7**. Do not read health as a quorum signal.

**Boot preflight (`@ripcord/core` `preflight`) runs six probes:** `getHealth`, `getNodeInfo`,
`getLiveValidators`, the Bitcoin RPC proxy (`getblockchaininfo`), `fetchConsensusQuorum`, and
`getFeeEstimate`. Each is independently fallible, so failures are reported per probe in
`probeFailures: { probe, message }[]` with `unreachable: true` only when every daemon-facing probe
failed. Verified 23 Aug against an unresolvable host: all five daemon probes fail in ~16 ms and are each
named. A failed probe leaves its fields at zero, and **a zero is not a verified value**:
`quorumSize: 0` means the quorum probe failed rather than a 0-of-0 quorum, `chainId: ''` means
`getNodeInfo` failed rather than a chain mismatch, and `l1Height: null` with
`l1HeightSource: 'unavailable'` means the Bitcoin RPC proxy did not answer. Never substitute the
CometBFT height (~437k) for the Bitcoin L1 height (~9k).

**Quorum keys are returned in a stable set but not a canonical form.** `compressedHex` is hex, and
`isCompressedHex`-style validation accepts either case, so anything that fingerprints or compares a
keyset must normalize case first. Live-verified 23 Aug: `@ripcord/core`'s quorum fingerprint changed
entirely when the same 7 keys were uppercased, which would have read as a validator rotation. The
threshold is a separate field from the keyset, so a fingerprint over keys alone cannot distinguish a
3-of-7 from a 5-of-7 over the same nodes; include the threshold. `fetchConsensusQuorum` does **not**
guarantee the 7 keys are distinct, so uniqueness must be asserted by the caller: a repeated key still
has length 7 but lets one node satisfy two of the five cooperative signatures.

Client-side consequence: keep **one** canonical fingerprint function
(`@ripcord/core` `computeFingerprint(keys, threshold)`) and cache the quorum as a **frozen** object.
Two independent implementations of "hash the quorum" will disagree and turn the quorum-change check
into a permanent false alarm; a mutable cached quorum lets one caller poison the 5-of-7 that every
later consumer reads, after validation has already passed. Both were real bugs, found 23 Aug.

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

**The third argument is an options OBJECT, not positional indices** (verified 23 Aug against the
aggregator's `.d.ts` and live):

```ts
deriveUserKey(mnemonic, network, opts?: { account?, passphrase?, change?, index? })
vc.deriveUserKey(MNEMONIC, netObj, { index: 1 }).path   // → "m/84'/1'/0'/0/1"
```

Omitting `opts` silently pins every call to `m/84'/1'/0'/0/0`. Since vaults are atomic (one deposit
each, §"vaults are atomic") every funded run needs a **fresh index**, so a wrapper that cannot pass
`index` cannot create a second vault or rebuild a recovered one. `Keystore.signerFor(change, index)` is
positional and takes the matching index; live-verified that
`deriveUserKey(m, net, { index: N }).publicKey === signerFor(false, N).publicKey` for N in 0,1,2,7.

**Phase 3 audit result:** `@ripcord/core` now exposes `deriveIdentity(mnemonic, network, index = 0)` and
`makeSigner(mnemonic, network, index)`, so the wrapper reaches the same indices as the SDK. Bad mnemonics
and off-curve x-only values are wrapped as `RipcordError(INVALID_FORMAT)` with their original causes.

**Bad input throws the SDK's own error classes, not yours.** `deriveUserKey` and
`Keystore.fromMnemonic` both raise `InvalidMnemonicError` (code `"INVALID_MNEMONIC"`) for empty,
non-BIP39, and bad-checksum phrases. Wrap them if your callers branch on your own error taxonomy.

Separately, `btc.address.fromOutputScript` on a P2TR script throws a **bare bitcoinjs `Error`**
(`"OP_1 <hex> has no matching Address"`) when the 32-byte x-only value is not a valid secp256k1
x-coordinate. Verified for all-`ff`, all-zero, and the field prime. A 64-hex-char check does **not**
imply a valid curve point, and an unchecked value would otherwise mint an unspendable address.

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
| `w.changeAddress` | - |
| `w.balance` → `{confirmed, unconfirmed, total}` bigints | - |
| `w.utxos` → array | - |
| `w.info` → full record incl. `addressType`, `accountPath`, `accountXpub` | `w.addressType` (undefined) |

**BLOCKED: `vc.importUserWallet(...)`** → `RPC scantxoutset failed: bitcoin rpc error -5: Address is
not valid`. Use `WalletAggregator.fromMnemonic().addAccount()` instead.

**BLOCKED: `w.send({to, amountSats, feeRateSatVb})`** → `feeRate must be a finite number ≥ 1 sat/vB,
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

**Vaults are atomic: one deposit each.** A second `depositToVault` on a funded vault is rejected:
*"vault … is already funded (1 UTXO(s), 40000 sats) - vaults are atomic (one deposit per vault);
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

Proof of reserves, the only check that binds a rebuild to real money:

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
  csvBlocks: 2,                        // CRITICAL: see below
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

## 10. Off-chain transfer: the load-bearing discovery

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
// DO NOT call finalizeVtxoPsbt: needs 5 node sigs and is NOT required.

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
    txid: DISPLAY_TXID,                 // DISPLAY order, see byte-order note
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

`verifyUnilateralExitPsbt` requires `expectedUserKey` and `minCsvBlocks`; these stop a substituted
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
`JSON.stringify` throws; use a replacer.

`TachiClient` (sdk-ts): all 15 reads verified: `getHealth`, `getNodeInfo`, `getStats`, `getSupply`,
`getFeeEstimate`, `getValidators`, `getLiveValidators`, `getWatchtowerStatus`, `getWatchtowerReceipts`,
`listEpochs`, `listBlocks`, `listVtxos`, `listVaults`, `getAddress`, `getMempool`.

`getAddress(pubkey)` → `{ pubkey, balance_sat, nonce, vtxo_count }`.

### Never call these

`getAddressTransactions` and `listTransactions` are **full unindexed chain scans**. Tachi's own
engineer measured **17.1 s** for an address with 2 matching transactions (`scanned_from_height: 115115,
scanned_to_height: 1`) and `listTransactions` exceeding an 8 s timeout, and wrote "impractically slow"
in `tachi-sdk-ts` issue #21. RIPCORD must contain **zero** call sites for either.

### Do not trust

`validateTachiTxOnDaemon` (`/tachi_txValidate`) reports **false negatives**: it rejects transactions
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

Filters: `address`, `vault`, `vaultId`, `blocks`, `validators`. **At least one filter is required**;
the daemon rejects a filterless connection. Block events verified via `?blocks=true`.

Backpressure: events buffer up to `maxQueuedEvents` (default 10,000), then the stream throws rather
than silently dropping. Leaving the loop by any means closes the socket. `@ripcord/core`'s
`BoundedEventQueue` mirrors this client-side and raises `RipcordCode.QUEUE_OVERFLOW` past its bound
rather than dropping events.

Field notes (2026-08-22, captured from the SDK-decoded `VaultEvent`, then re-probed):

- **`txHash` case does NOT match REST.** The WSS frame carries the tx hash **lowercase**
  (`64fd019e…`), while `waitForTachiTxCommit` / `broadcastTachiTx` return it **uppercase**
  (`64FD019E…`). Always case-normalise before joining a WSS event to its REST commit status.
- **`vout[].owner` is not a fixed width.** Alice's change output came back as a 64-char x-only
  key while Bob's received output came back as a 66-char compressed key, in the same transfer.
  Treat `owner` as an opaque hex pubkey string; do not key on its length.
- **The SDK's `subscribeVaultEvents` has NO reconnect.** A dropped socket only calls `onClose`;
  the caller must re-subscribe and re-query state after any gap. `@ripcord/core`'s `VaultIndexer`
  (`src/indexer.ts`) adds exponential-backoff reconnect plus a bounded client-side event queue.
- A `block` event (`event:"block"`) carries `block: { height, blockHash, appHash, txCount, epochClosed }`.
  `txCount` is the transactions in that block; `epochClosed` is `undefined` for a block that
  closed no epoch. `tx:pending` has `height: 0`, `tx:committed` has `height > 0`.
- A plain `transfer` frame has `vaultAddress: ""` (a transfer locks no vault) and `vout` populated
  with one entry per output; `type` is `"transfer"`. Observed pending latency ~300 ms after
  broadcast, committed ~1 s later (block finalisation is activity-driven, ~5 s cadence).

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

> **Re-probed 2026-08-23 against daemon v0.39.0 with three freshly committed transfers**
> (`D501919D…0476` @ epoch 437172, `F5BD7D7F…E749` @ epoch 437193, `FB650479…1095` @ epoch 437326).
> Several claims in the earlier (21 Aug) version of this section were **WRONG** and are corrected
> below. Where the old text disagrees, the 23 Aug probe wins. Every statement in §16.1 to §16.6 was
> re-asserted mechanically against the third transfer: **32 checks, 32 passed, 0 failed.**

### 16.1 The SDK wrapper works. It just needs camelCase.

**CORRECTION.** The old claim ("the SDK wrapper drops the query params, `getTransaction(hash,
{hat:true})` returns a `hat` key with no data") is **false**. Read the JS:

```js
// node_modules/@tachibtc/tachi-sdk-ts/dist/client.js
async getTransaction(hash, options) {
  const qs = { hash };
  if (options?.hat) qs.hat = "true";
  if (options?.rip) qs.rip = "true";
  if (options?.vtxoId) qs.vtxo_id = options.vtxoId;
  if (options?.originEpoch !== undefined) qs.origin_epoch = String(options.originEpoch);
  if (options?.finalEpoch  !== undefined) qs.final_epoch  = String(options.finalEpoch);
  return this.get("/tachi_tx", qs);
}
```

Verified live: `client.getTransaction(hash, { hat: true })` returns the **full** hat payload, and
`{ rip: true, originEpoch, finalEpoch }` returns the **full** rip. The trap is the casing, not the
wrapper: passing `origin_epoch` / `final_epoch` (snake, as the REST route wants) means the SDK never
sets them and the daemon answers `400 rip=true requires origin_epoch and final_epoch`. Use
`originEpoch` / `finalEpoch`.

Either path is fine. Raw REST keeps `proofs.ts` free of an extra client dependency, so RIPCORD uses
`fetch`, but the SDK is not broken and the old warning must not be repeated.

### 16.2 HAT

```ts
const r = await fetch(`${DAEMON}/tachi_tx?hash=${txHash}&hat=true`);
const { hat } = await r.json();
// → { vtxo_id: "5e150d21…79a2", btc_timestamp: 0, btc_height: 0,
//     proof: "f631ef7a23577b6df299c0ca73ddea3f4793ffd56fff38fb925439bb098713e2" }
```

- `hat.proof` is **bare lowercase hex, 64 chars** (no `0x`).
- `hat.vtxo_id` is the **spent input's** VTXO id. Verified equal to the input we selected on all three
  probes.
- The tx hash is **case-insensitive** on this route: uppercase (as `waitForTachiTxCommit` returns it)
  and lowercase both return the identical payload.
- A hash the daemon doesn't know → **HTTP 404 `transaction not found`** (not a 200 with an empty body).
- `btc_height` / `btc_timestamp` are still `0`. See §16.6.

**UNVERIFIED (23 Aug):** the old claim that a deposit is rejected with
`400 - tx has no inputs; hat/rip proofs require a spent VTXO` could **not** be re-confirmed: the last
40 epochs contained no non-transfer tx to probe. Treat it as a 21-Aug observation, not current fact,
and re-probe with a fresh deposit before relying on the exact message.

### 16.3 RIP: the window rule is NOT "≤ 50"

**CORRECTION.** The old text said "max 256 epochs, keep windows ≤ 50" and showed `origin + 50`. On a
freshly committed tx, `origin + 50` **fails**:

```
GET /tachi_tx?hash=…&rip=true&origin_epoch=437172&final_epoch=437222
→ HTTP 502  rip proof: rip query failed: chain proof: epoch 437181 not closed (chain gap)
```

The real constraint is **every epoch in `[origin_epoch, final_epoch]` must already be CLOSED.** Epochs
close roughly every 5 s under live traffic, so the usable window on a just-committed tx is however many
epochs have closed since. Measured sweep from `origin = 437172`:

| window | result |
|---|---|
| 0 | OK, 5,021 bytes, `Chain: null` |
| 1 | OK, 6,937 bytes, `Chain` length 1 |
| 2 | OK, 8,856 bytes, `Chain` length 2 |
| 3 | OK, 10,775 bytes, `Chain` length 3 |
| 5 | OK, 14,611 bytes, `Chain` length 5 |
| 10 | **HTTP 502** `epoch 437180 not closed (chain gap)` |
| 25 / 50 | **HTTP 502** same class of error |

The 256-epoch ceiling is real but is a *second*, looser limit:
`final_epoch - origin_epoch > 256` → `400 final_epoch - origin_epoch exceeds max chain length of 256 epochs`.

**Implication for `proofs.ts`:** do not hardcode a 50-epoch window. Either use **window 0** (self-proof,
always available the moment the tx commits) or poll `listEpochs` for the newest `status: "closed"` height
and clamp `final_epoch` to it. A fixed window is a guaranteed 502 on a fresh transfer.

`origin_epoch` need **not** equal the tx's epoch: `origin - 1` and `origin - 5` both succeed and return
the same `FinalRoot` as window 0 from the tx epoch, because `FinalRoot` tracks `final_epoch`.

Both params are mandatory: omitting either → `400 rip=true requires origin_epoch and final_epoch`.

### 16.4 RIP response shape (measured, not inferred)

```
rip = { VTXOID, BTCTimestamp, BTCHeight, PSBTPayload, Origin, Chain, FinalRoot }
Origin = { EpochNum, Keys, Proof, StateDiff, Root, Commitment }
Origin.Proof = { otherStems, depthExtensionPresent, commitmentsByPath, d, ipaProof }
Origin.Proof.ipaProof = { cl: string[8], cr: string[8], finalEvaluation }
```

**Encodings are mixed. This is the sharpest trap in the whole section:**

| Field | Encoding |
|---|---|
| `Origin.Root`, `Origin.Commitment`, `FinalRoot`, `Chain[i].Root` | **base64**, 44 chars → 32 bytes |
| `Origin.Keys[i]` | **base64**, 44 chars → 32 bytes |
| `StateDiff[].stem` | **`0x`-prefixed hex**, 31 bytes |
| `StateDiff[].suffixDiffs[].currentValue` | **`0x`-prefixed hex**, 32 bytes |
| `Proof.commitmentsByPath[]`, `Proof.d`, `ipaProof.cl/cr/finalEvaluation` | **`0x`-prefixed hex**, 32 bytes |
| `hat.proof` | **bare hex**, no `0x` |
| `VTXOID`, `PSBTPayload` | **JSON byte array** (`[122, 85, …]`), not a string |

`VTXOID` decodes byte-for-byte to the spent VTXO id and to `hat.vtxo_id` (all three probes). Reading it
as base64 or hex silently yields garbage.

`Chain` is **`null`** at window 0 and an array of per-epoch proofs otherwise. Each `Chain[i]` has the
same keys as `Origin`. Verified: `FinalRoot === Chain[Chain.length - 1].Root`, and at window 0
`FinalRoot === Origin.Root`.

### 16.5 The cryptographic link, corrected

The link verifies, but **not** the way the old text and `04-BUILD-PLAN.md` describe it.

```
hat.proof                                          =   f631ef7a…13e2   (bare hex)
rip.Origin.StateDiff[0].suffixDiffs[0].currentValue = 0xf631ef7a…13e2   (0x-prefixed)
strict ===                                          → FALSE
normalized (strip 0x, lowercase both)               → TRUE   ✅
```

**A strict `===` comparison FAILS.** `verifyHatInRip` must strip the `0x` prefix and lowercase both
sides. This is exactly the kind of bug that ships as "proof verification" and silently always returns
false.

**The Verkle suffix is NOT the constant 65.** Both `04-BUILD-PLAN.md` Task 8.2 and the old §16 said
"stem suffix 65" (both are now corrected in place). Measured across two transfers:

| tx | stem (31 bytes) | suffix |
|---|---|---|
| `D501919D…0476` | `786972eadc88ee526c80ef8e43dcaa45d6a00e53e12fc87d67ee18bc215ccb` | **204** (`0xcc`) |
| `F5BD7D7F…E749` | `e24a67157ee5c0bd55fcd63d7cd468a044a49fa341f081f523bc4824e50d2f` | **250** (`0xfa`) |
| `FB650479…1095` | `8d769de050cd9ff21f496af5691ae7aa2ca6e5260cbff2eaf6d593f9902f4b` | **148** (`0x94`) |

Three transfers, three different suffixes. It is not a constant under any reading.

The relationship that *does* hold, on all three probes:

```
Buffer.from(Origin.Keys[0], "base64").toString("hex") === stem_hex + suffix.toString(16).padStart(2, "0")
```

i.e. the 32-byte Verkle key is `stem(31 bytes) || suffix(1 byte)`, and the suffix is simply the key's
last byte. It varies per VTXO. **Never assert `suffix === 65`.** Locate the diff by matching the
normalized `currentValue` against `hat.proof`, and cross-check the stem against `Origin.Keys[0]`.

`Origin.Keys[0]` is not `sha256(vtxo_id)` (checked, no match). The derivation from VTXO id to Verkle
key is not public; treat the key as opaque and verify it only against the `stem || suffix` identity.

### 16.6 What CANNOT be verified on regtest (state this plainly)

- **`rip.PSBTPayload` is `null`.** So the spec sentence *"Proof is the hex-encoded SHA256d commitment
  over the raw finalized PSBT payload"* is **not locally checkable**. Confirmed the obvious wrong turn:
  hashing the empty payload gives `sha256("") = e3b0c442…b855` and
  `sha256d("") = 5df6e0e2…9456`, neither of which is `hat.proof`. `proofs.ts` must NOT claim to
  recompute the HAT commitment. It can only assert the daemon's HAT value appears in the daemon's
  Verkle state diff. Label that honestly in the UI: it is an **inclusion** proof, not a recomputation.
- **No L1 anchoring.** `hat.btc_height = 0`, `hat.btc_timestamp = 0`, `rip.BTCHeight = 0`,
  `rip.BTCTimestamp = 0`, and `epoch.bitcoin_block_height = null` on every sampled epoch
  (`hat_count: 0` too). The chain is complete up to the Verkle root and **stops there** on regtest.
- **The IPA proof is not verified client-side.** RIPCORD carries `Origin.Proof` / `ipaProof` through to
  the UI as evidence, but implementing Verkle/IPA verification in TypeScript is out of scope. Say
  "daemon-attested" and never imply local cryptographic verification of the commitment itself.


## 17. Error codes

| Code | Meaning | Cause |
|---|---|---|
| 3 | invalid signature | envelope signature doesn't verify |
| 5 | vtxo already spent | double spend |
| 6 | unauthorized: pubkey does not own vtxo | signer key ≠ VTXO `owner` |
| 8 | fee below minimum | `feeSats: 0n` |
| 12 | invalid transaction format | PSBT corrupt, or PSBT outputs don't mirror envelope outputs |
| - | amount mismatch | `sum(inputs) - sum(outputs) ≠ fee` |

**Reading a rejection (audit 2026-08-23).** The code alone is not enough, and the reason is not in a
field called `message`:

| Source | Numeric code | Reason text |
|---|---|---|
| `waitForTachiTxCommit` → `TachiTxCommitStatus` | `code` | **`log`** (no `message` field exists) |
| SDK `VtxoBroadcastError` | `tendermintCode` (`.code` is the string `"VTXO_BROADCAST"`) | **`tendermintLog`** |
| Bitcoin JSON-RPC proxy | `error.code` (negative, cannot collide with the table above) | **`error.message`** |

`amount mismatch` has **no numeric code** (blank row above), so its text in `log` is the only signal it
occurred. A mapper reading `message` alone silently misses every text-only rejection while its unit
tests pass. `@ripcord/core`'s `mapDaemonError` reads all of these and preserves `daemonCode` even when
the code is unmapped.

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
