import React from 'react';
import {BaseToast, ErrorToast, InfoToast} from 'react-native-toast-message';
import type {Theme} from '../theme/types';

/**
 * Creates a theme-aware toast configuration for react-native-toast-message
 * @param theme - The current theme object
 * @returns Toast configuration object
 */
export const createToastConfig = (theme: Theme) => {
  const isDarkMode = theme.colors.background !== '#ffffff';
  const baseToastStyle = {
    borderLeftColor: isDarkMode
      ? theme.colors.bitcoinOrange
      : theme.colors.secondary + '60',
    backgroundColor: isDarkMode
      ? theme.colors.cardBackground
      : theme.colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDarkMode
      ? theme.colors.bitcoinOrange
      : theme.colors.secondary + '60',
      height: 80,
  };

  const contentContainerStyle = {
    paddingHorizontal: 15,
    paddingVertical: 6,
  };

  const text1Style = {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
  };

  const text2Style = {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.regular,
    color: theme.colors.textSecondary,
  };

  return {
    success: (props: any) => (
      <BaseToast
        {...props}
        style={baseToastStyle}
        contentContainerStyle={contentContainerStyle}
        text1Style={text1Style}
        text2Style={text2Style}
        text1NumberOfLines={2}
        text2NumberOfLines={2}
      />
    ),
    error: (props: any) => (
      <ErrorToast
        {...props}
        style={baseToastStyle}
        contentContainerStyle={contentContainerStyle}
        text1Style={text1Style}
        text2Style={text2Style}
        text1NumberOfLines={2}
        text2NumberOfLines={2}
      />
    ),
    info: (props: any) => (
      <InfoToast
        {...props}
        style={baseToastStyle}
        contentContainerStyle={contentContainerStyle}
        text1Style={text1Style}
        text2Style={text2Style}
        text1NumberOfLines={2}
        text2NumberOfLines={2}
      />
    ),
  };
};
