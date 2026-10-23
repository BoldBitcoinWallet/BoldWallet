# Wave 2 PR notes — F15 (partial) + F3 + F4

Branch: `security/wave2-f15-f3-f4` on top of Wave 1 merge `c6d2613f`.
Scope: F15, F3, F4 only. No backup-format change, no wire-format change,
no new crypto libs.

## Headline

- **F3 DONE.** Android ESP fails closed with typed errors, StrongBox-first,
  `security-crypto:1.1.0` stable, UI surfacing, patch-package.
- **F4 DONE** (with documented fallback decision — see below). Keyshare
  Keychain item gets `WhenPasscodeSetThisDeviceOnly`, keyshare-scoped,
  via patch-package. No per-read biometry: rationale documented.
- **F15 PARTIAL → F15b open.** SecureBytes-at-export + wipe + theater
  removal landed and are tested. The `share_b64`-to-JS contract change
  did NOT land: the stored RNES JSON still carries plaintext `share_b64`
  through JS on persist/import/read. Details + bridge audit below.

## F15 — what landed

1. `BBMTLib/dkls/keyshare.go`: `KeyshareJSONFromHandle` uses
   `libtss.ExportKeyShareSecure` (mlock'd `SecureBytes`) + `defer
   secure.Destroy()`. The GC-heap `ExportKeyShare` string is gone from
   this path.
2. `BBMTLib/bbmtmobile/cstring.go` + new `BBMTLib/internal/cstrwipe`:
   `BbmtFree` memsets the full tracked allocation before `free`.
   Untracked/foreign pointers fall back to plain free (no crash).
3. Bridge theater removed (both platforms): the `withZeroed*Keyshare*`
   wrappers staged bytes, wiped the staging buffer, then built a NEW
   `String` and passed that on — wiping the wrong copy. Deleted; call
   sites pass the buffer through. Comments mark remaining copies as
   irreducible pending F15b.
4. Backup-export opacity pinned: `backupEncryptStoredKeyshare(password)`
   loads the stored JSON in native, encrypts in Go, resolves only the
   `BW2$` blob. JS never parses it (opacity tests).

## F15 — what did NOT land (→ F15b, stays open)

The stored format and its consumers still move plaintext `share_b64`
through JS. Concretely, today:

| Flow | Plaintext `share_b64` crosses JS? |
|---|---|
| Wallet persist (`persistWalletKeyshare` → `EncryptedStorage.setItem('keyshare', finalized)`) | YES — full JSON string built/passed in JS |
| Wallet read (`getKeyshare()` parses stored JSON) | YES |
| Backup import (`backupDecrypt` resolves `{"format","plaintext"}`) | YES, both platforms |
| Backup export (`backupEncryptStoredKeyshare`) | NO — ciphertext blob only (pinned by test) |
| LAN/PSBT signing (`mpcSignPSBT` et al.) | NO — native loads from RNES (both platforms) |
| Nostr join keysign | Android YES (`nostrJoinKeysign` takes `keyshareJSON: String` from JS); iOS NO (loads from RNES natively) |
| DKG setup output (`KeyshareJSONFromHandle` → bridge string) | YES — returns JSON string with `share_b64` |

Removing `share_b64` from all of these = native-held shares: native-side
persist, native-side import-decrypt returning metadata only,
metadata-only `getKeyshare`, and migrating Android `nostrJoinKeysign`
to native load. That is F15b (architectural, multi-surface); the Android keysign
asymmetry is tracked as F18. No heap-scan
test was written: it cannot pass while the JSON string exists, and a
test asserting it would be theater. `TestF15_BackupBlob_CiphertextOnly`
pins the backup-blob property (B1's) instead.

## F3 — failure-mode matrix

| Failure | Kind | Behavior | UI copy |
|---|---|---|---|
| `KeyPermanentlyInvalidatedException` | INVALIDATED | throw, nothing saved/read | "Secure storage was reset… re-import your keyshare backup." |
| `UserNotAuthenticatedException` | LOCKED | throw | "Your device must be unlocked… nothing was saved or read." |
| `UnrecoverableKeyException`, `KeyStoreException` | CORRUPTED | throw | "Secure storage… is corrupted… re-import your keyshare backup." |
| Any other `Exception` | UNAVAILABLE | throw | "Secure storage is unavailable — screen lock enabled and unlocked…" |
| `StrongBoxUnavailableException` in cause chain | — | fall through to TEE (not an error) | none |
| iOS `errSecInteractionNotAllowed` / `errSecAuthFailed` | LOCKED | reject | same LOCKED copy |
| iOS other `OSStatus` | UNAVAILABLE | reject | same UNAVAILABLE copy |

Decisions:

- `security-crypto:1.1.0` (stable). No alpha acceptance needed.
- `setUserAuthenticationRequired` deliberately NOT set: the keyshare is
  read on backgrounded/JS-polled paths (ceremony progress, resume)
  where per-read auth would fail spuriously. Bar enforced:
  device-unlock-grade binding + StrongBox/TEE hardware backing.
  Per-ceremony biometric unlock belongs with F15b.
- Fault-injection rationale: on-device key invalidation (biometric
  re-enrollment) and device-lock-mid-test are not programmatically
  triggerable on an emulator, so the INVALIDATED/LOCKED paths are
  proven at the mapper unit level (6/6) plus structurally: no
  `getSharedPreferences(` call exists anywhere in the module anymore —
  the fallback branch was deleted, not guarded.
- Patch-package (already in use, 3 existing patches), NOT vendoring.

## F4 — policy and fallback rationale

- Keyshare entry (`kSecAttrAccount == "keyshare"` ONLY): gets
  `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. All other
  RNEncryptedStorage keys keep library behavior (proven by harness:
  non-keyshare query carries no `kSecAttrAccessible`).
- NO `SecAccessControl`/biometry. Rationale: same as F3 — the keyshare
  is read on JS-polled/background paths where a prompt cannot work.
  User impact: nobody is locked out (no enrollment requirement);
  protection is device-passcode-grade + no backup migration, not
  biometric-grade. Attacker with an unlocked device reads via app
  context like any app data. Biometric-gated unlock → F15b.
- Pre-F4 items migrate on next write (`SecItemDelete` + `SecItemAdd`
  with the new query).
- Keychain failures reject with the same `[SECURE_STORAGE_<KIND>]`
  tokens, so JS copy is shared with F3.

## Patch proof (F3/F4 shared artifact)

- `patches/react-native-encrypted-storage+4.0.3.patch`: exactly 2 files
  (`.java` + `.m`), 170+/45-, regenerates byte-identically (stable).
- Fresh-install proven: both files restored to pristine npm-tarb
...[truncated 3289 chars]