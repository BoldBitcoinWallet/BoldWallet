import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  NativeModules,
  ScrollView,
  Linking,
} from 'react-native';

import BarcodeZxingScan from 'rn-barcode-zxing-scan';
import Clipboard from '@react-native-clipboard/clipboard';
import debounce from 'lodash/debounce';
import Big from 'big.js';
import {dbg, HapticFeedback} from '../utils';
import {useTheme} from '../theme';
import LocalCache from '../services/LocalCache';
import {SafeAreaView} from 'react-native-safe-area-context';

const {BBMTLibNativeModule} = NativeModules;

interface SendBitcoinModalProps {
  visible: boolean;
  onClose: () => void;
  onSend: (address: string, amount: Big, estimatedFee: Big) => void;
  btcToFiatRate: Big;
  walletBalance: Big;
  walletAddress: string;
  selectedCurrency: string;
}

const E8 = Big(10).pow(8);

const SendBitcoinModal: React.FC<SendBitcoinModalProps> = ({
  visible,
  onClose,
  onSend,
  btcToFiatRate,
  walletBalance,
  walletAddress,
  selectedCurrency,
}) => {
  const [address, setAddress] = useState<string>('');
  const [btcAmount, setBtcAmount] = useState<Big>(Big(0));
  const [inBtcAmount, setInBtcAmount] = useState('');
  const [inUsdAmount, setInUsdAmount] = useState('');
  const [estimatedFee, setEstimatedFee] = useState<Big | null>(null);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);

  const [activeInput, setActiveInput] = useState<'btc' | 'usd' | null>(null);
  const [feeStrategy, setFeeStrategy] = useState('eco');

  const {theme} = useTheme();

  const styles = StyleSheet.create({
    feeStrategyContainer: {
      marginBottom: 10,
    },
    feeStrategyButton: {
      backgroundColor: '#e9ecef',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 16,
      marginRight: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    feeStrategyButtonSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    feeStrategyText: {
      fontSize: 14,
      color: '#495057',
      fontWeight: '600',
    },
    feeStrategyTextSelected: {
      color: '#fff',
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
      color: '#7f8c8d',
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
    },
    modalContainer: {
      width: '90%',
      backgroundColor: theme.colors.background,
      borderRadius: 10,
      padding: 20,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      marginBottom: 20,
      paddingHorizontal: 4,
    },
    titleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    bitcoinLogo: {
      width: 24,
      height: 24,
      resizeMode: 'contain',
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
      flex: 1,
    },
    closeButton: {
      width: 30,
      height: 30,
    },
    closeButtonText: {
      fontSize: 16,
      color: theme.colors.text,
      fontWeight: '600',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 30,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.secondary,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      maxHeight: 50,
      backgroundColor: '#FFF',
      marginBottom: 10,
    },
    inputWithIcons: {
      position: 'relative',
      marginBottom: 20,
      marginTop: 20,
    },
    inputAddressWithIcons: {
      borderWidth: 1,
      borderColor: theme.colors.secondary,
      borderRadius: 8,
      padding: 12,
      paddingRight: 80,
      minHeight: 48,
      maxHeight: 120,
      fontSize: 14,
      backgroundColor: '#FFF',
      textAlignVertical: 'top',
      fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}) as any,
    },
    iconImage: {
      width: 24,
      height: 24,
    },
    pasteIconContainer: {
      position: 'absolute',
      top: 12,
      right: 40,
    },
    qrIconContainer: {
      position: 'absolute',
      top: 12,
      right: 10,
    },
    labelContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 5,
    },
    maxText: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: 'bold',
      marginBottom: 10,
      textDecorationLine: 'underline',
    },
    inputContainer: {
      marginBottom: 0,
    },
    inputLabel: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
      color: '#7f8c8d',
    },
    feeContainer: {
      marginTop: 15,
      padding: 10,
      backgroundColor: '#f8f9fa',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.secondary,
    },
    feeLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: '#7f8c8d',
    },
    feeInfoContainer: {
      marginTop: 5,
    },
    feeAmount: {
      fontSize: 16,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    feeCalculating: {
      marginLeft: 10,
      color: '#7f8c8d',
      fontSize: 14,
    },
    feeAmountContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    feeLoadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 5,
    },
    feeAmountUsd: {
      fontSize: 14,
      color: '#7f8c8d',
    },
    sendCancelButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 20,
    },
    sendButton: {
      flex: 1,
      backgroundColor: theme.colors.primary,
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      marginRight: 10,
    },
    cancelButton: {
      flex: 1,
      backgroundColor: theme.colors.secondary,
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      marginLeft: 10,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    disabledButton: {
      opacity: 0.5,
    },
    scannerContainer: {
      flex: 1,
      backgroundColor: 'black',
    },
    qrFrame: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: 'white',
      width: 250,
      height: 250,
      alignSelf: 'center',
      top: '25%',
    },
    closeScannerButton: {
      position: 'absolute',
      top: 50,
      right: 20,
      backgroundColor: theme.colors.accent,
      padding: 10,
      borderRadius: 50,
    },
    closeScannerButtonText: {
      color: '#fff',
      fontWeight: 'bold',
    },
    cameraNotFound: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Setup Guide Hint Styles
    setupGuideHint: {
      marginTop: 12,
      alignItems: 'center',
    },
    setupGuideHintTouchable: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    setupGuideHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    setupGuideHintIcon: {
      width: 16,
      height: 16,
      tintColor: theme.colors.primary,
    },
    setupGuideHintText: {
      fontSize: 13,
      color: theme.colors.primary,
      fontWeight: '500',
      textDecorationLine: 'underline',
      textDecorationColor: theme.colors.primary + '80',
    },
  });

  const feeStrategies = [
    {label: 'Economy', value: 'eco'},
    {label: 'Top Priority', value: 'top'},
    {label: '30 Min', value: '30m'},
    {label: '1 Hour', value: '1hr'},
  ];

  const formatUSD = (price: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);

  const debouncedGetFee = useCallback(
    debounce(async (addr: string, amt: string) => {
      if (!addr || !amt || btcAmount.eq(0)) {
        setEstimatedFee(null);
        return;
      }

      const amount = Big(amt);

      if (amount.gt(walletBalance) || !walletBalance) {
        setEstimatedFee(null);
        return;
      }

      setIsCalculatingFee(true);
      BBMTLibNativeModule.estimateFees(
        walletAddress,
        addr,
        amount.times(1e8).toFixed(0),
      )
        .then((fee: string) => {
          if (fee && typeof fee === 'string') {
            // Check if the response contains an error message
            if (
              fee.includes('failed') ||
              fee.includes('error') ||
              fee.includes('[')
            ) {
              dbg('Fee estimation API returned error:', fee);
              setEstimatedFee(null);
              return;
            }

            // Try to parse the fee as a valid number
            try {
              const feeNumber = parseFloat(fee);
              if (isNaN(feeNumber) || feeNumber <= 0) {
                dbg('Invalid fee amount received:', fee);
                setEstimatedFee(null);
                return;
              }

              dbg('got fees:', fee);
              const feeAmt = Big(feeNumber.toString());
              setEstimatedFee(feeAmt);
              if (Big(inBtcAmount).eq(walletBalance)) {
                setInBtcAmount(walletBalance.minus(feeAmt.div(1e8)).toString());
              }
            } catch (parseError) {
              dbg('Failed to parse fee amount:', fee, parseError);
              setEstimatedFee(null);
            }
          } else {
            dbg('No fee data received from API');
            setEstimatedFee(null);
          }
        })
        .catch((e: any) => {
          dbg('Fee estimation failed:', e);
          setEstimatedFee(null);
          // Only show alert for network/API errors, not parsing errors
          if (e.message && !e.message.includes('Invalid number')) {
            Alert.alert(
              'Fee Estimation Error',
              'Unable to estimate transaction fee. Please try again later.',
            );
          }
        })
        .finally(() => {
          setIsCalculatingFee(false);
        });
    }, 1000),
    [inBtcAmount, walletAddress, feeStrategy],
  );

  useEffect(() => {
    const initFee = async () => {
      const feeOption = await LocalCache.getItem('feeStrategy');
      const defaultFee = feeOption && feeOption !== 'min' ? feeOption : 'eco';
      setFeeStrategy(defaultFee);
      BBMTLibNativeModule.setFeePolicy(defaultFee);
      dbg('using fee strategy', defaultFee);
    };
    initFee();
  }, []);

  useEffect(() => {
    if (address && btcAmount) {
      debouncedGetFee(address, btcAmount.toString());
    }
  }, [address, btcAmount, debouncedGetFee]);

  const pasteAddress = useCallback(async () => {
    HapticFeedback.light();
    const text = await Clipboard.getString();
    setAddress(text);
  }, []);

  const handleBtcChange = (text: string) => {
    setActiveInput('btc');
    setInBtcAmount(text);
    try {
      const btc = Big(text || 0);
      setBtcAmount(btc);
      if (activeInput === 'btc') {
        setInUsdAmount(btc.mul(btcToFiatRate).toFixed(2));
      }
    } catch {
      dbg('Invalid BTC input:', text);
    }
  };

  const handleUsdChange = (text: string) => {
    setActiveInput('usd');
    setInUsdAmount(text);
    try {
      const usd = Big(text || 0);
      if (activeInput === 'usd') {
        setBtcAmount(usd.div(btcToFiatRate));
        setInBtcAmount(usd.div(btcToFiatRate).toFixed(8));
      }
    } catch {
      dbg('Invalid USD input:', text);
    }
  };

  const handleMaxClick = () => {
    HapticFeedback.medium();
    setBtcAmount(walletBalance);
    setInBtcAmount(walletBalance.toFixed(8));
    setInUsdAmount(walletBalance.times(btcToFiatRate).toFixed(2));
  };

  const handleFeeStrategyChange = (value: string) => {
    HapticFeedback.selection();
    setFeeStrategy(value);
    dbg('setting fee strategy to', value);
    BBMTLibNativeModule.setFeePolicy(value);
    LocalCache.setItem('feeStrategy', value);
  };

  const handleSendClick = () => {
    if (!estimatedFee) {
      Alert.alert('Error', 'Please wait for fee estimation');
      return;
    }
    const feeBTC = estimatedFee.div(1e8);
    const totalAmount = Big(inBtcAmount).add(feeBTC);
    if (totalAmount.gt(walletBalance)) {
      Alert.alert('Error', 'Total amount including fee exceeds wallet balance');
      return;
    }
    HapticFeedback.heavy();
    onSend(address, Big(inBtcAmount).times(1e8), estimatedFee);
  };

  const renderFeeSection = () => {
    if (!address || !btcAmount) {
      return null;
    }
    return (
      <View style={styles.feeContainer}>
        {isCalculatingFee ? (
          <View style={styles.feeLoadingContainer}>
            <ActivityIndicator size="small" />
            <Text style={styles.feeCalculating}>Calculating...</Text>
          </View>
        ) : estimatedFee ? (
          <View style={styles.feeInfoContainer}>
            <View style={styles.feeStrategyContainer}>
              <Text style={styles.label}>Network Fee:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {feeStrategies.map(strategy => (
                  <TouchableOpacity
                    key={strategy.value}
                    style={[
                      styles.feeStrategyButton,
                      feeStrategy === strategy.value &&
                        styles.feeStrategyButtonSelected,
                    ]}
                    onPress={() => handleFeeStrategyChange(strategy.value)}>
                    <Text
                      style={[
                        styles.feeStrategyText,
                        feeStrategy === strategy.value &&
                          styles.feeStrategyTextSelected,
                      ]}>
                      {strategy.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <View style={styles.feeAmountContainer}>
              <Text style={styles.feeAmount}>
                {estimatedFee.div(E8).toFixed(8)} BTC
              </Text>
              <Text style={styles.feeAmountUsd}>
                ({selectedCurrency}{' '}
                {formatUSD(
                  estimatedFee.div(E8).times(btcToFiatRate).toNumber(),
                )}
                )
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : -500}>
              <SafeAreaView edges={['top', 'left', 'right']}>
                <View style={styles.header}>
                  <View style={styles.titleContainer}>
                    <Image
                      source={require('../assets/bitcoin-logo.png')}
                      style={styles.bitcoinLogo}
                    />
                    <Text style={styles.title}>Send Bitcoin</Text>
                  </View>
                  <TouchableOpacity
                    onPress={onClose}
                    style={styles.closeButton}
                    activeOpacity={0.7}>
                    <Text style={styles.closeButtonText}>✖️</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.inputWithIcons}>
                  <TextInput
                    style={styles.inputAddressWithIcons}
                    placeholder="Recipient Bitcoin Address"
                    value={address}
                    onChangeText={setAddress}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    onPress={pasteAddress}
                    style={styles.pasteIconContainer}>
                    <Image
                      source={require('../assets/paste-icon.png')}
                      style={styles.iconImage}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      HapticFeedback.light();
                      if (Platform.OS === 'android') {
                        BarcodeZxingScan.showQrReader(
                          (error: any, data: any) => {
                            if (!error) {
                              setAddress(data);
                            }
                          },
                        );
                      }
                    }}
                    style={styles.qrIconContainer}>
                    <Image
                      source={require('../assets/qr-icon.png')}
                      style={styles.iconImage}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.inputContainer}>
                  <View style={styles.labelContainer}>
                    <Text style={styles.inputLabel}>Amount in BTC (₿)</Text>
                    <TouchableOpacity
                      onPress={handleMaxClick}
                      activeOpacity={0.7}>
                      <Text style={styles.maxText}>Max</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter BTC amount"
                    value={inBtcAmount}
                    onChangeText={handleBtcChange}
                    onFocus={() => setActiveInput('btc')}
                    keyboardType="decimal-pad"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>
                    Amount in {selectedCurrency} ($)
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder={`Or ${selectedCurrency} amount`}
                    value={inUsdAmount}
                    onFocus={() => setActiveInput('usd')}
                    onChangeText={handleUsdChange}
                    keyboardType="decimal-pad"
                  />
                </View>

                {renderFeeSection()}

                {/* Setup Guide Hint */}
                <View style={styles.setupGuideHint}>
                  <TouchableOpacity
                    style={styles.setupGuideHintTouchable}
                    onPress={() => {
                      HapticFeedback.medium();
                      const url =
                        'https://x.com/boldbtcwallet/status/1988332367489237160';
                      Linking.openURL(url).catch(err => {
                        Alert.alert('Error', 'Unable to open the video link');
                        dbg('Error opening URL:', err);
                      });
                    }}
                    activeOpacity={0.7}>
                    <View style={styles.setupGuideHintRow}>
                      <Image
                        source={require('../assets/start-icon.png')}
                        style={styles.setupGuideHintIcon}
                        resizeMode="contain"
                      />
                      <Text style={styles.setupGuideHintText}>
                        🎥 Watch Send Bitcoin video guide →
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                <View style={styles.sendCancelButtons}>
                  <TouchableOpacity
                    style={[
                      styles.sendButton,
                      (!address ||
                        !btcAmount ||
                        isCalculatingFee ||
                        !estimatedFee) &&
                        styles.disabledButton,
                    ]}
                    onPress={handleSendClick}
                    disabled={
                      !address ||
                      !btcAmount ||
                      isCalculatingFee ||
                      !estimatedFee
                    }
                    activeOpacity={0.7}>
                    <Text style={styles.buttonText}>Send</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      HapticFeedback.light();
                      onClose();
                    }}
                    activeOpacity={0.7}>
                    <Text style={styles.buttonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

export default SendBitcoinModal;
