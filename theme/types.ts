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
  // Additional colors for consistency
  bitcoinOrange: string;
  warning: string;
  warningLight: string;
  warningAccent: string;
  success: string;
  successLight: string;
  skeletonGray: string;
  // Overlay colors for glassmorphism effects
  blackOverlay05: string; // rgba(0, 0, 0, 0.05)
  blackOverlay06: string; // rgba(0, 0, 0, 0.06)
  blackOverlay10: string; // rgba(0, 0, 0, 0.1)
  blackOverlay30: string; // rgba(0, 0, 0, 0.3)
  whiteOverlay08: string; // rgba(255, 255, 255, 0.08)
  whiteOverlay10: string; // rgba(255, 255, 255, 0.1)
  whiteOverlay12: string; // rgba(255, 255, 255, 0.12)
  whiteOverlay15: string; // rgba(255, 255, 255, 0.15)
  whiteOverlay18: string; // rgba(255, 255, 255, 0.18)
  whiteOverlay20: string; // rgba(255, 255, 255, 0.2)
  whiteOverlay25: string; // rgba(255, 255, 255, 0.25)
  whiteOverlay30: string; // rgba(255, 255, 255, 0.3)
  primaryOverlay95: string; // rgba(26, 43, 60, 0.95) - primary color at 95% opacity
  blackOverlay02: string; // rgba(0, 0, 0, 0.02)
  blackOverlay03: string; // rgba(0, 0, 0, 0.03)
  blackOverlay04: string; // rgba(0, 0, 0, 0.04)
  blackOverlay50: string; // rgba(0, 0, 0, 0.5) - for modal overlays
  // Status color overlays
  receivedOverlay15: string; // rgba(46, 204, 113, 0.15) - success/received at 15% opacity
  receivedOverlay40: string; // rgba(46, 204, 113, 0.4) - success/received at 40% opacity
  dangerOverlay15: string; // rgba(231, 76, 60, 0.15) - danger at 15% opacity
  dangerOverlay40: string; // rgba(231, 76, 60, 0.4) - danger at 40% opacity
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
  medium: string;
  bold: string;
  monospace: string;
  monospaceMedium: string;
  monospaceBold: string;
  // Legacy support
  roboto: string;
  robotoMono: string;
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
