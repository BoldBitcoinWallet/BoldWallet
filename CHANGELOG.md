# Changelog

## [2.1.6] - 2025-01-XX

### Added
- **Balance Card in Send Modal**: New prominent balance card displayed above amount input in Send Bitcoin modal
  - Shows available balance in BTC and fiat currency
  - Integrated "Max" button for quick balance selection
  - Clean, professional UI with card styling
- **Smart Balance Check for Send Button**: Automatic balance refresh when clicking Send with zero balance
  - Prevents modal from opening prematurely when balance hasn't loaded
  - Shows loading spinner on Send button during balance check
  - Automatically opens modal if balance is found, or shows alert if truly zero
  - Prevents multiple rapid clicks with button disable state
  - 5-second timeout with graceful error handling

### Fixed
- **Co-signing Go Panic Recovery**: Fixed potential panic crashes in Nostr transport layer during co-signing
  - Added panic recovery with stack trace logging in `Client.Publish` goroutine
  - Improved nil pointer safety when extracting relay URLs
  - Better error messages for debugging relay connection issues
  - Enhanced resiliency for co-signing message delivery across multiple relays
- **Send Button Balance Race Condition**: Fixed issue where Send button would show "Insufficient Balance" alert even when balance was still loading
  - Eliminates flickering and need to click Send button multiple times
  - Better UX with immediate feedback during balance check

### Changed
- **Send Modal UI Enhancement**: Improved balance visibility and Max button placement
  - Balance card replaces inline "Max" text link
  - More prominent balance display with better visual hierarchy
  - Updated QR scanner icon to use scan-icon.png for consistency

### Technical Details
- **WalletHome.tsx**: Added `checkBalanceForSend()` function for dedicated balance fetching
- **SendBitcoinModal.tsx**: New balance card component with integrated Max button
- **client.go**: Enhanced panic recovery and error handling in Nostr publish operations
- **Error Handling**: Improved timeout and error recovery for balance checks

## [Unreleased]

### Added
- **Legacy Wallet Migration Modal**: New modal appears for users with legacy wallets, advising migration to new wallet setup for better PSBT compatibility
  - Non-dismissible modal with friendly messaging
  - "Do not remind me again" checkbox option
  - Modal flag automatically resets on new wallet import (if wallet is legacy)
  - Standalone `LegacyWalletModal` component for reusability

### Changed
- **Network Reset on Wallet Import**: Network always resets to mainnet when importing a keyshare to ensure clean state
- **Balance Display Styling**: Balance rows (BTC and USD) now have transparent background while maintaining tap-to-hide functionality
- **Button Alignment**: Send and Receive buttons now vertically align with Device and Address Type buttons above for consistent spacing
- **QR Scanner Subtitle**: Updated subtitle text to "Point camera to Sending Device QR" for clarity

### Fixed
- **Address Flickering Issue**: Fixed address changing/flickering after lock/unlock by making UserContext the single source of truth for addresses
  - UserContext now properly derives network-specific btcPub for both mainnet and testnet
  - WalletHome prioritizes userActiveAddress from UserContext over local state
  - Eliminated race conditions in address derivation
- **Network State Management**: Improved network state consistency across the app
  - Network reset on import ensures proper address derivation
  - All contexts and providers properly synchronized with network changes
- **Cache Clearing**: Comprehensive cache clearing on wallet setup and import screens
  - LocalCache cleared on ShowcaseScreen (import)
  - LocalCache cleared on MobilesPairing and MobileNostrPairing (setup mode only)
  - Stale btcPub removed from EncryptedStorage
  - WalletService cache cleared for fresh state

### Technical Details
- **UserContext**: Enhanced refresh() to derive separate btcPub values for mainnet and testnet
- **WalletHome**: Updated to use UserContext as primary address source, with local state as fallback
- **ShowcaseScreen**: Added network reset to mainnet on keyshare import using setActiveNetwork()
- **Cache Management**: Added useEffect hooks to clear all cache on wallet setup/import screens
- **Styles**: Updated balanceRowWithMargin to use transparent background
- **Button Layout**: Applied flexOneMinWidthZero and partyGap styles to action buttons for consistent alignment

## [2.1.4] - 2025-12-30

### Added
- **Resilient Nostr relay connections**: BTC sends now work reliably even if some Nostr relays are down
  - Automatically connects to multiple relays in parallel
  - Continues working if relays fail during the signing process
  - Faster connection establishment and better error recovery

### Changed
- **Faster pre-agreement timeout**: Reduced from 2 minutes to 16 seconds for quicker failure detection

### Fixed
- **Android navigation bar overlap**: Fixed bottom navigation bar overlapping system navigation on Android devices (e.g., Samsung)
- **Message delivery reliability**: Improved handling of messages sent just before subscription starts

---

## [2.1.3] - 2025-12-20

### Added
- **Hide/show balance user preference**: Tap balance to toggle visibility, preference persists across app sessions
- **Unified QR Scanner component** (`components/QRScanner.tsx` and `components/QRScanner.foss.tsx`):
  - Platform-specific implementations: iOS uses `react-native-vision-camera`, Android uses `rn-barcode-zxing-scan`
  - Support for both single and continuous scanning modes
  - Progress indicator for animated QR codes
  - Customizable titles, subtitles, and close button text
- **New `useQRScanner` hook** for reusable QR scanning logic
- **Enhanced pubkey matching logic** in `BBMTLib/tss/psbt.go`:
  - Better validation of input ownership before signing
  - Improved logging for debugging signature issues
  - Skips signing inputs that don't belong to the wallet (prevents errors)
  - More reliable pubkey derivation verification
- **PSBT sign filter**: Automatically filters and only signs inputs that belong to the wallet, preventing errors from unrelated inputs
- **QR Scan shortcut for Send (Second Device)**: Added QR code option in transport mode selector to share transaction details (address, amount, fee) from one phone to another for quick entry

### Changed
- **Wallet mode terminology**: Updated from "basic/flexi" to "duo/trio" for clearer wallet type indication (2/2 vs 2/3 multisig)
- **Keyshare backup naming**: Keyshare backup files now use xpub-based naming with index (e.g., `a6tr2-1.ks`, `a6tr2-2.ks`, `a6tr2-3.ks`) for better organization and identification
- **Default address type**: New wallets default to SegWit Native (BIP84) instead of Legacy addresses for better efficiency and lower fees
- **Refactored screens** to use new QR scanner:
  - `MobileNostrPairing.tsx` - Simplified QR scanning integration
  - `SendBitcoinModal.tsx` - Improved QR code scanning UX
  - `PSBTModal.tsx` - Enhanced QR code handling
  - `WalletHome.tsx` - Updated QR scanning flow
- **Code cleanup**: Removed large FOSS variant files (reduced codebase by ~8,500 lines):
  - `screens/MobileNostrPairing.foss.tsx` (6,032 lines removed)
  - `screens/PSBTModal.foss.tsx` (1,661 lines removed)
  - `screens/SendBitcoinModal.foss.tsx` (782 lines removed)

### Fixed
- **Wallet Context & Address Handling**: Improved address type handling with legacy wallet detection
- **Derive path management**: Better derive path management for different network types
- **Address type caching**: Enhanced address type caching and retrieval
- **Build & Dependencies**: Updated Android build configuration and TSS library binaries (iOS and Android)
- **Release script**: Improved release script (`android/release.sh`)

### Technical Details
- **Components**: Updated `KeyshareModal.tsx`, `TransportModeSelector.tsx`, and `Styles.tsx`
- **Screens**: Improvements to `WalletSettings.tsx`, `ShowcaseScreen.tsx`, and `PSBTScreen.tsx`
- **Utilities**: New utility functions in `utils.js` (53 lines added) with improved error handling and logging
- **Native Libraries**: Updated TSS framework binaries for iOS (all architectures) and TSS AAR library for Android
- **Native headers**: Updated native headers and Info.plist files
- **Statistics**: 32 files changed, 1,570 insertions, 9,089 deletions (net reduction of ~7,500 lines)

---

## [2.1.2] - 2025-12-19

### Added
- **`bold-spend` cross-platform binary**: New standalone binary for spending Bitcoin from keyshares
  - Works on Windows, Linux, and macOS (AMD64 and ARM64)
  - Self-contained - spawns itself as separate processes (no external dependencies)
  - Supports all address types (P2PKH, P2WPKH, P2SH-P2WPKH, P2TR)
  - Preview mode for fee estimation without sending transactions
  - Support for encrypted keyshares with separate passphrases per keyshare
  - Direct file path support (works with mobile app backup files)
- **Enhanced `spend-bitcoin.sh` script**:
  - Named arguments (flags) for better clarity and user experience
  - `--passphrase1` and `--passphrase2` for individual keyshare decryption
  - `--keyshare1` and `--keyshare2` flags to override default file paths
  - `--preview` flag for fee estimation without executing transactions
  - Improved error messages listing missing required arguments
  - Default keyshare files: `peer1.ks` and `peer2.ks`
- **Comprehensive Recovery Documentation**:
  - Updated `RECOVER.md` with mobile app backup file naming conventions
  - Examples for using `.share` files directly from mobile app backups
  - Platform-specific instructions for Windows, Linux, and macOS
  - Complete workflow examples for both `bold-spend` binary and `spend-bitcoin.sh` script

### Changed
- **PSBT Screen Section Titles**: Updated to "Bold Cosign | PSBT Signer" for clarity
- **Import Button Text**: "Upload PSBT File" → "Load PSBT File" for better clarity
- **Expand Icon Rotation**: Fixed to rotate 90° clockwise (was 180°) for both collapsible sections in PSBT screen and settings
- **Embedded PSBT Modal**: Removed redundant borders when used inside collapsible sections

### Fixed
- **PSBTModal.foss.tsx Alignment**: Fully aligned styles and UI with PSBTModal.tsx
  - Network badge styling (fontSize: 10, fontWeight: 700, letterSpacing: 0.5)
  - Cancel button disabled state (opacity: 0.5, added text disabled style)
  - Middle button container positioning (moved inside action buttons container)
- **Double Borders**: Removed borders from embedded PSBT modal to prevent double borders in collapsible sections
- **Collapsible Section Expand Icons**: Fixed rotation animation in both PSBTScreen and WalletSettings

### Technical Details
- **New binary**: `BBMTLib/tss/cmd/bold-spend/main.go` - Cross-platform Go binary
- **Build script**: `BBMTLib/build-bold-spend.sh` - Automated cross-compilation for all platforms
- **Documentation**: Enhanced `RECOVER.md` with mobile app backup file format examples and platform-specific guidance
- **PSBT Screen**: Added collapsible Sign PSBT section with smart default states
  - Added `psbt_mode_first_visit` flag in EncryptedStorage for state tracking
  - Added `psbtRotationAnim` animation for Sign PSBT section
  - First visit after PSBT mode toggle: Both sections closed
  - Subsequent visits: Bold Connect closed, Sign PSBT open by default
- **Modal Alignment**: Aligned all style properties between PSBTModal.tsx and PSBTModal.foss.tsx

---

## [2.1.1] - 2025-12-17

### Added
- **Multi-address type output descriptors**: Support for generating output descriptors for all three Bitcoin address types (Legacy, SegWit Native, SegWit Compatible)
- **PSBT Screen enhancements**:
  - New dedicated PSBT screen with collapsible "Bold Connect" section
  - Display of all three output descriptor types with individual copy/share/QR buttons
  - Improved UI/UX with consistent styling, shadows, and borders
  - Transport mode selector integration for PSBT signing
- **Keyshare Modal improvements**:
  - Display of wallet creation timestamp (`created_at`) in keyshare details
  - List of all output descriptors (Legacy, SegWit Native, SegWit Compatible) in Wallet Home modal
- **Utility function**: `generateAllOutputDescriptors()` in `utils.js` for centralized descriptor generation logic

### Changed
- **Backward compatibility for old wallets**:
  - Old wallets (created_at <= 1765894825732) continue using BIP44 paths for all address types
  - Old wallets show all three descriptor formats (pkh, wpkh, sh(wpkh)) but all use BIP44 derivation path
  - New wallets use optimized BIP84/BIP49 paths for SegWit address types
- **Derivation path logic**: Updated `getDerivePathForNetwork()` to support address types with legacy wallet detection
- **Output descriptor generation**: Go function `GetOutputDescriptor()` now accepts `addressType` parameter
- **Native bindings**: Updated iOS (Swift/Objective-C) and Android (Kotlin) bindings to support address type parameter

### Fixed
- ESLint warnings for unused variables
- JSX syntax errors in PSBTModal
- Collapsible section animation issues in PSBTScreen

### Technical Details
- **Go changes**: `BBMTLib/tss/common.go` - Added addressType parameter to `GetOutputDescriptor()`
- **Native modules**: Updated iOS and Android native module bindings
- **UI components**: Enhanced PSBTScreen, KeyshareModal, and WalletHome with multi-descriptor support
- **Migration strategy**: Timestamp-based detection (1765894825732) to distinguish old vs new wallets

---

## [2.0.2] - 2025-12-10

### 🔓 F-Droid Compatibility
- **FOSS Version for MobileNostrPairing**: Added `MobileNostrPairing.foss.tsx` for F-Droid builds
- **Removed react-native-vision-camera Dependency**: Replaced iOS camera with `BarcodeZxingScan` for both iOS and Android platforms
- **F-Droid Build Support**: MobileNostrPairing now passes F-Droid open source restrictions, similar to SendBitcoinModal

### 🎨 UI Improvements
- **Loading Screen Background Fix**: Added proper background color to safe area container for consistent theming

### 📱 App Icons
- **Android Launcher Icons**: Updated and optimized Android app launcher icons across all density variants
- **Icon Optimization**: Reduced file sizes while maintaining visual quality

### 🔧 CI/CD Improvements
- **Docker Caching for Nostr Relay**: Added Docker image caching for nostr-rs-relay in GitHub Actions to speed up test runs
- **Improved Test Pipeline**: Updated GitHub Actions workflow to require local Docker-based Nostr relay for testing
- **Test Script Enhancements**: Enhanced test-all.sh with better error messages and local relay requirements
- **Test Optimization**: Removed redundant tests that are already covered by the local relay

### Technical
- Created FOSS-compatible version of MobileNostrPairing screen
- Unified QR scanning implementation using BarcodeZxingScan across all platforms
- Maintained full feature parity with standard version
- Version code bumped to 32 (Android) and build 32 (iOS)

---

## [2.0.1] - 2025-12-08

### 🐛 Bug Fixes
- **Fix Double Promise Callback Crash**: Prevented SIGABRT crash caused by double promise resolution in native modules

### 🔄 Transaction Broadcast Reliability
- **PostTx Retry Logic**: Transaction broadcasting now automatically retries up to 4 times with exponential backoff (1s, 2s, 3s delays) if the initial broadcast fails

### 🎨 Nostr Pairing UI Enhancements
- **Redesigned Header Layout**: Help button moved to the left, title centered, abort/cancel button aligned to the right
- **Consistent Button Styling**: Cancel/Abort buttons now use pill-shaped outlined style matching local pairing screen
- **Icon-Based Help Modal**: Replaced emoji icons with consistent app asset icons
- **Improved Text Labels**: "Your Device" → "This Device", shortened step labels
- **Compact Copy/QR Buttons**: Icon-only buttons for copy and QR actions
- **Relay Config Repositioned**: Advanced Nostr relay settings moved for better flow
- **Reduced Padding**: Tighter spacing for a more compact layout

### Technical
- Refactored `PostTx` with retry logic and exponential backoff
- Added new button styles for consistency across screens
- Updated header alignment styles

---

## [2.0.0] - 2025-12-04

### 🚀 Major Features

#### 🌐 Nostr Integration - Decentralized Device Pairing
Bold Wallet now supports **Nostr** for device pairing and transaction signing. Connect devices through decentralized Nostr relays - no local network required. Works from anywhere in the world.

**Key Benefits:**
- Connect devices from anywhere, not just on the same WiFi network
- Uses decentralized Nostr relays for communication
- Enhanced security with NIP-44 encryption
- Flexible transport mode selection (Local WiFi/Hotspot or Nostr)

#### 🔐 Enhanced Security with NIP-44 Encryption
All Nostr communications use **NIP-44 encryption** for maximum security.

#### 🎨 Android Icon Changer
Android users can now customize their app icon from wallet settings.

#### 📱 Improved Transaction Details
- Better address display and linking
- Improved amount formatting
- Clearer transaction status indicators
- Direct links to blockchain explorers

#### 🔄 Transport Mode Selector
New interface to choose between:
- **Local WiFi/Hotspot**: Fast and reliable for nearby devices
- **Nostr**: Connect through decentralized relays from anywhere

### 🛡️ Enhanced Resiliency & Error Handling
- Improved session management and recovery
- Better error handling for network issues
- Go panic recovery coverage
- Unique pre-send session agreements
- Resilient relay connection with background retries

### ⚙️ Settings Improvements
- Nostr relay configuration
- Dynamic relay fetching from GitHub
- Better backup setup with filename handling
- Improved keyshare information display

### Technical
- Complete Nostr transport layer implementation
- `MobileNostrPairing.tsx` screen (5,500+ lines)
- NIP-44 encryption integration
- Rumor/wrap/seal message pattern

---

## [1.5.4] - 2025-11-19

### Improvements
- Performance optimizations
- Bug fixes and stability improvements

---

## [1.3.2] - 2025-08-01

### Store Updates
- App store metadata updates
- Compliance improvements

---

## [1.3.0] - 2025-07-10

### UI & Lock Optimizations
- User interface improvements
- Lock screen optimizations
- Performance enhancements

---

## [1.2.0] - 2025-06-25

### Terms & Privacy
- Added Terms and Conditions
- Added Privacy Policy
- Settings improvements

---

## [1.1.0] - 2025-06-12

### SegWit Support
- Support for SegWit Native addresses
- Support for SegWit Compatible addresses
- Wallet cache checks

---

## [1.0] - 2025-05-09

### Initial Release
- Multi-signature Bitcoin wallet
- TSS (Threshold Signature Scheme) support
- Duo and Trio wallet modes
- Local WiFi/Hotspot device pairing
- Transaction signing and broadcasting
- QR code scanning for addresses
- Blockchain explorer integration

---

**Repository**: [BoldBitcoinWallet/BoldWallet](https://github.com/BoldBitcoinWallet/BoldWallet)