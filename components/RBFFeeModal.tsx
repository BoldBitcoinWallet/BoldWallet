import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  NativeModules,
  Linking,
} from 'react-native';
import {useTheme} from '../theme';
import {dbg} from '../utils';
import EncryptedStorage from 'react-native-encrypted-storage';
import Big from 'big.js';

const {BBMTLibNativeModule} = NativeModules;
const E8 = Big(10).pow(8);

interface RBFFeeModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (newFee: Big) => void;
  transaction: {
    txid: string;
    fee: number;
  };
  baseApi: string;
  selectedCurrency: string;
  btcRate: number;
  getCurrencySymbol: (currency: string) => string;
  error?: string | null;
}

const RBFFeeModal: React.FC<RBFFeeModalProps> = ({
  visible,
  onClose,
  onConfirm,
  transaction,
  baseApi,
  selectedCurrency,
  btcRate,
  getCurrencySymbol,
  error: initialError,
}) => {
  const {theme} = useTheme();
  const [loading, setLoading] = useState(false);
  const [estimatedFee, setEstimatedFee] = useState<Big | null>(null);
  const [feeStrategy, setFeeStrategy] = useState('30m');
  const [feeError, setFeeError] = useState<string | null>(initialError || null);
  const baseUrl = baseApi ? baseApi.replace('/api', '') : 'https://mempool.space';

  const feeStrategies = [
    {value: 'eco', label: 'Eco'},
    {value: 'top', label: 'Top'},
    {value: '30m', label: '30m'},
    {value: '1hr', label: '1h'},
    {value: 'min', label: 'Min'},
  ];

  const fetchFees = useCallback(async () => {
    setLoading(true);
    setFeeError(null);
    dbg('RBF: Starting fee estimation with strategy:', feeStrategy);
    try {
      // Set the fee policy before estimating
      dbg('RBF: Setting fee policy to:', feeStrategy);
      await BBMTLibNativeModule.setFeePolicy(feeStrategy);

      // Use the new EstimateRBFFees function
      dbg('RBF: Calling estimateRBFFees for txid:', transaction.txid);
      const fee = await BBMTLibNativeModule.estimateRBFFees(transaction.txid);
      if (fee) {
        dbg('RBF: Got estimated fee:', fee);
        const feeAmt = Big(fee);
        setEstimatedFee(feeAmt);

        // Check if new fee is higher than old fee
        const oldFee = Big(transaction.fee);
        dbg(
          'RBF: Comparing fees - Old:',
          oldFee.toString(),
          'New:',
          feeAmt.toString(),
        );
        if (feeAmt.lte(oldFee)) {
          dbg('RBF: New fee is not higher than old fee');
          setFeeError(
            `Please select a higher fee strategy. Current fee: ${oldFee
              .div(E8)
              .toFixed(8)} BTC`,
          );
        } else {
          dbg('RBF: New fee is higher than old fee, proceeding');
        }
      }
    } catch (error: any) {
      console.error('Error estimating RBF fees:', error);
      dbg('RBF: Error details:', error.message);
      // Handle the specific RBF fee comparison error
      if (error.message?.includes('new fee must be higher than old fee')) {
        const oldFee = error.message.match(/old fee: (\d+)/)?.[1];
        const newFee = error.message.match(/new fee: (\d+)/)?.[1];
        dbg('RBF: Parsed error details - Old fee:', oldFee, 'New fee:', newFee);
        if (oldFee && newFee) {
          setFeeError(
            'Please select a higher fee strategy to speed up the transaction',
          );
        } else {
          setFeeError('Please select a higher fee strategy');
        }
      } else {
        setFeeError('Failed to estimate new fee. Please try again.');
      }
    } finally {
      setLoading(false);
      dbg('RBF: Fee estimation completed');
    }
  }, [transaction.txid, transaction.fee, feeStrategy]);

  useEffect(() => {
    const initFee = async () => {
      const feeOption = await EncryptedStorage.getItem('feeStrategy');
      setFeeStrategy(feeOption || 'eco');
      dbg('using fee strategy', feeOption);
    };
    initFee();
  }, []);

  useEffect(() => {
    if (visible) {
      fetchFees();
    }
  }, [visible, fetchFees, feeStrategy]);

  useEffect(() => {
    if (initialError) {
      setFeeError(initialError);
    }
  }, [initialError]);

  const handleFeeStrategyChange = (value: string) => {
    setFeeStrategy(value);
    dbg('setting fee strategy to', value);
    EncryptedStorage.setItem('feeStrategy', value);
  };

  const handleConfirm = () => {
    if (estimatedFee) {
      onConfirm(estimatedFee);
    }
  };

  const formatUSD = (price: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);

  const formatFiatAmount = (btcAmount: number) => {
    const fiatAmount = btcAmount * btcRate;
    return `${getCurrencySymbol(selectedCurrency)}${formatUSD(fiatAmount)}`;
  };

  const styles = StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
    },
    modalContainer: {
      width: '90%',
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      padding: 24,
    },
    header: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 24,
      textAlign: 'center',
    },
    txInfoContainer: {
      marginBottom: 24,
    },
    txLabel: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 8,
    },
    txIdContainer: {
      backgroundColor: theme.colors.cardBackground,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    txId: {
      fontSize: 14,
      color: theme.colors.primary,
      textAlign: 'center',
    },
    feeContainer: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      marginTop: 8,
    },
    feeValue: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
    },
    feeFiat: {
      fontSize: 14,
      color: theme.colors.secondary,
      marginTop: 2,
    },
    feeStrategyContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    feeStrategyButton: {
      backgroundColor: theme.colors.cardBackground,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      marginRight: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    selectedStrategy: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    feeStrategyText: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: '500',
    },
    selectedStrategyText: {
      color: '#fff',
    },
    loadingContainer: {
      height: 80,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorContainer: {
      backgroundColor: theme.colors.background,
      padding: 12,
      borderRadius: 8,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: theme.colors.danger,
    },
    errorText: {
      color: theme.colors.danger,
      textAlign: 'center',
      fontSize: 14,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    button: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      marginHorizontal: 6,
    },
    cancelButton: {
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    confirmButton: {
      backgroundColor: theme.colors.primary,
    },
    disabledButton: {
      opacity: 0.5,
    },
    buttonText: {
      color: '#fff',
      textAlign: 'center',
      fontWeight: '600',
      fontSize: 16,
    },
    cancelButtonText: {
      color: theme.colors.text,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 8,
    },
  });

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContainer}>
          <Text style={styles.header}>Speed Up Transaction</Text>

          <View style={styles.txInfoContainer}>
            <Text style={styles.txLabel}>Transaction ID</Text>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(`${baseUrl}/tx/${transaction.txid}`)
              }
              style={styles.txIdContainer}>
              <Text
                style={styles.txId}
                numberOfLines={1}
                ellipsizeMode="middle">
                {transaction.txid}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Fee</Text>
            <View style={styles.feeContainer}>
              <Text style={styles.feeValue}>
                {Big(transaction.fee).div(E8).toFixed(8)} BTC
              </Text>
              <Text style={styles.feeFiat}>
                ({formatFiatAmount(Big(transaction.fee).div(E8).toNumber())})
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>New Fee</Text>
            <View style={styles.feeContainer}>
              {loading ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <>
                  <Text style={styles.feeValue}>
                    {estimatedFee ? estimatedFee.div(E8).toFixed(8) : '-'} BTC
                  </Text>
                  <Text style={styles.feeFiat}>
                    ({estimatedFee ? formatFiatAmount(estimatedFee.div(E8).toNumber()) : '-'})
                  </Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fee Strategy</Text>
            <View style={styles.feeStrategyContainer}>
              {feeStrategies.map(strategy => (
                <TouchableOpacity
                  key={strategy.value}
                  style={[
                    styles.feeStrategyButton,
                    feeStrategy === strategy.value && styles.selectedStrategy,
                  ]}
                  onPress={() => handleFeeStrategyChange(strategy.value)}>
                  <Text
                    style={[
                      styles.feeStrategyText,
                      feeStrategy === strategy.value &&
                        styles.selectedStrategyText,
                    ]}>
                    {strategy.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {feeError && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{feeError}</Text>
            </View>
          )}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onClose}>
              <Text style={[styles.buttonText, styles.cancelButtonText]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                styles.confirmButton,
                (!estimatedFee || feeError) && styles.disabledButton,
              ]}
              disabled={!estimatedFee || !!feeError}
              onPress={handleConfirm}>
              <Text style={styles.buttonText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default RBFFeeModal;
