import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme';
import type {ConnectionQualityState} from '../services/mpcConnectionQuality';

type Props = {
  quality: ConnectionQualityState | null | undefined;
};

/** Compact Best / Medium / Low / Connecting chip for MPC progress modals. */
export function MpcConnectionQuality({quality}: Props) {
  const {theme} = useTheme();
  if (!quality) {
    return null;
  }
  const accent =
    quality.level === 'best'
      ? '#2e9e5b'
      : quality.level === 'medium'
        ? theme.colors.bitcoinOrange ?? '#f7931a'
        : quality.level === 'low'
          ? '#d14b4b'
          : theme.colors.textSecondary;

  return (
    <View
      style={styles.wrap}
      accessibilityLabel={`Connection quality ${quality.label}`}>
      <View style={[styles.dot, {backgroundColor: accent}]} />
      <Text
        style={[
          styles.label,
          {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSizes?.sm || 12,
            fontFamily: theme.fontFamilies?.regular,
          },
        ]}>
        Connection {quality.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 6,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    textAlign: 'center',
  },
});
