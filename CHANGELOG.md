# Changelog

## [3.0.0] - 2026-03-04

### Added
- **Multi-path HD wallet (no-address-reuse)**: Full support for per-address indexing and spending across receive and change paths.
  - **WalletService**: Aggregate balance and UTXO fetch across all HD addresses; `getHdAddressesWithPaths` with in-memory cache; `fetchUtxosWithPaths` with sequential API calls and empty-address skip cache; `fetchMoreTransactionsForAddresses` for cursor-based multi-address transaction pagination.
  - **HdIndexService**: Centralized HD index management; discovery uses `GAP_LIMIT` and `MIN_SCAN_INDEX`; runtime address range based on `max(externalIndex, maxUsedExternal)` and `changeIndex`.
  - **Receive**: Restoring-indexes flow; receive index advances only when current address is used; receive button shows busy state while computing next address.
- **Multi-path UTXO spend and fee estimation**:
  - **BBMTLib (Go)**: `SpendingHashWithUTXOs` for deterministic spending hash from a pre-fetched UTXO set; `estimateFeeWithUTXOs`; sequential API behavior and improved logging in fee/UTXO paths.
  - **Native bridges**: iOS/Android expose `spendingHashWithUTXOs`; Send flow uses multi-path UTXOs for fee and spending hash.
- **Transaction list and details**:
  - **TransactionList**: Multi-address transaction list with per-address cursor pagination; consolidation (1 internal output) vs rebalancing (2+ internal outputs) labels; animations for Sending/Receiving/Consolidating/Rebalancing; derivation path in details only (no Ix row in list).
  - **TransactionDetailsModal**: Inputs/outputs flow diagram (PSBT-style); internal (ours) outputs highlighted with theme accent; summary bar with fee; address path map for paths.
- **Pairing screens**: Inputs/outputs flow in MobilesPairing and MobileNostrPairing; “Signing Path” instead of “From Address”; network badge and flow diagram aligned.
- **Docs**: `HD_WALLET_REFACTOR.md`, `MULTI_PATH_UTXO_SPEND_DESIGN.md`.
- **RestoringIndexesModal**: Dedicated modal for index discovery progress.

### Changed
- **Mempool API**: All WalletService calls to mempool.space (UTXOs, transactions) are sequential/synchronous to avoid rate limits and non-determinism.
- **SendBitcoinModal**: Passes `activeNetwork` (e.g. testnet3) to WalletService; fee estimation uses multi-path UTXOs and native `estimateFeeWithUTXOs` with fallback.
- **UtxosScreen / WalletHome**: Use aggregate balance and multi-address–aware flows.
- **BBMTLib build**: `build.sh` banner and note for Go 1.25 taggedPointerPack; FIPS check and toolchain steps unchanged.
- **FIPS Android (Dockerfile.fips and fips-android.sh)**:
  - `WORKDIR /workspace` so `docker run -v $(pwd):/workspace ./build.sh` runs against mounted source; `-w /workspace` in script.
  - BuildKit cache mounts: dnf, Go tarball, Android SDK download and per-platform install cache, Go modules/gomobile.
  - Platform default: `linux/arm64` on Apple Silicon (avoids Go 1.25 taggedPointerPack under QEMU), `linux/amd64` elsewhere; optional `FIPS_ANDROID_PLATFORM` override.
  - Run-from-BBMTLib check so `build.sh` exists in mounted dir.

### Fixed
- **Receive index**: No longer advances on network errors; discovery records partial/failed state without bumping indexes; `bumpExternalIndexIfCurrentUsed` only when address is actually used.
- **Fee estimation**: Multi-path UTXO set used for native fee estimation; “insufficient funds” handling and logging aligned with multi-path.
- **Transaction list**: Removed legacy single-address consolidation detection and Ix row; correct merge/sort for multi-address pagination.

### Technical Details
- **Version**: `package.json` 3.0.0.
- **BBMTLib**: `go.mod`/`go.sum`; `tss/btc.go` (SpendingHashWithUTXOs, fee/UTXO); `tss/mpc_nostr.go`; iOS/Android native module updates; `Dockerfile.fips` (Go 1.25.x, TARGETARCH, cache mounts, WORKDIR /workspace).
- **Context**: UserContext/WalletContext and utils.js updates for tabs and routing where applicable.

## [2.2.0] - 2026-02-15

### Added
- **FIPS 140-3 (SP 800-90A DRBG) compliance**: Optional FIPS-approved build for BBMTLib and Docker.
  - **BBMTLib**: `build.sh` supports `GOFIPS140=v1.0.0` (default) or `GOFIPS140=off`; FIPS mode uses SP 800-90A DRBG with mixed entropy; requires Go 1.24+.
  - **Docker**: `Dockerfile.fips` and Red Hat UBI9-based FIPS build; `Dockerfile` passes through build args for FIPS.
  - **Android**: `fips-android.sh` and Gradle integration for FIPS-aware native build.
  - **CI**: Build and test pipeline checks FIPS capability and `go mod tidy` cleanliness.
- **Bold Wallet Chrome extension**: Device tab and Wallet home improvements.
  - **Device tab**: In the “Bold Web • Extension” section, added a link to install the Bold Wallet Chrome extension (Chrome Web Store).
  - **Wallet home**: Replaced the extension-pairing system Alert with a dedicated **Extension Pairing** modal: step-by-step explanation, Confirm/Cancel, and theme-aware typography (AppText, light/dark).

### Changed
- **BBMTLib build**: `build.sh` hardened (set -euo pipefail), FIPS and environment checks, `go mod tidy`/download/verify; gomobile/gobind validation.
- **Lint**: Resolved inline-style warnings in `ExtensionPairingModal` and `KeyshareInfoContent`; removed unused imports in `MobilesPairing`, `SignedPSBTModal`, and `UserPreferenceScreen`.

### Technical Details
- **Version**: `package.json` 2.2.0; Android/iOS version bumps as applicable.
- **BBMTLib**: `go.mod`/`go.sum` updates; README documents FIPS build and randomness behavior.

## [2.1.15] - 2026-02-05

### Changed
- **Send Bitcoin: sats-aware amount input**: `SendBitcoinModal` now respects the BTC/Sats toggle from Wallet Home for the main amount field, including label/placeholder (“Amount in sats” vs “Amount in BTC”), numeric keyboard selection, and Max behavior, while keeping all internal math in BTC and sending in sats.
- **Send Bitcoin: fee estimation UX**: Added consistent fee error handling with a unified “Fee Estimation Error” dialog that offers Retry/Cancel; prevents overlapping fee requests (Max is disabled while estimating), and ensures no alerts or side effects fire once the modal is closed or unmounted.
- **Send Bitcoin: address validation**: Uses network-aware validation via `validateBitcoinAddressEnhanced` so fee estimation, Max, QR imports, and send confirmation all require an address valid for the currently selected network, with inline error messaging.
- **Static QR copy behavior**: The “Scan on another device to auto fill” QR in `TransportModeSelector` is now explicitly non-copiable via `copyDisabled`, while other QR usages remain copiable by default.

### Fixed
- **Device QR toast ordering**: Resolved a Toast host conflict so QR-related toasts on the Devices screen now appear above their modals (no longer hidden underneath overlays).

### Technical Details
- **Version bump**: Updated Android `versionCode`/`versionName`, iOS `CURRENT_PROJECT_VERSION`/`MARKETING_VERSION`, and `package.json` to `2.1.15`.

## [2.1.14] - 2026-02-03

### Added
- **Settings sections and subsections**: Reorganized Settings into clear groups
  - **App**: Theme, Balance Display, Haptics, Storage, App Icon (Android)
  - **Wallet**: Security, Address Type (with address-type-icon), Network providers, Nostr Relays
  - **Advanced**: Wallet tab, UTXOs tab, PSBT, Mempool Playground, Dev Debug, Font Testing
  - **Info**: Legal and About under a single “Info” section header
- **Tab visibility toggles (Advanced)**: User can show/hide tabs; preferences persisted
  - Wallet tab toggle (default on)
  - PSBT tab toggle (default off)
  - UTXOs tab toggle (default off)
  - Mempool Playground (Play) tab toggle (default off)
- **Active tab priority on load**: Wallet → PSBT → Device (only if toggled on)

### Changed
- **Address Type**: Uses `address-type-icon.png` in Settings
- **UTXOs tab**: Uses `utxo-icon.png` in tab bar (replacing out-icon)
- **Tab bar labels**: Auto-shrink to fit (bounded width, `adjustsFontSizeToFit` on iOS); smaller base font on Android; icon wrapper in StyleSheet (lint)
- **Tab bar icon**: Slight inset so UTXO icon (and others) are not trimmed at top
- **Lock / reopen**: `UserProvider` wraps both lock screen and main content so tab preferences and last-active tab persist across lock/unlock (e.g. reopening stays on PSBT when PSBT was active)

### Technical Details
- **UserContext**: `showWalletTab`, `showPsbtTab` (default off), `showMempoolPlayground` (default off), `showUtxosTab` (default off); load/save via LocalCache (`wallet_tab_enabled`, `psbt_tab_enabled`, `mempool_playground_enabled`, `utxos_tab_enabled`)
- **utils.js**: `getResetToMainTabsWallet` / `getResetToMainTabsPSBT` accept `showWallet`; routes omit Wallet/PSBT when toggled off; selected index follows priority Wallet → PSBT → Device
- **App.tsx**: Tab.Screen for Wallet/PSBT conditional on `showWalletTab`/`showPsbtTab`; `initialRouteName` = first available of Wallet, PSBT, Device; `UserProvider` moved to wrap lock + main content
- **WalletSettings**: `SettingsSectionGroup` for section headers; Advanced holds Wallet tab, UTXOs, PSBT, Playground, Dev Debug, Font Testing; Info holds Legal and About

## [2.1.13] - 2026-02-01

### Added
- **Bottom Tab Navigation**: New tab-based navigation for main app areas
  - Four tabs: Device, Wallet, PSBT, Settings — direct access without drilling through stack
  - Custom tab bar with theme-aware icons (Device, Wallet, Cosign, Settings)
  - Floating lock FAB (bottom-right) for quick lock, with platform-specific styling
  - Main content (Wallet, PSBT, Settings) lives in tabs; pairing flows remain in stack
- **Device Tab / DeviceScreen**: Dedicated screen for device and keyshare management
  - New Device tab as first-class destination for keyshare info, backup, and device-related actions
  - Replaces deep navigation from Wallet/Settings for device operations
- **Toast Notifications**: App-wide toast feedback
  - Integrated `react-native-toast-message` with theme-aware `createToastConfig`
  - Used for copy confirmations, success/error feedback, and debug badges
  - Toast wrapper in App root with correct z-index and pointer-events
- **Address Type Modal**: Dedicated modal for address type selection/display
  - `AddressTypeModal` component for choosing or viewing address type (Legacy, SegWit Native, SegWit Compatible)
  - Used in WalletHome and flows that depend on address type (e.g. after network change)
  - Integrates with `updateAddressTypeModal` for network-driven address updates
- **AppPressable Component**: Reusable pressable for consistent touch UX
  - New `AppPressable` with variants (default, strong, none) and optional haptic feedback
  - Replaces `TouchableOpacity` across modals, settings, pairing, and wallet screens
  - Unified opacity and feedback behavior app-wide
- **Keyshare UI Refactor**: Backup and info split from legacy KeyshareModal
  - `BackupKeyshareModal` and `KeyshareInfoContent` for backup and detailed keyshare info
  - `KeyshareModal.tsx` removed; functionality consolidated into BackupKeyshareModal and KeyshareInfoContent
  - Clearer separation between “backup” and “info” use cases

### Changed
- **Navigation Structure**: Stack now wraps MainTabs (Device, Wallet, PSBT, Settings)
  - Welcome, Devices Pairing, Nostr Connect, and User Preferences remain stack-only
  - Home/PSBT/Settings moved into tab navigator with per-tab headers
- **Header / Network Provider**: Network provider row tappable; optional settings callback
  - `HeaderNetworkProvider` supports `onPress` and `onSettingsPress` for provider/settings access
  - Side button width standardized (`SIDE_BUTTON_WIDTH`) for layout symmetry
- **Theme and Controls**: Switch and warning colors aligned with theme
  - Switch colors use theme palette for light/dark mode
  - Warning colors consolidated in theme; removed hardcoded values and `warningBg`
  - WalletSettings styles made reactive to theme changes (fixes Android theme switch)
- **Debug Logging**: Session-based debug with safe console restore
  - When enabling debug, original console methods restored before use, then re-applied
  - Exported `setDebugLoggingEnabled` / `isDebugLoggingEnabled` for WalletSettings
  - Avoids “logging enabled” message being dropped when console was previously disabled

### Fixed
- **Network Routing for QR Scanning**: Correct routing when opening QR scanner from different contexts (e.g. Send vs Receive)
- **Android Exit Button Styling**: Styling and behavior of exit/back button in relevant screens (e.g. pairing/QR) corrected
- **WalletSettings Theme Reactivity**: Force re-render on Android when theme changes so styles update immediately
- **TSS / Nostr**: LocalStateNostr type restored; mutex deadlock fixes in Nostr/TSS layer (mpc_nostr, relay, etc.)
- **Docs**: Removed obsolete `docs/BITCOIN_DISPLAY_PLAN.md`

### Technical Details
- **Dependencies**: `@react-navigation/bottom-tabs`, `react-native-toast-message` added; `utils/toastConfig.tsx` for theme-aware toast config
- **New/Refactored Components**: `DeviceScreen`, `AddressTypeModal`, `AppPressable`; `BackupKeyshareModal` + `KeyshareInfoContent`; tab bar icons and `TabBarButton` in App
- **App.tsx**: MainTabs with tab bar, lock FAB, Toast wrapper; debug logging tied to `debugLoggingEnabledRef` and native log listeners
- **BBMTLib**: btc.go, hooks.go, interfaces.go, mpc.go, mpc_nostr.go, relay.go, logs.go updates; localstate_nostr cleanup
- **Version**: 2.1.13 (package.json); build numbers updated for iOS/Android as applicable

## [2.1.12] - 2026-01-25

### Added
- **Custom Font System**: Professional typography with Inter and JetBrains Mono fonts
  - Inter font family for UI text (Regular, Medium, SemiBold weights)
  - JetBrains Mono font family for technical content like Bitcoin addresses (Regular, Medium, Bold weights)
  - New font system with proper font family mappings and weight-to-family conversion
  - Font comparison and verification components for testing and validation
  - Automated font download scripts and comprehensive documentation
  - Font assets properly linked for both iOS and Android platforms
  - Enhanced typography consistency across all screens and components
- **Mempool Privacy Configuration**: New user preference screen for enhanced privacy
  - Custom mempool.space API endpoint configuration during wallet setup
  - Privacy-focused feature to reduce third-party tracking of Bitcoin addresses
  - API endpoint validation with automatic URL normalization
  - Option to skip configuration and use default public mempool servers
  - Settings integration for changing API endpoint after wallet creation
  - Educational information about privacy benefits of self-hosted mempool servers
- **Comprehensive Icon Asset Library**: Added 50+ new icon assets for improved UI consistency
  - Icons for settings, actions, network status, and wallet features
  - Theme-aware icon support with inverted variants for dark mode
  - Consistent icon styling across all screens and components
- **User Preference Screen**: New onboarding screen for privacy configuration
  - Clean, professional UI with privacy-focused messaging
  - API endpoint input with validation and error handling
  - Skip option for users who prefer default settings
  - Integrated into app navigation flow
- **Settings: Wallet Balance Formatting Option**: New user preference for balance display formatting
  - Toggle between raw numbers and formatted display with thousand separators
  - Better readability for large Bitcoin amounts and satoshi values
  - Preference persists across app sessions
  - Enhanced visual clarity for decimal precision verification
- **Settings: Dev Debug Mode (Advanced)**: Developer-focused debugging features
  - Hidden developer debug section accessible via build number (7 clicks on Android)
  - Debug logging toggle for logcat visibility (Android only)
  - Session-only debug logging that resets on app restart
  - Visual progress indicator with badge and toast notifications
  - Enhanced UI with status indicators and card-based layout
  - Warning messages for sensitive information handling

### Changed
- **Typography System Refactoring**: Complete font system overhaul
  - Migrated from system fonts to custom Inter and JetBrains Mono fonts
  - New `theme/fonts.ts` module with font utilities and mappings
  - Font weight to font family mapping for proper font selection
  - Enhanced font style creation with theme integration
  - All components updated to use new font system
- **Component Font Updates**: Updated all components to use new font families
  - TransactionList, TransactionDetailsModal, TransactionListSkeleton with Inter fonts
  - WalletSkeleton, Header, CurrencySelector with updated typography
  - QRScanner components with monospace font for addresses
  - TransportModeSelector, CacheIndicator, and other UI components
  - Consistent font usage across all screens
- **Screen Refactoring**: Improved code organization and font integration
  - MobileNostrPairing, MobilesPairing screens with font updates
  - PSBTModal, PSBTScreen with enhanced typography
  - SendBitcoinModal, ReceiveModal, SignedPSBTModal with font improvements
  - WalletHome, WalletSettings, ShowcaseScreen with updated fonts
  - LoadingScreen with theme-aware font support
- **Asset Organization**: Better asset management and organization
  - New assets directory structure with organized icon assets
  - Font assets properly linked via manifest files
  - Improved asset loading and caching
- **Font Normalizations (iOS and Android)**: Enhanced cross-platform font consistency
  - Improved font rendering consistency across iOS and Android platforms
  - Better font weight mapping and family selection
  - Optimized font loading and caching
  - Enhanced monospace font rendering for technical content
- **Nostr Pairing UI Flow Simplification**: Streamlined device pairing experience
  - Simplified pairing flow with clearer step indicators
  - Reduced UI complexity and improved user guidance
  - Better error messaging and recovery paths
  - Enhanced visual feedback during pairing process
- **Enhanced Device Keyshare Modal Info Optimization**: Improved keyshare information display
  - Enhanced wallet information display with better organization
  - Clearer capabilities and feature indicators
  - Bold Web Extension connector information
  - Watch Wallet Export with output descriptor support
  - Better visual hierarchy and information architecture
- **Better Network Handling**: Improved network error management
  - Reduced annoying UI error alerts for network issues
  - Background API retry logic with exponential backoff
  - Better error recovery and user feedback
  - Graceful degradation when network is unavailable
  - Improved timeout handling and connection management
- **React Native Performance Optimization and Refactoring**: Enhanced app performance
  - Code refactoring for better maintainability
  - Performance optimizations across components and screens
  - Reduced re-renders and improved state management
  - Better memory management and resource cleanup
  - Optimized asset loading and caching
- **Nostr/TSS Performance and Stability Enhancements**: Improved reliability
  - Enhanced Nostr transport layer performance
  - Better TSS library stability and error handling
  - Improved session management and recovery
  - Optimized message processing and chunk handling
  - Enhanced panic recovery and error logging

### Fixed
- **Font Consistency Issues**: Fixed inconsistent font rendering across platforms
  - Proper font family mapping for iOS and Android
  - Fixed font weight issues with correct font file selection
  - Improved monospace font rendering for Bitcoin addresses
  - Better font fallback handling
- **Code Cleanup**: Removed unused code and contexts
  - Removed unused NetworkContext, UserContext, WalletContext files
  - Cleaned up unused components and utilities
  - Removed deprecated useQRScanner hook
  - Improved code organization and maintainability
- **Co-Signing Timeout Fix**: Fixed transaction co-signing timeout issues
  - Added validation to ensure all npubs are fully converted before enabling co-signing button
  - Prevents session ID mismatch between devices during pre-agreement phase
  - Button now properly disabled until all device npubs are loaded and converted from hex format
  - Fixes timeout issues when Android and iOS devices have different session IDs
- **Final Step UI Improvements**: Enhanced Final Step section UI and layout
  - Removed card container wrapper for cleaner layout
  - Moved "All devices ready" checkbox and "Start Key Generation" button to appropriate sections
  - Improved spacing and visual hierarchy in Final Step section
  - Better participant device information display
  - Updated typography for participant titles
- **Dev Debug Section UI/UX**: Enhanced developer tools interface
  - Improved visual design with card-based layout
  - Better status indicators and feedback
  - Enhanced button styling and interactions
  - Improved accessibility and user experience

### Technical Details
- **Font System**: New `theme/fonts.ts` module with comprehensive font utilities
  - Font family mappings for Inter and JetBrains Mono
  - Weight-to-family conversion for proper font selection
  - Font style creation utilities with theme integration
  - Platform-specific font handling
- **Font Assets**: Added font files for both iOS and Android
  - Inter-Regular.ttf, Inter-Medium.ttf, Inter-SemiBold.ttf
  - JetBrainsMono-Regular.ttf, JetBrainsMono-Medium.ttf, JetBrainsMono-Bold.ttf
  - Proper font linking via link-assets-manifest.json files
- **User Preference Screen**: New screen component for privacy configuration
  - API endpoint validation with timeout handling
  - URL normalization and validation logic
  - Integration with UserContext for API provider management
- **Asset Management**: 50+ new icon assets added
  - Icons organized in assets/assets/assets/ directory
  - Theme-aware icon variants for light and dark modes
- **Files Changed**: 144 files changed with 6,026 insertions and 3,817 deletions
- **Components Updated**: All major components updated for new font system
- **Screens Updated**: All screens updated with font improvements and privacy features
- **Build System**: Updated iOS Xcode project and Android build configuration for font assets
- **Dev Debug Implementation**: New developer tools section in WalletSettings
  - Build number click tracking with visual feedback
  - Session-based debug logging toggle
  - Enhanced UI components with status indicators
- **Performance Improvements**: Multiple optimization passes
  - Component refactoring for better performance
  - State management optimizations
  - Network handling improvements
- **Native Libraries**: Updated TSS framework binaries for iOS and Android

## [2.1.11] - 2026-01-12

### Changed
- **Transaction List Typography Improvements**: Enhanced font sizes and weights for better readability and visual hierarchy
  - Status text increased from 13px to 16px (lg) for improved readability
  - Fiat amount increased from 12px to 13px (base) for better accessibility
  - Address labels and transaction IDs standardized to 13px (base) for consistency
  - Improved typography hierarchy following mobile financial app best practices
  - Better visual balance between primary, secondary, and tertiary information
- **Dark Mode Color Theme**: Replaced yellow accent colors with Bitcoin orange (#F7931A) in dark mode
  - Transaction status badges now use Bitcoin orange instead of yellow in dark mode
  - All accent colors across screens and components updated to Bitcoin orange in dark mode
  - Maintains yellow accent in light mode for consistency
  - Updated components: TransactionDetailsModal, TransactionList, TransportModeSelector, CurrencySelector, CacheIndicator, Styles
  - Updated screens: WalletSettings, ShowcaseScreen, SendBitcoinModal, PSBTScreen, MobilesPairing, MobileNostrPairing
- **Header Visual Symmetry**: Improved header layout balance
  - Price button width now matches combined width of lock and settings buttons for visual symmetry
  - Better visual balance between left and right header elements
  - Enhanced header component consistency

### Fixed
- **Transaction Details Font Sizing**: Fixed inconsistent font sizes in transaction details modal
  - From/To address font sizes aligned with transaction ID font size (14px)
  - Address index labels standardized to 14px for consistency
  - Improved readability and visual consistency across transaction details

### Technical Details
- **Files Changed**: 14 files changed with 341 insertions and 219 deletions
- **Components Updated**: TransactionList, TransactionDetailsModal, Header, Styles, CacheIndicator, CurrencySelector, TransportModeSelector
- **Screens Updated**: WalletSettings, ShowcaseScreen, SendBitcoinModal, PSBTScreen, MobilesPairing, MobileNostrPairing
- **Version Update**: Version bumped to 2.1.11

## [2.1.10] - 2026-01-12

### Added
- **Comprehensive Panic Recovery in Nostr Transport**: Enhanced error handling and crash prevention throughout the Nostr transport layer
  - Panic recovery added to chunk assembler operations (`ChunkAssembler.Add`, `ChunkPayload`, `ParseChunkTag`)
  - Panic recovery in message pump operations (`MessagePump.Run`, `processEvent`, query goroutines)
  - Panic recovery in session coordinator (`SessionCoordinator.AwaitPeers`, `PublishReady`, `PublishComplete`)
  - Stack trace logging for all panic recoveries to aid debugging
  - Improved reliability and stability of Nostr-based device pairing and transaction signing
- **Theme-Aware Typography System**: Font system now uses theme constants for consistency
  - Font sizes now use `theme.fontSizes` (xl, lg, base) instead of hardcoded values
  - Font weights use `theme.fontWeights` (bold, semibold, normal) with proper type casting
  - Font families use `theme.fontFamilies` (regular, monospace) for better theming support
  - Enhanced typography consistency across all screens and components

### Changed
- **Nostr Transport Layer Refactoring**: Improved code organization and error handling
  - Enhanced chunk handling with better metadata parsing and validation
  - Improved message processing with better error recovery
  - Enhanced session management with better peer coordination
  - Improved client connection handling and relay communication
  - Better error messages and logging throughout the transport layer
- **Screen Component Refactoring**: Major refactoring across multiple screens for better code organization
  - `MobileNostrPairing.tsx`: Significant refactoring (1102 lines changed) with improved error handling and code formatting
  - `MobilesPairing.tsx`: Refactored with better code structure (474 lines changed)
  - `PSBTModal.tsx`: Enhanced with improved UI and error handling (217 lines changed)
  - `WalletSettings.tsx`: Updated with better organization (251 lines changed)
  - `ShowcaseScreen.tsx`: Improved layout and functionality (118 lines changed)
  - `WalletHome.tsx`: Refactored for better maintainability (168 lines changed)
  - `PSBTScreen.tsx`, `SendBitcoinModal.tsx`, `SignedPSBTModal.tsx`: Enhanced with improvements
- **Component Theme Integration**: Enhanced components with better theme support
  - `Header.tsx`: Updated with theme-aware typography (47 lines changed)
  - `TransactionList.tsx`: Improved theme integration (47 lines changed)
  - `QRScanner.tsx`: Enhanced with theme constants (18 lines changed)
  - `KeyshareModal.tsx`: Updated with improvements (14 lines changed)
  - `Styles.tsx`: Refactored for better organization (153 lines changed)
- **TSS Library Updates**: Updated native libraries with improvements
  - Updated TSS framework binaries for iOS (all architectures)
  - Updated TSS AAR library for Android
  - Enhanced Go library with improved error handling and panic recovery

### Fixed
- **Nostr Transport Stability**: Fixed potential crashes from unhandled panics in transport operations
  - All critical operations now have panic recovery with proper error handling
  - Better error messages for debugging transport issues
  - Improved reliability of chunk assembly and message processing
- **Code Formatting and Consistency**: Improved code formatting across multiple files
  - Better indentation and line breaks for improved readability
  - Consistent code style across screens and components
  - Removed unused code (LoadingScreen.tsx cleanup)

### Technical Details
- **Nostr Transport Layer**: Enhanced with comprehensive panic recovery
  - `chunker.go`: Added panic recovery to chunk operations
  - `pump.go`: Enhanced message pump with panic recovery in all goroutines
  - `session.go`: Added panic recovery to session operations
  - `client.go`, `messenger.go`, `relay.go`: Improved error handling
- **Version Update**: Android version code bumped to 43, version name to 2.1.10
- **Files Changed**: 39 files changed with 2,213 insertions and 1,152 deletions
- **Build System**: Updated iOS Xcode project and Android build configuration

## [2.1.9] - 2026-01-10

### Added
- **Modular Header Components**: New reusable header components for better code organization
  - `HeaderPriceButton`: Standalone BTC price display component with currency selector integration
  - `HeaderNetworkProvider`: Network and API provider information display component
  - Improved component modularity and reusability across the app
- **Extended Theme Color System**: Enhanced theme palette with comprehensive overlay colors
  - New color constants: `bitcoinOrange`, `warning`, `success`, and their variants
  - Glassmorphism overlay colors: `blackOverlay02-50`, `whiteOverlay08-30`, `primaryOverlay95`
  - Status color overlays: `receivedOverlay15/40`, `dangerOverlay15/40`
  - Skeleton loading colors: `skeletonGray`
  - Better support for layered UI effects and visual depth
- **Balance Header Controls**: New style properties for balance visibility and unit toggling
  - `balanceHeaderControls`, `balanceEyeIcon`, `balanceUnitToggleContainer` styles
  - Foundation for enhanced balance display controls

### Changed
- **Theme Color Consistency**: Replaced hardcoded color values with theme color constants
  - Modal backdrops now use `theme.colors.modalBackdrop` instead of hardcoded rgba values
  - Error boundary colors use `theme.colors.danger` and `theme.colors.white`
  - QR Scanner components use theme colors for text, progress bars, and backgrounds
  - Currency selector and legal modals use theme-aware backdrop colors
- **Dark Mode Detection**: Simplified dark mode detection logic
  - Changed from checking background color strings to simple `!== '#ffffff'` comparison
  - More reliable and performant dark mode detection
  - Consistent dark mode behavior across all header components
- **Header Component Styling**: Enhanced header button and container styling
  - Consistent use of `theme.colors.blackOverlay06` and `theme.colors.blackOverlay10` for light mode
  - Better border and background color consistency across header elements
  - Improved visual hierarchy with theme-aware styling
- **Glassmorphism Effects**: Enhanced glassmorphism with new overlay color system
  - Wallet header uses `primaryOverlay95` in light mode and `whiteOverlay15` in dark mode
  - Consistent border colors using `whiteOverlay30` for better contrast
  - More refined visual depth and layering effects

### Fixed
- **Color Consistency Issues**: Fixed hardcoded color values throughout components
  - Replaced `rgba(0, 0, 0, 0.5)` with `theme.colors.modalBackdrop` in modals
  - Replaced `#ff6b6b` with `theme.colors.danger` in error boundaries
  - Replaced `#FFFFFF` and rgba white values with `theme.colors.white` and opacity variants
  - Replaced `#F7931A` with `theme.colors.bitcoinOrange` in QR scanners
- **QR Scanner Theme Support**: Improved QR scanner color consistency
  - All text colors now use theme color constants with proper opacity
  - Progress bars use theme colors for better visual consistency
  - Better dark mode support across all QR scanner variants

### Technical Details
- **Component Refactoring**: Header component split into modular sub-components
  - `HeaderPriceButton`: 216 lines of new component code
  - `HeaderNetworkProvider`: 216 lines of new component code
  - Better separation of concerns and component reusability
- **Theme System**: Extended `Styles.tsx` with 30+ new color constants
  - New overlay color system for glassmorphism effects
  - Better type safety with TypeScript theme definitions
- **Version Update**: Android version code bumped to 42, version name to 2.1.9
- **Files Changed**: Multiple components updated for theme color consistency
  - `Header.tsx`, `Styles.tsx`, `ErrorBoundary.tsx`, `CurrencySelector.tsx`
  - `LegalModal.tsx`, `LegacyWalletModal.tsx`, `QRScanner.tsx`, `QRScanner.foss.tsx`

## [2.1.8] - 2026-01-07

### Added
- **Dark Mode Support**: Complete dark mode implementation with system theme detection
  - New theme system with light and dark themes (`theme/themes.ts`)
  - Theme context provider with OS-based, light, and dark mode options (`theme/context.tsx`)
  - Automatic system theme detection and persistence of user preference
  - Dark mode optimized color palette with improved contrast and readability
  - Support for theme mode switching in wallet settings
- **Wallet Home UI Revamp**: Redesigned wallet home screen with enhanced visual hierarchy
  - Improved balance container styling with dark mode support
  - Enhanced glassmorphism effects for better visual depth
  - Updated wallet header with better contrast and visibility
  - Refined action button styling and positioning
- **Enhanced Header Component**: New header system with integrated features
  - BTC price display in header with currency selector integration
  - Custom header components with configurable height
  - Improved header button styling with dark mode support
  - Better visual integration of price and currency information
- **iOS Framework dSYM Generation**: Automated dSYM generation for crash reporting
  - New script (`ios/scripts/generate_framework_dsyms.sh`) for generating dSYM files
  - Automatic dSYM generation for Tss.framework and hermesvm.framework
  - Integrated into Xcode build process for release builds
  - Improved crash symbolication support for embedded frameworks
- **Dark Mode Assets**: New inverted icon assets for dark mode compatibility
  - `bold-icon-inverted.png` for dark mode header display
  - `icon-inverted.png` for dark mode app icon variants

### Changed
- **Theme System Refactoring**: Complete theme architecture overhaul
  - Migrated from single `theme.js` to modular theme system (`theme/` directory)
  - Separated theme types, definitions, context, and utilities
  - Improved type safety with TypeScript theme definitions
  - Better theme mode management with OS default support
- **UI Components Dark Mode Support**: All major components updated for dark mode
  - `TransactionList` and `TransactionListSkeleton` with dark mode styling
  - `TransactionDetailsModal` with improved dark mode contrast
  - `TransportModeSelector` with theme-aware styling
  - `WalletSkeleton` with dark mode loading states
  - `QRScanner` components with dark mode support
  - `CurrencySelector` with theme-aware UI
  - `LegalModal` and `LegacyWalletModal` with dark mode styling
- **Wallet Settings Theme Integration**: Theme selector in wallet settings
  - New theme mode selector (OS Default, Light, Dark)
  - Theme preference persistence across app sessions
  - Legacy theme migration support
- **Docker Build Optimizations**: Improved Docker build process
  - Fixed working directory context in Dockerfile
  - Better path handling for Go module downloads
  - Improved build reliability and consistency

### Fixed
- **Loading Screen Theme Support**: Fixed loading screen background for dark mode
- **Error Boundary Theme Integration**: Updated error boundary with theme support
- **Cache Indicator Dark Mode**: Improved cache indicator visibility in dark mode
- **Showcase Screen Theme Support**: Updated showcase screen with dark mode styling
- **PSBT Screen Theme Integration**: Enhanced PSBT screen with theme-aware components
- **Receive Modal Dark Mode**: Improved receive modal styling for dark mode
- **Send Bitcoin Modal Theme Support**: Enhanced send modal with dark mode styling

### Technical Details
- **Theme Architecture**: New `theme/` directory structure
  - `types.ts`: TypeScript type definitions for themes
  - `themes.ts`: Light and dark theme definitions
  - `context.tsx`: React context for theme management
  - `utils.ts`: Theme utility functions
  - `index.ts`: Theme module exports
- **Component Updates**: 39 files changed with 2,967 insertions and 1,522 deletions
- **Build System**: iOS Xcode project updated with dSYM generation build phase
- **Asset Management**: New inverted icon assets for dark mode compatibility

## [2.1.7] - 2026-01-05

### Added
- **Docker Build System**: Complete Docker-based build infrastructure for Android APK compilation with cross-platform support
- **Enhanced QR Code for Send Bitcoin**: QR codes now include address type, derivation path, and network to prevent session timeouts between devices
- **From Address Display**: Transaction details now show the source (from) address in pairing screens
- **Watch-Only Wallet Export**: Streamlined to output descriptors only (removed xpub/tpub export)
- **Multiple Address Display in Transactions**: Transaction details now show all recipient addresses for sent transactions and all sender addresses for received transactions
  - Sent transactions with multiple outputs (e.g., PSBT transactions) display all recipient addresses with individual amounts
  - Received transactions with multiple inputs display all sender addresses with the received output amount
  - Each address shows its BTC amount and fiat equivalent
  - Transaction list shows count indicator for multiple recipients: "To: address... (+2 more)"

### Changed
- **Docker Build System**: Moved Docker scripts to organized `docker/scripts/` directory
- **Android Build Configuration**: Enhanced build system with Docker-specific Gradle settings and improved ProGuard rules

### Fixed
- **Nostr Transport Panic Recovery**: Enhanced panic recovery in co-signing operations with better error handling
- **Legacy Wallet Migration Modal**: New modal appears for users with legacy wallets, advising migration to new wallet setup
- **Network Reset on Wallet Import**: Network always resets to mainnet when importing a keyshare to ensure clean state
- **Address Flickering Issue**: Fixed address changing/flickering after lock/unlock by making UserContext the single source of truth
- **Session Timeout Fix for QR Code Scanning**: Fixed session timeouts when scanning send Bitcoin QR codes from second device
- **TransactionList Loading State**: Fixed infinite "Loading..." state and network errors when restoring wallet for the first time

## [2.1.6] - 2025-12-31

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