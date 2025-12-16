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
