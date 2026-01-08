import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
} from 'react-native';
import {useTheme} from '../theme';
import moment from 'moment';
import {HapticFeedback, dbg} from '../utils';

interface TransactionDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  transaction: any;
  baseApi: string;
  selectedCurrency: string;
  btcRate: number;
  getCurrencySymbol: (currency: string) => string;
  address: string;
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
  address,
  status,
  amounts,
  isBlurred = false,
}) => {
  const {theme} = useTheme();
  const [currentBlockHeight, setCurrentBlockHeight] = React.useState<number | null>(null);
  
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

  const formatBtcAmount = (amount: number) => {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return '0.00000000';
    }
    const formatted = amount.toFixed(8);
    const [whole, decimal] = formatted.split('.');
    return `${Number(whole).toLocaleString()}.${decimal}`;
  };

  const getFiatAmount = (btcAmount: number) => {
    if (!btcRate || btcRate <= 0) {
      return '0.00';
    }
    const amount = btcAmount * btcRate;
    return amount.toFixed(2);
  };

  const isSent = status.text.includes('Sen') || transaction.sentAt;
  const amount = isSent ? amounts.sent : amounts.received;
  const hasValidAmount =
    typeof amount === 'number' && Number.isFinite(amount);

  const hasValidSent =
    typeof amounts.sent === 'number' && Number.isFinite(amounts.sent);
  const hasValidReceived =
    typeof amounts.received === 'number' && Number.isFinite(amounts.received);

  // Get the relevant address(es) with amounts based on transaction type
  // For sent: show ALL recipient addresses with their amounts (all outputs that aren't the sender's address)
  // For received: show ALL input addresses (excluding the receiver's own address if it appears)
  interface AddressWithAmount {
    address: string;
    amount: number; // in BTC
  }
  
  let relevantAddresses: AddressWithAmount[] = [];
  let addressLabel = '';
  
  if (isSent) {
    // Sent transaction: show ALL recipient addresses with their amounts
    const recipientOutputs = transaction.vout
      ?.filter((output: any) => {
        // Exclude outputs that match the sender's address (change outputs)
        return output.scriptpubkey_address && output.scriptpubkey_address !== address;
      }) || [];
    
    // Group by address and sum amounts (in case same address appears multiple times)
    const addressAmountMap = new Map<string, number>();
    recipientOutputs.forEach((output: any) => {
      const addr = output.scriptpubkey_address;
      const amountSats = output.value || 0;
      const currentAmount = addressAmountMap.get(addr) || 0;
      addressAmountMap.set(addr, currentAmount + amountSats);
    });
    
    // Convert to array with amounts in BTC
    relevantAddresses = Array.from(addressAmountMap.entries()).map(([addr, amountSats]) => ({
      address: addr,
      amount: amountSats / 1e8, // Convert satoshis to BTC
    }));
    
    addressLabel = relevantAddresses.length > 1 ? 'To Addresses' : 'To Address';
  } else {
    // Received transaction: collect ALL unique input addresses (these are the senders)
    // Exclude the user's own address (change) from the list since it's not a "from" address
    // For received transactions, show the output amount that went to user's address, not input amounts
    const inputAddresses: string[] = (transaction.vin
      ?.map((input: any) => input.prevout?.scriptpubkey_address)
      .filter((addr: any): addr is string => typeof addr === 'string' && addr !== address) || []) as string[]; // Exclude user's own address (change)
    
    // Remove duplicates
    const uniqueAddresses: string[] = [...new Set(inputAddresses)];
    
    // Calculate total received amount from outputs to user's address
    const totalReceivedSats = transaction.vout
      ?.filter((output: any) => output.scriptpubkey_address === address)
      .reduce((total: number, output: any) => total + (output.value || 0), 0) || 0;
    
    const totalReceivedBTC = totalReceivedSats / 1e8;
    
    // Show all sender addresses with the total received amount
    // (We can't attribute portions to individual senders since Bitcoin doesn't work that way)
    relevantAddresses = uniqueAddresses.map((addr: string) => ({
      address: addr,
      amount: totalReceivedBTC, // Show the received output amount, not input amounts
    }));
    
    addressLabel = relevantAddresses.length > 1 ? 'From Addresses' : 'From Address';
  }

  const renderDetailRow = (label: string, value: string | React.ReactNode) => (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.colors.blackOverlay50,
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
      borderColor: theme.colors.border + '40', // Add border for dark mode visibility
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border + '40', // Use theme border color
    },
    modalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontWeight: (theme.fontWeights?.bold || '700') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
    },
    closeButton: {
      padding: 8,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontWeight: (theme.fontWeights?.normal || '400') as any,
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
      fontWeight: (theme.fontWeights?.bold || '700') as any,
      fontFamily: theme.fontFamilies?.regular,
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
      borderBottomColor: theme.colors.background === '#121212' || theme.colors.background.includes('12')
        ? theme.colors.border + '40' // More visible border in dark mode
        : theme.colors.blackOverlay04, // Light mode border
      gap: 12,
    },
    detailLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontWeight: (theme.fontWeights?.normal || '400') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary, // Use textSecondary for better readability
      minWidth: 108,
    },
    detailValue: {
      fontSize: theme.fontSizes?.base || 14,
      fontWeight: (theme.fontWeights?.normal || '400') as any,
      fontFamily: theme.fontFamilies?.monospace || (Platform.OS === 'ios' ? 'Menlo' : 'monospace'),
      color: theme.colors.text,
      flexShrink: 1,
    },
    addressItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 12,
    },
    addressIndex: {
      fontSize: theme.fontSizes?.base || 13,
      fontWeight: (theme.fontWeights?.semibold || '600') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary, // Use textSecondary for better readability
      marginRight: 8,
      minWidth: 20,
    },
    txIdContainer: {
      backgroundColor: theme.colors.background === '#121212' || theme.colors.background.includes('12')
        ? theme.colors.cardBackground // Use cardBackground in dark mode
        : theme.colors.blackOverlay03, // Light mode background
      padding: 12,
      borderRadius: 8,
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.background === '#121212' || theme.colors.background.includes('12')
        ? theme.colors.border + '40' // More visible border in dark mode
        : theme.colors.blackOverlay06, // Light mode border
      marginRight: 12,
    },
    addressAmountContainer: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      minWidth: 100,
    },
    addressAmount: {
      fontSize: theme.fontSizes?.base || 14,
      fontWeight: (theme.fontWeights?.bold || '700') as any,
      fontFamily: theme.fontFamilies?.monospace || (Platform.OS === 'ios' ? 'Menlo' : 'monospace'),
      color: theme.colors.text,
      marginBottom: 2,
    },
    addressAmountFiat: {
      fontSize: theme.fontSizes?.sm || 12,
      fontWeight: (theme.fontWeights?.normal || '400') as any,
      fontFamily: theme.fontFamilies?.monospace || (Platform.OS === 'ios' ? 'Menlo' : 'monospace'),
      color: theme.colors.textSecondary, // Use textSecondary for better readability
    },
    txId: {
      fontSize: theme.fontSizes?.base || 13,
      fontWeight: (theme.fontWeights?.normal || '400') as any,
      fontFamily: theme.fontFamilies?.monospace || (Platform.OS === 'ios' ? 'Menlo' : 'monospace'),
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
      fontWeight: (theme.fontWeights?.bold || '700') as any,
      fontFamily: theme.fontFamilies?.regular,
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
      backgroundColor: theme.colors.background === '#121212' || theme.colors.background.includes('12')
        ? (theme.colors.received || '#66BB6A') + '26' // Dark mode with opacity
        : theme.colors.receivedOverlay15, // Light mode
      borderColor: theme.colors.background === '#121212' || theme.colors.background.includes('12')
        ? (theme.colors.received || '#66BB6A') + '80' // More visible border in dark mode
        : theme.colors.receivedOverlay40, // Light mode
    },
    statusBadgePending: {
      backgroundColor: theme.colors.background === '#121212' || theme.colors.background.includes('12')
        ? theme.colors.accent + '26' // Dark mode with opacity
        : theme.colors.dangerOverlay15, // Light mode
      borderColor: theme.colors.background === '#121212' || theme.colors.background.includes('12')
        ? theme.colors.accent + '80' // More visible border in dark mode
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
            <TouchableOpacity 
              onPress={() => {
                HapticFeedback.light();
                onClose();
              }} 
              style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Overview</Text>
              {renderDetailRow(
                'Status',
                <View
                  style={[
                    styles.statusBadge,
                    status.confirmed ? styles.statusBadgeConfirmed : styles.statusBadgePending,
                  ]}>
                  <Text
                    style={[
                      styles.statusText,
                      {
                        color: status.confirmed
                          ? theme.colors.received || theme.colors.secondary
                          : theme.colors.accent,
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
              {isSent && hasValidSent &&
                renderDetailRow('Sent', `${formatBtcAmount(amounts.sent)} BTC`)}
              {!isSent && hasValidReceived &&
                renderDetailRow(
                  'Received',
                  `${formatBtcAmount(amounts.received)} BTC`,
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

            {relevantAddresses.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{addressLabel}</Text>
                {relevantAddresses.map((addrWithAmount, index) => {
                  const addressExplorerLink = `${baseUrl}/address/${addrWithAmount.address}`;
                  const showAmount = addrWithAmount.amount > 0;
                  return (
                    <View key={index} style={styles.addressItem}>
                      {relevantAddresses.length > 1 && (
                        <Text style={styles.addressIndex}>{index + 1}.</Text>
                      )}
                      <View style={styles.txIdContainer}>
                        <TouchableOpacity
                          onPress={() => {
                            HapticFeedback.light();
                            Linking.openURL(addressExplorerLink);
                          }}>
                          <Text style={[styles.txId, styles.clickableText]}>
                            {addrWithAmount.address}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {showAmount && (
                        <View style={styles.addressAmountContainer}>
                          <Text style={styles.addressAmount}>
                            {isBlurred ? '***' : formatBtcAmount(addrWithAmount.amount)} BTC
                          </Text>
                          {!isBlurred && btcRate > 0 && (
                            <Text style={styles.addressAmountFiat}>
                              {getCurrencySymbol(selectedCurrency)}{getFiatAmount(addrWithAmount.amount)}
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Transaction ID</Text>
              <View style={styles.txIdContainer}>
                <TouchableOpacity 
                  onPress={() => {
                    HapticFeedback.light();
                    Linking.openURL(explorerLink);
                  }}>
                  <Text style={[styles.txId, styles.clickableText]}>
                    {transaction.txid}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Details</Text>
              {renderDetailRow(
                'Block Height',
                transaction.status?.block_height || 'Pending',
              )}
              {confirmations !== null && (
                renderDetailRow(
                  'Confirmations',
                  confirmations.toString(),
                )
              )}
              {typeof transaction.fee === 'number' &&
                Number.isFinite(transaction.fee) &&
                renderDetailRow(
                  'Fee',
                  `${formatBtcAmount(
                    transaction.fee / 1e8,
                  )} BTC (${getCurrencySymbol(
                    selectedCurrency,
                  )}${getFiatAmount(transaction.fee / 1e8)})`,
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
