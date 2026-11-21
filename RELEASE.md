# Release process — BoldWallet

## Toolchain minimums (F28-exp)

These floors exist because **CVE-2026-111943** (Go x509 eMudhra trust)
shipped in v4.1.0's `libbbmtmobile.so` and was fixed in **go1.26.10**, and
because **GO-2026-6859 / CVE-2026-97054** (`net/http` MaxBytesReader header
race) is fixed in **go1.26.11**. Do not regress them. **go1.27.4** is the
pin because Go 1.26's android/arm64 `C.GoString` reads outside the MTE
granule and GrapheneOS kills the process (`SEGV_MTESERR`). The bridge also
copies those strings with `strnlen`, so a remaining `C.GoString` in the
runtime is covered by this pin. `govulncheck` must run with this Go on
`PATH`: its version probe sets `GO111MODULE=off` and ignores `GOTOOLCHAIN`.

| Tool    | Minimum   | Pinned in |
|---------|-----------|-----------|
| Go      | 1.27.4    | `BBMTLib/go.mod` (`toolchain`), Dockerfiles, CI `setup-go`, `GOTOOLCHAIN=local` |
| Node    | 22.23.4   | `Dockerfile`, `package.json` engines, `.nvmrc` |

## Pre-release gate

After rebuilding native artifacts and before tagging:

```sh
./build-dkls.sh android
./build-dkls.sh ios
./BBMTLib/scripts/verify-native-artifacts.sh   # must PASS
```

`verify-native-artifacts.sh` fails the build if any shipped `.so` was built
with Go below the floor, if ABIs carry mixed versions, or if the iOS
archives contain vulnerable Go strings. Run it on the release machine;
there is no artifact-upload CI workflow on this track to gate it in
(the stamp workflows live on the Wave 5 branch — merge keeps both).

## Release artifacts (manual, F34 skipped)

`.sha256` / `.asc` for the APK/AAB/IPA are produced and uploaded manually
on the GitHub release page. Do not ship a release without them.

## Android APK ABIs

The GitHub and sideload `app-release.apk` packages `arm64-v8a` only, the same
set as the Play AAB (`android/scripts/build-play-aab.sh`). Android Studio's
signed-APK action uses that default. The React Native Gradle plugin appends
`reactNativeArchitectures` from `android/gradle.properties` onto the ABI
filter, so that property is `arm64-v8a` as well, and `app/build.gradle`
writes the filter again after the plugin. `jniLibs` still holds
`armeabi-v7a` and `x86_64` so the native stamp can require all three.
A fat APK for an emulator or a 32-bit phone:

```sh
cd android
./gradlew assembleRelease \
  -PplayAbi=arm64-v8a,armeabi-v7a,x86_64 \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
```
