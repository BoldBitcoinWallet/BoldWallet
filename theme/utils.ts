/**
 * Theme Utility Functions
 * Helper functions for working with themes
 */
import type {Theme, FontStyleOptions, ThemeFontWeights} from './types';
import {createThemedFontStyle} from './fonts';
/**
 * Get normalized font style from theme
 * IMPORTANT: For Inter fonts, weight is embedded in the family name.
 * This function maps weight to the appropriate font family and does NOT return fontWeight.
 * @param theme - The theme object
 * @param options - Font style options
 * @returns Normalized font style object (fontFamily with weight embedded, NO fontWeight)
 */
export const getFontStyle = (
  theme: Theme,
  options: FontStyleOptions = {},
): {
  fontSize: number;
  fontFamily: string;
  lineHeight?: number;
} => {
  const {
    size = 'base',
    weight = 'normal',
    family = 'regular',
    lineHeight,
  } = options;
  const fontSize =
    typeof size === 'number'
      ? size
      : theme.fontSizes[size] || theme.fontSizes.base;
  // Map weight to appropriate font family (Inter fonts embed weight in family name)
  // For Inter: '400' -> 'regular', '500' -> 'medium', '600'/'700' -> 'bold'
  // For monospace: use monospace families
  let fontFamily: string;
  if (family === 'monospace') {
    // Monospace families
    const weightStr = typeof weight === 'string' && weight in theme.fontWeights
      ? theme.fontWeights[weight as keyof ThemeFontWeights]
      : weight;
    if (weightStr === '500' || weightStr === '600') {
      fontFamily = theme.fontFamilies.monospaceMedium || theme.fontFamilies.monospace;
    } else if (weightStr === '700' || weightStr === '800' || weightStr === '900') {
      fontFamily = theme.fontFamilies.monospaceBold || theme.fontFamilies.monospace;
    } else {
      fontFamily = theme.fontFamilies.monospace;
    }
  } else {
    // Regular UI fonts (Inter) - map weight to family
    const weightStr = typeof weight === 'string' && weight in theme.fontWeights
      ? theme.fontWeights[weight as keyof ThemeFontWeights]
      : weight;
    if (weightStr === '500') {
      fontFamily = theme.fontFamilies.medium || theme.fontFamilies.regular;
    } else if (weightStr === '600' || weightStr === '700' || weightStr === '800' || weightStr === '900') {
      fontFamily = theme.fontFamilies.bold || theme.fontFamilies.regular;
    } else {
      // Default to regular for '400' or 'normal'
      fontFamily = theme.fontFamilies[family] || theme.fontFamilies.regular;
    }
  }
  const style: {
    fontSize: number;
    fontFamily: string;
    lineHeight?: number;
  } = {
    fontSize,
    fontFamily,
  };
  if (lineHeight !== undefined) {
    style.lineHeight = lineHeight;
  }
  return style;
};
/**
 * Re-export the proper font style creator from fonts module
 * Use this instead of manually setting fontFamily + fontWeight
 */
export {createThemedFontStyle};
