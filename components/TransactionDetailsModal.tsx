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
}

const TransactionDetailsModal: React.FC<TransactionDetailsModalProps> = ({
  visible,
  onClose,
  transaction,
  baseApi,
  selectedCurrency,
  btcRate,
  getCurrencySymbol,
  status,
  amounts,
}) => {
  if (!transaction || !status || !amounts) {
    return null;
  }

  const baseUrl = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  const explorerLink = `${baseUrl}/tx/${transaction.txid}`;

  const formatBtcAmount = (amount: number) => {
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

  // Get the relevant address based on transaction type
  const relevantAddress = isSent
    ? transaction.vout?.find(
        (output: any) =>
          output.scriptpubkey_address !==
          transaction.vin[0]?.prevout?.scriptpubkey_address,
      )?.scriptpubkey_address
    : transaction.vin?.find(
        (input: any) =>
          input.prevout.scriptpubkey_address !==
          transaction.vout[0]?.scriptpubkey_address,
      )?.prevout?.scriptpubkey_address;

  const addressLabel = isSent ? 'To Address' : 'From Address';
  const addressExplorerLink = relevantAddress
    ? `${baseUrl}/address/${relevantAddress}`
    : '';

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
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Overview</Text>
              {renderDetailRow(
                'Status',
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
                </Text>,
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
                renderDetailRow('Sent', `${formatBtcAmount(amounts.sent)} BTC`)}
              {!isSent &&
                renderDetailRow(
                  'Received',
                  `${formatBtcAmount(amounts.received)} BTC`,
                )}
              {renderDetailRow(
                'Value',
                `${getCurrencySymbol(selectedCurrency)}${getFiatAmount(
                  amount,
                )}`,
              )}
            </View>

            {relevantAddress && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{addressLabel}</Text>
                <View style={styles.txIdContainer}>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(addressExplorerLink)}>
                    <Text style={[styles.txId, styles.clickableText]}>
                      {relevantAddress}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Transaction ID</Text>
              <View style={styles.txIdContainer}>
                <TouchableOpacity onPress={() => Linking.openURL(explorerLink)}>
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
              {renderDetailRow(
                'Fee',
                `${formatBtcAmount(
                  transaction.fee / 1e8,
                )} BTC (${getCurrencySymbol(selectedCurrency)}${getFiatAmount(
                  transaction.fee / 1e8,
                )})`,
              )}
              {renderDetailRow('Size', `${transaction.size} bytes`)}
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
    width: '90%',
    maxHeight: '80%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
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
    fontSize: 18,
    fontWeight: '600',
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
    fontSize: 16,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
  },
  detailLabel: {
    fontSize: 14,
    color: themes.lightPolished.colors.text,
    opacity: 0.7,
  },
  detailValue: {
    fontSize: 14,
    color: themes.lightPolished.colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  txIdContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
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
    fontSize: 14,
    fontWeight: '600',
  },
});

export default TransactionDetailsModal;
