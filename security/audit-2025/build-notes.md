# Build environment notes (hardening sessions, 2026-10)

## 1. Never trust a piped exit code (F41 session, 2026-10-25)

`npm ci 2>&1 | tail -2` reported success while the install was incomplete
(`node_modules/fast-base64-decode/index.js` missing; the release JS bundle
then failed). A pipeline's exit code is the LAST command's (`tail`), not the
installer's.

Rule: capture the exit code unpiped (`cmd > log 2>&1; echo "exit=$?"`), or
check the produced artifacts directly. This applies to `npm ci`,
`./gradlew ... | tail`, `go test ... | tail`, `xcodebuild ... | tail`.

## 2. xcodebuild test + build-system sandboxing

`xcodebuild test` build phases ([CP] Embed Pods Frameworks / Copy Pods
Resources for the BoldWalletTests target) fail in this shell with
sandbox-exec "Operation not permitted" on mkdir/rsync. The same phases pass
with `ENABLE_USER_SCRIPT_SANDBOXING=NO` (CLI override, no project change):
`** TEST BUILD SUCCEEDED **`. The only iOS test is the stock RN template
(`testRendersWelcomeScreen`, looks for "Welcome to React", 600 s timeout) —
never maintained, fails by design. Project iOS evidence is therefore:
`xcodebuild build` SUCCEEDED (Debug), `build-for-testing` SUCCEEDED, F4
keychain harness PASSED, ceremony-harness PASSED.

## 3. Gradle offline cache misses are not test failures

`./gradlew test --offline` failed at `:app:checkDebugOptimizedAarMetadata`
(debugOptimized AAR variants never cached). Run online once to fill the
cache; only then does `--offline` work. Distinguish "could not resolve /
download" (environment) from test failures (results XML).

## 4. Emulator / device hygiene

- Instrumented: target `Small_Phone_API_35` explicitly (`ANDROID_SERIAL`)
  — a concurrently attached physical device previously caused
  INSTALL_FAILED_UPDATE_INCOMPATIBLE.
- Root `connectedDebugAndroidTest` fails at
  `:op-engineering_op-sqlite:mergeDebugAndroidTestNativeLibs` (duplicate
  `libc++_shared.so`, op-sqlite vs react-android) — third-party packaging
  conflict, not a test failure. Use `:app:connectedDebugAndroidTest`.
