# PR Summary: PSBT Screen UX Improvements and Modal Alignment

## Overview
This PR improves the PSBT screen user experience with collapsible sections, smart default states, and aligns PSBTModal.foss.tsx with PSBTModal.tsx for consistent styling.

## Changes

### 🎨 PSBT Screen Enhancements

#### Collapsible Sections
- **Bold Connect Section**: Already collapsible, now with improved behavior
- **Sign PSBT Section**: Made collapsible with expand/collapse animation
- Both sections use consistent styling with 90° clockwise rotation for expand icons

#### Smart Default States
- **First visit after PSBT mode toggle**: Both sections closed (clean slate)
- **Subsequent visits**: Bold Connect closed, Sign PSBT open by default
- Uses `psbt_mode_first_visit` flag to track state

#### UI Improvements
- Updated section title: "Bold Cosign | PSBT Signer"
- Updated button text: "Upload PSBT File" → "Load PSBT File"
- Removed redundant borders from embedded PSBT modal (collapsible section already has borders)

### 🔧 PSBTModal Alignment

#### Style Consistency
- Aligned `PSBTModal.foss.tsx` with `PSBTModal.tsx` for consistent UI
- Network badge styling: fontSize 10, fontWeight 700, proper letterSpacing
- Cancel button disabled state: opacity 0.5, added text disabled style
- Middle button container positioning: moved inside action buttons container

#### Embedded Mode Improvements
- Removed borders and shadows from `embeddedContent` when used in collapsible sections
- Cleaner nested card appearance without double borders

### 🐛 Bug Fixes
- Fixed expand icon rotation: now rotates 90° clockwise (was 180°)
- Fixed network badge conditional rendering to always show (matches PSBTModal.tsx)

## Technical Details

### Files Modified
- `screens/PSBTScreen.tsx`: Added collapsible Sign PSBT section, updated state management
- `screens/WalletSettings.tsx`: Updated PSBT mode toggle to set `psbt_mode_first_visit` flag
- `screens/PSBTModal.foss.tsx`: Aligned styles and UI with PSBTModal.tsx
- `screens/PSBTModal.tsx`: Removed borders from embedded mode

### State Management
- New flag: `psbt_mode_first_visit` in EncryptedStorage
- Tracks first visit after PSBT mode toggle for smart default behavior

### Animation
- Added `psbtRotationAnim` for Sign PSBT section expand/collapse
- Consistent 90° rotation animation for both collapsible sections

## Testing Checklist
- [ ] Toggle PSBT mode in settings → verify both sections closed on first visit
- [ ] Navigate away and back to PSBT screen → verify Sign PSBT open, Bold Connect closed
- [ ] Expand/collapse both sections → verify smooth animations
- [ ] Verify no double borders in embedded PSBT modal
- [ ] Check network badge styling matches between both modal versions
- [ ] Verify cancel button disabled state works correctly

## Version
This PR updates version **2.1.2** with additional improvements
