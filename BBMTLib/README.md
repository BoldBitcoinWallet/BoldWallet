# BBMTLib

**Bold Bitcoin MPC TSS Library**

A secure Multi-Party Computation (MPC) Threshold Signature Scheme (TSS) library for Bitcoin, built for mobile integration on both iOS and Android.

## How to Build (mobile)

```bash
cd BBMTLib

# Everything for release (libtss + GG18 + DKLs, Android + iOS on macOS)
./build-all.sh

# Or step by step:
./build.sh --with-dkls    # GG18 gomobile + DKLs (no libtss pre-step / host smoke)
./build-dkls.sh android # libbbmtmobile.so + dkls_jni (GG18 + DKLs, single runtime)
./build.sh              # gomobile tss.aar / Tss.xcframework (legacy; Android app uses bbmtmobile)
./build-dkls.sh ios     # libbbmtmobile.xcframework (macOS only)
```

For F-Droid / Android release builds, prefer this minimal path:

```bash
cd BBMTLib
bash mobile-deps/libtss/setup-libtss.sh
cargo install cargo-ndk
./build-dkls.sh android
```

`build-all.sh` remains useful for local full-matrix builds, but is not required to produce the Android APK native artifacts.

| Backend | Script | Android | iOS |
|---------|--------|---------|-----|
| **Both** | `build-all.sh` | `jniLibs/*/libbbmtmobile.so` + `dkls_jni` | `BbmtMobile/libbbmtmobile.xcframework` |
| GG18 + DKLs | `build-dkls.sh android` | same (Bbmt* + Dkls* JNI) | `build-dkls.sh ios` |
| Legacy gomobile | `build.sh` | (not linked in app) | optional `Tss.xcframework` |

Do **not** ship `tss.aar` and `libbbmtmobile.so` together — two Go runtimes corrupt the heap. See [docs/DKLS_MOBILE.md](docs/DKLS_MOBILE.md).

## iOS (manual gomobile)

```bash
gomobile bind -v -target=ios,iossimulator,macos -o Tss.xcframework github.com/BoldBitcoinWallet/BBMTLib/tss
```

## Android (release app)

```bash
./build-dkls.sh android   # libbbmtmobile.so + libdkls_jni.so per ABI
```

## FIPS 140-3 (SP 800-90A DRBG) (NIST) compliance

The library can be built with the Go Cryptographic Module so that key generation and signing use FIPS 140-3 approved algorithms. The top-level `build.sh` and the Docker build enable this by default.


**Randomness Behavior:**

- **Without FIPS:**  
  - Only one source of entropy is used
  - `crypto/rand.Reader` uses **only the operating system’s RNG** via `crypto/internal/sysrand`.  
  - No DRBG is used; output is directly from the OS.

- **With FIPS enabled:**  
  - Two different sources of entropy are mixed together
  - `crypto/rand.Reader` is backed by an **SP 800-90A DRBG** (`crypto/internal/fips140/drbg`), seeded from a dedicated FIPS entropy source.
  - On every read, **128 bits of OS randomness** are mixed in as additional input, strengthening the output per FIPS requirements.

- **Build with FIPS (default):** `GOFIPS140=v1.0.0` is set in `build.sh`; the resulting binary runs in FIPS mode by default. No runtime env is required.
- **Build without FIPS:** run `GOFIPS140=off ./build.sh` (or set `GOFIPS140=off` before `gomobile bind`).
- **Docker:** pass `--build-arg GOFIPS140=off` to disable FIPS in the image.

Requires Go 1.24+. See [Go FIPS 140-3](https://go.dev/doc/security/fips140).

## License  
This project is licensed under the **Apache-2.0 License**. See [LICENSE](LICENSE) for details.  

## NOTICE  
This product includes modified code from third-party projects. For full attribution details, see the [NOTICE](NOTICE) file.  