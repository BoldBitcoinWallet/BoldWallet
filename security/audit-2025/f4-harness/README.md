# F4 evidence harness

Compiles the ACTUAL patched `RNEncryptedStorage.m` (RN API stubbed via
`React/`) and exercises it against a real Keychain. Asserts at the
query-construction level (`storeQueryForKey:`), because macOS Keychain
match semantics differ from iOS and a live ACL dump is misleading
(both match queries succeeded on macOS during development).

## Run

From the repo root (macOS, Xcode CLT):

```sh
RNESIOS=node_modules/react-native-encrypted-storage/ios
clang -fobjc-arc -framework Foundation -framework Security \
  -Isecurity/audit-2025/f4-harness -I"$RNESIOS" \
  security/audit-2025/f4-harness/main.m "$RNESIOS/RNEncryptedStorage.m" \
  -o /tmp/f4harness-bin && /tmp/f4harness-bin
```

Requires `npx patch-package` to have applied
`patches/react-native-encrypted-storage+4.0.3.patch` (runs on
`npm ci` via postinstall).

## Expected output

```text
ok: keyshare setItem resolves value
ok: keyshare getItem round-trips
keyshare query kSecAttrAccessible = akpu
ok: keyshare query has WhenPasscodeSetThisDeviceOnly
ok: pref setItem resolves
some_pref query kSecAttrAccessible = <absent>
ok: non-keyshare query keeps library behavior
ok: missing key resolves nil
HARNESS PASSED
```

`akpu` is Apple's constant value for
`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. The `<absent>` line
proves non-keyshare keys keep stock library behavior (F4 scoping).
