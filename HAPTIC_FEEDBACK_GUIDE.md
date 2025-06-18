# Haptic Feedback Guide 🎯

## Overview
The app now includes a global haptic feedback service that provides consistent tactile feedback across all screens. This enhances the user experience by providing immediate physical confirmation of interactions.

## Usage

### Import the Service
```javascript
import {HapticFeedback} from '../utils';
```

### Available Haptic Types

#### 1. **Light Feedback** - Subtle interactions
```javascript
HapticFeedback.light();
```
**Use for:**
- Toggle switches
- Balance visibility toggle
- Section expansions
- Minor UI interactions

#### 2. **Medium Feedback** - Standard interactions
```javascript
HapticFeedback.medium();
```
**Use for:**
- Main action buttons (Send, Receive, Setup)
- Navigation between screens
- Important selections

#### 3. **Heavy Feedback** - Important actions
```javascript
HapticFeedback.heavy();
```
**Use for:**
- Wallet deletion
- Critical confirmations
- Error states

#### 4. **Success Feedback** - Positive outcomes
```javascript
HapticFeedback.success();
```
**Use for:**
- Successful transactions
- Wallet setup completion
- Backup success

#### 5. **Warning Feedback** - Caution states
```javascript
HapticFeedback.warning();
```
**Use for:**
- Insufficient funds
- Network warnings
- Security alerts

#### 6. **Error Feedback** - Error states
```javascript
HapticFeedback.error();
```
**Use for:**
- Transaction failures
- Network errors
- Critical errors

#### 7. **Selection Feedback** - Selection changes
```javascript
HapticFeedback.selection();
```
**Use for:**
- Currency selection
- Address type changes
- Theme changes

## Implementation Examples

### Button Interactions
```javascript
<TouchableOpacity
  onPress={() => {
    HapticFeedback.medium();
    handleSendBitcoin();
  }}>
  <Text>Send Bitcoin</Text>
</TouchableOpacity>
```

### Toggle Switches
```javascript
<Switch
  onValueChange={(value) => {
    HapticFeedback.light();
    handleThemeToggle(value);
  }}
  value={isDarkMode}
/>
```

### Success Actions
```javascript
const handleTransactionSuccess = () => {
  HapticFeedback.success();
  showSuccessMessage();
};
```

### Error Handling
```javascript
const handleTransactionError = (error) => {
  HapticFeedback.error();
  showErrorMessage(error);
};
```

## Platform Differences

The service automatically handles platform differences:
- **iOS**: Uses native haptic feedback patterns
- **Android**: Uses appropriate vibration patterns with fallbacks

## Best Practices

1. **Don't overuse**: Too much haptic feedback can be annoying
2. **Match intensity to importance**: Use light for subtle, heavy for critical
3. **Be consistent**: Use the same haptic type for similar actions
4. **Consider accessibility**: Some users may have haptics disabled

## Current Implementation

The following screens already have haptic feedback:
- ✅ **WalletSettings**: Section toggles, theme/network switches
- ✅ **ShowcaseScreen**: Setup/Restore wallet buttons
- ✅ **WalletHome**: Send/Receive buttons, balance toggle

## Adding to New Screens

To add haptic feedback to new interactions:

1. Import the service: `import {HapticFeedback} from '../utils';`
2. Choose appropriate haptic type based on interaction importance
3. Add to the onPress/onChange handler
4. Test on both iOS and Android

Example:
```javascript
<TouchableOpacity
  onPress={() => {
    HapticFeedback.medium(); // or light/heavy based on importance
    handleAction();
  }}>
  <Text>Action</Text>
</TouchableOpacity>
```

This creates a more engaging and responsive user experience throughout the app! 🚀 