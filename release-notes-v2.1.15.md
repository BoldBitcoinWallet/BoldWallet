### BoldWallet v2.1.15 – Send modal sats mode, fee UX, address validation

✨ **What's changed**

### Send Bitcoin: amount and unit
* **Sats-aware input**: SendBitcoinModal respects the BTC/Sats toggle from Wallet Home — label/placeholder (“Amount in sats” vs “Amount in BTC”), numeric keyboard selection, and Max behavior aligned with the chosen unit
* **Internal consistency**: All internal math remains in BTC; sending uses sats when in sats mode — correct amounts every time

### Send Bitcoin: fee estimation
* **Unified error handling**: “Fee Estimation Error” dialog with Retry/Cancel — no scattered alerts
* **No overlapping requests**: Max is disabled while fee estimation is in progress — avoids race conditions
* **Clean teardown**: No alerts or side effects after the modal is closed or unmounted — predictable behavior

### Send Bitcoin: address validation
* **Network-aware validation**: Uses `validateBitcoinAddressEnhanced` so fee estimation, Max, QR imports, and send confirmation all require an address valid for the currently selected network
* **Inline errors**: Invalid-address messaging shown inline — clear feedback before sending

### QR and copy behavior
* **Static pairing QR**: The “Scan on another device to auto fill” QR in TransportModeSelector is non-copiable via `copyDisabled` — other QR usages remain copiable by default

### Fixes
* **Device QR toasts**: Resolved Toast host conflict so QR-related toasts on the Devices screen appear above their modals — no longer hidden underneath overlays

### Technical
* **Version**: 2.1.15 (package.json); iOS MARKETING_VERSION 2.1.15; Android versionName 2.1.15
* **Build**: Updated iOS Xcode project and Android build as applicable

**💛 _No servers. No seed phrases. Just sovereign sats._**

—

🔗 **Learn more** at [boldbitcoinwallet.com](https://boldbitcoinwallet.com/)

🔐 **PGP public key** at [boldwallet-publickey.asc](https://github.com/BoldBitcoinWallet/.github/blob/main/PGP/boldwallet-publickey.asc)

📎 **SHA256: app-release.apk.sha256**

`<replace with actual SHA256 after build>`

🔑 **SHA256-PGP-Signature: app-release.apk.sha256.asc**

```text
<replace with actual PGP signature after signing>
```

**APK signature**

This APK is signed with the official BoldWallet keystore.

Do not mix it with the F-Droid/Zapstore or other stores signed build. Stick to one source for updates.
