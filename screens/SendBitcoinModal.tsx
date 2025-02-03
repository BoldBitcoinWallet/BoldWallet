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
  SafeAreaView,
  Image,
  ActivityIndicator,
  NativeModules,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import Clipboard from '@react-native-clipboard/clipboard';
import debounce from 'lodash/debounce';
import theme from '../theme';
import Big from 'big.js';

const {BBMTLibNativeModule} = NativeModules;

interface SendBitcoinModalProps {
  visible: boolean;
  onClose: () => void;
  onSend: (address: string, amount: Big, estimatedFee: Big) => void;
  btcToUsdRate: Big;
  walletBalance: Big;
  walletAddress: string;
}

const E8 = Big(10).pow(8);

const QRScanner = ({device, codeScanner, onClose}: any) => {
  if (!device) {
    return <Text style={styles.cameraNotFound}>Camera Not Found</Text>;
  }
  return (
    <View style={styles.scannerContainer}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device || null}
        isActive={true}
        torch="off"
        codeScanner={codeScanner}
      />
      <View style={styles.qrFrame} />
      <TouchableOpacity style={styles.closeScannerButton} onPress={onClose}>
        <Text style={styles.closeScannerButtonText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
};

const SendBitcoinModal: React.FC<SendBitcoinModalProps> = ({
  visible,
  onClose,
  onSend,
  btcToUsdRate,
  walletBalance,
  walletAddress,
}) => {
  const [address, setAddress] = useState<string>('');
  const [btcAmount, setBtcAmount] = useState<Big>(Big(0));
  const [inBtcAmount, setInBtcAmount] = useState('');
  const [inUsdAmount, setInUsdAmount] = useState('');
  const [isScannerVisible, setIsScannerVisible] = useState<boolean>(false);
  const [estimatedFee, setEstimatedFee] = useState<Big | null>(null);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);

  const [activeInput, setActiveInput] = useState<'btc' | 'usd' | null>(null);

  const device = useCameraDevice('back');
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      if (codes.length > 0) {
        setAddress(codes[0].value!!);
        setIsScannerVisible(false);
      }
    },
  });

  const formatUSD = (price: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);

  // Create a debounced version of getEstimateFee
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
      BBMTLibNativeModule.estimateFee(
        walletAddress,
        addr,
        amount.times(1e8).toFixed(0),
      )
        .then((fee: string) => {
          if (fee) {
            console.log('got fees:', fee);
            const feeAmt = Big(fee).times(1.25).lt(512)
              ? Big(512)
              : Big(fee).times(1.25);
            setEstimatedFee(feeAmt);
            console.log({
              inBtcAmount,
              walletBalance,
            });
            if (inBtcAmount === walletBalance.toString()) {
              console.log({
                inBtcAmount,
                walletBalance,
              });
              setInBtcAmount(walletBalance.minus(feeAmt.div(1e8)).toString());
            }
          }
        })
        .catch((e: any) => {
          console.error('Fee estimation failed:', e);
          Alert.alert('Error', 'Failed to estimate transaction fee');
        })
        .finally(() => {
          setIsCalculatingFee(false);
        });
    }, 1000),
    [inBtcAmount, walletAddress],
  );

  // Update fee when inputs change
  useEffect(() => {
    if (address && btcAmount) {
      debouncedGetFee(address, btcAmount.toString());
    }
  }, [address, btcAmount, debouncedGetFee]);

  const pasteAddress = useCallback(async () => {
    const text = await Clipboard.getString();
    setAddress(text);
  }, []);

  const handleBtcChange = (text: string) => {
    setActiveInput('btc');
    setInBtcAmount(text); // Update the raw input value first
    try {
      const btc = Big(text || 0);
      setBtcAmount(btc);
      if (activeInput === 'btc') {
        setInUsdAmount(btc.mul(btcToUsdRate).toFixed(2));
      }
    } catch {
      console.error('Invalid BTC input:', text);
    }
  };

  const handleUsdChange = (text: string) => {
    setActiveInput('usd');
    setInUsdAmount(text); // Update the raw input value first
    try {
      const usd = Big(text || 0);
      if (activeInput === 'usd') {
        setBtcAmount(usd.div(btcToUsdRate)); // Sync only if this input is active
        setInBtcAmount(usd.div(btcToUsdRate).toFixed(8));
      }
    } catch {
      console.error('Invalid USD input:', text);
    }
  };

  const handleMaxClick = () => {
    setBtcAmount(walletBalance);
    setInBtcAmount(walletBalance.toFixed(8));
    setInUsdAmount(walletBalance.times(btcToUsdRate).toFixed(2));
  };

  const handleSendClick = () => {
    if (!estimatedFee) {
      Alert.alert('Error', 'Please wait for fee estimation');
      return;
    }
    const feeBTC = estimatedFee.div(1e8);
    const totalAmount = Big(inBtcAmount).add(feeBTC);
    console.log({totalAmount, feeBTC, btcAmount, walletBalance});
    if (totalAmount.gt(walletBalance)) {
      Alert.alert('Error', 'Total amount including fee exceeds wallet balance');
      return;
    }
    onSend(address, Big(inBtcAmount).times(1e8), estimatedFee);
  };

  const renderFeeSection = () => {
    if (!address || !btcAmount) {
      return null;
    }
    return (
      <View style={styles.feeContainer}>
        <Text style={styles.feeLabel}>Network Fee:</Text>
        {isCalculatingFee ? (
          <View style={styles.feeLoadingContainer}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.feeCalculating}>Calculating...</Text>
          </View>
        ) : estimatedFee ? (
          <View style={styles.feeInfoContainer}>
            <View style={styles.feeAmountContainer}>
              <Text style={styles.feeAmount}>
                {estimatedFee.div(E8).toFixed(8)} BTC
              </Text>
              <Text style={styles.feeAmountUsd}>
                ($
                {formatUSD(estimatedFee.div(E8).times(btcToUsdRate).toNumber())}
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
              <SafeAreaView>
                <Text style={styles.header}>Send Bitcoin</Text>
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
                    onPress={() => setIsScannerVisible(true)}
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
                    <TouchableOpacity onPress={handleMaxClick}>
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
                  <Text style={styles.inputLabel}>Amount in USD ($)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Or USD amount"
                    value={inUsdAmount}
                    onFocus={() => setActiveInput('usd')}
                    onChangeText={handleUsdChange}
                    keyboardType="decimal-pad"
                  />
                </View>

                {renderFeeSection()}

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
                    }>
                    <Text style={styles.buttonText}>Send</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={onClose}>
                    <Text style={styles.buttonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>

                {/* QR Scanner Modal */}
                <Modal
                  animationType="slide"
                  transparent={false}
                  visible={isScannerVisible}
                  onRequestClose={() => setIsScannerVisible(false)}>
                  <QRScanner
                    device={device}
                    codeScanner={codeScanner}
                    onClose={() => setIsScannerVisible(false)}
                  />
                </Modal>
              </SafeAreaView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    width: '90%',
    backgroundColor: theme.colors.background,
    borderRadius: 10,
    padding: 20,
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 0,
    textAlign: 'center',
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
    maxHeight: 50,
    fontSize: 14,
    backgroundColor: '#FFF',
  },
  iconImage: {
    width: 24,
    height: 24,
  },
  pasteIconContainer: {
    position: 'absolute',
    top: '50%',
    right: 40,
    transform: [{translateY: -12}],
  },
  qrIconContainer: {
    position: 'absolute',
    top: '50%',
    right: 10,
    transform: [{translateY: -12}],
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
    marginRight: 10, // Add some space between BTC and USD amounts
  },
  feeCalculating: {
    marginLeft: 10,
    color: '#7f8c8d',
    fontSize: 14,
  },
  feeAmountContainer: {
    flexDirection: 'row', // Align children in a row
    alignItems: 'center', // Center items vertically within the row
    justifyContent: 'space-between', // Space between BTC and USD amounts
  },
  feeLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center', // Center the loading indicator and text
    marginTop: 5,
  },
  feeAmountUsd: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 2,
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
  confirmationBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmationContainer: {
    width: '90%',
    backgroundColor: theme.colors.background,
    borderRadius: 10,
    padding: 20,
  },
  confirmationHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: theme.colors.text,
  },
  confirmationDetails: {
    marginBottom: 20,
  },
  confirmationLabel: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 10,
  },
  addressText: {
    fontSize: 14,
    color: theme.colors.text,
    marginTop: 5,
    marginBottom: 10,
  },
  confirmationValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  confirmationUsdValue: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 10,
  },
  totalContainer: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: theme.colors.secondary,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  totalUsdValue: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  confirmationButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 10,
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
});

export default SendBitcoinModal;
