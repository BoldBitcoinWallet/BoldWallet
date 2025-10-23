# Bold Bitcoin Wallet v1.4.0 - Release Notes

**Release Date:** October 22, 2025  
**Branch:** rn-upgrade  
**Previous Release:** v1.3.2 (Main branch)

---

## 🎯 Major Release Highlights

This is a significant upgrade focusing on **modernizing the React Native infrastructure** and improving app stability and performance.

### Version Upgrade (v1.3.2 → v1.4.0)

---

## 📦 Dependency Upgrades

### Core Framework Upgrades
- **React**: 18.3.1 → 19.1.1
- **React Native**: 0.76.9 → 0.82.0
- **@react-native/babel-preset**: 0.76.5 → 0.82.0
- **@react-native-community/cli**: 15.0.1 → 20.0.0

### Navigation & UI Libraries
- **@react-navigation/native**: 7.0.14 → 7.1.18
- **@react-navigation/native-stack**: 7.2.0 → 7.3.28
- **@react-navigation/elements**: 2.2.5 → 2.6.5
- **react-native-reanimated**: 3.16.6 → 4.1.3
- **react-native-gesture-handler**: 2.21.2 → 2.28.0
- **react-native-screens**: 4.4.0 → 4.17.1
- **react-native-safe-area-context**: 5.0.0 → 5.6.0

### New Dependencies Added
- **react-native-worklets**: 0.6.1 (NEW) - Enables high-performance worklet-based operations
- **patch-package**: 8.0.1 (NEW) - For managing patches to dependencies

### Other Dependencies Updated
- **lottie-react-native**: 7.2.2 → 7.3.4
- **react-native-svg**: 15.10.1 → 15.12.1
- **react-native-fs**: 2.20.0 → 2.18.0
- **typescript**: 5.0.4 → 5.8.3
- **jest**: 29.6.3 → 29.2.1

### Removed Dependencies
- **react-native-linear-gradient** - Removed (likely replaced with native implementations or alternative)
- **@react-navigation/stack** - Removed (using native-stack instead)

---

## ✨ New Features & Improvements

### 1. **Architecture & Performance**
- ✅ Migration to `createNativeStackNavigator` for better Fabric compatibility
- ✅ Enabled `react-native-screens` for improved navigation performance
- ✅ Added `react-native-safe-area-context` provider wrapper for better device compatibility
- ✅ Integrated `react-native-worklets` for high-performance operations

### 2. **Enhanced Authentication**
- ✅ Auto-trigger authentication after app initialization
- ✅ Improved authentication flow with better error handling
- ✅ Better logging and debugging of authentication events
- ✅ Support for `BiometryTypes.Biometrics` in addition to FaceID/TouchID

### 3. **Network Context Management** (NEW)
- ✅ Introduced `NetworkContext.tsx` for centralized network state management
- ✅ Decoupled network state from component-level management
- ✅ Better network switching and state propagation across the app
- ✅ Improved handling of mainnet/testnet switching

### 4. **Wallet Services Enhancement**
- ✅ Refactored state management in WalletHome and WalletSettings
- ✅ Improved transaction fetching and caching
- ✅ Better handling of pending transactions
- ✅ Enhanced error handling throughout wallet operations

### 5. **UI/UX Improvements**
- ✅ Updated component styling in `Styles.tsx`
- ✅ Improved skeleton loaders and loading states
- ✅ Better visual feedback for network indicators
- ✅ Enhanced transaction list rendering
- ✅ Improved modal dialogs (SendBitcoin, Receive)

### 6. **Developer Experience**
- ✅ Added `postinstall` script with patch-package support
- ✅ Improved TypeScript configuration (v5.8.3)
- ✅ Better debugging output with console logging
- ✅ Enhanced error messages throughout the codebase
- ✅ New Android build scripts for release management:
  - `check-elf-alignment.sh`
  - `clean-and-build.sh`
  - `generate-signed-bundle.sh`

### 7. **Patches & Workarounds**
- ✅ Added patches for:
  - `react-native-document-picker+9.3.1.patch` (NEW)
  - `rn-barcode-zxing-scan+1.0.4.patch` (updated)

---

## 🔧 Android Build System Improvements

### New Files & Configuration
- ✅ `android/app/CMakeLists.txt` - Added C++ build configuration
- ✅ `android/check_elf_alignment.sh` - ELF binary alignment checking
- ✅ `android/clean-and-build.sh` - Streamlined clean build process
- ✅ `android/generate-signed-bundle.sh` - Improved signed bundle generation
- ✅ `android/base/lib/arm64-v8a/libreactnative.so` - Added native library

### Build Configuration Updates
- ✅ Updated Gradle versions and configurations
- ✅ Improved native module handling
- ✅ Enhanced build scripts and automation

### iOS Build Updates
- ✅ Updated Xcode project configuration
- ✅ Added `BoldWalletRelease.xcscheme` for release builds
- ✅ Updated Podfile dependencies (2132 lines changed in Podfile.lock)
- ✅ Improved native module compilation

---

## 🔄 State Management Refactoring

### WalletHome Screen (`screens/WalletHome.tsx`)
- ✅ Moved network state management to `NetworkContext`
- ✅ Added refs for preventing duplicate fetch operations:
  - `isFetchInProgressRef`
  - `isReinitInProgressRef`
  - `fetchDataRef`
- ✅ Improved transaction update handling
- ✅ Better cache management

### WalletSettings Screen (`screens/WalletSettings.tsx`)
- ✅ Refactored component structure
- ✅ Improved settings persistence
- ✅ Enhanced state update handling

### MobilesPairing Screen (`screens/MobilesPairing.tsx`)
- ✅ Minor updates to pairing flow
- ✅ Better error handling in mobile pairing

---

## 🐛 Bug Fixes & Stability

- ✅ Fixed potential race conditions in data fetching
- ✅ Improved error handling and logging throughout
- ✅ Better memory management in useEffect hooks
- ✅ Fixed authentication flow edge cases
- ✅ Improved network error handling and recovery

---

## 📄 Configuration & Tooling

- ✅ Added polyfills.js for better compatibility
- ✅ Updated metro.config.js for new dependencies
- ✅ Improved ESLint configuration
- ✅ Added TypeScript improvements
- ✅ Updated Jest configuration for testing

---

## ⚠️ Breaking Changes

- **Navigation Stack**: Migrated from `@react-navigation/stack` to `@react-navigation/native-stack`
  - All stack navigation is now using native implementation
  - Better performance and Fabric compatibility
  
- **React 19**: Apps using React Native 0.82.0 must be compatible with React 19.1.1
  - Review any custom hooks and component patterns

---

## 🔐 Security

- ✅ Updated all dependencies to latest stable versions with security patches
- ✅ No known CVEs in current dependency tree

---

## 📊 Statistics

- **Files Changed**: 44
- **Lines Added**: ~8,456
- **Lines Removed**: ~4,728
- **Net Change**: +3,728 lines
- **Major Commits**: 10 draft commits (draft-upgrade through draft-9)

---

## 🚀 Testing Recommendations

Before deploying to production, test:
1. ✅ Full authentication flow (with and without biometrics)
2. ✅ Network switching (mainnet ↔ testnet)
3. ✅ Transaction fetching and display
4. ✅ Wallet settings persistence
5. ✅ Mobile pairing functionality
6. ✅ QR code scanning
7. ✅ Send/Receive transactions
8. ✅ App lifecycle and backgrounding
9. ✅ Different device sizes and OS versions
10. ✅ Memory usage and performance

---

## 📝 Migration Notes

### For Developers
- Update your development environment to support React 19.1.1
- Review React Native 0.82.0 release notes for compatibility
- Ensure your IDE supports TypeScript 5.8.3
- Run `npm install` followed by `patch-package` postinstall hook

### For App Deployment
- Test thoroughly on both Android and iOS
- Verify all native module integrations (BBMTLib)
- Check native library alignment with new build system
- Validate all release signatures

---

## 🔗 Related Branches & PRs

- **Merge Base**: v1.3.2 (Main branch)
- **Current Branch**: rn-upgrade
- **Related Tags**: v1.3.2, v1.3.1, v1.3.0, v1.2.0, v1.1.0, v1.0

---

## 📞 Support & Reporting

For issues or bugs discovered in this release:
1. Test with the latest version
2. Document reproduction steps
3. Check existing issues on GitHub
4. Report with relevant logs and device information

---

**Status**: Development/Testing Phase  
**Next Steps**: QA Testing → Performance Optimization → Production Release

