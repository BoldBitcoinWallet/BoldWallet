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
  status?: 'pending' | 'signing' | 'signed' | 'broadcasted' | 'rejected';
  onReviewSign: () => void;
  isSender?: boolean;
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
  status = 'pending',
  onReviewSign,
  isSender = false,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const isSenderWaitingApproval = isSender && status === 'pending';
  const isSenderReadyToContinue = isSender && status === 'signing';
  const isActionable =
    (!isSender && status === 'pending') || isSenderReadyToContinue;
  const isSigning = status === 'signing';
  const isSigned = status === 'signed';
  const isBroadcasted = status === 'broadcasted';
  const isTerminal = isSigned || isBroadcasted || status === 'rejected';
  const headerText = isBroadcasted
    ? 'Broadcasted'
    : isSigned
    ? 'Co-Signed'
    : isSigning
    ? 'Signing In Progress'
    : isSender && status === 'pending'
    ? 'Waiting for Peer Co-Sign'
    : status === 'rejected'
    ? 'Request Rejected'
    : 'Action Required: Co-Sign Transaction';
  const buttonText = isBroadcasted
    ? 'Broadcasted'
    : isSigned
    ? 'Co-Signed'
    : isSenderReadyToContinue
    ? 'Continue Co-Sign'
    : isSigning
    ? 'Signing...'
    : isSenderWaitingApproval
    ? 'Wait for Peer Approval'
    : status === 'rejected'
    ? 'Rejected'
    : 'Review & Sign';

  const handleReviewPress = () => {
    console.log('[NIP46-TLM][UI] CoSignRequestCard button press', {
      isActionable,
      status,
      amountSats,
      feeSats,
      recipientAddress: truncateAddress(recipientAddress),
      timestamp,
    });
    onReviewSign();
  };

  return (
    <View
      style={[
        styles.wrap,
        isBroadcasted && styles.wrapSigned,
        isSigned && styles.wrapSigned,
        status === 'rejected' && styles.wrapRejected,
      ]}>
      <AppText
        style={[
          styles.header,
          isBroadcasted && styles.headerSigned,
          isSigned && styles.headerSigned,
          status === 'rejected' && styles.headerRejected,
        ]}>
        {headerText}
      </AppText>

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

      {isTerminal ? (
        <View
          style={[
            styles.statusPill,
            isBroadcasted
              ? styles.statusPillBroadcasted
              : isSigned
              ? styles.statusPillSigned
              : styles.statusPillRejected,
          ]}
        >
          <AppText
            style={[
              styles.statusPillText,
              isBroadcasted
                ? styles.statusPillTextBroadcasted
                : isSigned
                ? styles.statusPillTextSigned
                : styles.statusPillTextRejected,
            ]}
          >
            {buttonText}
          </AppText>
        </View>
      ) : (
        <AppPressable
          disabled={!isActionable}
          onPress={handleReviewPress}
          style={[styles.button, !isActionable && styles.buttonDisabled]}>
          <AppText style={[styles.buttonText, !isActionable && styles.buttonTextDisabled]}>
            {buttonText}
          </AppText>
        </AppPressable>
      )}

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
    wrapSigned: {
      borderColor: 'rgba(72, 187, 120, 0.65)',
      backgroundColor: 'rgba(72, 187, 120, 0.12)',
    },
    wrapRejected: {
      borderColor: 'rgba(227, 93, 91, 0.65)',
      backgroundColor: 'rgba(227, 93, 91, 0.12)',
    },
    header: {
      color: '#f5a623',
      fontSize: 14,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 8,
    },
    headerSigned: {
      color: '#48bb78',
    },
    headerRejected: {
      color: '#e35d5b',
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
    buttonDisabled: {
      backgroundColor: 'rgba(148, 163, 184, 0.45)',
    },
    buttonText: {
      color: '#1b1b1b',
      fontFamily: theme.fontFamilies?.bold,
      fontSize: 13,
    },
    buttonTextDisabled: {
      color: '#172034',
    },
    statusPill: {
      marginTop: 10,
      width: '100%',
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
      borderWidth: 1,
    },
    statusPillSigned: {
      borderColor: 'rgba(72, 187, 120, 0.45)',
      backgroundColor: 'rgba(72, 187, 120, 0.12)',
    },
    statusPillBroadcasted: {
      borderColor: 'rgba(34, 197, 94, 0.55)',
      backgroundColor: 'rgba(34, 197, 94, 0.14)',
    },
    statusPillRejected: {
      borderColor: 'rgba(227, 93, 91, 0.5)',
      backgroundColor: 'rgba(227, 93, 91, 0.14)',
    },
    statusPillText: {
      fontFamily: theme.fontFamilies?.bold,
      fontSize: 13,
    },
    statusPillTextSigned: {
      color: '#48bb78',
    },
    statusPillTextBroadcasted: {
      color: '#22c55e',
    },
    statusPillTextRejected: {
      color: '#e35d5b',
    },
    time: {
      marginTop: 8,
      fontSize: 11,
      color: theme.colors.textSecondary,
      alignSelf: 'flex-end',
    },
  });

export default CoSignRequestCard;