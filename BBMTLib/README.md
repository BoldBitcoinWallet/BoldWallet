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


## License  
This project is licensed under the **Apache-2.0 License**. See [LICENSE](LICENSE) for details.  

## NOTICE  
This product includes modified code from third-party projects. For full attribution details, see the [NOTICE](NOTICE) file.  