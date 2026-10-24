# F15b-2 ceremony-token harness (iOS side)

Compiles the ACTUAL `ios/CeremonyTokens.swift` (pure Swift, no RN
deps) with `swiftc` and exercises the token state machine,
class/session binding, expiry, and revocation with a fake clock.
Mirrors `CeremonyTokensTest.kt` case-for-case. No keychain use;
nothing to clean up.

## Run

From the repo root (macOS, Xcode CLT):

```sh
swiftc -o /tmp/ceremony-harness ios/CeremonyTokens.swift \
  security/audit-2025/ceremony-harness/main.swift && /tmp/ceremony-harness
```

## Expected output

Ends with `CEREMONY HARNESS PASSED`. Covers: mint→verify
activation + multi-use, class/session binding with
no-transition-on-failure, unknown-token fail, lazy expiry,
complete→used, release→revoked (idempotent), cancel +
new-ceremony revocation, same-session remint supersede, strict
wire parsing.
