/**
 * Compact entry for the device-entropy sheet on pairing screens.
 */
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';

export default function DeviceEntropyPill({onPress}: {onPress: () => void}) {
  const {theme} = useTheme();
  const tokens = theme.colors;
  const styles = StyleSheet.create({
    pill: {
      flex: 1,
      width: '100%',
      height: 40,
      minHeight: 40,
      maxHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 6,
      paddingRight: 10,
      paddingVertical: 0,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: tokens.border,
      backgroundColor: tokens.cardBackground,
    },
    iconWell: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.bitcoinOrange + '22',
    },
    icon: {
      width: 15,
      height: 15,
      tintColor: tokens.bitcoinOrange,
    },
    copy: {flex: 1, minWidth: 0},
    title: {
      color: tokens.text,
      fontSize: 13,
      fontFamily: theme.fontFamilies?.bold,
    },
    hint: {
      color: tokens.textSecondary,
      fontSize: 11,
      fontFamily: theme.fontFamilies?.medium,
    },
    chevron: {
      color: tokens.textSecondary,
      fontSize: 18,
      fontWeight: '600',
      marginTop: -1,
    },
  });

  return (
    <AppPressable
      style={styles.pill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Device entropy">
      <View style={styles.iconWell}>
        <Image
          source={require('../assets/dice-icon.png')}
          style={styles.icon}
          resizeMode="contain"
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          Device entropy
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          How this phone draws randomness
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </AppPressable>
  );
}
