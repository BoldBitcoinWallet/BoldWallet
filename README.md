# Bold Bitcoin Wallet

<p align="center"> 
  <img src="https://github.com/user-attachments/assets/844f9927-252a-4fd8-a2e0-5e9d3e9b7d74" width=200 height=410>
</p>

<p align="center">
  <strong>Seedless, secure Bitcoin wallet using Threshold Signatures.</strong>
</p>

## About

Bold Bitcoin Wallet is an open-source next-generation Bitcoin wallet that eliminates traditional security tradeoffs and single points of failure. It uses Threshold Signatures (2-of-2 or 2-of-3) over your mobile devices — no internet needed for setup or signing.

## ✨ Key Features

- ✅ **Seedless Setup** - Uses Threshold Signature Scheme (TSS), no seed phrases required
- 🔐 **No Seed Phrases** - No paper backups or hardware wallets needed
- 📱 **Multi-Device Security** - Up to 3 device-based key generation with 2 devices needed for signing
- 🎛 **PSBT Signer** - Compatible with wallets like Sparrow, Electrum, BlueWallet, and more
- 🔄 **P2P Encrypted Protocol** - Secure communication between devices over Nostr or Local WiFi/Hotspot
- 🚫 **Offline Capable** - No internet required for setup or signing transactions
- 📦 **100% Open Source** - Verifiable, auditable, and transparent
- 🧾 **Flexible Mempool** - Supports Mempool.space (public or self-hosted) for enhanced privacy
- 🌐 **Connect Anywhere** - Device pairing via Nostr relays (works from anywhere) or local WiFi

## 📲 Install Bold Bitcoin Wallet App:

[<img src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83&releaseDate=1699228800"
    alt="Download on the App Store"
    height="50">](https://apps.apple.com/ae/app/bold-bitcoin-wallet/id6748949478)

[<img src="https://boldbitcoinwallet.com/playstore.svg"
    alt="Get it on Play Store"
    height="20">  Via Playstore](https://play.google.com/store/apps/details?id=com.boldwallet)

[<img src="https://zapstore.dev/images/logo.svg"
    alt="Get it on Zap Store"
    height="20">  Via Zap Store](https://zapstore.dev/apps/naddr1qvzqqqr7pvpzq7xwd748yfjrsu5yuerm56fcn9tntmyv04w95etn0e23xrczvvraqq8xxmmd9e3x7mrywaskcmr9ws90nrd9)

[<img src="https://f-droid.org/badge/get-it-on.png"
    alt="Get it on F-Droid"
    height="50">](https://f-droid.org/packages/com.boldwallet)

---

## 📱 App Overview

Bold Bitcoin Wallet provides a complete Bitcoin wallet experience with a focus on security and sovereignty:

- **🔒 Secure Lock Screen** - Biometric and passcode protection
- **🚀 Easy Setup** - Quick onboarding with device pairing
- **💼 Wallet Home** - Clean interface showing balance and transaction history
- **📤 Send Bitcoin** - Create and sign transactions securely
- **📥 Receive Bitcoin** - Generate addresses with QR codes
- **🎛 PSBT Signing** - Import and sign PSBTs from Sparrow, Electrum, and other wallets
- **⚙️ Settings** - Customize network, API providers, and wallet preferences
- **🔐 Multi-Device Pairing** - Connect devices via Nostr or local WiFi

For app screenshots and visual previews, check the [App Store listing](https://apps.apple.com/ae/app/bold-bitcoin-wallet/id6748949478) or [Play Store listing](https://play.google.com/store/apps/details?id=com.boldwallet).

----

## ➡️ BoldWallet Official Release
**[Download Latest APK Release](https://github.com/BoldBitcoinWallet/BoldWallet/releases/latest)**

> ⚠️ **Important:** This APK is signed with the official BoldWallet keystore.  
> It is **not compatible** with the version distributed via [F-Droid](https://f-droid.org).  
> Always install updates from **one source only** to avoid signature conflicts.

## 📖 Dev Guide
- You can build the Android APK yourself, via Auto Builder or Manual Build as below.
- iOS builds follow React-Native iphone–guide 

## 🪄 Android - Build It Yourself 
### 🔁 Via Auto Builder
Relies on docker (Dockerfile) - guaranteed quick way to compile and release the APK.

**Docker scripts are located in `docker/scripts/` - see [docker/README.md](docker/README.md) for full documentation.**

Build the APK seamlessly following the steps:
- Optional: edit android/release.sh when needed:
```sh
KEYSTORE_FILE="my-release-key.jks"
KEY_ALIAS="my-key"
KEYSTORE_PASSWORD="your_keystore_password"
KEY_PASSWORD="your_key_password"
```
- Run Docker Script Runner:
```sh
# use sudo if needed for docker
# This will take time given your PC performance (couple of minutes up to 30 minutes)
# When done, the app-release.apk is generated within the BoldWallet folder

> sh docker-apk-builder.sh --fdroid #optional, for F-Droid foss tailored build
> sh docker-apk-builder.sh --fdroid --git=main #optional, which git "branch,tag, or commit-hash" to use
```

For F-Droid builds, the Docker path now bootstraps pinned `libtss` plus Rust `libtss-ffi` and then runs `BBMTLib/build-dkls.sh android` (single runtime: `libbbmtmobile.so` + `libdkls_jni.so`).

![image](https://github.com/user-attachments/assets/eb8f1a45-b2cb-46ec-a061-fc0cb4f10448)
  
### ✍️ Via Manual Build
Manual build, requires manual and extra efforts to compiles the app on your PC.

BoldWallet is a typical React Native Mobile Based App ( android / iOS ).
- Built using node v20.18.1
  - npm install
  - For Android native libs (release path):
    - `cd BBMTLib && ./build-dkls.sh android`
    - This is the Android v4 runtime path (`libbbmtmobile.so` + `libdkls_jni.so`)
    - `build-all.sh` is optional for full matrix/local smoke workflows
  - For Android APK build:
    - cd android
    - ./release.sh
        - APK generated under:
            ./android/app/build/outputs/apk/release/app-release.apk 


----

## 🔐 Recovery Without the App

If you need to recover or spend Bitcoin from your keyshares without using the mobile app, you can use the command-line recovery tools. This is useful if:
- The mobile app is unavailable or not working
- You need to recover funds from keyshare backups
- You want to use the wallet from a desktop environment

### Quick Recovery Guide

Bold Wallet provides cross-platform CLI tools for recovering and spending Bitcoin from keyshare backups:

1. **`bold-spend` binary** (Recommended) - Works on Windows, Linux, and macOS
2. **`spend-bitcoin.sh` script** - Unix/Linux/macOS only

### What You Need

- **Keyshare files**: Both keyshare backup files (`.share` files from mobile app or `.ks` files)
- **Passphrases**: If your keyshares are encrypted
- **Network info**: Mainnet or testnet
- **Derivation path**: BIP32 path for your wallet address type

### Quick Example

```bash
# Navigate to BBMTLib directory
cd BBMTLib

# Build the recovery binary
./build-bold-spend.sh

# Preview transaction (estimate fee)
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient_address> \
  --amount-sats <amount> \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --keyshare1 "KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "your-passphrase-1" \
  --passphrase2 "your-passphrase-2" \
  --preview

# Send transaction (remove --preview and add --fee-sats)
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient_address> \
  --amount-sats <amount> \
  --fee-sats <estimated_fee> \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --keyshare1 "KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "your-passphrase-1" \
  --passphrase2 "your-passphrase-2"
```

### Complete Recovery Documentation

For detailed recovery instructions, including:
- All address types (Legacy, SegWit Native, SegWit Compatible, Taproot)
- Platform-specific instructions (Windows, Linux, macOS)
- Troubleshooting common issues
- Complete workflow examples
- Security best practices

👉 **See the full [Recovery Guide](https://github.com/BoldBitcoinWallet/BoldWallet/blob/v2.1.2/BBMTLib/RECOVER.md)**

The recovery guide covers:
- Building binaries for all platforms
- Using mobile app backup files directly (`.share` format)
- Fee estimation and transaction preview
- Mainnet and testnet examples
- Encrypted and unencrypted keyshare scenarios
- Platform-specific commands (Windows PowerShell, Linux, macOS)

---

#### React Native Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
