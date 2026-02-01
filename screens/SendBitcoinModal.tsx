import React, {useState, useCallback, useEffect, useMemo} from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
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
import {
  dbg,
  HapticFeedback,
  decodeSendBitcoinQR,
  formatBitcoinDisplay,
} from '../utils';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
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
  const {showSats, balanceFormattingEnabled} = useUser();
  const styles = StyleSheet.create({
    feeStrategyContainer: {
      marginBottom: 8,
    },
    feeStrategyButton: {
      backgroundColor: theme.colors.cardBackground,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 12,
      marginRight: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
    },
    feeStrategyButtonSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    feeStrategyText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    feeStrategyTextSelected: {
      color: theme.colors.white,
    },
    label: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 6,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.modalBackdrop,
    },
    modalContainer: {
      width: '90%',
      maxHeight: '90%',
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
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
      // Keep Bitcoin logo intact (no tint)
    },
    title: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      flex: 1,
    },
    closeButton: {
      width: 30,
      height: 30,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
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
      fontSize: theme.fontSizes?.md || 15,
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
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.monospace,
      lineHeight: 16,
      backgroundColor: theme.colors.cardBackground || '#FFF',
      textAlignVertical: 'top',
      color: theme.colors.text,
    },
    iconImage: {
      width: 24,
      height: 24,
      tintColor: theme.colors.text, // Fix dark mode visibility
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent
          : theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.sm || 11,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
      marginBottom: 3,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    balanceCardBtc: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 2,
    },
    balanceCardFiat: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    balanceCardMaxButton: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent || theme.colors.primary
          : theme.colors.bitcoinOrange,
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: 8,
      minWidth: 60,
      alignItems: 'center',
      justifyContent: 'center',
    },
    balanceCardMaxButtonText: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: '#fff',
    },
    inputContainer: {
      marginBottom: 0,
    },
    inputLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 6,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    inputError: {
      borderColor: theme.colors.danger || '#DC3545',
    },
    errorText: {
      fontSize: theme.fontSizes?.sm || 12,
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
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
      marginBottom: 8,
    },
    feeInfoContainer: {
      marginTop: 0,
    },
    feeAmount: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    feeCalculating: {
      marginLeft: 10,
      color: theme.colors.textSecondary, // Use theme color for dark mode readability
      fontSize: theme.fontSizes?.base || 14,
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
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    sendCancelButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 14,
      gap: 10,
    },
    sendButton: {
      flex: 1,
      backgroundColor: theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
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
      tintColor: theme.colors.text, // Use text color for better dark mode visibility
    },
    setupGuideHintText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text, // Use text color for better dark mode readability
      textDecorationLine: 'underline',
      textDecorationColor: theme.colors.text + '80',
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
      BBMTLibNativeModule.spendingHash(walletAddress, addr, satoshiAmount)
        .then((hash: string) => {
          setSpendingHash(hash);
          dbg('got spending hash:', hash);
          BBMTLibNativeModule.estimateFees(walletAddress, addr, satoshiAmount)
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
                    setInUsdAmount(
                      adjustedAmount.times(btcToFiatRate).toFixed(2),
                    );
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
    if (
      address &&
      btcAmount &&
      btcAmount.gt(0) &&
      validateBitcoinAddress(address)
    ) {
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
  const handleQRScan = useCallback(
    (qrData: string) => {
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
      if (
        decoded &&
        decoded.toAddress &&
        decoded.amountSats &&
        decoded.feeSats
      ) {
        // It's a send bitcoin QR format - populate all fields
        if (!validateBitcoinAddress(decoded.toAddress)) {
          Alert.alert(
            'Invalid Address',
            'The scanned QR code contains an invalid Bitcoin address.',
          );
          return;
        }
        const amountSats = Big(decoded.amountSats);
        const feeSats = Big(decoded.feeSats);
        const amountBTC = amountSats.div(1e8);
        if (amountSats.lte(0) || feeSats.lte(0)) {
          Alert.alert(
            'Invalid Amount',
            'The scanned QR code contains invalid amount or fee values.',
          );
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
          `Address and amount have been filled from the QR code.\n\nAddress: ${decoded.toAddress.substring(
            0,
            10,
          )}...\nAmount: ${formatBitcoinDisplay(amountBTC.toNumber(), {
            inSats: showSats,
            formatted: balanceFormattingEnabled,
          })}\n\nPlease review and confirm.`,
        );
      } else {
        // It's a regular Bitcoin address - just set the address
        if (validateBitcoinAddress(qrData.trim())) {
          setAddress(qrData.trim());
        } else {
          Alert.alert(
            'Invalid QR Code',
            'The scanned QR code is not a valid Bitcoin address or send bitcoin data.',
          );
        }
      }
    },
    [btcToFiatRate, showSats, balanceFormattingEnabled],
  );
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
              <ScrollView
                horizontal
                removeClippedSubviews
                keyboardShouldPersistTaps="handled"
                overScrollMode="never"
                showsHorizontalScrollIndicator={false}>
                {feeStrategies.map(strategy => (
                  <Pressable
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
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={styles.feeAmountContainer}>
              <Text style={styles.feeAmount}>
                {formatBitcoinDisplay(estimatedFee.div(E8).toNumber(), {
                  inSats: showSats,
                  formatted: balanceFormattingEnabled,
                })}
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
                  <Pressable
                    onPress={onClose}
                    style={styles.closeButton}
                    android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                    <Text style={styles.closeButtonText}>✖️</Text>
                  </Pressable>
                </View>
                <ScrollView
                  removeClippedSubviews
                  keyboardShouldPersistTaps="handled"
                  overScrollMode="never"
                  showsVerticalScrollIndicator={false}>
                  <View style={styles.inputWithIcons}>
                    <TextInput
                      style={styles.inputAddressWithIcons}
                      placeholder="Recipient Bitcoin Address"
                      placeholderTextColor={theme.colors.textSecondary + '80'}
                      value={address}
                      onChangeText={setAddress}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                      numberOfLines={2}
                      scrollEnabled
                      selectTextOnFocus
                    />
                    <Pressable
                      onPress={pasteAddress}
                      style={styles.pasteIconContainer}>
                      <Image
                        source={require('../assets/paste-icon.png')}
                        style={styles.iconImage}
                        resizeMode="contain"
                      />
                    </Pressable>
                    <Pressable
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
                    </Pressable>
                  </View>
                  {/* Balance Card */}
                  <View style={styles.balanceCard}>
                    <View style={styles.balanceCardLeft}>
                      <Text style={styles.balanceCardLabel}>
                        Available Balance
                      </Text>
                      <Text style={styles.balanceCardBtc}>
                        {formatBitcoinDisplay(walletBalance.toNumber(), {
                          inSats: showSats,
                          formatted: balanceFormattingEnabled,
                        })}
                      </Text>
                      <Text style={styles.balanceCardFiat}>
                        ~{selectedCurrency}{' '}
                        {formatUSD(
                          walletBalance.times(btcToFiatRate).toNumber(),
                        )}
                      </Text>
                    </View>
                    <Pressable
                      onPress={handleMaxClick}
                      style={styles.balanceCardMaxButton}
                      android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                      <Text style={styles.balanceCardMaxButtonText}>Max</Text>
                    </Pressable>
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>Amount in BTC (₿)</Text>
                    <TextInput
                      style={[
                        styles.input,
                        amountExceedsBalance && styles.inputError,
                      ]}
                      placeholder="Enter BTC amount"
                      placeholderTextColor={theme.colors.textSecondary + '80'}
                      value={inBtcAmount}
                      onChangeText={handleBtcChange}
                      onFocus={() => setActiveInput('btc')}
                      keyboardType="decimal-pad"
                    />
                    {amountExceedsBalance && (
                      <Text style={styles.errorText}>
                        Amount exceeds wallet balance (
                        {formatBitcoinDisplay(walletBalance.toNumber(), {
                          inSats: showSats,
                          formatted: balanceFormattingEnabled,
                        })}
                        )
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
                      placeholderTextColor={theme.colors.textSecondary + '80'}
                      value={inUsdAmount}
                      onFocus={() => setActiveInput('usd')}
                      onChangeText={handleUsdChange}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  {renderFeeSection()}
                  {/* Setup Guide Hint */}
                  <View style={styles.setupGuideHint}>
                    <Pressable
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
                      android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
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
                    </Pressable>
                  </View>
                  <View style={styles.sendCancelButtons}>
                    <Pressable
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
                      android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                      <Text style={styles.buttonText}>Send</Text>
                    </Pressable>
                    <Pressable
                      style={styles.cancelButton}
                      onPress={() => {
                        HapticFeedback.light();
                        onClose();
                      }}
                      android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                      <Text style={styles.buttonText}>Cancel</Text>
                    </Pressable>
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
