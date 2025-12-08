# Bold Wallet v2.0.1 Release Notes

## 🔧 Improvements

### 🎨 Nostr Pairing UI Enhancements
Complete refresh of the Nostr pairing screen for a cleaner, more intuitive experience:

- **Redesigned Header Layout**: Help button moved to the left, title centered, and abort/cancel button aligned to the right for better visual balance
- **Consistent Button Styling**: Cancel/Abort buttons now use the same pill-shaped outlined style as the local pairing screen
- **Icon-Based Help Modal**: Replaced emoji icons with consistent app asset icons in the "How It Works" modal
- **Improved Text Labels**: 
  - "Your Device" → "This Device" for clarity
  - Shortened step labels ("Second Peer" → "2nd Peer", "Third Peer" → "3rd Peer")
  - More concise alert messages
- **Compact Copy/QR Buttons**: Icon-only buttons for copy and QR actions, saving space
- **Relay Config Repositioned**: Advanced Nostr relay settings moved for better flow
- **Reduced Padding**: Tighter spacing for a more compact layout

### 📱 Other UI Refinements
- Improved horizontal and vertical alignment of header elements
- Better visual hierarchy in pairing steps
- Enhanced touch targets for icon buttons

### 🔄 Transaction Broadcast Reliability
- **PostTx Retry Logic**: Transaction broadcasting now automatically retries up to 4 times with exponential backoff (1s, 2s, 3s delays) if the initial broadcast fails. This significantly improves reliability when broadcasting transactions to the network.

## 🔧 Technical Changes

### Core (Go/TSS Library)
- Refactored `PostTx` into wrapper with retry logic and `postTxOnce` for single attempt
- Added exponential backoff timing between retry attempts
- Improved error logging with attempt count

### Frontend (React Native)
- Added new styles: `retryButton`, `retryLink`, `buttonFlex`, `cancelSetupButton`, `cancelLink`
- Updated `headerRow` and `headerContent` styles for centered alignment
- Consistent theming with primary color tinted icons

## 📊 Version Info
- **Version**: 2.0.1
- **Android Version Code**: 31
- **Files Changed**: 17
- **Key Updates**: `btc.go`, `MobileNostrPairing.tsx`

---

**Full Changelog**: See git diff from `v2.0.0` to `v2.0.1` for complete details.
