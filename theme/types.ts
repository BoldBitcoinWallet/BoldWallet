/**
 * Theme Type Definitions
 * Centralized type definitions for the theme system
 */

export type ThemeMode = 'os' | 'light' | 'dark';

export interface ThemeColors {
  primary: string;
  subPrimary: string;
  secondary: string;
  danger: string;
  accent: string;
  background: string;
  text: string;
  textSecondary: string;
  cardBackground: string;
  disabled: string;
  border: string;
  textOnPrimary: string;
  sent: string;
  received: string;
  buttonText: string;
  disabledText: string;
  modalBackdrop: string;
  lightGray: string;
  mediumGray: string;
  white: string;
  shadowColor: string;
}

export interface ThemeFontSizes {
  xs: number;
  sm: number;
  base: number;
  md: number;
  lg: number;
  xl: number;
  '2xl': number;
  '3xl': number;
  // Legacy support
  small: number;
  medium: number;
  large: number;
  extraLarge: number;
}

export interface ThemeFontWeights {
  normal: string;
  medium: string;
  semibold: string;
  bold: string;
}

export interface ThemeFontFamilies {
  regular: string;
  monospace: string;
}

export interface ThemeSpacing {
  small: number;
  medium: number;
  large: number;
  extraLarge: number;
}

export interface ThemeBorderRadius {
  small: number;
  medium: number;
  large: number;
}

export interface ThemeShadow {
  shadowColor: string;
  shadowOffset: {width: number; height: number};
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ThemeShadows {
  light: ThemeShadow;
  medium: ThemeShadow;
}

export interface Theme {
  colors: ThemeColors;
  fontSizes: ThemeFontSizes;
  fontWeights: ThemeFontWeights;
  fontFamilies: ThemeFontFamilies;
  spacing: ThemeSpacing;
  borderRadius: ThemeBorderRadius;
  shadow: ThemeShadows;
}

export interface FontStyleOptions {
  size?: keyof ThemeFontSizes | number;
  weight?: keyof ThemeFontWeights | string;
  family?: keyof ThemeFontFamilies;
  lineHeight?: number;
}

export interface ThemeContextValue {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleTheme: (isCrypto?: boolean) => Promise<void>;
}

