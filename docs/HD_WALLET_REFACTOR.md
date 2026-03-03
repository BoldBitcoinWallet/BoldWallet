# HD Wallet Refactor: No Address Reuse & Change Addresses

**Production non-custodial wallet — any bug can cause permanent fund loss. Test thoroughly and rebuild native library before release.**

---

## Implementation status (as of refactor)

| Goal | Status | Notes |
|------|--------|--------|
| 1) No address reuse, external/internal chains, persisted indexes | **Done** | HdIndexService, getReceivePath/getChangePath, WalletContext/UserContext/WalletService/WalletHome use external index; getNextReceiveAddress increments external. |
| 2) Change address: fresh internal, increment only after tx success | **Done** | getNextChangeAddress, NostrMpcSendBTC(changeAddress), incrementChangeIndexAfterSend after broadcast success in MobileNostrPairing. |
| 3) MPC/TSS compatibility, path to signing, deterministic derivation | **Done** | Single-path send unchanged; path still passed; no change to PSBT or keysign logic. |
| 4) UTXO mapping with derivation path | **Partial** | UTXOWithPath in Go; current send still single-address, single path. Multi-address UTXO fetch + per-input path in builder not yet implemented. |
| 5) Gap limit 20, restore-from-seed | **Partial** | GAP_LIMIT=20 used in getWalletBalanceAggregate; restore discovery (scan until 20 empty) not implemented. |

**Remaining (optional next steps):** Multi-address UTXO selection + per-input path in send; balance UI using getWalletBalanceAggregate; "Get new address" button calling getNextReceiveAddress; restore discovery for gap limit.

---

## 1. Architecture Impact Analysis

### 1.1 Current Architecture Summary

| Area | Current behavior | Storage / API |
|------|------------------|----------------|
| **Receive address** | Single address per (network, addressType). Path: `m/{44'\|49'\|84'}/{coinType}'/0'/0/0`. | `LocalCache.currentAddress`, WalletContext `address`, UserContext `activeAddress` (one per type at index 0). |
| **Change** | Change output sent back to **same** receive address (sender address) → address reuse. | N/A (no change index). |
| **Balance** | One address → `BBMTLibNativeModule.totalUTXO(address)` → single sum. | `WalletService.getWalletBalance(address)`, cache key `wallet_balance_${address}`. |
| **UTXOs** | Fetched per single address: `/address/${addr}/utxo`. No derivation path stored with UTXO. | UtxosScreen, Go `FetchUTXOs(address)`, `UTXO` struct: TxID, Vout, Value, Status only. |
| **Send (Nostr MPC)** | Single `senderAddress`, single `derivePath`. Go: `FetchUTXOs(senderAddress)`, build tx, change → `fromAddr` (sender). Sign all inputs with same `derivePath`. | `NostrMpcSendBTC(..., derivePath, ..., senderAddress, receiverAddress, ...)`. |
| **PSBT** | Signing reads **per-input** `Bip32Derivation` from PSBT; no change in PSBT flow. | PSBT created externally; app only signs. |
| **Derivation path** | `getDerivePathForNetwork(network, addressType, useLegacyPath, account=0, change=0, index=0)` — `change` and `index` exist but always 0. | utils.js; call sites never pass index. |

**Critical**: MPC/TSS signing in `BBMTLib/tss/psbt.go` and `mpc_nostr.go` uses derivation path per input from PSBT or single path for NostrMpcSendBTC. Deterministic derivation is already required; we extend to **per-UTXO path** for sends.

### 1.2 Target Architecture (Post-Refactor)

| Area | Target behavior | Storage / API |
|------|-----------------|----------------|
| **Receive (external chain)** | Fresh address each time. Path: `m/{bip}'/{coinType}'/0'/0/<externalIndex>`. Persist `externalIndex`; increment when user “uses” next receive address (e.g. when displaying new address or after first receive to current). | New: `hd_external_index_${network}_${addressType}`, `hd_max_used_external_${network}_${addressType}` (for gap limit). |
| **Change (internal chain)** | Change output always to **new** internal address. Path: `m/{bip}'/{coinType}'/0'/1/<changeIndex>`. Persist `changeIndex`; increment **only after** tx build + broadcast success. | New: `hd_change_index_${network}_${addressType}`. |
| **Balance** | Aggregate over all “in-scope” addresses: external `0..maxUsedExternal+gap`, internal `0..maxUsedChange+gap` (gap = 20). | WalletService: sum `totalUTXO(addr)` for each address, or new native `TotalUTXOMulti` (optional). |
| **UTXOs** | Every UTXO used in spending must carry its **derivation path**. Transaction builder (RN or Go) uses path per input for signing. | UTXO type in Go extended with optional `DerivationPath`; RN fetches per-address and tags with path. |
| **Send (Nostr MPC)** | Inputs may come from multiple addresses (external + internal). Each input signed with **its own** path. Change output to **next internal** address (derived from next change index). | New flow: RN fetches UTXOs for all in-scope addresses, attaches paths → pass to native; or new native API that accepts multiple (address, path) and change path/address. |
| **Gap limit** | Standard gap limit = 20. Restore/scan: stop external at first 20 consecutive unused; same for internal. | Used when discovering addresses on restore; max “scan” range = lastUsed + 20. |

### 1.3 Impact Matrix

| Component | Impact | Change type |
|-----------|--------|-------------|
| `utils.js` (getDerivePathForNetwork) | Low | Already has change/index; ensure all call sites can pass them; add taproot/BIP86 if needed later. |
| `WalletContext.tsx` | Medium | Derive address from **external index**; persist and increment external index when “next address” is used. |
| `UserContext.tsx` | Medium | activeAddress = address at current **external index** (not only type); persist external index per network+type; derive “all” addresses for display may become “current receive at index” + optional history. |
| `WalletService.ts` | High | Balance: aggregate over multiple addresses (external 0..maxUsed+gap, internal 0..changeMax+gap). Persist/read HD indexes. Optional: getNextChangeAddress(), incrementChangeIndexAfterSend(). |
| `LocalCache` keys | Medium | New keys: `hd_external_index_*`, `hd_change_index_*`, `hd_max_used_external_*` (and network/addressType scoped). |
| `WalletHome.tsx` | Medium | Receive: show address at current external index; “Get new address” = bump external index and show next. Send: pass UTXOs + paths or multi-address to native. |
| `UtxosScreen.tsx` | Medium | Show UTXOs from **all** in-scope addresses (or still single “current” for simplicity); if multi, fetch per address and merge with path. |
| `MobileNostrPairing.tsx` / send flow | High | Build send from **multiple** addresses; pass list of (UTXO + path) or (addresses + paths) + change address to native. |
| `BBMTLib/tss/btc.go` | High | `UTXO` struct: add `DerivationPath string`. `FetchUTXOs` stays per-address. New or extended: build tx from UTXOs with per-input path; change to given change address. |
| `BBMTLib/tss/mpc_nostr.go` | High | NostrMpcSendBTC: accept either (1) multiple (address, path) + change address, or (2) pre-fetched UTXOs with path. Sign **each input** with **its** path (like PSBT). Change output to **change address**, not sender. |
| Native bridge (iOS/Android) | Medium | New method(s) for HD send: e.g. `nostrMpcSendBTCWithUTXOs(..., utxosWithPathsJSON, changeAddress, ...)` or extend params. |
| PSBT signing | None | Already per-input path from Bip32Derivation; no change. |
| Recovery / restore | Medium | On restore from seed: derive addresses with gap limit 20; discover used range; set external/change indexes accordingly. |

---

## 2. Safe Refactor Plan

### Phase 1: Persistence & derivation (no UX change)
- Add HD index storage keys and helpers (get/set external index, change index, max used external).
- Use **existing** single-address flow but derive address from stored external index (default 0) so current behavior is unchanged.
- Ensure `getDerivePathForNetwork(..., change, index)` is used everywhere with explicit 0,0 for receive and 1,index for change when needed.
- **No** change to balance or send yet; only “plumbing” for indexes.

### Phase 2: Receive address = next external index
- When user opens “receive” or wallet home, show address at **current external index**.
- Add “Get new address” (or equivalent): increment external index, derive new address, persist, display.
- Migrate existing wallets: if `currentAddress` exists and no `hd_external_index_*`, set external index to 0 and keep showing same address (no reuse for **new** receives going forward).

### Phase 3: Balance aggregation
- WalletService: for current network + address type, get max used external (+ gap) and change (+ gap).
- Derive list of addresses (external 0..maxUsed+gap, internal 0..changeMax+gap).
- Fetch balance (totalUTXO) per address and sum; cache per-address and/or aggregated.
- Transaction list: still keyed by address; may need to merge txs from multiple addresses for “wallet” view.

### Phase 4: Change address in send flow
- **RN**: Before calling native send, derive **next change address** (internal chain, current change index). Pass to native.
- **Native**: Extend NostrMpcSendBTC (or add NostrMpcSendBTCWithUTXOs) to accept **change address** and **per-input derivation path** (from UTXOs with path). Build tx: change output to change address; sign each input with its path.
- **RN**: After **successful** broadcast, increment stored change index (so next send uses next change address).
- **UTXO source**: Either (A) RN fetches UTXOs for all in-scope addresses, tags each with path, passes to native; or (B) native accepts list of (address, path), fetches UTXOs per address, merges, tags, selects, builds. Option (A) keeps “which addresses” in RN and avoids multiple native fetches; Option (B) keeps one native call but more complex native API. **Recommendation**: (A) for clarity and reuse of existing totalUTXO/fetch.

### Phase 5: UTXO mapping and multi-address send
- When building send: collect all UTXOs from external + internal addresses (with paths); run selection (e.g. smallest-first) in RN or native; build tx with change to next internal address; sign each input with correct path.
- Ensure every stored/displayed UTXO in send flow includes `derivationPath`.

### Phase 6: Gap limit and restore
- On app init or restore: discover “used” range by checking addresses 0..N (external) and 0..M (internal) until 20 consecutive unused (or use existing restore flow if any).
- Set `hd_max_used_external` and change index from discovery so balance/send use correct ranges.

---

## 3. Exact Code Changes (Aligned With Existing Patterns)

### 3.1 New storage keys (LocalCache)

- `hd_external_index_${network}_${addressType}` — number, default 0.
- `hd_change_index_${network}_${addressType}` — number, default 0.
- `hd_max_used_external_${network}_${addressType}` — number, default 0 (for gap scan).
- Migration: if key missing, treat as 0.

### 3.2 utils.js

- **No signature change** to `getDerivePathForNetwork`; already supports `(network, addressType, useLegacyPath, account, change, index)`.
- Add helper (optional): `getReceivePath(network, addressType, useLegacyPath, index)` → path with change=0.  
  `getChangePath(network, addressType, useLegacyPath, index)` → path with change=1.
- Ensure taproot (BIP86) is not used in path until explicitly added; current UI uses legacy/segwit-native/segwit-compatible.

### 3.3 HD index service (new or in WalletService)

- `getExternalIndex(network, addressType): Promise<number>`
- `setExternalIndex(network, addressType, value): Promise<void>`
- `getChangeIndex(network, addressType): Promise<number>`
- `setChangeIndex(network, addressType, value): Promise<void>`
- `incrementChangeIndexAfterSend(network, addressType): Promise<void>` — call only after broadcast success.
- `getMaxUsedExternal(network, addressType): Promise<number>`
- `setMaxUsedExternal(network, addressType, value): Promise<void>`
- All use LocalCache with keys above; parse/store as string numbers.

### 3.4 WalletContext / UserContext

- **WalletContext.refreshWallet**: Read external index (default 0), derive path with change=0 and that index, derive address, set in state. Persist `currentAddress` as now for backward compatibility.
- **UserContext.refresh**: When deriving addresses for network, use **external index** for the “primary” receive address (legacy/segwit-native/segwit-compatible). Optionally keep deriving only one address per type at current index (no need to derive 0..N in UI unless showing “next” or balance).
- **UserContext.setActiveAddressType**: No change; still one active type; address for that type = external chain at current external index.

### 3.5 WalletService

- **getWalletBalance**:  
  - Resolve network, addressType (from state/cache).  
  - Get maxUsedExternal, changeIndex (or 0).  
  - Build address list: external indices 0..maxUsedExternal+gap, internal 0..changeIndex+gap (or 0..changeIndex if no change used yet).  
  - For each address, call `totalUTXO(address)` and sum.  
  - Apply pending sent subtraction to sum; return single WalletBalance.
- **getNextChangeAddress**: Derive path with change=1 and current change index; return address (do not increment).
- **incrementChangeIndexAfterSend**: Read change index, increment, persist.
- Cache: balance can be cached per “wallet” key (e.g. `wallet_balance_${network}_${addressType}`) for aggregated balance; or keep per-address and sum on read.

### 3.6 Receive address UX

- **WalletHome** (receive): Show address at current external index (already the case if WalletContext/UserContext use index).
- **“Get new address”**: Call getExternalIndex, increment, setExternalIndex(newValue), derive new address at new index, update state and LocalCache `currentAddress`, refresh UI.
- Migration: On first run after deploy, if `hd_external_index_*` missing but `currentAddress` exists, set external index to 0 so we don’t duplicate; from then on “Get new address” bumps to 1, 2, …

### 3.7 Send flow (Nostr MPC)

- **RN (e.g. MobileNostrPairing)**:
  1. Build list of “in-scope” addresses (external 0..maxUsed+gap, internal 0..changeIndex+gap) with their derivation paths.
  2. Fetch UTXOs for each address (same API as today: `/address/${addr}/utxo`).
  3. Tag each UTXO with its address’s derivation path → `{ txid, vout, value, status, derivationPath }`.
  4. Run coin selection (e.g. smallest-first) over combined list; get selected UTXOs with paths.
  5. Derive **change address**: getChangePath(..., changeIndex), derive pubkey, btcAddress → changeAddress.
  6. Call **new** native method, e.g. `nostrMpcSendBTCWithUTXOs(relaysCSV, ..., keyshareJSON, utxosWithPathsJSON, receiverAddress, amountSatoshi, agreedFee, changeAddress, ...)`.
  7. On success: call `incrementChangeIndexAfterSend(network, addressType)`.
- **Native (Go)**:
  - New type: `UTXOWithPath { TxID, Vout, Value, Status, DerivationPath }`.
  - New function (e.g. `NostrMpcSendBTCWithUTXOs`) that: parses utxosWithPaths, selects (or receives pre-selected) UTXOs, builds tx with recipient + **change to changeAddress**, creates prevOutFetcher, signs **each input** with **NostrJoinKeysignWithSighash(..., utxo.DerivationPath, sighash)**.
  - Remove or avoid using single derivePath for all inputs; use per-input path.
- **Bridge**: New React Native method `nostrMpcSendBTCWithUTXOs` with params including `utxosWithPathsJSON` (string) and `changeAddress` (string).

### 3.8 BBMTLib/tss/btc.go

- Add `DerivationPath string` to `UTXO` (or use a new struct `UTXOWithPath` for the new API).
- Keep `FetchUTXOs(address)` as-is (returns UTXOs without path); path is attached in RN or in a new function that fetches multiple addresses and returns UTXOs with path.
- Optional: `FetchUTXOsWithPaths(addressesWithPaths []struct{Address, Path})` that fetches per address and returns merged list with path; or keep this in RN.

### 3.9 BBMTLib/tss/mpc_nostr.go

- Add `NostrMpcSendBTCWithUTXOs(..., utxosWithPathsJSON, changeAddress, ...)` (and same pre-agreement flow as NostrMpcSendBTC).
- In the internal run: parse UTXOs with paths, select if not pre-selected, build tx with **change output to changeAddress**, then for each input call signing with **that input’s DerivationPath** (not single derivePath).
- Keep existing `NostrMpcSendBTC` for backward compatibility during migration (e.g. single-address wallets) or deprecate after cutover.

### 3.10 Gap limit

- Constant `GAP_LIMIT = 20`.
- When computing “address list” for balance or send: external indices `0..max( maxUsedExternal, externalIndex ) + GAP_LIMIT`, internal `0..changeIndex + GAP_LIMIT` (or 0..changeIndex+gap). New wallets: only 0 and 0 so two addresses.
- Restore: scan external 0,1,… until 20 consecutive unused; set maxUsedExternal; same for internal.

---

## 4. Edge Cases and Migration Strategy

### 4.1 Edge cases

- **Legacy wallets (useLegacyPath)**: Same HD logic applies; path stays `m/44'/.../0/index` and `m/44'/.../1/index`. No special case beyond existing legacy path.
- **Multiple address types**: Indexes are **per (network, addressType)**. User can switch type; each type has its own external/change indexes.
- **Concurrent sends**: Only one send at a time per (network, addressType); increment change index only after success to avoid reusing same change address.
- **Failed broadcast**: Do not increment change index; next send will reuse same change address (acceptable; or implement “pending change index” and commit on confirm).
- **Restore from seed**: No existing keyshare; after keygen/restore, set all HD indexes to 0. Optionally run discovery (gap 20) and set maxUsedExternal from chain (future improvement).
- **PSBT with mixed inputs**: Already supported; Bip32Derivation per input. No change.
- **Taproot**: Currently not in UI path helper; if added later, use BIP86 path and add case in getDerivePathForNetwork.

### 4.2 Rebuild required for change-address support
- **Go**: `BBMTLib/tss/mpc_nostr.go` exports `NostrMpcSendBTC(..., changeAddress string)`.
- **Native**: Rebuild the Tss framework (iOS xcframework, Android AAR) from BBMTLib so the new parameter is in the native API. The React Native bridge (iOS/Android) already accepts and passes `changeAddress`; they will compile once the rebuilt framework exposes the new signature.

### 4.3 Migration strategy

1. **Deploy with feature flag or gradual rollout**:  
   - New wallets: use HD indexes from 0.  
   - Existing wallets: on first load after update, if `hd_external_index_*` missing, set to 0; treat current `currentAddress` as index 0 (so no change in displayed address). From then on, “Get new address” uses index 1, 2, …

2. **No key migration**: Don’t delete or overwrite `currentAddress`; keep it in sync with “address at current external index” so any code that only reads currentAddress still works.

3. **Balance**: First version can keep “single address” balance (current address = index 0) for existing users until Phase 3 is enabled; then switch to aggregated balance so that change outputs (which will go to internal chain) are included.

4. **Send**: The app now passes an optional change address to NostrMpcSendBTC (new parameter `changeAddress`). When non-empty, change output goes to that address (HD internal chain); after successful broadcast, the app calls `incrementChangeIndexAfterSend`. **Rebuild the BBMTLib/Tss native library** (iOS xcframework and Android AAR) from the Go package so that `NostrMpcSendBTC(..., changeAddress string)` is exported; the React Native bridge and MobileNostrPairing already pass the new parameter.

5. **Rollback**: If we need to roll back, old app version will ignore new HD keys and keep using single address (currentAddress); no corruption.

### 4.4 Testing checklist

- [ ] New wallet: external index 0, change index 0; receive shows one address; send creates change to internal 0; after send, change index 1.
- [ ] “Get new address”: external index increments; new address derived; balance later includes both addresses when Phase 3 in place.
- [ ] Legacy wallet (useLegacyPath): paths remain BIP44; indexes work the same.
- [ ] Restore: indexes 0; no crash.
- [ ] PSBT sign: unchanged; still per-input path from Bip32Derivation.
- [ ] Multi-input send: inputs from two different receive addresses; each signed with correct path; change to internal address.

### 4.5 Production safety (non-custodial — fund loss prevention)

- **Change index only after broadcast success**  
  `incrementChangeIndexAfterSend` is called only after a valid txid is returned. If broadcast fails or the app crashes before that, the same change index is reused on next send (safe).

- **No signing logic changed**  
  PSBT signing still uses Bip32Derivation per input. Nostr send still uses one path per current single-address flow; when we add multi-UTXO send, each input must use its stored path.

- **Deterministic paths**  
  Paths are derived from (network, addressType, useLegacyPath, chain, index). Same inputs always yield the same path; no randomness in derivation.

- **Index storage**  
  HD indexes are stored in LocalCache (same as existing wallet state). Missing key is treated as 0. No migration that deletes or overwrites existing addresses.

- **Rollback**  
  Old app versions that don’t read HD keys still work with a single address; they ignore new keys. New app with old native library: bridge must be compatible (e.g. pass `""` for changeAddress if old API has no such param) or app must require rebuilt library.

- **Verify before release**  
  1) Rebuild Tss from BBMTLib so `NostrMpcSendBTC(..., changeAddress)` is exported.  
  2) Test send: change output goes to a **different** address (internal) than sender.  
  3) Test that after send, next send uses a **new** change address (change index incremented).  
  4) Confirm PSBT signing and existing flows are unchanged.

---

This document is the single source of truth for the HD refactor. Implementation should follow the phases and code change list above while respecting existing patterns (LocalCache, WalletService, UserContext, theming, and MPC/TSS signing).
