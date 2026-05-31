import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text, View, ViewStyle} from 'react-native';
import {useTheme} from '../theme';

type Props = {
  status: string;
  sessionShort?: string | null;
  style?: ViewStyle;
  /** Subtle pulse on the status dot during long transport waits */
  pulseIndicator?: boolean;
};

/** Status line in MPC progress modals with optional session id badge (right-aligned). */
export function MpcModalStatusRow({
  status,
  sessionShort,
  style,
  pulseIndicator,
}: Props) {
  const {theme} = useTheme();
  const badge = sessionShort?.trim();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulseIndicator) {
      pulse.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulseIndicator, pulse]);

  const accent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;

  return (
    <View style={[styles.row, style]}>
      <Animated.View
        style={[
          styles.indicator,
          {backgroundColor: accent},
          pulseIndicator ? {opacity: pulse} : styles.indicatorOpaque,
        ]}
      />
      <Text
        style={[
          styles.statusText,
          styles.statusTextFlex,
          {
            color: theme.colors.text,
            fontFamily: theme.fontFamilies?.medium,
            fontSize: theme.fontSizes?.base || 14,
          },
        ]}
        numberOfLines={2}>
        {status}
      </Text>
      {badge ? (
        <Text
          style={[
            styles.sessionBadge,
            {
              color: theme.colors.textSecondary,
              fontSize: theme.fontSizes?.sm || 12,
            },
          ]}
          accessibilityLabel={`Session ${badge}`}>
          {badge}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  indicatorOpaque: {
    opacity: 1,
  },
  statusText: {},
  statusTextFlex: {
    flex: 1,
  },
  sessionBadge: {
    fontFamily: 'Menlo',
    marginLeft: 8,
    textAlign: 'right',
    minWidth: 32,
  },
});
