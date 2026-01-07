/**
 * Theme Definitions
 * Light and dark theme color palettes and styling
 */

import {Platform} from 'react-native';
import type {Theme} from './types';

// Shared font sizes across themes
const fontSizes = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 15,
  lg: 16,
  xl: 18,
  '2xl': 20,
  '3xl': 24,
  // Legacy support
  small: 12,
  medium: 14,
  large: 16,
  extraLarge: 18,
};

// Shared font weights across themes
const fontWeights = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

// Shared font families across themes
const fontFamilies = {
  regular: Platform.OS === 'ios' ? 'System' : 'Roboto',
  monospace: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};

// Shared spacing across themes
const spacing = {
  small: 8,
  medium: 12,
  large: 20,
  extraLarge: 30,
};

// Shared border radius across themes
const borderRadius = {
  small: 8,
  medium: 10,
  large: 12,
};

/**
 * Light theme - preserves current color palette
 * Exact match to original lightPolished theme
 */
export const lightTheme: Theme = {
  colors: {
    primary: '#1A2B3C',
    subPrimary: '#033e3e',
    secondary: '#344960',
    danger: '#e74c3c',
    accent: '#f1c40f',
    background: '#ffffff',
    text: '#2c3e50',
    textSecondary: '#6b7280',
    cardBackground: '#f8f9fa',
    disabled: '#cbd5e1',
    border: '#94a3b8',
    textOnPrimary: '#ffffff',
    sent: '#E53935',
    received: '#4CAF50',
    buttonText: '#ffffff',
    disabledText: '#777',
    modalBackdrop: 'rgba(0, 0, 0, 0.8)',
    lightGray: '#777',
    mediumGray: '#666',
    white: '#fff',
    shadowColor: '#000',
  },
  fontSizes,
  fontWeights,
  fontFamilies,
  spacing,
  borderRadius,
  shadow: {
    light: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    medium: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 2,
    },
  },
};

/**
 * Dark theme - optimized color choices for dark mode
 */
export const darkTheme: Theme = {
  colors: {
    primary: '#3A3A3A', // Warm dark gray
    subPrimary: '#4A4A4A', // Slightly lighter warm gray
    secondary: '#00D2B8', // Teal/green
    danger: '#FF6B6B', // Softer red
    accent: '#E6C435', // Darker yellow/gold for better contrast
    background: '#121212', // Material dark background
    text: '#FFFFFF', // White text for better contrast
    textSecondary: '#B0B0B0', // Muted light text
    cardBackground: '#1E1E1E', // Dark card
    disabled: '#424242', // Dark disabled
    border: '#333333', // Dark border
    textOnPrimary: '#FFFFFF', // White on primary
    sent: '#FF6B6B', // Soft red for sent
    received: '#66BB6A', // Softer green
    buttonText: '#FFFFFF', // White text
    disabledText: '#757575', // Gray disabled text
    modalBackdrop: 'rgba(0, 0, 0, 0.85)', // Darker backdrop
    lightGray: '#757575', // Light gray in dark mode
    mediumGray: '#9E9E9E', // Medium gray
    white: '#FFFFFF', // White
    shadowColor: '#000', // Black shadow
  },
  fontSizes,
  fontWeights,
  fontFamilies,
  spacing,
  borderRadius,
  shadow: {
    light: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.3,
      shadowRadius: 2,
      elevation: 1,
    },
    medium: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.5,
      shadowRadius: 4,
      elevation: 2,
    },
  },
};

/**
 * Legacy themes for backward compatibility
 */
export const themes = {
  lightPolished: lightTheme,
  cryptoVibrant: {
    colors: {
      primary: '#1A2B3C',
      secondary: '#00D2B8',
      accent: '#F5A623',
      background: '#FFFFFF',
      text: '#1E293B',
      textSecondary: '#64748B',
      cardBackground: '#F5F7FA',
      subPrimary: '#033e3e',
      danger: '#e74c3c',
      disabled: '#cbd5e1',
      border: '#94a3b8',
      textOnPrimary: '#ffffff',
      sent: '#E53935',
      received: '#4CAF50',
      buttonText: '#ffffff',
      disabledText: '#777',
      modalBackdrop: 'rgba(0, 0, 0, 0.8)',
      lightGray: '#777',
      mediumGray: '#666',
      white: '#fff',
      shadowColor: '#000',
    },
    fontSizes,
    fontWeights,
    fontFamilies,
    spacing,
    borderRadius,
    shadow: lightTheme.shadow,
  },
  dark: darkTheme,
};

