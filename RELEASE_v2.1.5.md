### 🚀 BoldWallet v2.1.5 – Address Stability, Legacy Wallet Support & Network State Improvements

**✨ What's Changed**

### 🔒 Address Stability & State Management
* **Fixed Address Flickering**: Completely resolved address changing/flickering after lock/unlock by making UserContext the single source of truth for addresses
* **Network-Specific Address Derivation**: UserContext now properly derives separate btcPub values for both mainnet and testnet, eliminating race conditions
* **Consistent Address Display**: WalletHome now prioritizes userActiveAddress from UserContext over local state, ensuring you always see the correct address
* **Eliminated Race Conditions**: Improved address derivation flow prevents address mismatches during state updates and network switches

### 🎯 Legacy Wallet Migration Support
* **Migration Advisory Modal**: New modal appears for users with legacy wallets, providing friendly guidance on migrating to new wallet setup
* **Better PSBT Compatibility**: Advises users that new wallet setups offer improved PSBT compatibility and interoperability with modern wallets
* **User Preference**: "Do not remind me again" checkbox allows users to dismiss the modal while keeping the option to see it again on new wallet imports
* **Smart Reset Logic**: Modal flag automatically resets on wallet import if the imported wallet is legacy, ensuring users are always informed

### 🌐 Network State Management
* **Clean State on Import**: Network always resets to mainnet when importing a keyshare, ensuring proper address derivation and clean wallet state
* **Synchronized Contexts**: All contexts and providers properly synchronized with network changes for consistent state across the app
* **Proper Address Derivation**: Network reset on import ensures addresses are correctly derived for the imported wallet's network

### 🧹 Cache Management
* **Comprehensive Cache Clearing**: Automatic cache clearing on wallet setup and import screens for fresh, clean state
* **Stale Data Prevention**: Removes stale btcPub from EncryptedStorage and clears WalletService cache when setting up or importing wallets
* **Setup Mode Detection**: Cache clearing only occurs during wallet setup (duo/trio modes), not during signing operations, preserving existing wallet state

### 🎨 UI/UX Improvements
* **Transparent Balance Display**: Balance rows (BTC and USD) now have transparent background while maintaining tap-to-hide functionality for a cleaner look
* **Button Alignment**: Send and Receive buttons now vertically align with Device and Address Type buttons above for consistent, professional spacing
* **Improved QR Scanner**: Updated subtitle text to "Point camera to Sending Device QR" for clearer user guidance
* **Visual Consistency**: Better alignment and spacing throughout the wallet home screen for a more polished appearance

### 🔧 Reliability & Stability
* **Enhanced UserContext**: Improved refresh() function to derive network-specific btcPub values correctly for both networks
* **Better State Synchronization**: WalletHome now uses UserContext as primary address source with local state as fallback
* **Cache Management**: Added useEffect hooks to clear all cache on wallet setup/import screens for fresh state
* **Network Reset Integration**: ShowcaseScreen now properly resets network to mainnet on keyshare import using setActiveNetwork()

### Technical
* Enhanced **`UserContext.refresh()`** to derive separate btcPub values for mainnet and testnet
* Updated **WalletHome** to prioritize userActiveAddress from UserContext over local state
* Added **network reset** to mainnet on keyshare import in ShowcaseScreen
* Implemented **comprehensive cache clearing** on wallet setup/import screens
* Updated **balanceRowWithMargin** style to use transparent background
* Applied **flexOneMinWidthZero and partyGap** styles to action buttons for consistent alignment
* Created standalone **`LegacyWalletModal`** component for reusability

**_💛 No servers. No seed phrases. Just sovereign sats._**

⸻

🔗 **Learn more** at [boldbitcoinwallet.com](https://boldbitcoinwallet.com/)

🔐 **PGP Public Key** at [boldwallet-publickey.asc](https://github.com/BoldBitcoinWallet/.github/blob/main/PGP/boldwallet-publickey.asc)

**📎 SHA256: app-release.apk.sha256**

`[SHA256_HASH_WILL_BE_ADDED_AFTER_BUILD]`

**🔑 SHA256-PGP-Signature: app-release.apk.sha256.asc**

```text
[PGP_SIGNATURE_WILL_BE_ADDED_AFTER_SIGNING]
```

⸻

⚠️ APK Signature

This APK is signed with the official BoldWallet keystore.

Do not mix it with the F-Droid build. Stick to one source for updates.

