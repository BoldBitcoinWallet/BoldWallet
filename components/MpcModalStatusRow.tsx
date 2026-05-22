import React from 'react';
import {StyleSheet, Text, View, ViewStyle} from 'react-native';
import {useTheme} from '../theme';

type Props = {
  status: string;
  sessionShort?: string | null;
  style?: ViewStyle;
};

/** Status line in MPC progress modals with optional session id badge (right-aligned). */
export function MpcModalStatusRow({status, sessionShort, style}: Props) {
  const {theme} = useTheme();
  const badge = sessionShort?.trim();
  return (
    <View style={[styles.row, style]}>
      <View
        style={[
          styles.indicator,
          {
            backgroundColor:
              theme.colors.background === '#ffffff'
                ? theme.colors.primary
                : theme.colors.bitcoinOrange,
          },
        ]}
      />
      <Text
        style={[
          styles.statusText,
          {
            color: theme.colors.text,
            fontFamily: theme.fontFamilies?.medium,
            fontSize: theme.fontSizes?.base || 14,
            flex: 1,
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
  statusText: {},
  sessionBadge: {
    fontFamily: 'Menlo',
    marginLeft: 8,
    textAlign: 'right',
    minWidth: 32,
  },
});
