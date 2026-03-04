import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import moment from 'moment';
import {dbg, formatBitcoinDisplay} from '../utils';
interface TransactionDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  transaction: any;
  baseApi: string;
  selectedCurrency: string;
  btcRate: number;
  getCurrencySymbol: (currency: string) => string;
  /** HD address → path map, used to annotate our inputs/outputs with derivation path. */
  addressPathMap?: Record<
    string,
    {derivationPath: string; chain: 'receive' | 'change'; index: number}
  > | null;
  status: {
    confirmed: boolean;
    text: string;
  } | null;
  amounts: {
    sent: number;
    received: number;
    changeAmount: number;
  } | null;
  isBlurred?: boolean;
}
const TransactionDetailsModal: React.FC<TransactionDetailsModalProps> = ({
  visible,
  onClose,
  transaction,
  baseApi,
  selectedCurrency,
  btcRate,
  getCurrencySymbol,
  addressPathMap,
  status,
  amounts,
  isBlurred = false,
}) => {
  const {theme} = useTheme();
  const {showSats, balanceFormattingEnabled} = useUser();
  const [currentBlockHeight, setCurrentBlockHeight] = React.useState<
    number | null
  >(null);
  const baseUrl = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  const explorerLink = transaction ? `${baseUrl}/tx/${transaction.txid}` : '';
  // Fetch current block height to calculate confirmations
  React.useEffect(() => {
    if (visible && transaction?.status?.block_height) {
      const fetchCurrentBlockHeight = async () => {
        try {
          // Use /api/blocks/tip/height endpoint (e.g., https://mempool.space/api/blocks/tip/height)
          const apiUrl = baseApi.replace(/\/+$/, ''); // Remove trailing slashes
          const response = await fetch(`${apiUrl}/blocks/tip/height`);
          if (response.ok) {
            const height = await response.text();
            const blockHeight = parseInt(height.trim(), 10);
            if (!isNaN(blockHeight) && blockHeight > 0) {
              setCurrentBlockHeight(blockHeight);
            }
          }
        } catch (error) {
          // Silently fail - confirmations will just not be shown
          dbg('Failed to fetch current block height:', error);
        }
      };
      fetchCurrentBlockHeight();
    }
  }, [visible, transaction?.status?.block_height, baseApi]);
  // Calculate confirmations if we have both block heights
  const confirmations = React.useMemo(() => {
    if (
      transaction?.status?.block_height &&
      currentBlockHeight &&
      currentBlockHeight >= transaction.status.block_height
    ) {
      return currentBlockHeight - transaction.status.block_height + 1;
    }
    return null;
  }, [transaction?.status?.block_height, currentBlockHeight]);
  if (!transaction || !status || !amounts) {
    return null;
  }
  const getFiatAmount = (btcAmount: number) => {
    if (!btcRate || btcRate <= 0) {
      return '0.00';
    }
    const amount = btcAmount * btcRate;
    return amount.toFixed(2);
  };
  const isSent = status.text.includes('Sen') || transaction.sentAt;
  const amount = isSent ? amounts.sent : amounts.received;
  const hasValidAmount = typeof amount === 'number' && Number.isFinite(amount);
  const hasValidSent =
    typeof amounts.sent === 'number' && Number.isFinite(amounts.sent);
  const hasValidReceived =
    typeof amounts.received === 'number' && Number.isFinite(amounts.received);
  const renderDetailRow = (label: string, value: string | React.ReactNode) => (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      width: '92%',
      maxHeight: '85%',
      elevation: 5,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.2,
      shadowRadius: 6,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
    },
    modalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    closeButton: {
      padding: 8,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      opacity: 0.7,
    },
    scrollContent: {
      padding: 16,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 12,
      letterSpacing: 0.2,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
      gap: 12,
    },
    detailLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary, // Use textSecondary for better readability
      minWidth: 108,
    },
    detailValue: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      flexShrink: 1,
    },
    ioRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
      gap: 8,
    },
    ioAddressBlock: {
      flex: 1,
      flexShrink: 1,
    },
    ioAddress: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
    },
    ioPath: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.monospace,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      marginTop: 2,
    },
    ioAmountBlock: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      minWidth: 90,
    },
    ioAmount: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.monospaceBold,
      color: theme.colors.text,
    },
    ioAmountOurs: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    ioBadge: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 2,
    },
    txIdContainer: {
      backgroundColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.cardBackground // Use cardBackground in dark mode
          : theme.colors.blackOverlay03, // Light mode background
      padding: 12,
      borderRadius: 8,
      flex: 1,
      borderWidth: 1,
      borderColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.border + '40' // More visible border in dark mode
          : theme.colors.blackOverlay06, // Light mode border
      marginRight: 12,
    },
    txId: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      marginBottom: 8,
      flexWrap: 'wrap',
    },
    clickableText: {
      color: theme.colors.text, // Use text color for better readability in dark mode
      textDecorationLine: 'underline',
      textDecorationColor: theme.colors.text, // Match underline color
    },
    statusText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      alignSelf: 'flex-start',
    },
    statusBadgeConfirmed: {
      backgroundColor:
        theme.colors.background !== '#ffffff'
          ? (theme.colors.received || '#66BB6A') + '26' // Dark mode with opacity
          : theme.colors.receivedOverlay15, // Light mode
      borderColor:
        theme.colors.background !== '#ffffff'
          ? (theme.colors.received || '#66BB6A') + '80' // More visible border in dark mode
          : theme.colors.receivedOverlay40, // Light mode
    },
    statusBadgePending: {
      backgroundColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.bitcoinOrange + '26' // Dark mode with opacity - use bitcoin orange
          : theme.colors.dangerOverlay15, // Light mode
      borderColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.bitcoinOrange + '80' // More visible border in dark mode - use bitcoin orange
          : theme.colors.dangerOverlay40, // Light mode
    },
  });
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Transaction Details</Text>
            <AppPressable
              onPress={() => {
                onClose();
              }}
              style={styles.closeButton}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text style={styles.closeButtonText}>✕</Text>
            </AppPressable>
          </View>
          <ScrollView
            style={styles.scrollContent}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            overScrollMode="never"
            showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Overview</Text>
              {renderDetailRow(
                'Status',
                <View
                  style={[
                    styles.statusBadge,
                    status.confirmed
                      ? styles.statusBadgeConfirmed
                      : styles.statusBadgePending,
                  ]}>
                  <Text
                    style={[
                      styles.statusText,
                      {
                        color: status.confirmed
                          ? theme.colors.received
                          : theme.colors.background === '#ffffff'
                          ? theme.colors.accent // Use accent in light mode
                          : theme.colors.bitcoinOrange, // Use bitcoin orange in dark mode
                      },
                    ]}>
                    {status.text}
                  </Text>
                </View>,
              )}
              {renderDetailRow(
                'Date',
                transaction.sentAt
                  ? moment(transaction.sentAt).format('MMM D, YYYY h:mm A')
                  : transaction.status?.block_time
                  ? moment(transaction.status.block_time * 1000).format(
                      'MMM D, YYYY h:mm A',
                    )
                  : 'Pending',
              )}
              {isSent &&
                hasValidSent &&
                renderDetailRow(
                  'Sent',
                  formatBitcoinDisplay(amounts.sent, {inSats: showSats, formatted: balanceFormattingEnabled}),
                )}
              {!isSent &&
                hasValidReceived &&
                renderDetailRow(
                  'Received',
                  formatBitcoinDisplay(amounts.received, {inSats: showSats, formatted: balanceFormattingEnabled}),
                )}
              {hasValidAmount &&
                renderDetailRow(
                  'Value',
                  isBlurred
                    ? '***'
                    : `${getCurrencySymbol(selectedCurrency)}${getFiatAmount(
                        amount,
                      )}`,
                )}
            </View>
            {/* Inputs */}
            {transaction.vin?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Inputs</Text>
                {transaction.vin.map((input: any, idx: number) => {
                  const addr: string = input.prevout?.scriptpubkey_address || '';
                  const sats: number = input.prevout?.value || 0;
                  const pathInfo = addr ? addressPathMap?.[addr] : undefined;
                  const short = addr
                    ? `${addr.slice(0, 8)}…${addr.slice(-6)}`
                    : 'coinbase';
                  const addrLink = addr ? `${baseUrl}/address/${addr}` : null;
                  return (
                    <View key={idx} style={styles.ioRow}>
                      <View style={styles.ioAddressBlock}>
                        {addrLink ? (
                          <AppPressable
                            onPress={() => Linking.openURL(addrLink)}
                            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                            <Text style={[styles.ioAddress, styles.clickableText]}>
                              {short}
                            </Text>
                          </AppPressable>
                        ) : (
                          <Text style={styles.ioAddress}>{short}</Text>
                        )}
                        {pathInfo && (
                          <Text style={styles.ioPath}>
                            {pathInfo.derivationPath} · {pathInfo.chain} #{pathInfo.index}
                          </Text>
                        )}
                      </View>
                      <View style={styles.ioAmountBlock}>
                        {pathInfo && <Text style={styles.ioBadge}>ours</Text>}
                        <Text style={[styles.ioAmount, pathInfo ? styles.ioAmountOurs : null]}>
                          {isBlurred
                            ? '***'
                            : formatBitcoinDisplay(sats / 1e8, {
                                inSats: showSats,
                                formatted: balanceFormattingEnabled,
                              })}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {/* Outputs */}
            {transaction.vout?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Outputs</Text>
                {transaction.vout.map((output: any, idx: number) => {
                  const addr: string = output.scriptpubkey_address || '';
                  const sats: number = output.value || 0;
                  const pathInfo = addr ? addressPathMap?.[addr] : undefined;
                  const short = addr
                    ? `${addr.slice(0, 8)}…${addr.slice(-6)}`
                    : 'OP_RETURN';
                  const addrLink = addr ? `${baseUrl}/address/${addr}` : null;
                  return (
                    <View key={idx} style={styles.ioRow}>
                      <View style={styles.ioAddressBlock}>
                        {addrLink ? (
                          <AppPressable
                            onPress={() => Linking.openURL(addrLink)}
                            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                            <Text style={[styles.ioAddress, styles.clickableText]}>
                              {short}
                            </Text>
                          </AppPressable>
                        ) : (
                          <Text style={styles.ioAddress}>{short}</Text>
                        )}
                        {pathInfo && (
                          <Text style={styles.ioPath}>
                            {pathInfo.derivationPath} · {pathInfo.chain} #{pathInfo.index}
                          </Text>
                        )}
                      </View>
                      <View style={styles.ioAmountBlock}>
                        {pathInfo && <Text style={styles.ioBadge}>ours</Text>}
                        <Text style={[styles.ioAmount, pathInfo ? styles.ioAmountOurs : null]}>
                          {isBlurred
                            ? '***'
                            : formatBitcoinDisplay(sats / 1e8, {
                                inSats: showSats,
                                formatted: balanceFormattingEnabled,
                              })}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Transaction ID</Text>
              <View style={styles.txIdContainer}>
                <AppPressable
                  onPress={() => {
                    Linking.openURL(explorerLink);
                  }}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <Text style={[styles.txId, styles.clickableText]}>
                    {transaction.txid}
                  </Text>
                </AppPressable>
              </View>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Details</Text>
              {renderDetailRow(
                'Block Height',
                transaction.status?.block_height || 'Pending',
              )}
              {confirmations !== null &&
                renderDetailRow('Confirmations', confirmations.toString())}
              {typeof transaction.fee === 'number' &&
                Number.isFinite(transaction.fee) &&
                renderDetailRow(
                  'Fee',
                  `${formatBitcoinDisplay(transaction.fee / 1e8, {
                    inSats: showSats,
                    formatted: balanceFormattingEnabled,
                  })} (${getCurrencySymbol(selectedCurrency)}${getFiatAmount(
                    transaction.fee / 1e8,
                  )})`,
                )}
              {typeof transaction.size === 'number' &&
                Number.isFinite(transaction.size) &&
                renderDetailRow('Size', `${transaction.size} bytes`)}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
export default TransactionDetailsModal;
