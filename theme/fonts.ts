/**
 * Font Utilities
 * Helper functions and utilities for working with unified fonts across platforms
 */
import {Platform, TextStyle} from 'react-native';
import {Theme, FontStyleOptions} from './types';
/**
 * Font family mappings for React Native
 * These map our logical font names to the actual font family names
 * Inter for UI text, JetBrains Mono for technical content
 */
export const FONT_FAMILIES = {
  // Inter family - Professional UI fonts
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  bold: 'Inter-SemiBold',
  // JetBrains Mono family - Precision monospace for Bitcoin addresses
  monospace: 'JetBrainsMono-Regular',
  monospaceMedium: 'JetBrainsMono-Medium',
  monospaceBold: 'JetBrainsMono-Bold',
} as const;
/**
 * Font weight to font family mapping
 * Maps standard font weights to specific Inter font files
 */
export const WEIGHT_TO_FAMILY_MAP = {
  '300': FONT_FAMILIES.regular, // Light -> Regular (closest available)
  '400': FONT_FAMILIES.regular, // Normal -> Regular
  '500': FONT_FAMILIES.medium, // Medium -> Medium
  '600': FONT_FAMILIES.bold, // SemiBold -> SemiBold
  '700': FONT_FAMILIES.bold, // Bold -> SemiBold (closest available)
  '800': FONT_FAMILIES.bold, // ExtraBold -> SemiBold (closest available)
  '900': FONT_FAMILIES.bold, // Black -> SemiBold (closest available)
} as const;
/**
 * Font weight to monospace font family mapping
 * JetBrains Mono - now with Medium and Bold weights available
 */
export const WEIGHT_TO_MONO_FAMILY_MAP = {
  '300': FONT_FAMILIES.monospace, // Light -> Regular
  '400': FONT_FAMILIES.monospace, // Normal -> Regular
  '500': FONT_FAMILIES.monospaceMedium, // Medium -> Medium
  '600': FONT_FAMILIES.monospaceMedium, // SemiBold -> Medium
  '700': FONT_FAMILIES.monospaceBold, // Bold -> Bold
  '800': FONT_FAMILIES.monospaceBold, // ExtraBold -> Bold
  '900': FONT_FAMILIES.monospaceBold, // Black -> Bold
} as const;
/**
 * Creates a font style object with proper font family based on weight
 * @param options Font style options
 * @param theme Theme object containing font configuration
 * @returns TextStyle object with proper fontFamily
 */
export const createFontStyle = (
  options: FontStyleOptions,
  theme: Theme,
): TextStyle => {
  const {size, weight = '400', family = 'regular', lineHeight} = options;
  // Determine if we're using monospace
  const isMonospace = family === 'monospace';
  // Get the appropriate font family based on weight
  let fontFamily: string;
  if (isMonospace) {
    fontFamily =
      WEIGHT_TO_MONO_FAMILY_MAP[
        weight as keyof typeof WEIGHT_TO_MONO_FAMILY_MAP
      ] || FONT_FAMILIES.monospace;
  } else {
    fontFamily =
      WEIGHT_TO_FAMILY_MAP[weight as keyof typeof WEIGHT_TO_FAMILY_MAP] ||
      FONT_FAMILIES.regular;
  }
  // Build the style object
  const style: TextStyle = {
    fontFamily,
  };
  // Add font size
  if (typeof size === 'number') {
    style.fontSize = size;
  } else if (size && theme.fontSizes[size]) {
    style.fontSize = theme.fontSizes[size];
  }
  // Add line height if specified
  if (lineHeight) {
    style.lineHeight = lineHeight;
  }
  return style;
};
/**
 * Gets the appropriate font family for a given weight
 * @param weight Font weight
 * @param isMonospace Whether to use monospace font
 * @returns Font family name
 */
export const getFontFamily = (
  weight: string = '400',
  isMonospace: boolean = false,
): string => {
  if (isMonospace) {
    return (
      WEIGHT_TO_MONO_FAMILY_MAP[
        weight as keyof typeof WEIGHT_TO_MONO_FAMILY_MAP
      ] || FONT_FAMILIES.monospace
    );
  }
  return (
    WEIGHT_TO_FAMILY_MAP[weight as keyof typeof WEIGHT_TO_FAMILY_MAP] ||
    FONT_FAMILIES.regular
  );
};
/**
 * Pre-defined font styles for common use cases
 */
export const FONT_STYLES = {
  // Headers - Inter SemiBold for impact
  h1: {
    fontFamily: FONT_FAMILIES.bold,
    fontSize: 24,
    lineHeight: 32,
  },
  h2: {
    fontFamily: FONT_FAMILIES.bold,
    fontSize: 20,
    lineHeight: 28,
  },
  h3: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 18,
    lineHeight: 26,
  },
  h4: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 16,
    lineHeight: 24,
  },
  // Body text - Inter Regular for readability
  body: {
    fontFamily: FONT_FAMILIES.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyMedium: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyLarge: {
    fontFamily: FONT_FAMILIES.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  // Small text
  caption: {
    fontFamily: FONT_FAMILIES.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  captionMedium: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  // Button text
  button: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 16,
    lineHeight: 24,
  },
  buttonSmall: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  // JetBrains Mono for Bitcoin addresses, keys, hashes - CRITICAL for precision
  address: {
    fontFamily: FONT_FAMILIES.monospace,
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ['no-ligatures'] as any, // Disable ligatures - critical for Bitcoin
  },
  addressSmall: {
    fontFamily: FONT_FAMILIES.monospace,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['no-ligatures'] as any, // Disable ligatures
  },
  code: {
    fontFamily: FONT_FAMILIES.monospace,
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['no-ligatures'] as any, // Disable ligatures
  },
  // Bitcoin amounts - Inter Medium/SemiBold for trust and clarity
  amount: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 18,
    lineHeight: 26,
    letterSpacing: -0.2, // Tighter spacing for numbers
  },
  amountLarge: {
    fontFamily: FONT_FAMILIES.bold,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.3, // Tighter spacing for large amounts
  },
  balance: {
    fontFamily: FONT_FAMILIES.bold,
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.2, // Tighter spacing
  },
} as const;
/**
 * Typography hook for easy access to font styles
 * @param theme Theme object
 * @returns Object with font utility functions
 */
export const useTypography = (theme: Theme) => {
  return {
    /**
     * Get a font style with theme-aware sizing
     */
    getStyle: (options: FontStyleOptions): TextStyle => {
      return createFontStyle(options, theme);
    },
    /**
     * Get font family for weight
     */
    getFontFamily: (weight?: string, isMonospace?: boolean) => {
      return getFontFamily(weight, isMonospace);
    },
    /**
     * Pre-defined styles
     */
    styles: FONT_STYLES,
    /**
     * Font families
     */
    families: FONT_FAMILIES,
  };
};
/**
 * Font loading status check for React Native mobile platforms
 * Useful for debugging font loading issues
 */
export const checkFontAvailability = (): Record<string, boolean> => {
  // On React Native (iOS/Android), fonts should be available if properly configured
  // Return true for all fonts assuming proper setup
  return Object.values(FONT_FAMILIES).reduce((acc, family) => {
    acc[family] = true;
    return acc;
  }, {} as Record<string, boolean>);
};
/**
 * Creates a proper font style for React Native that handles weight-to-family mapping
 * This is critical for Inter fonts where weight is embedded in the family name
 * @param options Font style options
 * @returns TextStyle object with correct fontFamily (no separate fontWeight)
 */
export const createThemedFontStyle = (options: {
  size?: number;
  weight?: '300' | '400' | '500' | '600' | '700' | '800' | '900';
  isMonospace?: boolean;
  lineHeight?: number;
  letterSpacing?: number;
}): TextStyle => {
  const {
    size,
    weight = '400',
    isMonospace = false,
    lineHeight,
    letterSpacing,
  } = options;
  // Get the correct font family based on weight
  const fontFamily = isMonospace
    ? getFontFamily(weight, true)
    : getFontFamily(weight, false);
  const style: TextStyle = {
    fontFamily,
  };
  // Add size if specified
  if (size) {
    style.fontSize = size;
  }
  // Add line height if specified
  if (lineHeight) {
    style.lineHeight = lineHeight;
  }
  // Add letter spacing if specified
  if (letterSpacing) {
    style.letterSpacing = letterSpacing;
  }
  // DO NOT add fontWeight - it's embedded in the fontFamily name
  return style;
};
/**
 * Font configuration validation
 * Helps ensure fonts are properly configured
 */
export const validateFontConfiguration = () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Check if we're on a supported platform
  if (!['ios', 'android'].includes(Platform.OS)) {
    warnings.push(
      `Unsupported platform: ${Platform.OS}. Fonts may not work as expected.`,
    );
  }
  // Platform-specific checks
  if (Platform.OS === 'ios') {
    // On iOS, fonts should be registered in Info.plist
    warnings.push('Ensure fonts are added to Info.plist under UIAppFonts key.');
  }
  if (Platform.OS === 'android') {
    // On Android, fonts should be in assets/fonts
    warnings.push(
      'Ensure fonts are placed in android/app/src/main/assets/fonts/ directory.',
    );
  }
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};
/**
 * Export commonly used font configurations for Bitcoin wallet UI
 */
export const COMMON_FONT_CONFIGS = {
  // For Bitcoin addresses and transaction IDs - JetBrains Mono with ligatures disabled
  bitcoinAddress: {
    fontFamily: FONT_FAMILIES.monospace,
    fontSize: 14,
    letterSpacing: 0.5,
    fontVariant: ['no-ligatures'] as any,
    fontFeatureSettings: '"liga" 0', // Alternative method to disable ligatures
  } as TextStyle,
  // For Bitcoin amounts - Inter Medium for trust (proportional)
  bitcoinAmount: {
    fontFamily: FONT_FAMILIES.medium,
    fontSize: 18,
    letterSpacing: -0.2,
  } as TextStyle,
  // For Bitcoin amounts - Monospace for precision and alignment
  bitcoinAmountMono: {
    fontFamily: FONT_FAMILIES.monospace, // Use Regular for best cross-platform consistency
    fontSize: 15,
    letterSpacing: 0,
    fontVariant: ['no-ligatures'] as any,
    fontFeatureSettings: '"liga" 0', // Disable ligatures for consistent rendering
  } as TextStyle,
  // For QR code labels - Inter Regular
  qrLabel: {
    fontFamily: FONT_FAMILIES.regular,
    fontSize: 12,
    textAlign: 'center' as const,
  } as TextStyle,
  // For transaction details - Inter Regular
  transactionDetail: {
    fontFamily: FONT_FAMILIES.regular,
    fontSize: 14,
    lineHeight: 20,
  } as TextStyle,
  // For seed phrases - JetBrains Mono, critical precision
  seedPhrase: {
    fontFamily: FONT_FAMILIES.monospace,
    fontSize: 16,
    letterSpacing: 0.5,
    fontVariant: ['no-ligatures'] as any,
    fontFeatureSettings: '"liga" 0',
  } as TextStyle,
};
