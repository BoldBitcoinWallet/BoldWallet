import React from 'react';
import {View, Text, StyleSheet, Image} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {networkLabel} from './transactionFlowUtils';

export type PairingSpendStickyFooterProps = {
  summaryLine: string;
  network?: string;
  buttonLabel: string;
  onPress: () => void;
  disabled?: boolean;
  iconSource?: number;
};

const PairingSpendStickyFooter: React.FC<PairingSpendStickyFooterProps> = ({
  summaryLine,
  network,
  buttonLabel,
  onPress,
  disabled = false,
  iconSource = require('../assets/cosign-icon.png'),
}) => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const isTestnet = network === 'testnet3' || network === 'testnet';

  const styles = StyleSheet.create({
    wrap: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.cardBackground,
      paddingTop: 10,
      paddingHorizontal: 16,
      paddingBottom: Math.max(insets.bottom, 12),
      shadowColor: '#000',
      shadowOffset: {width: 0, height: -2},
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 8,
    },
    summary: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    summaryInRow: {
      marginBottom: 0,
      flex: 1,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 10,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: isTestnet
        ? theme.colors.bitcoinOrange + '22'
        : theme.colors.primary + '18',
    },
    badgeText: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.bold,
      color: isTestnet ? theme.colors.bitcoinOrange : theme.colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    button: {
      backgroundColor: disabled
        ? theme.colors.border
        : theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
      tintColor: theme.colors.white,
    },
    buttonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
    },
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.summaryRow}>
        <Text style={[styles.summary, styles.summaryInRow]} numberOfLines={2}>
          {summaryLine}
        </Text>
        {network ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{networkLabel(network)}</Text>
          </View>
        ) : null}
      </View>
      <AppPressable
        style={styles.button}
        onPress={onPress}
        disabled={disabled}
        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
        <View style={styles.buttonContent}>
          <Image source={iconSource} style={styles.buttonIcon} resizeMode="contain" />
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </View>
      </AppPressable>
    </View>
  );
};

export default PairingSpendStickyFooter;

/** Scroll padding so last section is not hidden behind sticky footer. */
export const PAIRING_STICKY_FOOTER_SCROLL_PADDING = 120;
