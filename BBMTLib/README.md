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
./build.sh              # tss.aar only (GG18)
./build-dkls.sh android # libbbmtmobile.so (DKLs JNI; tss.aar still for GG18)
./build-dkls.sh ios     # libbbmtmobile.xcframework (macOS only)
```

| Backend | Script | Android | iOS |
|---------|--------|---------|-----|
| **Both** | `build-all.sh` | `tss.aar` + `jniLibs/*/libbbmtmobile.so` | `BbmtMobile/libbbmtmobile.xcframework` |
| GG18 (BNB) | `build.sh` | `android/app/libs/tss.aar` | legacy `Tss.xcframework` (app uses bbmtmobile on iOS) |
| DKLs23 | `build-dkls.sh` | `jniLibs/*/libbbmtmobile.so` (+ `dkls_jni`) | `ios/BbmtMobile/libbbmtmobile.xcframework` |

Do **not** add `dkls.aar` on Android — it duplicates `go.Seq` from `tss.aar`. See [docs/DKLS_MOBILE.md](docs/DKLS_MOBILE.md).

## iOS (manual gomobile)

```bash
gomobile bind -v -target=ios,iossimulator,macos -o Tss.xcframework github.com/BoldBitcoinWallet/BBMTLib/tss
```

## Android (manual gomobile)

```bash
gomobile bind -v -target=android -androidapi 21 -o tss.aar github.com/BoldBitcoinWallet/BBMTLib/tss
cp tss.aar ../android/app/libs/tss.aar
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