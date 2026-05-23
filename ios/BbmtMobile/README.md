# BbmtMobile (iOS native MPC)

Prebuilt **GG18 + DKLs** live in `libbbmtmobile.xcframework`. They are **not** in git (same policy as Android `jniLibs/*/libbbmtmobile.so`).

## Build (macOS only)

From the repo root:

```bash
cd BBMTLib
./build-dkls.sh ios
# or full pipeline:
./build-all.sh
```

Outputs:

- `libbbmtmobile.xcframework/` (device + simulator)
- `libbbmtmobile_go.h` (also copied to `ios/libbbmtmobile_go.h` for Xcode)

Requires: Go, Xcode, Rust `libtss-ffi` iOS targets (`mobile-deps/libtss/build-libtss.sh` runs as part of `build-dkls.sh`).

## Xcode

The app links **only** `BbmtMobile/libbbmtmobile.xcframework`. Do not add `Tss.xcframework` or a second Go runtime.

If the framework is missing after clone, run the build above — `BbmtBridge.mm` will fail compile with a pointer to this step.

See `BBMTLib/docs/DKLS_MOBILE.md`.
