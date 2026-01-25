# Font Download Instructions - Inter + JetBrains Mono

This document provides instructions for downloading the professional font combination for BoldWallet: **Inter** for UI text and **JetBrains Mono** for technical content.

## Font Philosophy

BoldWallet uses a carefully chosen font pairing designed for Bitcoin wallets and financial applications:

> **Typography that disappears — Bitcoin stays.**

### Why This Combination?

**Inter (UI/Normal Text)**
- Designed specifically for fintech and system UIs
- Neutral, confident, not "exchange-y"
- Excellent readability at small sizes
- No hype, no gimmicks → builds trust
- Already used by hardware wallets and protocol dashboards

**JetBrains Mono (Addresses/Hashes/Technical)**
- True fixed-width with perfect character distinction
- Clean shapes for critical characters: `1 l I 0 O`
- No ambiguity → essential for Bitcoin addresses
- Widely respected by engineers and security tools
- **Ligatures disabled** (important for crypto)

## Required Font Files

### Inter Family (UI Text)
- `Inter-Regular.ttf` (Weight: 400)
- `Inter-Medium.ttf` (Weight: 500)  
- `Inter-SemiBold.ttf` (Weight: 600)

### JetBrains Mono Family (Technical Content)
- `JetBrainsMono-Regular.ttf` (Weight: 400)
- `JetBrainsMono-Medium.ttf` (Weight: 500) *optional*
- `JetBrainsMono-Bold.ttf` (Weight: 700) *optional*

## Download Methods

### Method 1: Automated Script (Recommended)

Run the provided download script:

```bash
cd BoldWallet/assets/fonts/
chmod +x download_fonts.sh
./download_fonts.sh
```

This will automatically download all fonts and provide verification.

### Method 2: Manual Download

#### Inter Fonts
Download from the official Inter repository:

1. **Inter-Regular.ttf**
   ```bash
   curl -L -o Inter-Regular.ttf "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.ttf"
   ```

2. **Inter-Medium.ttf**
   ```bash
   curl -L -o Inter-Medium.ttf "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Medium.ttf"
   ```

3. **Inter-SemiBold.ttf**
   ```bash
   curl -L -o Inter-SemiBold.ttf "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-SemiBold.ttf"
   ```

#### JetBrains Mono Fonts
Download from the official JetBrains Mono repository:

1. **JetBrainsMono-Regular.ttf**
   ```bash
   curl -L -o JetBrainsMono-Regular.ttf "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf"
   ```

2. **JetBrainsMono-Medium.ttf** (optional)
   ```bash
   curl -L -o JetBrainsMono-Medium.ttf "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Medium.ttf"
   ```

3. **JetBrainsMono-Bold.ttf** (optional)
   ```bash
   curl -L -o JetBrainsMono-Bold.ttf "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Bold.ttf"
   ```

### Method 3: Website Downloads

**Inter:**
- Visit [rsms.me/inter](https://rsms.me/inter/)
- Download the font family
- Extract and copy the required weights

**JetBrains Mono:**
- Visit [jetbrains.com/lp/mono](https://www.jetbrains.com/lp/mono/)
- Download the font family
- Extract and copy the required weights

## Verification

After downloading, your `BoldWallet/assets/fonts/` directory should contain:

```
BoldWallet/assets/fonts/
├── Inter-Regular.ttf          (~370 KB)
├── Inter-Medium.ttf           (~375 KB)
├── Inter-SemiBold.ttf         (~380 KB)
├── JetBrainsMono-Regular.ttf  (~290 KB)
├── JetBrainsMono-Medium.ttf   (~295 KB) [optional]
└── JetBrainsMono-Bold.ttf     (~300 KB) [optional]
```

**Total size:** ~1.4MB (required fonts only)

## Font Usage Guidelines

### Inter Usage (UI Text)
- **Inter-Regular** (400): Body text, labels, descriptions
- **Inter-Medium** (500): Buttons, emphasized text, card titles  
- **Inter-SemiBold** (600): Headers, important CTAs, navigation

### JetBrains Mono Usage (Technical Content)
- **JetBrainsMono-Regular**: Bitcoin addresses, transaction IDs, seed phrases
- All monospace content should disable ligatures
- Perfect for any content where character precision matters

## Configuration Notes

### Critical: Disable Ligatures
JetBrains Mono includes programming ligatures that MUST be disabled for Bitcoin content:

```typescript
const monoStyle = {
  fontFamily: 'JetBrainsMono-Regular',
  fontVariant: ['no-ligatures'], // Disable ligatures
  fontFeatureSettings: '"liga" 0', // Alternative method
};
```

### Minimum Sizes
- **Inter**: Optimized for 14px and above (perfect for mobile)
- **JetBrains Mono**: Readable from 12px, optimal at 14px+

### Weight Mapping
Our system automatically maps CSS font weights to available font files:

| CSS Weight | Inter Font | JetBrains Mono |
|------------|------------|----------------|
| 300-400 | Inter-Regular | JetBrainsMono-Regular |
| 500 | Inter-Medium | JetBrainsMono-Medium* |
| 600 | Inter-SemiBold | JetBrainsMono-Medium* |
| 700+ | Inter-SemiBold | JetBrainsMono-Bold* |

*Falls back to Regular if not available

## License Information

**Inter**
- License: SIL Open Font License 1.1
- Commercial use: ✅ Allowed
- Modification: ✅ Allowed

**JetBrains Mono**  
- License: SIL Open Font License 1.1
- Commercial use: ✅ Allowed
- Modification: ✅ Allowed

Both fonts are free for commercial use in Bitcoin wallets.

## Inspiration & Validation

This font combination is used by or similar to:
- Hardware wallet interfaces (Trezor, Ledger)
- Bitcoin protocol dashboards
- Security-first fintech applications
- Developer tooling and terminals

## Design Principles

**Boring is Good**
- Fonts should be invisible to users
- Focus stays on Bitcoin functionality
- No distracting or trendy typography

**Trust Through Simplicity**
- Clean, neutral appearance builds confidence  
- Professional feel without being cold
- Appropriate for financial applications

**Functional Above All**
- Perfect readability for small mobile screens
- No character ambiguity in addresses/hashes
- Consistent across all platforms

## Troubleshooting

**Download Failures:**
- Check internet connection
- Try alternative download URLs
- Some fonts may not be available in all weights

**File Verification:**
- Minimum file sizes: Inter (~370KB), JetBrains Mono (~290KB)
- Files should be binary TTF format
- Test by opening in font preview apps

**Platform Issues:**
- Ensure proper file permissions (readable by React Native)
- Verify file names match exactly (case-sensitive)

## Next Steps

Once fonts are downloaded:
1. ✅ Platform configuration (Android & iOS)  
2. ✅ React Native configuration updates
3. ✅ Theme system integration
4. ✅ Component updates and testing

The result: A Bitcoin wallet with professional, trustworthy typography that gets out of the way and lets Bitcoin shine.