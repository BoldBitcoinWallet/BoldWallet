# F15b-1 envelope harness (iOS side)

Compiles the ACTUAL `ios/KeyshareEnvelope.swift` (pure Swift, no RN
deps) with `swiftc` and exercises seal/open/keychain/migration on
macOS. Throwaway keychain accounts only; cleans up after itself
(including the test device key).

## Run

From the repo root (macOS, Xcode CLT):

```sh
swiftc -o /tmp/envelope-harness ios/KeyshareEnvelope.swift \
  security/audit-2025/envelope-harness/main.swift && /tmp/envelope-harness
```

## Expected output

Ends with `ENVELOPE HARNESS PASSED`. Intermediate `ok:` lines
cover: seal shape + opacity, round-trip, fresh nonce, tamper
rejection, 7 malformed rejections, F4 protection-class parity
of the store query, migration converge + idempotent re-run,
crash recovery, corrupt-fails-closed + untouched, cleanup.

The Android mirror is `EnvelopeInstrumentedTest` (real
Keystore + ESP on emulator) plus JVM `AesGcmEnvelopeTest`.
