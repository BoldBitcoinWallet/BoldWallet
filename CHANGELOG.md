# Changelog

## [Unreleased] - Output Descriptors with Multiple Address Types

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
