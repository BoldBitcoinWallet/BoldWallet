# BBMTLib

**Bold Bitcoin MPC TSS Library**

A secure Multi-Party Computation (MPC) Threshold Signature Scheme (TSS) library for Bitcoin, built for mobile integration on both iOS and Android.

## How to Build

```bash
# Get dependencies
go mod tidy

# Initialize Go Mobile (install as tool, doesn't modify go.mod)
go install golang.org/x/mobile/bind@latest

# Set build flags
export GOFLAGS="-mod=mod"
```

## iOS

```bash
# Build for iOS, macOS, and iOS Simulator
gomobile bind -v -target=ios,macos,iossimulator -tags=ios,macos,iossimulator github.com/BoldBitcoinWallet/BBMTLib/tss
```

## Android

```bash
# Build for Android
gomobile bind -v -target=android github.com/BoldBitcoinWallet/BBMTLib/tss

# If the following error occurs  
"no usable NDK in /Android/Sdk: unsupported API version 16"
# Then specify the version api with the following command
gomobile bind -v -target=android -androidapi 21 github.com/BoldBitcoinWallet/BBMTLib/tss

# Copy the generated tss.aar lib to the android/app/libs folder
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