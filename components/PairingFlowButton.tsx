/**
 * Shared shape for leaving a pairing flow or retrying it.
 * Callers keep their own onPress.
 */
import React from 'react';
import {Image, StyleSheet, Text, type StyleProp, type ViewStyle} from 'react-native';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';

type Props = {
  variant: 'quiet' | 'retry';
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export default function PairingFlowButton({variant, label, onPress, style}: Props) {
  const {theme} = useTheme();
  const tokens = theme.colors;
  const filled =
    tokens.background === '#ffffff' ? tokens.primary : tokens.bitcoinOrange;
  const quiet = variant === 'quiet';
  const styles = StyleSheet.create({
    btn: {
      minHeight: 40,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: quiet ? tokens.border : filled,
      backgroundColor: quiet ? 'transparent' : filled,
    },
    label: {
      color: quiet ? tokens.textSecondary : '#FFFFFF',
      fontSize: 14,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
    },
    icon: {
      width: 16,
      height: 16,
      marginRight: 6,
      tintColor: '#FFFFFF',
    },
  });

  return (
    <AppPressable style={[styles.btn, style]} onPress={onPress} accessibilityRole="button">
      {variant === 'retry' ? (
        <Image
          source={require('../assets/refresh-icon.png')}
          style={styles.icon}
          resizeMode="contain"
        />
      ) : null}
      <Text style={styles.label}>{label}</Text>
    </AppPressable>
  );
}
