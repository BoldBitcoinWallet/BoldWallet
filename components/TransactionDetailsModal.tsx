import React, {useState, useEffect} from 'react';
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
import {useNavigation, CommonActions} from '@react-navigation/native';
import RBFFeeModal from './RBFFeeModal';
import {useTheme} from '../theme';
import Big from 'big.js';

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
  address,
}) => {
  const [showRBFModal, setShowRBFModal] = useState(false);
  const [rbfError, setRBFError] = useState<string | null>(null);
  const navigation = useNavigation();

  // Add debug logging for component mount and updates
  useEffect(() => {
    console.log('[TransactionDetailsModal] Mounted/Updated:', {
      visible,
      showRBFModal,
      transactionId: transaction?.txid,
      status: status?.text,
      isPending: status?.text?.includes('Sending'),
      isSent: status?.text?.includes('Sen') || transaction?.sentAt,
    });
  }, [visible, showRBFModal, transaction, status]);

  if (!transaction || !status || !amounts) {
    console.log('[TransactionDetailsModal] Missing required data:', {
      hasTransaction: !!transaction,
      hasStatus: !!status,
      hasAmounts: !!amounts,
    });
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
  const isSending = !status.confirmed && status.text.includes('Sending');

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

  const handleRBF = () => {
    console.log('[TransactionDetailsModal] RBF button clicked:', {
      txid: transaction.txid,
      currentFee: transaction.fee,
      amount: amount,
      relevantAddress,
      fromAddress: transaction.vin[0]?.prevout?.scriptpubkey_address,
    });
    setShowRBFModal(true);
  };

  const handleCloseRBF = () => {
    console.log('[TransactionDetailsModal] RBF modal closed');
    setShowRBFModal(false);
  };

  const handleConfirmRBF = (newFee: Big) => {
    console.log('[TransactionDetailsModal] RBF confirmed with fee:', newFee);

    // Validate that new fee is higher than old fee
    if (newFee.lte(Big(transaction.fee))) {
      setRBFError(
        `New fee must be higher than the current fee (${transaction.fee} sat/vB)`,
      );
      return;
    }

    // Prepare navigation params
    const navigationParams = {
      mode: 'send_btc',
      rbfTxId: transaction.txid,
      oldFee: transaction.fee.toString(),
      newFee: newFee.toString(),
      toAddress: relevantAddress,
      satoshiAmount: Big(amount).mul(1e8).toString(),
      usdAmount: getFiatAmount(amount).toString(),
      satoshiFees: newFee.toString(),
      usdFees: getFiatAmount(newFee.div(1e8).toNumber()).toString(),
      currencySymbol: getCurrencySymbol(selectedCurrency),
      explorerLink: explorerLink,
      addressType: transaction.vin[0]?.prevout?.scriptpubkey_type || 'p2wpkh',
    };

    // Close modals first
    setShowRBFModal(false);
    setRBFError(null);
    setTimeout(() => {
      onClose();
      requestAnimationFrame(() => {
        navigation.dispatch(
          CommonActions.navigate({
            name: '📱📱 Pairing',
            params: navigationParams,
          }),
        );
      });
    }, 0);
  };

  const renderDetailRow = (label: string, value: string | React.ReactNode) => (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
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
                  moment(transaction.status?.block_time * 1000).format(
                    'MMM D, YYYY h:mm A',
                  ),
                )}
                {isSent &&
                  renderDetailRow(
                    'Sent',
                    `${formatBtcAmount(amounts.sent)} BTC`,
                  )}
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
                {
                  <TouchableOpacity
                    style={styles.rbfButton}
                    onPress={handleRBF}>
                    <Text style={styles.rbfButtonText}>
                      🚀 Speed Up Transaction
                    </Text>
                  </TouchableOpacity>
                }
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
                  <TouchableOpacity
                    onPress={() => Linking.openURL(explorerLink)}>
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
          {showRBFModal && (
            <RBFFeeModal
              visible={showRBFModal}
              onClose={handleCloseRBF}
              onConfirm={handleConfirmRBF}
              transaction={{
                txid: transaction.txid,
                fee: transaction.fee,
              }}
              baseApi={baseApi}
              selectedCurrency={selectedCurrency}
              btcRate={btcRate}
              getCurrencySymbol={getCurrencySymbol}
              error={rbfError}
            />
          )}
        </View>
      </Modal>
    </>
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
    fontWeight: '500',
  },
  txIdContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  txId: {
    fontSize: 12,
    color: themes.lightPolished.colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  clickableText: {
    color: themes.lightPolished.colors.primary,
  },
  statusText: {
    fontWeight: '600',
  },
  rbfButton: {
    backgroundColor: themes.lightPolished.colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  rbfButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  rbfDescription: {
    fontSize: 12,
    color: themes.lightPolished.colors.text,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 8,
  },
});

export default TransactionDetailsModal;
