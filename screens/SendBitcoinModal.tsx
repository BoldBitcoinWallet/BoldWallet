import React, {useState, useCallback, useEffect, useMemo} from 'react';
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
import QRScanner from '../components/QRScanner';
import Clipboard from '@react-native-clipboard/clipboard';
import debounce from 'lodash/debounce';
import Big from 'big.js';
import {dbg, HapticFeedback, decodeSendBitcoinQR} from '../utils';
import {useTheme} from '../theme';
import LocalCache from '../services/LocalCache';
import {SafeAreaView} from 'react-native-safe-area-context';
import {validate as validateBitcoinAddress} from 'bitcoin-address-validation';

const {BBMTLibNativeModule} = NativeModules;

interface SendBitcoinModalProps {
  visible: boolean;
  onClose: () => void;
  onSend: (
    address: string,
    amount: Big,
    estimatedFee: Big,
    spendingHash: string,
  ) => void;
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
  const [isScannerVisible, setIsScannerVisible] = useState<boolean>(false);
  const [estimatedFee, setEstimatedFee] = useState<Big | null>(null);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);
  const [spendingHash, setSpendingHash] = useState<string>('');
  const [_activeInput, setActiveInput] = useState<'btc' | 'usd' | null>(null);
  const [feeStrategy, setFeeStrategy] = useState('1hr');

  const {theme} = useTheme();

  const styles = StyleSheet.create({
    feeStrategyContainer: {
      marginBottom: 8,
    },
    feeStrategyButton: {
      backgroundColor: theme.colors.cardBackground || '#e9ecef',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 12,
      marginRight: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.border || '#e0e0e0',
    },
    feeStrategyButtonSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    feeStrategyText: {
      fontSize: 12,
      color: theme.colors.textSecondary || '#495057',
      fontWeight: '600',
    },
    feeStrategyTextSelected: {
      color: '#fff',
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 6,
      color: theme.colors.textSecondary || '#7f8c8d',
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
    },
    modalContainer: {
      width: '90%',
      maxHeight: '90%',
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      padding: 16,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      marginBottom: 12,
      paddingHorizontal: 0,
    },
    titleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flex: 1,
    },
    bitcoinLogo: {
      width: 20,
      height: 20,
      resizeMode: 'contain',
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
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
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      fontSize: 15,
      maxHeight: 48,
      backgroundColor: theme.colors.cardBackground || '#FFF',
      marginBottom: 8,
      color: theme.colors.text,
    },
    inputWithIcons: {
      position: 'relative',
      marginBottom: 12,
      marginTop: 0,
    },
    inputAddressWithIcons: {
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      paddingRight: 80,
      minHeight: 56,
      maxHeight: 64,
      fontSize: 13,
      lineHeight: 16,
      backgroundColor: theme.colors.cardBackground || '#FFF',
      textAlignVertical: 'top',
      fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}) as any,
      color: theme.colors.text,
    },
    iconImage: {
      width: 24,
      height: 24,
    },
    pasteIconContainer: {
      position: 'absolute',
      top: 10,
      right: 40,
      padding: 4,
    },
    qrIconContainer: {
      position: 'absolute',
      top: 10,
      right: 8,
      padding: 4,
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
    balanceCard: {
      backgroundColor: theme.colors.cardBackground || '#f8f9fa',
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary || '#e0e0e0',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    balanceCardLeft: {
      flex: 1,
    },
    balanceCardLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.textSecondary || '#7f8c8d',
      marginBottom: 3,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    balanceCardBtc: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.text,
      marginBottom: 2,
    },
    balanceCardFiat: {
      fontSize: 12,
      color: theme.colors.textSecondary || '#7f8c8d',
      fontWeight: '500',
    },
    balanceCardMaxButton: {
      backgroundColor: theme.colors.accent || theme.colors.primary,
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: 8,
      minWidth: 60,
      alignItems: 'center',
      justifyContent: 'center',
    },
    balanceCardMaxButtonText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '700',
    },
    inputContainer: {
      marginBottom: 0,
    },
    inputLabel: {
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 6,
      color: theme.colors.textSecondary || '#7f8c8d',
    },
    inputError: {
      borderColor: theme.colors.danger || '#DC3545',
    },
    errorText: {
      fontSize: 12,
      color: theme.colors.danger || '#DC3545',
      marginTop: -8,
      marginBottom: 8,
      marginLeft: 4,
    },
    feeContainer: {
      marginTop: 10,
      padding: 12,
      backgroundColor: theme.colors.cardBackground || '#f8f9fa',
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary,
    },
    feeLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textSecondary || '#7f8c8d',
      marginBottom: 8,
    },
    feeInfoContainer: {
      marginTop: 0,
    },
    feeAmount: {
      fontSize: 15,
      fontWeight: '700',
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
      fontSize: 12,
      color: theme.colors.textSecondary || '#7f8c8d',
    },
    sendCancelButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 14,
      gap: 10,
    },
    sendButton: {
      flex: 1,
      backgroundColor: theme.colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      flex: 1,
      backgroundColor: theme.colors.secondary || theme.colors.border,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
    },
    disabledButton: {
      opacity: 0.5,
    },
    // Setup Guide Hint Styles
    setupGuideHint: {
      marginTop: 8,
      alignItems: 'center',
    },
    setupGuideHintTouchable: {
      paddingVertical: 6,
      paddingHorizontal: 10,
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
      fontSize: 12,
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

  const getFee = useCallback(
    async (addr: string, amt: string) => {
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
      const satoshiAmount = amount.times(1e8).toFixed(0);
      BBMTLibNativeModule.spendingHash(
        walletAddress,
        addr,
        satoshiAmount,
      )
        .then((hash: string) => {
          setSpendingHash(hash);
          dbg('got spending hash:', hash);
          BBMTLibNativeModule.estimateFees(
            walletAddress,
            addr,
            satoshiAmount,
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
                  // Dismiss keyboard when fee is updated
                  Keyboard.dismiss();
                  if (Big(inBtcAmount).eq(walletBalance)) {
                    // When MAX is clicked, adjust amount to account for fee
                    const adjustedAmount = walletBalance.minus(feeAmt.div(1e8));
                    setInBtcAmount(adjustedAmount.toFixed(8));
                    setBtcAmount(adjustedAmount);
                    setInUsdAmount(adjustedAmount.times(btcToFiatRate).toFixed(2));
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
        })
        .catch((e: any) => {
          dbg('Spending hash failed:', e);
          setIsCalculatingFee(false);
          setEstimatedFee(null);
        });
    },
    [btcAmount, walletBalance, walletAddress, inBtcAmount, btcToFiatRate],
  );

  const debouncedGetFee = useMemo(() => debounce(getFee, 1000), [getFee]);

  useEffect(() => {
    const initFee = async () => {
      const feeOption = await LocalCache.getItem('feeStrategy');
      // Always default to 'eco' if no fee strategy is set or if it was 'min'
      const defaultFee = feeOption && feeOption !== 'min' ? feeOption : 'eco';
      setFeeStrategy(defaultFee);
      BBMTLibNativeModule.setFeePolicy(defaultFee);
      dbg('using fee strategy', defaultFee);
    };
    initFee();
  }, []);

  useEffect(() => {
    // Only trigger fee estimation if we have a valid address and non-zero amount
    if (address && btcAmount && btcAmount.gt(0) && validateBitcoinAddress(address)) {
      debouncedGetFee(address, btcAmount.toString());
    } else {
      // Clear fee if conditions aren't met
      setEstimatedFee(null);
    }
  }, [address, btcAmount, debouncedGetFee, feeStrategy]);

  const pasteAddress = useCallback(async () => {
    HapticFeedback.light();
    const text = await Clipboard.getString();

    // Validate that the clipboard contains what looks like a Bitcoin address
    if (!text || !text.trim()) {
      Alert.alert('Error', 'No content found in clipboard');
      return;
    }

    // Show confirmation dialog for security
    Alert.alert(
      'Confirm Address',
      `Use this address?\n\n${text}`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Use Address',
          onPress: () => {
            setAddress(text.trim());
          },
        },
      ],
      {cancelable: true},
    );
  }, []);

  const handleBtcChange = (text: string) => {
    setActiveInput('btc');
    setInBtcAmount(text);
    try {
      const btc = Big(text || 0);
      setBtcAmount(btc);
      // Always update USD amount when BTC changes (no need to check activeInput)
      setInUsdAmount(btc.mul(btcToFiatRate).toFixed(2));
    } catch {
      dbg('Invalid BTC input:', text);
    }
  };

  const handleUsdChange = (text: string) => {
    setActiveInput('usd');
    setInUsdAmount(text);
    try {
      const usd = Big(text || 0);
      const calculatedBtc = usd.div(btcToFiatRate);
      // Always update BTC amount when USD changes (no need to check activeInput)
      setBtcAmount(calculatedBtc);
      setInBtcAmount(calculatedBtc.toFixed(8));
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

  // Handle QR scan - supports both regular addresses and send bitcoin QR format
  const handleQRScan = useCallback((qrData: string) => {
    if (!qrData || !qrData.trim()) {
      return;
    }

    // Check if it's a send bitcoin QR format (address|amount|fee|hash|addressType|derivationPath)
    const decoded = decodeSendBitcoinQR(qrData) as {
      toAddress: string;
      amountSats: string;
      feeSats: string;
      spendingHash?: string;
      addressType?: string;
      derivationPath?: string;
    } | null;
    if (decoded && decoded.toAddress && decoded.amountSats && decoded.feeSats) {
      // It's a send bitcoin QR format - populate all fields
      if (!validateBitcoinAddress(decoded.toAddress)) {
        Alert.alert('Invalid Address', 'The scanned QR code contains an invalid Bitcoin address.');
        return;
      }

      const amountSats = Big(decoded.amountSats);
      const feeSats = Big(decoded.feeSats);
      const amountBTC = amountSats.div(1e8);

      if (amountSats.lte(0) || feeSats.lte(0)) {
        Alert.alert('Invalid Amount', 'The scanned QR code contains invalid amount or fee values.');
        return;
      }

      // Populate form fields
      setAddress(decoded.toAddress);
      setBtcAmount(amountBTC);
      setInBtcAmount(amountBTC.toFixed(8));
      setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
      setSpendingHash(decoded.spendingHash || '');
      
      // Set the fee (will be validated when fee estimation runs)
      // Note: The fee from QR might not match current network conditions,
      // but we'll let the fee estimation handle that
      
      Alert.alert(
        'Transaction Details Loaded',
        `Address and amount have been filled from the QR code.\n\nAddress: ${decoded.toAddress.substring(0, 10)}...\nAmount: ${amountBTC.toFixed(8)} BTC\n\nPlease review and confirm.`,
      );
    } else {
      // It's a regular Bitcoin address - just set the address
      if (validateBitcoinAddress(qrData.trim())) {
        setAddress(qrData.trim());
      } else {
        Alert.alert('Invalid QR Code', 'The scanned QR code is not a valid Bitcoin address or send bitcoin data.');
      }
    }
  }, [btcToFiatRate]);

  const handleFeeStrategyChange = (value: string) => {
    HapticFeedback.selection();
    setFeeStrategy(value);
    dbg('setting fee strategy to', value);
    BBMTLibNativeModule.setFeePolicy(value);
    LocalCache.setItem('feeStrategy', value);
    // Dismiss keyboard when fee strategy changes (triggers new fee estimation)
    Keyboard.dismiss();
  };

  const handleSendClick = () => {
    // Client-side Bitcoin address validation
    if (!address || !validateBitcoinAddress(address)) {
      Alert.alert('Error', 'Please enter a valid Bitcoin address');
      return;
    }

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
    onSend(address, Big(inBtcAmount).times(1e8), estimatedFee, spendingHash);
  };

  // Check if amount exceeds balance
  const amountExceedsBalance = btcAmount.gt(0) && btcAmount.gt(walletBalance);

  const renderFeeSection = () => {
    if (!address || !btcAmount) {
      return null;
    }
    return (
            <View style={styles.feeContainer}>
        {isCalculatingFee ? (
          <View style={styles.feeLoadingContainer}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.feeCalculating}>Calculating...</Text>
          </View>
        ) : estimatedFee ? (
          <View style={styles.feeInfoContainer}>
            <View style={styles.feeStrategyContainer}>
              <Text style={styles.feeLabel}>Network Fee:</Text>
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
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled">
                  <View style={styles.inputWithIcons}>
                  <TextInput
                    style={styles.inputAddressWithIcons}
                    placeholder="Recipient Bitcoin Address"
                    value={address}
                    onChangeText={setAddress}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    numberOfLines={2}
                    scrollEnabled
                    selectTextOnFocus
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
                      setIsScannerVisible(true);
                    }}
                    style={styles.qrIconContainer}>
                    <Image
                      source={require('../assets/scan-icon.png')}
                      style={styles.iconImage}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>

                {/* Balance Card */}
                <View style={styles.balanceCard}>
                  <View style={styles.balanceCardLeft}>
                    <Text style={styles.balanceCardLabel}>Available Balance</Text>
                    <Text style={styles.balanceCardBtc}>
                      {walletBalance.toFixed(8)} BTC
                    </Text>
                    <Text style={styles.balanceCardFiat}>
                      ~{selectedCurrency}{' '}
                      {formatUSD(walletBalance.times(btcToFiatRate).toNumber())}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleMaxClick}
                    style={styles.balanceCardMaxButton}
                    activeOpacity={0.8}>
                    <Text style={styles.balanceCardMaxButtonText}>Max</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Amount in BTC (₿)</Text>
                  <TextInput
                    style={[
                      styles.input,
                      amountExceedsBalance && styles.inputError,
                    ]}
                    placeholder="Enter BTC amount"
                    value={inBtcAmount}
                    onChangeText={handleBtcChange}
                    onFocus={() => setActiveInput('btc')}
                    keyboardType="decimal-pad"
                  />
                  {amountExceedsBalance && (
                    <Text style={styles.errorText}>
                      Amount exceeds wallet balance ({walletBalance.toFixed(8)} BTC)
                    </Text>
                  )}
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
                </ScrollView>

                <QRScanner
                  visible={isScannerVisible}
                  onClose={() => setIsScannerVisible(false)}
                  onScan={handleQRScan}
                  mode="single"
                  title="Scan QR Code"
                  subtitle="Point camera at the QR data"
                />
              </SafeAreaView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

export default SendBitcoinModal;
