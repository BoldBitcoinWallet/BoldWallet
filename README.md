# Bold Bitcoin Wallet

<p align="center"> 
  <img src="https://github.com/user-attachments/assets/844f9927-252a-4fd8-a2e0-5e9d3e9b7d74" width=200 height=410>
</p>

<p align="center">
  <strong>Seedless, secure Bitcoin wallet using Threshold Signatures.</strong>
</p>

## About

Bold Bitcoin Wallet is an open-source Bitcoin wallet. Keys are split across your phones with a threshold signature, so no single phone holds a seed phrase. Duo needs both phones for every spend. Trio lets any two of three approve. Setup and signing on a local Wi-Fi network or hotspot need no internet. Nostr pairing works from anywhere and does need a connection.

## Features

- **Seedless.** There is no 12-word seed. A backup is an encrypted keyshare file on the phone.
- **PSBT.** Sign partially signed transactions from Sparrow, Electrum, BlueWallet, and other wallets.
- **Mempool hosts.** Use mempool.space, public hosts, or a host you run.
- **Dice rolls.** Optional. The same dice sequence on every phone becomes the master chaincode. See [docs/DICE_USER_GUIDE.md](docs/DICE_USER_GUIDE.md).
- **Shop names.** Optional. A Branta QR can show the shop name and logo before you pay.
- **Open source.** The wallet, the signing library, and the release builds can be inspected.

## Install

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

**[Download the latest APK](https://github.com/BoldBitcoinWallet/BoldWallet/releases/latest)**

This APK is signed with the official BoldWallet keystore. It is not compatible with the [F-Droid](https://f-droid.org) build. Install updates from one source only, or Android will refuse the update because the signature does not match.

The release APK is 64-bit ARM only (`arm64-v8a`), about 53 MB. 32-bit Android phones are not supported. They are not secure enough for a modern wallet: the kernel, the chipset, and the manufacturer's update policy leave them behind even a modest 64-bit phone.

## Build

### Docker

From the repo root. Details are in [docker/README.md](docker/README.md).

```sh
./docker/scripts/docker-apk-builder.sh
./docker/scripts/docker-apk-builder.sh --fdroid
./docker/scripts/docker-apk-builder.sh --fdroid --git=main
```

The F-Droid image builds `libbbmtmobile.so` and `libdkls_jni.so` from the pinned [libtss](https://github.com/BoldBitcoinWallet/libtss) checkout.

### Manual

Node 22.23.4 and Go 1.27.4. A new machine follows [docs/DEV-SETUP.md](docs/DEV-SETUP.md).

```sh
cd BBMTLib && ./build-dkls.sh android
cd android && ./release.sh
```

`./release.sh` writes an arm64 APK to `android/app/build/outputs/apk/release/app-release.apk`. A fat emulator build uses the flags in [RELEASE.md](RELEASE.md).

### iOS

Xcode on macOS. The same setup guide covers the native xcframework and the CocoaPods install.

## Recovery

Use the command-line tools only when the phones are unavailable. Both keyshares are loaded on that one computer. The steps and the warning are in [BBMTLib/RECOVER.md](BBMTLib/RECOVER.md).
