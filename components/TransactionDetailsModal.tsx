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
import {themes} from '../theme';
import moment from 'moment';
import {HapticFeedback} from '../utils';

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
  if (!transaction || !status || !amounts) {
    return null;
  }

  const baseUrl = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  const explorerLink = `${baseUrl}/tx/${transaction.txid}`;

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
    const inputAddresses = transaction.vin
      ?.map((input: any) => input.prevout?.scriptpubkey_address)
      .filter((addr: string) => addr && addr !== address) || []; // Exclude user's own address (change)
    
    // Remove duplicates
    const uniqueAddresses = [...new Set(inputAddresses)];
    
    // Calculate total received amount from outputs to user's address
    const totalReceivedSats = transaction.vout
      ?.filter((output: any) => output.scriptpubkey_address === address)
      .reduce((total: number, output: any) => total + (output.value || 0), 0) || 0;
    
    const totalReceivedBTC = totalReceivedSats / 1e8;
    
    // Show all sender addresses with the total received amount
    // (We can't attribute portions to individual senders since Bitcoin doesn't work that way)
    relevantAddresses = uniqueAddresses.map(addr => ({
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
                          ? themes.lightPolished.colors.primary
                          : themes.lightPolished.colors.accent,
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

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: themes.lightPolished.colors.background,
    borderRadius: 16,
    width: '92%',
    maxHeight: '85%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: themes.lightPolished.colors.text,
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 20,
    color: themes.lightPolished.colors.text,
    opacity: 0.7,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: themes.lightPolished.colors.text,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.04)',
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: themes.lightPolished.colors.text,
    opacity: 0.6,
    minWidth: 108,
  },
  detailValue: {
    fontSize: 14,
    color: themes.lightPolished.colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 1,
  },
  addressItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  addressIndex: {
    fontSize: 13,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
    opacity: 0.5,
    marginRight: 8,
    minWidth: 20,
  },
  txIdContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    marginRight: 12,
  },
  addressAmountContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 100,
  },
  addressAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: themes.lightPolished.colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
  },
  addressAmountFiat: {
    fontSize: 12,
    color: themes.lightPolished.colors.text,
    opacity: 0.6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  txId: {
    fontSize: 13,
    color: themes.lightPolished.colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  clickableText: {
    color: themes.lightPolished.colors.primary,
    textDecorationLine: 'underline',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
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
    backgroundColor: 'rgba(46, 204, 113, 0.15)',
    borderColor: 'rgba(46, 204, 113, 0.4)',
  },
  statusBadgePending: {
    backgroundColor: 'rgba(231, 76, 60, 0.15)',
    borderColor: 'rgba(231, 76, 60, 0.4)',
  },
});

export default TransactionDetailsModal;
