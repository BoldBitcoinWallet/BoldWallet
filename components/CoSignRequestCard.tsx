import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import AppPressable from './AppPressable';
import AppText from './AppText';
import { useTheme } from '../theme';

type Props = {
  amountSats: number;
  feeSats: number;
  recipientAddress: string;
  timestamp: number;
  onReviewSign: () => void;
};

function truncateAddress(address: string): string {
  if (!address) return 'Unknown recipient';
  if (address.length <= 22) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

function formatClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const CoSignRequestCard: React.FC<Props> = ({
  amountSats,
  feeSats,
  recipientAddress,
  timestamp,
  onReviewSign,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrap}>
      <AppText style={styles.header}>Action Required: Co-Sign Transaction</AppText>

      <View style={styles.detailRow}>
        <AppText style={styles.label}>Amount</AppText>
        <AppText style={styles.value}>{amountSats} sats</AppText>
      </View>
      <View style={styles.detailRow}>
        <AppText style={styles.label}>Fee</AppText>
        <AppText style={styles.value}>{feeSats} sats</AppText>
      </View>
      <View style={styles.detailRow}>
        <AppText style={styles.label}>To</AppText>
        <AppText style={styles.value}>{truncateAddress(recipientAddress)}</AppText>
      </View>

      <AppPressable onPress={onReviewSign} style={styles.button}>
        <AppText style={styles.buttonText}>Review & Sign</AppText>
      </AppPressable>

      <AppText style={styles.time}>{formatClock(timestamp)}</AppText>
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    wrap: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(245, 166, 35, 0.60)',
      backgroundColor: 'rgba(245, 166, 35, 0.12)',
      padding: 12,
      marginBottom: 10,
    },
    header: {
      color: '#f5a623',
      fontSize: 14,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 8,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
      gap: 12,
    },
    label: {
      color: theme.colors.textSecondary,
      fontSize: 12,
    },
    value: {
      color: theme.colors.text,
      fontSize: 12,
      flexShrink: 1,
      textAlign: 'right',
    },
    button: {
      marginTop: 10,
      width: '100%',
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: 'center',
      backgroundColor: '#f5a623',
    },
    buttonText: {
      color: '#1b1b1b',
      fontFamily: theme.fontFamilies?.bold,
      fontSize: 13,
    },
    time: {
      marginTop: 8,
      fontSize: 11,
      color: theme.colors.textSecondary,
      alignSelf: 'flex-end',
    },
  });

export default CoSignRequestCard;