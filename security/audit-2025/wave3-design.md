# Wave 3 Phase A design — F15b + F18 + F10

Status: DESIGN FOR REVIEW. No implementation code. Phase B starts on
sign-off. Environment confirmed: iOS simulator BUILD SUCCEEDED,
Android compileDebugKotlin + unit 6/6 green, emulator-5554 attached.

## 0. Ground truths established in Phase A research

Corrections and findings that shape this design (all verified against
source, not assumed):

1. **F18 premise was wrong — reframed.** Wave 2 notes said iOS
   `nostrJoinKeysign` "loads from RNES natively". It does not:
   `ios/BBMTLibNativeModule.swift:927` takes `keyshareJSON: String`
   from JS, exactly like Android `:741`. BOTH platforms pass
   keyshare-JSON-from-JS on this method. F18 = REMOVE BOTH bridge methods in 3b (dead code mitigates
   reachability, not severity — severity stays High).
2. **`nostrJoinKeysign` is dead from JS** (repo-wide search: zero
   callers outside audit docs). F18 reshape has zero JS migration
   cost; the method today is pure attack surface.
3. **Bridge `fetchData` is LIVE** (`MobilesPairing.tsx:2281`, inside a
   `while`-retry poll loop during LAN ceremonies). High-frequency →
   per-call auth tokens are unworkable; ceremony-scoped tokens only.
4. **Bridge `aesEncrypt` / `aesDecrypt` / `aesEncryptStoredKeyshare`
   are DEAD** (zero callers). Removal candidates (F10 surface cut).
5. **A biometric-auth service EXISTS**
   (`services/walletBiometricAuth.ts`): backup/airgap/delete/dev-view
   already prompt. F10 tokens and F4 re-integration build on the OS
   prompt stack, not on this JS helper directly (see §6: JS booleans
   are forgeable by same-context JS; tokens must be native-minted).
6. **No keyshare-blob read happens on background/foreground paths.**
   `mpcKeepAlive`, `SyncCoordinator`, `providerHealthPoller` never
   touch RNES/keyshare; no `AppState` handler reads the blob. The
   Wave 2 "backgrounded reads" rationale referred to in-flight
   ceremonies continuing while backgrounded — which hold shares in
   memory, never re-read. Consequence: ceremony auth minted in the
   foreground never needs to prompt while backgrounded (§5).
7. **GG18 keygen is reachable** (user pref, default DKLs23,
   `tssConfig.ts:21`). GG18 DKG output (`tss/mpc.go`, returns
   `localState` secret JSON) and GG18 signing are in scope — no
   consumer left on plaintext. (Deprecating new GG18 is a product
   call, §9 Q5; legacy GG18 import must work regardless.)
8. **THE ENVELOPE REQUIREMENT (most important).** F15b as "remove
   share bytes from bridge methods" is INSUFFICIENT: any JS can call
   `EncryptedStorage.getItem('keyshare')` directly and read the
   at-rest JSON with `share_b64`. The RNES native module is itself a
   bridge. Therefore the `keyshare` RNES value must become an
   ENVELOPE decryptable only natively (AES-GCM via platform APIs,
   device-bound key in Android Keystore / iOS Keychain). JS-direct
   reads then yield ciphertext. Alternatives considered and
   rejected: renamed/obscure storage keys (obscurity, fragile);
   Go-held at-rest keys (more moving parts, same trust root).
   The envelope uses platform APIs only — no new crypto libs.
9. **Handles alone do NOT fix F10's bridge half.** Any bridge API
   that issues a usable active-share reference is equally callable
   by malicious JS. So: there is NO API to obtain the active share
   — signing/transport methods load implicitly from RNES+envelope
   (as most already do), and AUTHORIZATION comes from ceremony
   tokens minted alongside an OS-visible prompt (§6). Handles exist
   only for staged (unpersisted, usually attacker-created-if-abused)
   shares. Confidentiality = handles + envelope (F15b);
   authorization = ceremony tokens (F10).
10. **Clipboard is already gated** (dev-mode + biometric + explicit
    warning naming the secrets). F10 still removes the secret write:
    gate depth is not a substitute for not exfiltrating.
11. `getKeyshare()` (utils.js) has exactly 2 callers
    (`DeviceScreen:42`, `PSBTScreen:137`, both pub_key+chaincode for
    descriptors) and no internal callers. Removable.
12. `getKeyshareNostrPrepJSON` has 1 caller, fixed 5-key contract.
    Left untouched; new superset getter added alongside.

## 1. Opaque handle model

### 1.1 Shape

- Go-side registry (new file, e.g. `BBMTLib/dkls/handles.go` +
  GG18 side in `BBMTLib/tss/` or one shared package):
  `map[handleID]entry`, `handleID` = 16 random bytes (crypto/rand),
  hex-encoded for bridge transit.
- `entry = {backend, secret}` where secret is `*libtss.KeyShareHandle`
  (DKLs, live object) or `SecureBytes`-held LocalState JSON (GG18,
  re-parsed per op — matches today's accessor pattern).
- Registry holds AT MOST 2 entries, enforced: one `staged`
  (unpersisted setup/import result, JS-referenced by ID) and one
  `activeCache` (implicit, native-managed, never exposed to JS).
  Staging a new entry destroys any prior staged entry.
- JS-visible handle payload: `{handle: "<hex32>", metadata: {...}}`.
  Handle IDs are unguessable; knowledge of a staged ID grants nothing
  except referencing a share the holder's own ceremony created.

### 1.2 Lifecycle

- CREATE: DKG setup completion (Go registers `share` → returns ID +
  metadata); backup import (Go decrypts (B1), verifies (F2),
  registers → ID + metadata + legacy flag). No plaintext resolved.
- STAGE→PERSIST: `persistStoredKeyshare(handle, {nsec?, npub?})`.
  Go finalizes JSON (adds nsec/npub fields as
  `finalizeKeyshareForStorage` does today), emits JSON bytes to
  NATIVE ONLY, native envelope-encrypts (§1.5) and writes RNES,
  returns metadata. JS writes the SQLite metadata mirror from the
  response (metadata-only, safe). Staged entry destroyed after
  persist (single-use staging).
- ACTIVE USE: signing/transport methods take NO handle. Native
  loads RNES → de-envelopes → imports to Go `activeCache` (lazy:
  only when cache empty) → calls existing Go ops. JS passes only
  ceremony token + operation params.
- DESTROY: `destroyKeyshareHandles()` wipes staged + activeCache +
  native caches. Wired into delete-wallet (all 4 sites), setup
  abort (both screens), import abort. Explicit per-handle destroy
  is unnecessary (max 2 entries, both cleared together); staged
  IDs are single-use and invalidated on persist anyway.

### 1.3 Scoping

Per-launch (ephemeral, Go heap only). No persisted handles — this
sidesteps the entire F13 authenticated-persistence problem by
construction. Cross-launch continuity = RNES+envelope, re-imported
lazily on next foreground use.

### 1.4 Background / process death

- Background: process alive → handles intact → in-flight ceremonies
  continue with zero re-reads and zero prompts (§5 proof that no
  read path fires backgrounded).
- Kill: Go memory gone → both entries unrecoverable. Restart: old
  IDs unresolvable (registry empty) → any use lazily restores from
  RNES+envelope under a NEW internal cache entry. No orphaned
  handle is usable (IDs are never valid across launches);
  re-auth is required for the next ceremony (positive F13
  interaction: no silent resume post-death; F13 itself stays open).

### 1.5 At-rest envelope (closes the JS-direct-RNES hole, §0.8)

- The `keyshare` RNES value becomes
  `v1:<base64 nonce>:<base64 AES-GCM ciphertext>` (new format
  marker; GCM over the full keyshare JSON).
- Envelope key: AES-256-GCM key in Android Keystore / iOS
  Keychain (`WhenPasscodeSetThisDeviceOnly`), generated on first
  3a launch, never exposed to JS (all encrypt/decrypt in native
  platform code). No new crypto libs: `javax.crypto`+KeyStore /
  CommonCrypto+SecKey.
- Migration (native, first 3a launch): read RNES value; if it
  lacks the `v1:` marker, parse-validate minimally (must contain
  `pub_key`, else treat as corrupt → typed error directing to
  backup re-import), envelope-encrypt, write back. If the
  device key was invalidated (Keychain/Keystore reset),
  de-envelope fails → typed `[SECURE_STORAGE_INVALIDATED]`
  (reuse F3/F4 copy: "re-import your keyshare backup").
- Nothing else changes at rest: outer RNES protection (F3/F4)
  stays; B1 backup format untouched (export re-uses
  `backupEncryptStoredKeyshare`, which de-envelopes natively
  first — one-line change inside an already-ciphertext method).
- Migration protocol (atomic, retry-safe; RNES is key-value,
  so atomicity comes from a staging key, not file rename):
  1. DETECT: read `keyshare`; `v1:` marker present → done
     (delete any leftover `keyshare_migrating`, resolve
     `{migrated:false}`). Absent → sniff `pub_key` (else
     corrupt → typed error, direct to backup re-import).
  2. WRITE envelope to `keyshare_migrating` (ESP `commit()`,
     synchronous — never `apply()`; Keychain Add is sync).
  3. VERIFY: read back staging, decrypt, compare bytes to
     the plaintext read in (1).
  4. PROMOTE: write envelope to `keyshare`, verify decrypt,
     delete `keyshare_migrating`, then the plaintext is gone
     (overwritten — no separate delete step can strand it).
  5. CRASH-MID-MIGRATION: recovery is idempotent — staging
     present+valid → resume at (4); `keyshare` already `v1:`
     → delete staging, done; plaintext + no staging →
     restart at (2). Plaintext and envelope never coexist
     past step (4) except across a crash, and recovery
     always converges to envelope-only.
  6. SANITIZED LOGGING: lengths, booleans, step markers only
     (`migrating len=412`, `promoted ok`). Never values,
     never partial plaintext, never nonces.
  7. UI: bootstrap calls `ensureKeyshareEnveloped()`
     (idempotent) with a blocking "Securing your keyshare…"
     status; resolves `{migrated:bool}`.
  8. POST-MIGRATION (Q2 condition): on first `{migrated:true}`
     (one-time flag in AppConfigRepository), show "Your
     keyshare storage was upgraded. Make sure you have a
     current backup." with an "Open backup" action.

### 1.6 Wipe semantics

- Every registry destruction wipes: DKLs `share.Free()`;
  GG18 `SecureBytes.Destroy()` + `clear()` on transient buffers;
  map entry deleted. `defer` on all paths incl. errors.
- Native transient copies (JNI String, NSString, RNES-read
  buffers): references dropped immediately after use; JNI/NS
  transit copies are unwipeable — disclosed, same class as the
  Wave 2 "irreducible copies" (now one boundary inward: they
  never reach JS). No JS string ever holds share bytes — the
  property the §8 tests prove.
- `destroyKeyshareHandles` wipes staged + activeCache + drops
  native cached buffers. Post-destroy, registry lookups fail
  closed (unknown-handle error, never a stale share).

## 2. Bridge contract change (complete enumeration)

Both platforms mirror unless noted. `token` = §6 ceremony token
(3b). `meta` = §3 superset metadata. Promise/resolver plumbing
unchanged.

### Table A — F15b reshaped (3a unless noted)

| # | Method | Current | New |
|---|---|---|---|
| A1 | `mpcTssSetup` | resolves GG18 LocalState JSON (secret) | OUT OF WAVE 3 (F19): stays plaintext (reachable via opt-out pref); TssProvider takes the legacy branch (C1/C2 note) |
| A2 | `nostrMpcTssSetup` | resolves LocalState JSON; takes `partyNsec` | OUT OF WAVE 3 (F19): stays plaintext; TssProvider takes the legacy branch (C1/C2 note) |
| A3 | `dklsMpcTssSetup` | resolves keyshare JSON (`share_b64`) | resolves `{handle, metadata}` |
| A4 | `dklsNostrMpcTssSetup` | resolves keyshare JSON; takes `partyNsec` | resolves `{handle, metadata}`; KEEPS `partyNsec` (same rationale) |
| A5 | `backupDecrypt` | resolves `{format, plaintext}` (secret) | REMOVED. Replaced by A6 (sole caller: import flow) |
| A6 | NEW `importBackupToStagedHandle` | — | `(blob, password)` → `{handle, metadata, legacy}`. Go: B1-decrypt → F2-verify → stage. JS validates metadata only |
| A7 | NEW `persistStoredKeyshare` | — | `(handle, {nsec?, npub?})` → `metadata`. Go finalizes JSON → native ONLY → envelope → RNES. Replaces `persistWalletKeyshare`'s RNES write |
| A8 | NEW `getKeyshareMetadataJSON` | — | `()` → §3 superset metadata. Replaces blob reads for descriptors, chaincode, labels, legacy detection |
| A9 | NEW `getKeyshareStructureRedacted` | — | `()` → dev field tree, secret values `<redacted len=N>`. Replaces direct RNES read in dev view |
| A10 | NEW `destroyKeyshareHandles` | — | `()` → `true`. Wipes staged + activeCache + native caches. Delete/abort flows |
| A11 | `nostrJoinKeysign` (BOTH — F18, 3b) | takes `keyshareJSON` + `partyNsec` from JS | REMOVED both platforms (dead from JS: zero migration; removal beats reshape for dead attack surface). Go cgo stays (native-only, harmless) |
| A12 | `backupEncryptStoredKeyshare` | `(password)` → ciphertext (already clean) | 3a: unchanged. 3b: ADD `token` (replaces JS-layer biometric gate with enforced ceremony auth) |

### Table B — token-gated, no plaintext change (all 3b)

ADD `token` param (last before promise/resolver); native
verifies §6, else rejects `[CEREMONY_AUTH_REQUIRED]`.

| # | Method | Token op |
|---|---|---|
| B1–B4 | GG18 signing ×4 | EXCLUDED from Wave 3 (F19): stay untokenized. Fail closed naturally on DKLs wallets (LocalState parse fails); GG18-wallet ceremony-auth gap disclosed under F19 |
| B5–B8 | `dklsMpcSignPSBT`, `dklsMpcSendBTCWithUTXOs`, `dklsNostrMpcSendBTC`, `dklsNostrMpcSignPSBT` | `sign` |
| B9–B12 | A3–A4 (DKLs setup; A1–A2 GG18 excluded per F19) | `keygen` (3a ships WITHOUT tokens; DKG-start ungated interim — solo DKG harmless, disclosed) |
| B13 | `publishData` | parent ceremony token (`sign`\|`keygen`) + session — NO separate transport class/mint (revised 3b-1b: one token per ceremony; LAN send within the ceremony session) |
| B14 | `fetchData` | parent ceremony token (`sign`\|`keygen`) + session (poll loop covered by the ceremony token — why tokens are session-scoped, never per-call) |
| B15 | `setAPI` | allowlist-or-token: OK iff URL ∈ native-persisted allowlist OR valid `config` token (which persists the URL). Init passes with stored URLs; attacker hosts fail without a user-visible prompt |
| B16 | `setFeeAPIs` | same rule as B15 (same oracle-pointing class) |
| B17–B18 | A6 `importBackupToStagedHandle`, A7 `persistStoredKeyshare` | `import` (one prompt covers stage+persist; persist ungated would let malicious JS overwrite RNES with an attacker share — the guard is JS-side and skippable) |
| B19 | cancel ×4 | ceremony token (same op+session). STUCK-cancel: fresh token for the same sessionID re-auths (acceptable UX, no un-cancellable state). F12's exact-match mechanism stays Wave 4. Cancel REVOKES the session token natively (3b authorization requirement — F10 isn't closed if cancel leaves the token valid) |
| B20–B21 | `nostrKeypair`, `eciesKeypair` (REVISED 3b kickoff: retain + gate, do not remove — live callers confirmed) | `keygen` (same ceremony/session as DKG: one token covers pairing-identity generation + setup; generation ≠ exfil but a live secret-minting oracle needs the OS-visible prompt all the same) |

### Table C — removed (LANDED IN 3a per mandated sequence; the "(3b)" label here is stale — no code action)

`aesEncrypt`, `aesDecrypt`, `aesEncryptStoredKeyshare` (both
platforms). Generic oracles with no JS callers. Go
`BbmtAesEncrypt/Decrypt` stay (native-stored path + Go-internal
callers — verify in Phase B, do not remove blindly).

Verification rule (applied pre-Phase-B + re-run at removal):
repo-wide zero-caller search AND WebView inventory (single
static-HTML quotes marquee; zero onMessage/injectedJavaScript/
postMessage app-wide) AND `eval(`/`new Function` (zero) AND
dynamic bridge indexing `NativeModule[` (zero). No hidden path
reaches the dead methods → plain method deletion; no bridge
registration change needed. (If any path is ever found, pair
removal with registration-gating instead.)

### Table D — unchanged + why (all others, both platforms)

- Pure public-input crypto/format: `derivePubkey`, `encodeXpub`,
  `getOutputDescriptor`, `appendOutputDescriptorChecksum`,
  `btcAddress`, `recoverPubkey`, `sha256`, `secureRandom`,
  `parsePSBTDetails`/`psbtIdentityHash` (iOS),
  `computeTxId`, `hexToNpub`, `getDeviceEntropyMetadata`.
- Read-only oracles: `totalUTXO`, `estimateFees`,
  `estimateFeeWithUTXOs`, `spendingHash(+WithUTXOs)`.
- Broadcast-only: `postTx` (attacker txs can't get signed
  without a ceremony token).
- LAN device ops: `runRelay`, `stopRelay`, `listenForPeers`,
  `discoverPeers`, `getLanIp` (availability-only impact).
- Setup helpers: `preparams`, `ensureDklsLanRuntime`,
  `dklsHelloDkg` (no secrets).
- Fresh-secret generators: `nostrKeypair`, `eciesKeypair`.
  REVISED 3b kickoff: RETAIN + TOKEN-GATE (B20–B21, `keygen`
  class), do not remove. Q7 verification: LIVE callers
  confirmed (`MobileNostrPairing:1240` pairing identity;
  `MobilesPairing:1953` LAN transport) → removal BLOCKED
  (would regress pairing). A removed dead method is a win; a
  gated live method is the actual fix — minting requires the
  OS-visible prompt like every other secret-yielding call.
- Non-sensitive config: `setBtcNetwork`, `setFeePolicy`.
- Presence (already clean): `hasKeyshareInSecureStorage`,
  `getKeyshareNostrPrepJSON` (fixed 5-key contract, 1 caller).
- ~~Cancel ×4: deliberately UNGATED until F12 (Wave 4)~~ —
  STRUCK 3b kickoff, superseded by B19 (Q6): cancel takes the
  ceremony token (same op+session) and REVOKES the session
  token natively. STUCK-cancel answered by fresh-token
  re-auth. Only F12's exact-match MECHANISM stays Wave 4.
- Plumbing: `addListener`, `removeListeners`, `disableLogging`.

### Go/cgo surface changes (3a)

- NEW registry: `StageShare`, `LookupStaged`, `DestroyStaged`,
  `ActiveCacheStore/Lookup/Clear` — IDs/metadata only, never
  share bytes.
- `KeyshareJSONFromHandle`: stays for NATIVE persist emission
  (Go→native bytes for envelope input). Guardrail test extended:
  3a bans resolving its output through any `*Native` return
  (Wave 2 banned plaintext `ExportKeyShare(`; same test file).
- DKG funcs (`dkls/nostr.go`, `dkls/lan.go`, GG18
  `tss/mpc.go` + Nostr keygen): return `{handleID,
  metadataJSON}` instead of secret JSON.
- NEW cgo (3a): `BbmtImportBackupStaged(blob, pw)`,
  `BbmtFinalizeStagedForPersist(handle, nsec, npub)` → JSON
  for native envelope input, `BbmtDestroyHandles()`,
  `BbmtImportJSONToActive(json)` (restore path).
- `DklsNostrJoinKeysign` / `BbmtNostrJoinKeysign` (cgo): take
  keyshare bytes from NATIVE (unchanged at cgo level — the JS
  param disappears one layer up). 3b.

## 3. Metadata allowlist extension

Base = NostrPrep 5 keys (both platforms, tested, 1 caller — DO
NOT MODIFY that method). New `getKeyshareMetadataJSON` superset
(both platforms, identical key sets, parity-tested):

INCLUDE: `pub_key`, `chain_code_hex`, `keygen_committee_keys`,
`local_party_key`, `nostr_npub` (NostrPrep 5) + `created_at`,
`tss_backend`, `suite` (legacy/backend detection).
`chain_code_hex` follows the NostrPrep precedent — already
JS-visible today, so this expands nothing; the SQLite mirror's
chaincode-blanking is a separate hardening that stands
(inconsistency disclosed, out of scope).

EXCLUDE (asserted absent by test on every response):
`share_b64`, `ecdsa_local_data`, `nsec`, `sessionKeyHex`, any
`encKey`/`decKey`/`sessionKey`, other entries' handle IDs.

`getKeyshareStructureRedacted` (dev view): same JSON walk as
today's `parseKeyshareJsonForDevView`, performed NATIVELY with
secret leaves replaced by `"<redacted len=N>"`. UI renders the
response unchanged. Dev-gate + biometric + warning stay.

SQLite mirror (`KEYSHARE_META_JSON`): stays JS-side, but input
becomes the §3 metadata object (not the blob). The blob-reading
backfill in `getKeyshareMetadata` is replaced by A8. Test
asserts the mirror never contains secret fields.

## 4. Consumer enumeration (file, function, today → tomorrow)

3a consumers (storage flows + clipboard):

| # | File : function | Plaintext today | Tomorrow |
|---|---|---|---|
| C1 | `MobilesPairing.tsx` LAN setup (~1173, ~591) | DKG `result` string → React state, `JSON.parse` validation, `pendingKeyshareRef`, `persistWalletKeyshare(raw)` | `{handle, meta}`; state holds meta; validation + `getKeyshareDisplayLabel` from meta; ref holds handle; commit → A7; abort → A10 (+ RNES clear) |
| C2 | `MobileNostrPairing.tsx` Nostr setup (~1811, ~2665) | `keyshareJSON` → `pending.json` → `persistWalletKeyshare(pending.json, {nsec…})` | handle in `pending`; finalize opts (nsec/npub) passed INTO A7; same panel UX |
| C3 | `keyshareImport.ts` `decryptAndValidateKeyshare` + `finalizeKeyshareImport` | `backupDecrypt` → `envelope.plaintext` (secret) → parse/validate → persist | A6 → `{handle, meta, legacy}`; garbage/format checks move native; `resolveUseLegacyDerivationPaths` already takes meta-only inputs — unchanged; legacy alert unchanged |
| C4 | `walletSetupOrchestrator.ts` `persistWalletKeyshare` / `finalizeKeyshareForStorage` / `verifyWalletKeysharePersisted` | builds/writes full JSON via `EncryptedStorage.setItem`; verify reads raw blob | persist takes `(handle, opts)` → A7 → returns meta → JS writes SQLite mirror; finalize's field-merge moves into Go (`BbmtFinalizeStagedForPersist`); verify → native `hasKeyshareInSecureStorage` (exists both platforms) |
| C5 | `utils.js` `getKeyshare()` + `DeviceScreen:42` + `PSBTScreen:137` | full blob parse for pub_key+chaincode (descriptors) | REMOVE `getKeyshare`; both callers → A8 |
| C6 | `chaincodeReader.ts` | raw `EncryptedStorage.getItem` for chaincode | A8 (chaincode in allowlist) |
| C7 | `KeyshareInfoContent.tsx` dev view (~497, :605, :1769 tree) | direct RNES read → full structure incl. secrets → tree display + clipboard copy | A9 redacted structure → same tree UI; copy → metadata-only (npub/pub_key/suite/committee); dev-gate + biometric + warning stay |
| C8 | delete-wallet ×4 (`WalletSettings:1109`, `ShowcaseScreen:213`, `MobileNostrPairing:2705`, `WalletHome:1260` meta-only) | RNES clear/remove + meta clear | prepend A10 (destroy handles); rest unchanged. Typed-phrase gate stays (it IS the confirmation; destroy is RNES-nondestructive until the clear runs) |
| C9 | `DiceEntropySheet.tsx:604` | copies raw dice rolls (chaincode preimage) | `copyDisabled` (QR scan remains the transfer path; mirrors airgap precedent). PROPOSED — reviewer can strike (§9 Q4) |
| C10 | `utils.js` `save/get/clearKeyshareMetadata` + backfill (~1508) | mirror writes from blob; backfill reads blob | mirror I/O takes §3 meta; backfill → A8 |

GG18 note (F19): C1/C2 dispatch by backend. GG18 runs keep
the CURRENT plaintext flow on an explicit
`{kind:'legacy-gg18'}` branch — F19-cited, fully functional,
NOT silent compat. L1 spy tests skip the GG18 branch with an
F19 cite. A6/A7/envelope stay backend-agnostic (no GG18
import/persist regression).

Already-clean, NO CHANGE (verified): `BackupKeyshareModal`,
`AirgapKeyshareExportModal` (ciphertext via A12); NostrPrep
caller (`MobileNostrPairing:281`); `WalletHome`/`WalletSettings`/
`ShowcaseScreen` meta readers; `resolveTssBackend*` (meta-only);
all §2-Table-D callers; QR/clipboard sites carrying public data
only (descriptors, npub, txid, rawTxHex, signed PSBT,
`connectionDetails` = npub+name+nonce, extension QR = pubkey).

3b consumers (ceremony auth threading): `TssProvider` sign/setup
wrappers + direct callers (`MobilesPairing:876/1953/2281`,
`WalletService` setAPI ×3 + `WalletSettings:977`,
`Backup/Airgap` modals) — each obtains a §6 token at ceremony
start and threads it through. Mechanical once §6 lands.

## 5. Background / polled read paths

Verified inventory (Phase A greps — no blob read fires off the
user-visible path):

| Path | Reads keyshare? | Under F15b |
|---|---|---|
| `mpcKeepAlive` (ceremony progress) | NO (Go status events only) | unchanged |
| `SyncCoordinator` / `providerHealthPoller` | NO | unchanged |
| `AppState` foreground/background handlers | NO blob reads | unchanged |
| In-flight ceremony backgrounded (user backgrounds mid-sign) | holds Go/native memory, never re-reads | works: handles + minted token survive; NO prompt can fire (tokens mint foreground-only) |
| Kill mid-ceremony → relaunch | registry empty | old IDs unresolvable; next use lazily restores from RNES+envelope; next ceremony re-auths (no silent resume) |
| `fetchData` poll loop (LAN) | transport ciphertext, not keyshare | covered by ceremony token (3b); loop mechanics unchanged |
| Bootstrap `hasKeyshare*` / restore discovery | presence bool / metadata | unchanged (already clean) |

Conclusion: NO path needs metadata-only downgrade or
elimination — the background concern dissolves because (a) no
read fires backgrounded, and (b) ceremony auth is
mint-in-foreground/use-anywhere. This is what makes F4
biometry re-integration feasible (§6).

EXPLICITLY CONFIRMED pre-Phase-B: zero keyshare/RNES reads in
AppState active-transition handlers repo-wide; zero in
setInterval/setTimeout bodies in MobilesPairing,
MobileNostrPairing, mpcKeepAlive, TssProvider (8 sites —
transport/status only). No biometry exemptions needed; no
re-read path exists to exempt.

## 6. Ceremony tokens + F4 biometry re-integration (3b)

### 6.1 Why tokens, why not handles-alone (§0.9)

Same-JS-context malicious code reads all JS state and calls all
bridge methods. Handles give CONFIDENTIALITY (no share bytes
reachable); they cannot give AUTHORIZATION (any issuance API is
equally callable). Authorization = a token mintable ONLY
alongside a user-visible OS authentication. The task's option
(a)-primary is therefore reframed honestly: (a)=F15b
confidentiality is necessary but insufficient for F10;
(b)-generalized-to-per-ceremony is the authorization fix.
Per-call tokens are rejected: the `fetchData` poll loop and
multi-message ceremonies would prompt-storm; session-scoped is
the only shippable shape, and same-context piggybacking during
an ACTIVE ceremony is unaffected by granularity anyway
(disclosed residual, §6.4).

### 6.2 Mechanics

- NEW per-ceremony mint methods (NO generic "request token
  for class X" — a generic minter would be the same
  vulnerability one level up): `requestSignCeremonyToken`,
  `requestKeygenCeremonyToken`, `requestExportCeremonyToken`,
  `requestImportCeremonyToken`, `requestConfigCeremonyToken`,
  each `(sessionID)` → NATIVE shows OS auth (BiometricPrompt /
  LAContext, biometric-or-device-passcode; no-sensor devices
  still get a device-passcode prompt — never silent) with
  HARDCODED per-ceremony copy (JS supplies nothing, so the
  action label is unspoofable) → mints random 128-bit token →
  native map `{token: (opClass, sessionID, expiry≤10min)}` →
  resolves token string. Op CLASSES: `sign`, `keygen`,
  `export`, `import`, `config` — no cross-class replay
  (sign/export/import/config tokens never interchange). NO
  `transport` class: transport calls verify against the PARENT
  ceremony token (`sign`|`keygen`) + session — the ceremony's
  own channel, one token per ceremony, no confusion mode.
  Devices with NO screen lock configured: REFUSE with UX
  message (`[CEREMONY_AUTH_NO_LOCK]`, "Set a device screen
  lock to continue") — DECIDED (Q3).
- Table-B methods take `token` (+ `sessionID` where the call
  lacks one), verify natively (exists, non-terminal, op +
  sessionID match, TTL bounds ceremony START per 3b-1c),
  else `[CEREMONY_AUTH_REQUIRED]` (single code, no reason
  oracle). Tokens are multi-use within their (op,
  sessionID); replay across op/session fails. JS maps stable
  tokens to user copy ("Confirm to continue — authenticate
  in the prompt").
- Release: explicit `releaseCeremonyToken(token)` on
  cancel/complete (best-effort from JS) + 10-min expiry (§10:
  10 min wins; the earlier "30-min" here was a doc bug) +
  native wipe on A10. Stale tokens fail closed, never linger.
  TTL bounds ceremony START, not duration (3b-1c): only
  MINTED tokens can expire; a started ceremony never dies
  mid-sign from token expiry. Duration bounded by
  complete/release/cancel, single-live-session supersession,
  and process death.
- Tests: jest mocks the native module (no OS prompt); JVM/XCTest
  use a DEBUG-only `requestCeremonyTokenTest(op, sessionID)`
  (compile-gated: `BuildConfig.DEBUG` / `#if DEBUG`; absent in
  release). No `__DEV__` fail-open anywhere near ceremony auth
  (unlike the advisory JS helper, which keeps its semantics for
  non-enforcing UI gates only).

### 6.3 F4 biometry: what prompts, what doesn't

- PROMPTS (foreground, user-initiated): signing ceremonies
  (`sign`), DKG setup (`keygen`), backup/airgap export
  (`export` — replaces the current JS-layer biometric gate
  with enforced ceremony auth; one prompt, not two),
  custom-API writes (`config`), backup import+stage (`import`,
  one prompt covers A6+A7). (No `join` class: A11 removed.)
- NO PROMPT: metadata reads, presence checks, restore
  discovery, bootstrap, in-flight backgrounded work (uses
  minted token), delete (typed-phrase gate stays).
- Rationale: prompts gate EXFIL and SIGNING — the two
  irreversible actions. Routine reads stay device-unlock-grade
  (today's UX, no spurious prompts). F4's item-level class
  (`WhenPasscodeSetThisDeviceOnly`) stands unchanged; the
  biometric INTENT deferred from Wave 2 is fulfilled at the
  ceremony layer — the independently-correct layer, since
  item-level biometry cannot survive backgrounded reads
  either way.

### 6.4 Disclosed residuals (F10)

- Same-context JS active DURING a user ceremony can piggyback
  the session token (fundamental same-context limit; mitigated
  by short ceremonies, user surprise, and the MPC-peer
  requirement for valid signatures).
- Malicious JS can wipe RNES / SQLite (availability-only DoS;
  backup restores; unpreventable — same class as AsyncStorage
  deletion).
- Attacker-swapped PSBT shown to the user: the ceremony
  prompt shows title/detail supplied BY JS (spoofable
  summary). Full fix = native confirmation screen parsing
  destination/amount from the PSBT bytes at signing time —
  explicitly OUT of this wave (recommend as F10-follow-up or
  Wave 5 item, not silently dropped).

## 7. Split decision: RECOMMEND 3a / 3b

One wave covering registry + envelope + all storage consumers
+ all ceremony reshapes + tokens + F18 + F10 is too large to
review as a unit and cannot fail independently. The seam is
clean (storage flows need no ceremony auth to be fully
closed):

WAVE 3a = F15b-1 (storage confidentiality) + F10-clipboard:
Table C dead-oracle removals + Go registry + envelope +
migration (§1) + Table A A3–A10 (A1–A2 GG18 → F19; setup
WITHOUT tokens) + §3 + §4-C1–C10 + F10 clipboard (C7/C9 +
clipboard-after-export tests). FIRST COMMIT: clipboard
removal (highest-likelihood exfil path, independent of
envelope). Closes: DKLs create, persist, import-decrypt,
read, dev-view, delete. Interim states, all disclosed:
DKG-start ungated (solo DKG harmless); signing still
implicit-load without tokens (no JS plaintext — same as
today, strictly safer via envelope); GG18 plaintext (F19).

WAVE 3b = F15b-2 (ceremony) + F18 + F10-bridge + F4-auth:
Table A A11(removal)–A12 + Table B incl. B17–B19 (B1–B4
GG18 excluded per F19) + §6 + F18 removal verification +
malicious-JS simulation tests + round-trips. Closes:
signing-path plaintext (F18 both platforms removed),
bridge authorization incl. cancel (F10), ceremony biometry
(F4 intent). Keypair generators retained per Q7.

Each merges only with its scope FULLY closed (§8 evidence).
If the reviewer vetoes the split, the same design executes
as one wave on `security/wave3-f15b-f18-f10`; branches below
assume the split.

## 8. Test strategy (primary evidence)

Form: (a) bridge-spy instrumentation + resolve-schema
assertion, NOT JS heap scan (Hermes internals — flaky,
indirect). The boundary claim "no share bytes cross JS↔native"
is proven in layers:

- L1 jest bridge-spy per closed flow (3a: setup-output,
  import, persist, read/metadata, dev-view, delete; 3b:
  signing, join, export, config): mock native module records
  EVERY arg + resolution; test uses a known share fixture;
  assert no recorded string contains `share_b64`,
  `ecdsa_local_data`, `nsec1`, or base64(known share bytes).
- L2 native schema tests (JVM + XCTest, all new/changed
  resolves): assert payloads match `{handle, metadata}` /
  metadata schemas; assert secret keys absent. F18 parity:
  symmetric tests both platforms proving native-load.
- L3 Go registry tests: stage/lookup/destroy isolation,
  double-destroy safety, Destroy-wipes (extends Wave 2
  SecureBytes tests), guardrail: no `*Native` return resolves
  `KeyshareJSONFromHandle` output.
- L4 instrumented round-trips both platforms:
  create→persist→read→sign→verify; RNES inspection asserts
  `v1:` envelope undecryptable without device key; kill
  mid-session → relaunch → old IDs unusable + wallet
  restorable; clipboard-after-every-export-action clean.
- L5 (3b) malicious-JS simulation: sensitive calls without /
  wrong-op / expired token → typed fail, no side effect;
  `setAPI` attacker URL → fail; allowlisted URL without
  token → pass (init path proven).

## 9. Reviewer questions (blocking sign-off)

- Q1. Split 3a/3b as §7, or one wave? (Branches:
  `security/wave3a-f15b1-f10clip` / `security/wave3b-f15b2-f18-f10`
  vs `security/wave3-f15b-f18-f10`.)
- Q2. Envelope (§1.5) confirmed as the JS-direct-RNES answer?
  (Only sound alternative is relocating the keyshare out of
  RNES entirely — larger change, same trust root.)
- Q3. Ceremony auth REFUSES on devices with no screen lock
  (§6.2). Confirm the UX gate, or downgrade to
  warn-and-allow (weaker; say so explicitly)?
- Q4. Dice-roll clipboard → `copyDisabled` (C9)? One-line,
  zero transfer-path loss (QR scan remains). Strike if the
  rolls aren't considered key material.
- Q5. GG18: migrate (spec'd in A1/A2/B1–B4) or product-decide
  to deprecate NEW GG18 keygen (scope shrinks; legacy import
  still migrates regardless)?
- Q6. `cancel*` ungated until F12 — acceptable interim?
- Q7. `nostrKeypair` / `eciesKeypair` unchanged (F5 scope) —
  confirmed out of wave?
- Q8. Native PSBT-confirmation screen → F10-follow-up/Wave 5
  (§6.4) — tracked now, or does F10 stay open until it lands?

END OF PHASE A. Awaiting review + sign-off before Phase B.
Branch for this doc: `security/wave3-f15b-f18-f10` (rename at
Phase B kickoff if Q1 splits).

## 10. Pre-Phase-B resolutions (approved with split)

- Q1 SPLIT: 3a = storage confidentiality + clipboard +
  dead-oracle removals (`security/wave3a-f15b1-f10clip`); 3b =
  ceremony + F18 + F10-bridge + F4-auth + cancel gating.
- Q2 ENVELOPE APPROVED with: atomic migration (staging-key
  protocol §1.5), fail-closed device-key loss (typed error),
  one-time post-migration backup prompt.
- Q3 REFUSE to sign without screen lock, with UX message.
- Q4 CLIPBOARD FIRST: secret clipboard removal lands as the
  first 3a commit, before the envelope. Metadata-only copy
  (npub, pub_key, suite) kept. Dice copy disabled.
- Q5 GG18 OUT OF WAVE 3 → F19 (protocol-variant decision,
  deferred, High). A1/A2 + B1–B4 excluded; A6/A7/envelope
  stay backend-agnostic.
- Q6 CANCEL GATED in 3b (B19); F12 mechanism stays Wave 4.
- Q7 KEYPAIR VERIFICATION: live callers found → removal
  BLOCKED; retained, F5 scope.
- Q8 PSBT-SCREEN → F20 (High, post-Wave-3).

3a sequence (mandated): clipboard removal → dead-oracle
removals → envelope + registry → consumers → migration →
tests. L1+L2 accepted as primary evidence. Report green
before 3b.