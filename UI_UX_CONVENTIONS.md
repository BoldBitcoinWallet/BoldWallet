# UI/UX Conventions Summary

## Design Patterns

### 1. Modal Structure
- **Overlay**: `rgba(0,0,0,0.75)` or `rgba(0,0,0,0.8)`
- **Content**: 
  - Background: `theme.colors.cardBackground`
  - Border radius: `16px`
  - Width: `85%`
  - Max width: `420px`
  - Shadow/elevation for depth
- **Header**:
  - Icon (20x20) + Title (fontSize 18, fontWeight 700)
  - Close button: Circular (40x40), subtle background
- **Body**: Padding 24px horizontal, 20px vertical
- **Actions**: Buttons at bottom, side-by-side with gap

### 2. Button Styles
- **Primary Button**:
  - Background: `theme.colors.primary`
  - Text: White/background color
  - Border radius: `12px`
  - Padding: `14-16px` vertical
  - Font weight: `600`
  - Shadow/elevation
- **Secondary Button**:
  - Background: Transparent
  - Border: `2px`, `theme.colors.border`
  - Text: `theme.colors.text`
- **Disabled**: `opacity: 0.5`

### 3. Input Fields
- Border width: `1.5px`
- Border radius: `12px`
- Padding: `16px` horizontal, `14px` vertical
- Font size: `16px`
- Focus state: Border color changes to `theme.colors.primary`
- Background: Subtle (`rgba(0,0,0,0.02)`)

### 4. Card/Container Patterns
- Background: `theme.colors.cardBackground`
- Border radius: `12-16px`
- Padding: `16-24px`
- Shadow/elevation for depth
- Border: `1px`, `theme.colors.border` (when needed)

### 5. Typography
- **Titles**: `fontSize: 18-20`, `fontWeight: 700`
- **Body**: `fontSize: 14-16`, `fontWeight: 500-600`
- **Secondary text**: `theme.colors.textSecondary`
- **Labels**: `fontSize: 13-14`, `fontWeight: 600`

### 6. Icons
- Standard size: `20-24px`
- Tint color: `theme.colors.primary` or context-specific
- Used in buttons, headers, and indicators

### 7. Selection Patterns (Mode Selection)
- **Option Cards**:
  - Border radius: `12px`
  - Padding: `18px` top, `12px` bottom
  - Border: `1px` when unselected, `1.5px` when selected
  - Selected: Background tint + border color change
  - Checkmark icon in top-right corner when selected
- **Animation**: Subtle connector lines/dots for visual flow

### 8. Haptic Feedback
- Use `HapticFeedback.light()` for subtle interactions
- Use `HapticFeedback.medium()` for selections
- Use `HapticFeedback.heavy()` for important actions

### 9. Theme Usage
- Always use `useTheme()` hook
- Access colors via `theme.colors.*`
- Common colors:
  - `primary`: Main brand color
  - `text`: Primary text
  - `textSecondary`: Secondary text
  - `cardBackground`: Card/container background
  - `background`: Screen background
  - `border`: Borders
  - `accent`: Accent color

### 10. Animations
- Use `Animated` API for smooth transitions
- Fade animations: `animationType="fade"` for modals
- Timing: `200-300ms` for most transitions
- Easing: `Easing.cubic` or `Easing.inOut(Easing.quad)`

### 11. QR Code Display
- White background with padding
- Border radius: `12px`
- Shadow/elevation
- Centered in container

### 12. Status Indicators
- Checkmarks: Green/primary color
- Loading: Progress indicators
- Error: Red/error color with clear messaging

## Implementation Checklist

When creating new components:
- [ ] Use `useTheme()` hook
- [ ] Follow modal structure pattern
- [ ] Use consistent button styles
- [ ] Apply proper spacing (12px, 16px, 24px)
- [ ] Add haptic feedback for interactions
- [ ] Use theme colors throughout
- [ ] Add proper shadows/elevation
- [ ] Ensure accessibility (TouchableOpacity with activeOpacity)
- [ ] Match existing animation patterns
- [ ] Use consistent typography scale

