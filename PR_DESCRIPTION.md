# 🚀 Multi-Address Type Output Descriptors with Backward Compatibility

## 📋 Summary

This PR adds comprehensive support for generating output descriptors for all three Bitcoin address types (Legacy, SegWit Native, SegWit Compatible) while maintaining full backward compatibility with existing wallets.

## ✨ Features

### 🎯 Multi-Address Type Output Descriptors
- **Legacy (BIP44)**: `pkh([fingerprint/44'/coinType'/0']xpub/0/*)`
- **SegWit Native (BIP84)**: `wpkh([fingerprint/84'/coinType'/0']xpub/0/*)`
- **SegWit Compatible (BIP49)**: `sh(wpkh([fingerprint/49'/coinType'/0']xpub/0/*))`

### 🔄 Backward Compatibility Strategy
- **Old Wallets** (created_at ≤ 1765894825732):
  - All descriptors use BIP44 derivation path (44')
  - Different descriptor formats: `pkh`, `wpkh`, `sh(wpkh)`
  - Ensures existing funds remain visible after update
- **New Wallets** (created_at > 1765894825732):
  - Use optimized BIP84/BIP49 paths for SegWit address types
  - Proper descriptor formats matching derivation paths

### 🎨 UI/UX Enhancements

#### PSBT Screen
- New dedicated PSBT screen with improved layout
- Collapsible "Bold Connect" section (closed by default)
- Display all three output descriptor types with individual actions:
  - Copy to clipboard
  - Share as file
  - Show QR code
- Consistent styling with shadows, borders, and spacing
- Transport mode selector integration for PSBT signing

#### Keyshare Modal (Wallet Home)
- Display wallet creation timestamp (`created_at`)
- Show all three output descriptors with individual copy/share/QR buttons
- Consistent UI matching PSBTScreen design
- Removed single `outputDescriptor` field in favor of `outputDescriptors` object

### 🛠️ Technical Improvements

#### Code Organization
- **Centralized Logic**: New `generateAllOutputDescriptors()` utility function in `utils.js`
- **DRY Principle**: Eliminated duplicate descriptor generation code
- **Type Safety**: Updated TypeScript interfaces for descriptor objects

#### Native Module Updates
- **Go**: Added `addressType` parameter to `GetOutputDescriptor()` function
- **iOS**: Updated Swift and Objective-C bindings
- **Android**: Updated Kotlin bindings

#### Derivation Path Logic
- Updated `getDerivePathForNetwork()` to support address types
- Automatic legacy wallet detection based on creation timestamp
- Smart path selection based on wallet age and address type

## 🔧 Technical Details

### Migration Strategy
- **Timestamp Threshold**: `1765894825732` (December 2025)
- **Detection**: Automatic via `isLegacyWallet(created_at)` utility
- **Zero User Action**: Seamless migration, no breaking changes

### File Changes
- **Go**: `BBMTLib/tss/common.go` - Enhanced descriptor generation
- **Native**: iOS/Android bindings updated
- **UI**: `PSBTScreen.tsx`, `KeyshareModal.tsx`, `WalletHome.tsx`
- **Utils**: `utils.js` - New utility functions

## ✅ Testing Checklist

- [x] Old wallets continue to work with existing funds
- [x] New wallets use optimized paths
- [x] All three descriptor types generate correctly
- [x] UI displays all descriptors properly
- [x] Copy/share/QR actions work for each descriptor
- [x] Backward compatibility verified
- [x] No breaking changes

## 📸 Screenshots

_Add screenshots of the new PSBT Screen and Keyshare Modal showing all three descriptors_

## 🔗 Related Issues

_Link any related issues here_

## 🚦 Breaking Changes

**None** - This PR is fully backward compatible. Existing wallets continue to function exactly as before.

## 📝 Notes

- The timestamp-based detection ensures smooth migration
- Old wallets show all three descriptor formats but use BIP44 paths
- New wallets automatically get optimized paths
- All descriptor generation logic is centralized for easier maintenance
- Removed `outputDescriptor` field, now using only `outputDescriptors` object

---

**Ready for Review** ✅
