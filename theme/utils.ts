/**
 * Theme Utility Functions
 * Helper functions for working with themes
 */

import type {Theme, FontStyleOptions, ThemeFontWeights} from './types';

/**
 * Get normalized font style from theme
 * @param theme - The theme object
 * @param options - Font style options
 * @returns Normalized font style object
 */
export const getFontStyle = (
  theme: Theme,
  options: FontStyleOptions = {},
): {
  fontSize: number;
  fontWeight: string;
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
  const fontWeight =
    typeof weight === 'string' && weight in theme.fontWeights
      ? theme.fontWeights[weight as keyof ThemeFontWeights]
      : weight;
  const fontFamily =
    theme.fontFamilies[family] || theme.fontFamilies.regular;

  const style: {
    fontSize: number;
    fontWeight: string;
    fontFamily: string;
    lineHeight?: number;
  } = {
    fontSize,
    fontWeight,
    fontFamily,
  };

  if (lineHeight !== undefined) {
    style.lineHeight = lineHeight;
  }

  return style;
};

