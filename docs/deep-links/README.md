# Deep link server setup (Phase 2)

BoldWallet handles external URLs via native intent filters and JS routing in `IncomingUrlHandler`. HTTPS universal links require hosting verification files on `boldbitcoinwallet.com`.

## Pay URL shape

```
https://boldbitcoinwallet.com/pay?address=<bitcoin-address>&amount=<btc-decimal>
```

Optional query params mirror BIP-21 (`label`, etc.) where supported by `parseUniversalPayLink`.

## iOS — Apple App Site Association

Host at:

```
https://boldbitcoinwallet.com/.well-known/apple-app-site-association
```

Use the template in [`apple-app-site-association`](./apple-app-site-association). Team ID `2G529K765N`. App ID: `org.reactjs.native.boldbtc.wallet`. Live copy: `welcome` repo → `public/.well-known/`.

Enable **Associated Domains** in Xcode — `applinks:boldbitcoinwallet.com` and `applinks:www.boldbitcoinwallet.com` in `BoldWallet.entitlements`.

## Android — Digital Asset Links

Host at:

```
https://boldbitcoinwallet.com/.well-known/assetlinks.json
```

Use the template in [`assetlinks.json`](./assetlinks.json). Live copy: `welcome` repo → `public/.well-known/`.

**Fingerprints:** include every certificate users may install with:

| Source | Key | Status |
|--------|-----|--------|
| GitHub APK / sideload | Upload keystore (`BoldBitcoinWallet.jks`) | In `assetlinks.json` |
| Google Play | App signing key (Play Console → Setup → App integrity → App signing) | Add when available |

Package name: `com.boldwallet`.

Both `boldbitcoinwallet.com` and `www.boldbitcoinwallet.com` HTTPS `/pay` links are supported (Android manifest + iOS associated domains).

## Verification

- **iOS:** Install release build, tap a `/pay` link in Notes/Safari; app should open without a disambiguation browser step.
- **Android:** `adb shell am start -a android.intent.action.VIEW -d "https://boldbitcoinwallet.com/pay?address=bc1qtest"` (also test `https://www.boldbitcoinwallet.com/pay?...`)
- **Web fallback:** https://boldbitcoinwallet.com/pay?address=… (landing page in `welcome` repo)
- **Custom schemes:** `boldwallet://import-keyshare`, `bitcoin:bc1q...?amount=0.001`
