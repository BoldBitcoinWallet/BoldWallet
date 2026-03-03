# Multi-Path UTXO Spend: Technical Design

**Objective:** Support spending UTXOs from multiple addresses (receive + change chains) with correct per-input derivation paths. Current app only spends from a single address.

---

## 1. Current Single-Path Model: Gap Analysis

### 1.1 Current Flow (mpcSend / nostrMpcSendBTC)

```
RN (MobilesPairing / MobileNostrPairing)
  │
  ├─ derivationPath (single, e.g. m/84'/0'/0'/0/5)
  ├─ senderAddress (derived from path)
  ├─ publicKey (derived from path)
  │
  └─► Native (Go)
        │
        ├─ FetchUTXOs(senderAddress)     ← SINGLE ADDRESS
        ├─ SelectUTXOs(utxos, amount+fee, "smallest")
        ├─ Build tx: inputs from selectedUTXOs, change → senderAddress
        └─ For each input: JoinKeysign(..., derivePath, sighash)  ← SAME PATH FOR ALL
```

### 1.2 Identified Gaps

| Gap | Impact | Location |
|-----|--------|----------|
| **G1: Single-address UTXO fetch** | UTXOs from other addresses (receive #0, change #1, etc.) are never considered | `FetchUTXOs(senderAddress)` in btc.go, mpc_nostr.go |
| **G2: Single derivation path** | All inputs signed with same key; inputs from different addresses need different keys | `JoinKeysign` / `NostrJoinKeysignWithSighash` called with single `derivePath` |
| **G3: Change output destination** | Change goes to `senderAddress` (or optional `changeAddress` in Nostr); multi-path spend needs explicit next change address | MpcSendBTC uses `fromAddr`; NostrMpcSendBTC has `changeAddress` param |
| **G4: RN passes single path** | Route params only carry one `derivationPath`; no list of (address, path) | MobilesPairing, MobileNostrPairing |
| **G5: No UTXO→path mapping** | UTXO struct has no DerivationPath; `UTXOWithPath` exists but is unused in send flow | btc.go has `UTXOWithPath`; MpcSendBTC uses plain `UTXO` |

### 1.3 What Already Exists

- **UTXOWithPath** in btc.go: `UTXO` + `DerivationPath`
- **NostrJoinKeysignWithSighash(..., derivationPath, sighash)**: accepts per-call path
- **JoinKeysign(..., derivePath, message)**: same
- **PSBT signing**: reads `Bip32Derivation` per input → per-input path (proven pattern)
- **WalletService.getHdAddressesWithPaths()**: returns `{address, derivationPath, chain, index}[]` for in-scope addresses
- **NostrMpcSendBTC(..., changeAddress)**: change can go to HD internal address

---

## 2. UTXO Fetching Strategy for Multiple Addresses

### 2.1 Address Scope

```
External (receive): 0 .. max(externalIndex, maxUsedExternal) + GAP_LIMIT
Internal (change): 0 .. changeIndex + GAP_LIMIT
```

Use `WalletService.getHdAddressesWithPaths()` which already computes this.

### 2.2 Fetch Strategy

**Option A: RN fetches, native receives pre-tagged UTXOs (Recommended)**

1. RN calls `getHdAddressesWithPaths(network, addressType)` → list of `{address, derivationPath, chain, index}`
2. For each address, fetch UTXOs via existing API: `/address/{addr}/utxo` (or reuse `totalUTXO`-style fetch; need full UTXO list)
3. Tag each UTXO with its address's `derivationPath`
4. Merge into single list: `UTXOWithPath[]`
5. Pass to native: `utxosWithPathsJSON`

**Option B: Native fetches multiple addresses**

1. New native API: `FetchUTXOsMulti(addressesWithPaths []struct{Address, Path})` → `[]UTXOWithPath`
2. RN passes list of (address, path)
3. Native fetches per address, merges, tags with path

**Recommendation:** Option A. RN already has `getHdAddressesWithPaths`; fetches can be parallelized; keeps native API simpler; aligns with HD_WALLET_REFACTOR Phase 4.

### 2.3 UTXO Fetch Implementation (RN)

```typescript
// Pseudocode
async function fetchUtxosWithPaths(network, addressType, apiUrl): Promise<UTXOWithPath[]> {
  const addressesWithPaths = await walletService.getHdAddressesWithPaths(network, addressType);
  const allUtxos: UTXOWithPath[] = [];
  await Promise.all(addressesWithPaths.map(async ({ address, derivationPath }) => {
    const utxos = await fetchUtxosForAddress(apiUrl, address); // existing /address/:addr/utxo
    utxos.forEach(u => allUtxos.push({ ...u, derivation_path: derivationPath }));
  }));
  return allUtxos;
}
```

---

## 3. Input Selection Logic

### 3.1 Selection Over Combined UTXO Pool

- **Input:** `UTXOWithPath[]` (all UTXOs from receive + change addresses)
- **Target:** `amountSatoshi + estimatedFee`
- **Strategy:** Same as today — e.g. "smallest" (smallest-first), or "largest", or "single" if one UTXO suffices

### 3.2 Selection Algorithm (Unchanged)

`SelectUTXOs` in btc.go already implements smallest-first. Extend to `SelectUTXOsWithPaths(utxosWithPaths []UTXOWithPath, totalAmount int64, strategy string)` that:
- Treats value/amount the same
- Returns `[]UTXOWithPath` (preserving path per selected UTXO)

### 3.3 Deterministic Ordering

- Sort combined UTXO list by `(TxID, Vout)` before selection for reproducibility
- Session/hash consistency for MPC (both devices must select same UTXOs)

---

## 4. Per-Input Signing

### 4.1 Current (Single Path)

```go
for i, utxo := range selectedUTXOs {
  sigHash := CalcWitnessSigHash(...)
  sigJSON := JoinKeysign(..., derivePath, sighashBase64)  // same derivePath
  tx.TxIn[i].Witness = ...
}
```

### 4.2 Multi-Path (Per-Input Path)

```go
for i, utxoWithPath := range selectedUTXOsWithPaths {
  sigHash := CalcWitnessSigHash(...)
  inputPath := utxoWithPath.DerivationPath  // per-input path
  sigJSON := JoinKeysign(..., inputPath, sighashBase64)
  // Witness also needs correct pubKey for this input
  pubKeyBytes := derivePubKey(keyshare, inputPath)
  tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
}
```

### 4.3 Critical: PubKey Per Input

- Each input's witness includes the **public key** for that input's address
- Must derive pubKey from `utxoWithPath.DerivationPath` per input
- Go: `GetDerivedPubKey(keyshare.PubKey, keyshare.ChainCodeHex, path, false)`

---

## 5. Change Outputs

### 5.1 Change Address

- **Source:** Next change address = `getChangePath(network, addressType, useLegacyPath, changeIndex)`
- **Rule:** Change always goes to internal chain (never back to receive)
- **After broadcast:** `incrementChangeIndexAfterSend(network, addressType)`

### 5.2 Multi-Path Consistency

- Change output is **one** address (next internal index)
- Independent of which addresses contributed inputs
- Same as current NostrMpcSendBTC(changeAddress) behavior

---

## 6. Edge Cases

### 6.1 Partial Spends

- User sends 50k sats; UTXO has 100k → 50k change
- Change → next internal address
- No change from current logic

### 6.2 Dust Consolidation

- Many small UTXOs (e.g. 546 sats each)
- Selection may pick many inputs
- **Risk:** Tx size grows; fee estimation must account for more inputs
- **Mitigation:** Fee estimation should use actual selected UTXO count; consider "consolidation" mode that prefers fewer, larger UTXOs

### 6.3 Mixed Script Types

- Receive #0 = legacy (P2PKH), Change #0 = segwit (P2WPKH)
- Each input signed with correct script type (already handled by `txscript` based on pkScript)
- Per-input path ensures correct key derivation

### 6.4 Insufficient Funds Across All Addresses

- Selection fails if sum(UTXOs) < amount + fee
- Same error handling as today; no new case

### 6.5 Single UTXO Sufficient

- If one UTXO covers amount + fee → one input, one path
- Degrades to current behavior; no special handling

---

## 7. RN / Native Interface Changes

### 7.1 New Native API (Recommended)

```
MpcSendBTCWithUTXOs(
  server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare,
  utxosWithPathsJSON string,  // JSON array of {txid, vout, value, status, derivation_path}
  receiverAddress string,
  amountSatoshi, estimatedFee int64,
  changeAddress string,
) (txid string, err error)
```

```
NostrMpcSendBTCWithUTXOs(
  relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats,
  keyshareJSON string,
  utxosWithPathsJSON string,
  receiverAddress string,
  amountSatoshi, estimatedFee int64,
  changeAddress string,
) (txid string, err error)
```

### 7.2 Alternative: Extend Existing API

Add optional `utxosWithPathsJSON`. If non-empty, use it instead of fetching from `senderAddress`. Keeps backward compatibility but bloats params.

### 7.3 RN Bridge (iOS / Android)

- New method `mpcSendBTCWithUTXOs` / `nostrMpcSendBTCWithUTXOs`
- Params: same as current + `utxosWithPathsJSON`, `changeAddress` (Nostr already has changeAddress)

### 7.4 RN Caller (MobilesPairing / MobileNostrPairing)

**Before (Send BTC mode):**
1. Get `derivationPath` from route params (single path)
2. Derive senderAddress, btcPub from path
3. Call mpcSendBTC(path, btcPub, senderAddress, ...)

**After (Multi-path):**
1. Get network, addressType from route params
2. Fetch `utxosWithPaths` via RN (WalletService or new helper)
3. Derive `changeAddress` = getNextChangeAddress(network, addressType)
4. Call mpcSendBTCWithUTXOs(utxosWithPathsJSON, changeAddress, ...)
5. On success: incrementChangeIndexAfterSend()

---

## 8. High-Level Architecture

### 8.1 Multi-Path Spend Flow (Pseudocode)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ RN (MobilesPairing / MobileNostrPairing)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. addressesWithPaths = getHdAddressesWithPaths(network, addressType)   │
│ 2. utxosWithPaths = []                                                   │
│    for each {address, derivationPath} in addressesWithPaths:             │
│      utxos = fetchUtxos(apiUrl, address)                                 │
│      for each utxo: utxosWithPaths.push({...utxo, derivation_path})     │
│ 3. changeAddress = getNextChangeAddress(network, addressType)           │
│ 4. Call native: mpcSendBTCWithUTXOs(utxosWithPathsJSON, changeAddress,  │
│      receiverAddress, amountSatoshi, fee)                                │
│ 5. On success: incrementChangeIndexAfterSend()                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Native (Go)                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Parse utxosWithPathsJSON → []UTXOWithPath                             │
│ 2. selected = SelectUTXOsWithPaths(utxosWithPaths, amount+fee, "smallest")│
│ 3. Build tx:                                                             │
│    - Add inputs from selected (outpoints)                                │
│    - Add output: amount → receiverAddress                               │
│    - If change > 546: Add output: change → changeAddress                │
│ 4. prevOutFetcher = build from selected                                 │
│ 5. For each input i:                                                     │
│    - sigHash = CalcWitnessSigHash(tx, i, prevOut)                        │
│    - path = selected[i].DerivationPath                                   │
│    - pubKey = GetDerivedPubKey(keyshare, path)                          │
│    - sig = JoinKeysign(..., path, sighash)  // or NostrJoinKeysignWithSighash │
│    - tx.TxIn[i].Witness = {sig, pubKey}                                  │
│ 6. Broadcast tx                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Data Flow Diagram

```
[WalletService.getHdAddressesWithPaths]
         │
         ▼
[(addr1, path1), (addr2, path2), ...]  ──►  fetch UTXOs per address
         │                                        │
         │                                        ▼
         │                              [(utxo1, path1), (utxo2, path1), (utxo3, path2), ...]
         │                                        │
         │                                        ▼
         │                              SelectUTXOsWithPaths (smallest-first)
         │                                        │
         │                                        ▼
         │                              [selected UTXOs with paths]
         │                                        │
         └────────────────────────────────────────┼─────────────────────────────────────
                                                  ▼
                                    mpcSendBTCWithUTXOs / nostrMpcSendBTCWithUTXOs
                                                  │
                                                  ▼
                                    Per-input: derive key from path → sign
```

---

## 9. Performance Implications

### 9.1 Larger HD Wallets

| Factor | Impact | Mitigation |
|--------|--------|------------|
| **Address count** | externalEnd + internalEnd can be 40+ addresses (gap 5 each) | Parallel fetch; cache UTXOs; limit scan range for send (e.g. only 0..maxUsed+gap) |
| **UTXO count** | Many addresses × few UTXOs each = many API calls | Batch or parallel fetch; consider server-side multi-address UTXO endpoint if available |
| **Selection** | O(n) over merged list | Acceptable; n typically < 100 |
| **Signing** | N MPC rounds for N inputs | Inherent; each input needs separate keysign; UX: show progress (e.g. "Signing input 2 of 5") |

### 9.2 Efficiency Strategies

1. **Cache UTXOs:** Fetch once when entering send flow; reuse for fee estimation and final send
2. **Lazy address range:** Only fetch addresses 0..maxUsedExternal+GAP and 0..changeIndex+GAP (not full theoretical range)
3. **Parallel fetch:** `Promise.all` over addresses for UTXO fetch
4. **Reduce API calls:** If mempool.space supports batch, use it; otherwise parallel is best

---

## 10. Testing Strategies

### 10.1 Correctness

| Test | Description |
|------|-------------|
| **Single-path regression** | One UTXO, one address → same behavior as current mpcSend |
| **Two receive addresses** | UTXOs at receive #0 and #1; spend both; verify both inputs signed, change to internal |
| **Receive + change** | UTXO at receive #0 and change #0; spend; verify per-input path, change to internal #1 |
| **Insufficient single address** | Receive #0 has 30k, need 50k; receive #1 has 40k → selection uses both |
| **Determinism** | Same UTXO set, same amount → same selection and tx shape on both devices |

### 10.2 Security

| Test | Description |
|------|-------------|
| **Wrong path** | Sign input with wrong path → invalid signature (reject by network) |
| **Path isolation** | Ensure no path leakage between inputs |
| **Change address** | Verify change goes to correct internal address, not receive |

### 10.3 Edge Cases

- Dust (546 sats) handling
- Many inputs (10+) → fee and UX
- Mixed P2PKH / P2WPKH inputs
- Legacy vs segwit paths (useLegacyPath)

---

## 11. Stepwise Implementation Plan

### Phase 1: Native Multi-Path Support (Priority: P0)

| Step | Task | Risk |
|------|------|------|
| 1.1 | Add `SelectUTXOsWithPaths` in btc.go (or extend SelectUTXOs to accept UTXOWithPath) | Low |
| 1.2 | Add `MpcSendBTCWithUTXOs` in btc.go: accept utxosWithPathsJSON, changeAddress; per-input path + pubKey | Medium |
| 1.3 | Add `NostrMpcSendBTCWithUTXOs` in mpc_nostr.go: same logic, NostrJoinKeysignWithSighash per input | Medium |
| 1.4 | Export via iOS/Android bridge; new RN methods | Low |

### Phase 2: RN UTXO Fetch + Tagging (Priority: P0)

| Step | Task | Risk |
|------|------|------|
| 2.1 | Add `fetchUtxosForAddress(apiUrl, address)` in WalletService or utils | Low |
| 2.2 | Add `fetchUtxosWithPaths(network, addressType, apiUrl)` using getHdAddressesWithPaths | Low |
| 2.3 | Ensure fee estimation uses same UTXO set (or compatible) | Medium |

### Phase 3: Integrate Send Flow (Priority: P0)

| Step | Task | Risk |
|------|------|------|
| 3.1 | MobilesPairing: In Send BTC mode, fetch utxosWithPaths, derive changeAddress, call mpcSendBTCWithUTXOs | Medium |
| 3.2 | MobileNostrPairing: Same for nostrMpcSendBTCWithUTXOs | Medium |
| 3.3 | On success: incrementChangeIndexAfterSend | Low |
| 3.4 | Fallback: if fetch fails or empty, fall back to single-path (current) flow for backward compat | Low |

### Phase 4: Fee Estimation (Priority: P1)

| Step | Task | Risk |
|------|------|------|
| 4.1 | EstimateFees today uses single address; extend to accept utxosWithPaths or multi-address | Medium |
| 4.2 | SpendingHash (for session) must be deterministic over selected UTXOs; ensure both devices select same set | Medium |

### Phase 5: UX and Polish (Priority: P2)

| Step | Task | Risk |
|------|------|------|
| 5.1 | Show "Signing input X of Y" during multi-input sign | Low |
| 5.2 | Handle slow UTXO fetch (loading state) | Low |

---

## 12. Integration with Current Architecture

### 12.1 Backward Compatibility

- **Keep** `mpcSendBTC` and `nostrMpcSendBTC` for single-path (or deprecate after cutover)
- **Add** `mpcSendBTCWithUTXOs` and `nostrMpcSendBTCWithUTXOs` as new entry points
- RN can detect: if utxosWithPaths available and non-empty → use new flow; else → legacy single-path

### 12.2 Session / Pre-Agreement (Nostr)

- `sessionFlag` and `sessionID` today use `balanceSats`, `amountSatoshi`
- For multi-path: balance = sum(utxosWithPaths); same formula
- Pre-agreement flow unchanged; only the UTXO source and signing loop change

### 12.3 Local (mpcSend) vs Nostr

- Both need same native changes (UTXOWithPath, per-input signing)
- Local: JoinKeysign; Nostr: NostrJoinKeysignWithSighash
- Same tx structure; same change handling

---

## 13. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| **Incorrect per-input path** | Unit test: derive pubKey from path, verify address matches UTXO's address |
| **Fee underestimation** | Use actual selected UTXO count for fee estimation; add margin for multi-input |
| **Session mismatch (Nostr)** | Both devices must receive same utxosWithPaths; RN fetches before pairing; or native fetches with same address list |
| **Change index desync** | Only increment after broadcast success; same as today |

---

## 14. Summary

- **Gap:** Single-address fetch + single-path signing prevents multi-UTXO, multi-path spends.
- **Fix:** RN fetches UTXOs for all in-scope addresses, tags with path; passes `utxosWithPathsJSON` + `changeAddress` to new native API; native selects, builds tx, signs each input with its path.
- **Existing:** UTXOWithPath, per-input path in PSBT, getHdAddressesWithPaths, NostrJoinKeysignWithSighash(derivationPath) all support this.
- **Effort:** ~3–5 days for native + RN integration; 1–2 days testing.
