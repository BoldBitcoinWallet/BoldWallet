# DKLs23 mobile integration

## gomobile limitation

`gomobile bind` **cannot** import packages that use cgo (`import "C"`). The libtss stack uses **Go c-shared** + JNI (Android) / `DklsBridge` (iOS).

Do **not** add `externalNativeBuild { cmake { path "CMakeLists.txt" } }` to `android/app/build.gradle`. That breaks React Native 0.82 bridgeless startup (`PlatformConstants` TurboModule missing). JNI is prebuilt into `jniLibs` by `build-dkls.sh` instead.

## Build (required before device test)

```bash
cd BBMTLib

# Prerequisites: Rust, Go 1.22+, `cargo install cargo-ndk`, Android NDK r23+
# (set ANDROID_NDK_HOME to a numeric NDK, e.g. .../ndk/28.2.13676358 — not legacy rc*)

# All native artifacts (GG18 + DKLs, Android + iOS on macOS)
./build-all.sh

# Or manually:
# 1) ./mobile-deps/libtss/build-libtss.sh
# 2) ./build.sh --with-dkls
# 3) cd .. && npx react-native run-android
```

Outputs:

| Platform | Artifact |
|----------|----------|
| Android GG18 | `android/app/libs/tss.aar` (gomobile; keep using main-branch / `build.sh` artifact) |
| Android DKLs | `android/app/src/main/jniLibs/<abi>/libbbmtmobile.so` (unified `bbmtmobile` build; `Dkls*` via JNI only) |
| Android | `android/app/src/main/jniLibs/<abi>/libdkls_jni.so` (built by `build-dkls.sh`, not app CMake) |
| iOS | `ios/BbmtMobile/libbbmtmobile.xcframework` — **unified** GG18+DKLs (one Go runtime). Do **not** link `Tss.xcframework` + a second Go runtime (heap crash). |
| iOS | `ios/DklsMobile/libdklsmobile_go.h` |

Build iOS artifacts:

```bash
cd BBMTLib && ./build-dkls.sh ios
```

### iOS Xcode setup (one-time)

1. Run `BBMTLib/build-dkls.sh ios` → `ios/BbmtMobile/libbbmtmobile.xcframework`
2. Link **only** `BbmtMobile/libbbmtmobile.xcframework` (remove `Tss.xcframework` and `libdklsmobile` from the app target)
3. Sources: `ios/BbmtBridge.mm`, `ios/TssShim.swift`; bridging header imports `BbmtBridge.h`
4. Header search: `$(PROJECT_DIR)/BbmtMobile` and `$(PROJECT_DIR)` (for `libbbmtmobile_go.h`)

## New wallet setup (duo + trio)

- **Default backend:** DKLs23 for new keygen (duo 2-of-2 and trio 2-of-3). GG18 preparams (`ppm.json`) run only when `DKLS23_OPTED_OUT` is set (dev: long-press **Choose Your Setup** on Welcome).
- **Prepare step:** DKLs runs `helloDkg` — on device this only checks `libtss` linkage (`tss_version`), not a full in-process DKG (avoids iOS heap issues beside gomobile `Tss`). GG18 runs `preparams` (minutes). UI copy is backend-aware (`services/tssKeygenPrepare.ts`).
- **LAN party names:** HTTP relay uses `KeyShare1`, `KeyShare2`, `KeyShare3` (not `party1`). Go maps these in `dkls/party.go`.
- **Progress:** DKLs reports `type: keygen` / `type: keysign` via `tss.ReportKeygenProgress` / `ReportKeysignProgress`. RN maps steps in `services/mpcProgress.ts` (duo keygen denom 14, trio 22, keysign 12 per input; step 99 = done).

### Setup test matrix (manual)

| Mode | Transport | Expected |
|------|-----------|----------|
| Duo | LAN | `tss_backend: dkls23`, shared pubkey |
| Duo | Nostr | same + `nostr_npub` on keyshare |
| Trio | LAN | three `KeyShareN` roles, 2-of-3 DKG |
| Trio | Nostr | three npubs in session |
| Any | Opt-out | GG18 preparams + legacy keyshare shape |

Scripts: `./scripts-dkls/main.go local-keygen` (duo), `local-keygen-3` (trio).

### Trio spend / keysign (aligned with GG18)

- **2-of-3 signing** uses only the participating devices, not all three DKG parties.
- **Nostr:** `partiesNpubsCSV` = local npub + selected peer (same as GG18 `mpc_nostr.go`). Go maps npubs → DKG ids via `keygen_committee_keys` order (`dkls/signing_resolve.go`).
- **LAN:** `partiesCSV` = `KeyShare1,KeyShare3` style subset when two devices co-sign; ids come from `share.Identifier()`, not list index.
- **Tests:** `TestDKGAndSignInProcessTrio`, `TestResolveSigningSessionLANTrioSubset`, `TestResolveSigningSessionNostrMapsCommitteeIndex`.

## Verify on device

1. **Smoke:** Dev build → trigger `dklsHelloDkg` (or check logs for `DklsNative: libbbmtmobile loaded`).
2. **LAN keygen:** New wallet via **Devices Pairing** (duo or trio on same Wi‑Fi).
3. **Nostr keygen:** New wallet via **Nostr Connect**. All devices must run a build with `libdklsmobile` linked.
4. **GG18 regression:** Open an old wallet → send/sign should still use BNB (`tss_backend: gg18`).
5. **Spend / PSBT:** DKLs23 wallets use the same `TssProvider` paths; native `dkls*` methods call Go (`NostrMpcSendBTC`, `MpcSignPSBT`, etc.) with per-input DKLs keysign.
6. **Devices tab:** Wallet Information shows **Wallet type** (`DKLs23 (libtss)` vs `GG18 (BNB)`).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `DKLS_NATIVE_REQUIRED` | Run `./build-dkls.sh android` and rebuild app |
| `libbbmtmobile not loaded` | Check `jniLibs/arm64-v8a/libbbmtmobile.so` exists (`./build-dkls.sh android`) |
| CMake skipped `dkls_jni` | Build `libbbmtmobile.so` first; CMake only builds JNI if it exists for that ABI |
| Link errors building `.so` | Install NDK, set `ANDROID_NDK_HOME`, run `cargo install cargo-ndk` |
| `Duplicate class go.Seq` (release) | Do not add `dkls.aar` alongside `tss.aar`; use `build-dkls.sh android` only |

## Keyshare format

DKLs23 keyshares use `tss_backend: "dkls23"` and `share_b64`. Not compatible with BNB GG18 keyshares.
