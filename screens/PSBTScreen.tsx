import React, {useCallback, useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  Animated,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import {SafeAreaView} from 'react-native-safe-area-context';
import EncryptedStorage from 'react-native-encrypted-storage';
import {NativeModules} from 'react-native';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {PSBTLoader} from './PSBTModal';
import {dbg, HapticFeedback, generateAllOutputDescriptors} from '../utils';
import {CommonActions, useRoute, RouteProp} from '@react-navigation/native';
import TransportModeSelector from '../components/TransportModeSelector';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import QRCodeModal from '../components/QRCodeModal';
import SignedPSBTModal from './SignedPSBTModal';
import {WalletService} from '../services/WalletService';
import LocalCache from '../services/LocalCache';
import CurrencySelector from '../components/CurrencySelector';
import {createStyles as createGlobalStyles} from '../components/Styles';
const {BBMTLibNativeModule} = NativeModules;
interface KeyshareInfoForPsbt {
  outputDescriptors: {
    legacy: string;
    segwitNative: string;
    segwitCompatible: string;
  };
}
type RouteParams = {
  signedPsbt?: string;
};
const PSBTScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const globalStyles = createGlobalStyles(theme);

  // Helper function to format long strings: first 8 chars ... last 8 chars
  const formatLongString = useCallback((value: string): string => {
    if (!value || value.length <= 16) return value;
    return `${value.substring(0, 8)}...${value.substring(value.length - 8)}`;
  }, []);

  const {
    activeNetwork: network,
    activeAddressType: addressType,
    activeApiProvider: apiBase,
  } = useUser();
  const [keyshareInfo, setKeyshareInfo] = useState<KeyshareInfoForPsbt | null>(
    null,
  );
  const [isWatchWalletExpanded, setIsWatchWalletExpanded] = useState(false);
  const [isPSBTSectionExpanded, setIsPSBTSectionExpanded] = useState(false);
  const [isOutputDescriptorQrVisible, setIsOutputDescriptorQrVisible] =
    useState(false);
  const [selectedDescriptorType, setSelectedDescriptorType] = useState<
    'legacy' | 'segwitNative' | 'segwitCompatible' | null
  >(null);
  const [isPSBTTransportModalVisible, setIsPSBTTransportModalVisible] =
    useState<boolean>(false);
  const [pendingPSBTParams, setPendingPSBTParams] = useState<{
    psbtBase64: string;
  } | null>(null);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);
  const [isSignedPSBTModalVisible, setIsSignedPSBTModalVisible] =
    useState(false);
  const [btcPrice, setBtcPrice] = useState<string>('');
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [priceData, setPriceData] = useState<{[key: string]: number}>({});
  const [isCurrencySelectorVisible, setIsCurrencySelectorVisible] =
    useState(false);
  // Animation for Bold Connect collapsible section
  const rotationAnim = useRef(
    new Animated.Value(isWatchWalletExpanded ? 1 : 0),
  ).current;
  // Animation for Sign PSBT collapsible section
  const psbtRotationAnim = useRef(
    new Animated.Value(isPSBTSectionExpanded ? 1 : 0),
  ).current;
  useEffect(() => {
    Animated.timing(rotationAnim, {
      toValue: isWatchWalletExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isWatchWalletExpanded, rotationAnim]);
  useEffect(() => {
    Animated.timing(psbtRotationAnim, {
      toValue: isPSBTSectionExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isPSBTSectionExpanded, psbtRotationAnim]);
  const rotateInterpolate = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });
  const psbtRotateInterpolate = psbtRotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });
  const handleToggleWatchWallet = useCallback(() => {
    HapticFeedback.light();
    const newValue = !isWatchWalletExpanded;
    setIsWatchWalletExpanded(newValue);
    // Close other section if opening this one
    if (newValue) {
      setIsPSBTSectionExpanded(false);
    }
  }, [isWatchWalletExpanded]);
  const handleTogglePSBTSection = useCallback(() => {
    HapticFeedback.light();
    const newValue = !isPSBTSectionExpanded;
    setIsPSBTSectionExpanded(newValue);
    // Close other section if opening this one
    if (newValue) {
      setIsWatchWalletExpanded(false);
    }
  }, [isPSBTSectionExpanded]);
  const loadKeyshareInfo = useCallback(async () => {
    try {
      const keyshareJSON = await EncryptedStorage.getItem('keyshare');
      if (!keyshareJSON) {
        setKeyshareInfo(null);
        return;
      }
      const keyshare = JSON.parse(keyshareJSON);
      const pubKey = keyshare.pub_key || '';
      const chainCode = keyshare.chain_code_hex || '';
      // Generate output descriptors for all address types using utility function
      const descriptors = await generateAllOutputDescriptors(
        BBMTLibNativeModule,
        pubKey,
        chainCode,
        network,
        keyshare.created_at,
      );
      const outputDescriptors = {
        legacy: descriptors.legacy,
        segwitNative: descriptors.segwitNative,
        segwitCompatible: descriptors.segwitCompatible,
      };
      setKeyshareInfo({
        outputDescriptors,
      });
    } catch (error) {
      dbg('PSBTScreen: Error loading keyshare info:', error);
      setKeyshareInfo(null);
    }
  }, [network]);
  // Check for signedPsbt in route params and show modal
  useEffect(() => {
    const signedPsbtParam = route.params?.signedPsbt;
    if (signedPsbtParam) {
      setSignedPsbt(signedPsbtParam);
      setIsSignedPSBTModalVisible(true);
      // Clear the param to prevent showing again
      navigation.setParams({signedPsbt: undefined});
    }
  }, [route.params?.signedPsbt, navigation]);
  // Share helper for exporting text as a small file (descriptor)
  const shareTextAsFile = useCallback(
    async (text: string, filename: string, title: string) => {
      HapticFeedback.medium();
      try {
        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${filename}`;
        const fileExists = await RNFS.exists(filePath);
        if (fileExists) {
          await RNFS.unlink(filePath);
        }
        await RNFS.writeFile(filePath, text, 'utf8');
        await Share.open({
          title,
          message: title,
          url: `file://${filePath}`,
          type: 'text/plain',
          filename,
          isNewTask: true,
          failOnCancel: false,
        });
        try {
          await RNFS.unlink(filePath);
        } catch {}
      } catch (error: any) {
        if (error?.message !== 'User did not share') {
          Alert.alert('Error', 'Failed to share file');
        }
      }
    },
    [],
  );
  const handleCopyOutputDescriptor = useCallback(
    (type: 'legacy' | 'segwitNative' | 'segwitCompatible') => {
      const descriptor = keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      HapticFeedback.light();
      Clipboard.setString(descriptor);
      const typeLabel =
        type === 'legacy'
          ? 'Legacy'
          : type === 'segwitNative'
          ? 'Native SegWit'
          : 'Nested SegWit';
      Toast.show({
        type: 'success',
        text1: 'Copied',
        text2: `${typeLabel} output descriptor copied to clipboard`,
      });
    },
    [keyshareInfo],
  );
  const handleShareOutputDescriptor = useCallback(
    (type: 'legacy' | 'segwitNative' | 'segwitCompatible') => {
      const descriptor = keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      const now = new Date();
      const month = now.toLocaleDateString('en-US', {month: 'short'});
      const day = now.getDate().toString().padStart(2, '0');
      const year = now.getFullYear();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const typeLabel =
        type === 'legacy'
          ? 'legacy'
          : type === 'segwitNative'
          ? 'segwit-native'
          : 'segwit-compatible';
      const filename = `output-descriptor-${typeLabel}.${month}${day}.${year}.${hours}${minutes}.txt`;
      shareTextAsFile(descriptor, filename, 'Share Output Descriptor');
    },
    [keyshareInfo, shareTextAsFile],
  );
  const handleShowOutputDescriptorQR = useCallback(
    (type: 'legacy' | 'segwitNative' | 'segwitCompatible') => {
      const descriptor = keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      HapticFeedback.light();
      setSelectedDescriptorType(type);
      setIsOutputDescriptorQrVisible(true);
    },
    [keyshareInfo],
  );
  // Handle PSBT signing - same logic as WalletHome
  // Note: The actual signing functions extract derivation paths from PSBT's Bip32Derivation internally
  const handlePSBTSign = useCallback(
    async (psbtBase64: string, _derivePath?: string) => {
      // The actual PSBT signing will extract paths from PSBT's Bip32Derivation field
      // derivePath parameter is kept for API compatibility but not used
      // Check if keyshare supports Nostr (has nostr_npub)
      try {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (keyshareJSON) {
          const keyshare = JSON.parse(keyshareJSON);
          const hasNostrSupport =
            keyshare.nostr_npub && keyshare.nostr_npub.trim() !== '';
          if (!hasNostrSupport) {
            // Keyshare was generated with local mode, navigate directly to Devices Pairing
            navigation.dispatch(
              CommonActions.navigate({
                name: 'Devices Pairing',
                params: {
                  mode: 'sign_psbt',
                  addressType,
                  psbtBase64,
                },
              }),
            );
            return;
          }
        }
      } catch (error) {
        dbg('PSBTScreen: Error checking keyshare for Nostr support:', error);
        // Continue to show transport selector if check fails
      }
      // Store params and show transport selector
      setPendingPSBTParams({psbtBase64});
      setTimeout(() => {
        setIsPSBTTransportModalVisible(true);
      }, 300);
    },
    [addressType, navigation],
  );
  const navigateToPSBTSigning = useCallback(
    (transport: 'local' | 'nostr') => {
      if (!pendingPSBTParams) return;
      const {psbtBase64} = pendingPSBTParams;
      const routeName =
        transport === 'local' ? 'Devices Pairing' : 'Nostr Connect';
      // For PSBT signing, network is not strictly required (extracted from app state in MobilesPairing),
      // but we pass it for consistency. Derivation path is extracted from PSBT's Bip32Derivation.
      navigation.dispatch(
        CommonActions.navigate({
          name: routeName,
          params: {
            mode: 'sign_psbt',
            addressType,
            psbtBase64,
            network: network || 'mainnet', // Pass network for consistency (not strictly required for PSBT)
          },
        }),
      );
      setPendingPSBTParams(null);
    },
    [pendingPSBTParams, addressType, navigation, network],
  );
  useEffect(() => {
    loadKeyshareInfo();
  }, [loadKeyshareInfo]);
  // Fetch bitcoin price and initialize currency
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const currency = (await LocalCache.getItem('currency')) || 'USD';
        setSelectedCurrency(currency);
        const walletService = WalletService.getInstance();
        await walletService.initialize();
        const priceResponse = await walletService.getBitcoinPrice();
        if (priceResponse && priceResponse.rates) {
          setPriceData(priceResponse.rates);
          const r = priceResponse.rates[currency] || priceResponse.rate || 0;
          if (r && r > 0) {
            setBtcPrice(r.toString());
          }
        }
      } catch (error) {
        dbg('PSBTScreen: Error fetching price:', error);
      }
    };
    fetchPrice();
  }, []);
  const handleCurrencySelect = async (currency: {code: string}) => {
    setSelectedCurrency(currency.code);
    await LocalCache.setItem('currency', currency.code);
    if (priceData[currency.code]) {
      const formattedPrice = priceData[currency.code].toFixed(2);
      setBtcPrice(formattedPrice);
    }
  };
  // Handle section expansion based on PSBT mode toggle state
  useEffect(() => {
    const checkPSBTModeState = async () => {
      try {
        const isFirstVisit = await EncryptedStorage.getItem(
          'psbt_mode_first_visit',
        );
        if (isFirstVisit === 'true') {
          // First visit after toggle: both sections closed
          setIsWatchWalletExpanded(false);
          setIsPSBTSectionExpanded(false);
          // Clear the flag so subsequent visits use default behavior
          await EncryptedStorage.removeItem('psbt_mode_first_visit');
        } else {
          // Subsequent visits: Bold Connect closed, Sign PSBT open
          setIsWatchWalletExpanded(false);
          setIsPSBTSectionExpanded(true);
        }
      } catch (error) {
        dbg('PSBTScreen: Error checking PSBT mode state:', error);
        // Default behavior on error: Bold Connect closed, Sign PSBT open
        setIsWatchWalletExpanded(false);
        setIsPSBTSectionExpanded(true);
      }
    };
    checkPSBTModeState();
  }, []);
  return (
    <SafeAreaView style={styles.screenContainer} edges={['left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}>
        {keyshareInfo && (
          <View
            style={[
              styles.watchWalletCard,
              isWatchWalletExpanded && styles.watchWalletCardExpanded,
            ]}>
            <AppPressable
              style={styles.watchWalletHeaderRow}
              onPress={handleToggleWatchWallet}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Bold Wallet Connect section, ${
                isWatchWalletExpanded ? 'expanded' : 'collapsed'
              }`}
              accessibilityHint={`Double tap to ${
                isWatchWalletExpanded ? 'collapse' : 'expand'
              } Bold Connect section`}>
              <View style={styles.watchWalletHeaderContent}>
                <Image
                  source={require('../assets/descriptor-icon.png')}
                  style={styles.watchWalletIcon}
                  resizeMode="contain"
                />
                <Text style={styles.watchWalletTitle}>
                  Watch Wallet Export
                </Text>
              </View>
              <Animated.Text
                style={[
                  styles.watchWalletExpandIcon,
                  {
                    transform: [{rotate: rotateInterpolate}],
                    color: theme.colors.text,
                  },
                ]}>
                ▶
              </Animated.Text>
            </AppPressable>
            {/* Collapsible content - only rendered when expanded */}
            {isWatchWalletExpanded && (
              <View
                style={[
                  styles.watchWalletContent,
                  styles.watchWalletContentExpanded,
                ]}>
                <Text style={styles.watchWalletSubtitle}>
                  Bold acts as your multi-party Bitcoin signer. Create
                  transactions in a watch-only compatible wallet like Sparrow or
                  Electrum and sign them securely via PSBT.
                </Text>
                <Text style={styles.watchWalletWarning}>
                  ⚠️ Note: Taproot is not supported. Only Legacy, Native SegWit,
                  and Nested SegWit address types are supported.
                </Text>
                {/* Output Descriptors - One row per address type */}
                {keyshareInfo.outputDescriptors.legacy && (
                  <View
                    style={[
                      globalStyles.watchWalletItem,
                      !keyshareInfo.outputDescriptors.segwitNative &&
                        !keyshareInfo.outputDescriptors.segwitCompatible &&
                        globalStyles.watchWalletItemLast,
                    ]}>
                    <Text style={globalStyles.watchWalletItemLabel}>
                      Output Descriptor (Legacy)
                    </Text>
                    <View style={globalStyles.watchWalletItemValueContainer}>
                      <AppPressable
                        onPress={() => handleCopyOutputDescriptor('legacy')}
                        style={globalStyles.keyshareKeyContainerBadge}
                        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                        <Image
                          source={require('../assets/copy-icon.png')}
                          style={globalStyles.keyshareBadgeCopyIcon}
                        />
                        <Text
                          style={globalStyles.keyshareKeyTextClickable}
                          numberOfLines={1}>
                          {formatLongString(
                            keyshareInfo.outputDescriptors.legacy || 'N/A',
                          )}
                        </Text>
                      </AppPressable>
                      <View style={globalStyles.keyshareButtonsRow}>
                        <AppPressable
                          onPress={() => handleShareOutputDescriptor('legacy')}
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                        <AppPressable
                          onPress={() => handleShowOutputDescriptorQR('legacy')}
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                      </View>
                    </View>
                  </View>
                )}
                {keyshareInfo.outputDescriptors.segwitNative && (
                  <View
                    style={[
                      globalStyles.watchWalletItem,
                      !keyshareInfo.outputDescriptors.segwitCompatible &&
                        globalStyles.watchWalletItemLast,
                    ]}>
                    <Text style={globalStyles.watchWalletItemLabel}>
                      Output Descriptor (Native SegWit)
                    </Text>
                    <View style={globalStyles.watchWalletItemValueContainer}>
                      <AppPressable
                        onPress={() =>
                          handleCopyOutputDescriptor('segwitNative')
                        }
                        style={globalStyles.keyshareKeyContainerBadge}
                        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                        <Image
                          source={require('../assets/copy-icon.png')}
                          style={globalStyles.keyshareBadgeCopyIcon}
                        />
                        <Text
                          style={globalStyles.keyshareKeyTextClickable}
                          numberOfLines={1}>
                          {formatLongString(
                            keyshareInfo.outputDescriptors.segwitNative || 'N/A',
                          )}
                        </Text>
                      </AppPressable>
                      <View style={globalStyles.keyshareButtonsRow}>
                        <AppPressable
                          onPress={() =>
                            handleShareOutputDescriptor('segwitNative')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                        <AppPressable
                          onPress={() =>
                            handleShowOutputDescriptorQR('segwitNative')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                      </View>
                    </View>
                  </View>
                )}
                {keyshareInfo.outputDescriptors.segwitCompatible && (
                  <View style={globalStyles.watchWalletItem}>
                    <Text style={globalStyles.watchWalletItemLabel}>
                      Output Descriptor (Nested SegWit)
                    </Text>
                    <View style={globalStyles.watchWalletItemValueContainer}>
                      <AppPressable
                        onPress={() =>
                          handleCopyOutputDescriptor('segwitCompatible')
                        }
                        style={globalStyles.keyshareKeyContainerBadge}
                        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                        <Image
                          source={require('../assets/copy-icon.png')}
                          style={globalStyles.keyshareBadgeCopyIcon}
                        />
                        <Text
                          style={globalStyles.keyshareKeyTextClickable}
                          numberOfLines={1}>
                          {formatLongString(
                            keyshareInfo.outputDescriptors.segwitCompatible ||
                              'N/A',
                          )}
                        </Text>
                      </AppPressable>
                      <View style={globalStyles.keyshareButtonsRow}>
                        <AppPressable
                          onPress={() =>
                            handleShareOutputDescriptor('segwitCompatible')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                        <AppPressable
                          onPress={() =>
                            handleShowOutputDescriptorQR('segwitCompatible')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
        {/* Sign PSBT Section - Collapsible */}
        <View
          style={[
            styles.psbtSectionCard,
            isPSBTSectionExpanded && styles.psbtSectionCardExpanded,
          ]}>
          <AppPressable
            style={styles.psbtSectionHeaderRow}
            onPress={handleTogglePSBTSection}
            android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`Sign PSBT section, ${
              isPSBTSectionExpanded ? 'expanded' : 'collapsed'
            }`}
            accessibilityHint={`Double tap to ${
              isPSBTSectionExpanded ? 'collapse' : 'expand'
            } Sign PSBT section`}>
            <View style={styles.psbtSectionHeaderContent}>
              <Image
                source={require('../assets/cosign-icon.png')}
                style={styles.psbtSectionIcon}
                resizeMode="contain"
              />
              <Text style={styles.psbtSectionTitle}>
                Bold PSBT Signer
              </Text>
            </View>
            <Animated.Text
              style={[
                styles.psbtSectionExpandIcon,
                {
                  transform: [{rotate: psbtRotateInterpolate}],
                  color: theme.colors.text,
                },
              ]}>
              ▶
            </Animated.Text>
          </AppPressable>
          {/* Collapsible content - only rendered when expanded */}
          {isPSBTSectionExpanded && (
            <View style={styles.psbtSectionContent}>
              <View style={styles.psbtBodyContainer}>
                <PSBTLoader
                  onClose={() => {
                    // In PSBT screen, Cancel should only reset the loader state,
                    // not navigate away from this screen.
                  }}
                  disableCancelWhenEmpty={true}
                  useOverlay={false}
                  onSign={handlePSBTSign}
                />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
      <CurrencySelector
        visible={isCurrencySelectorVisible}
        onClose={() => setIsCurrencySelectorVisible(false)}
        onSelect={handleCurrencySelect}
        currentCurrency={selectedCurrency}
        availableCurrencies={priceData}
      />
      {/* QR Code Modals for watch-wallet import helpers */}
      <QRCodeModal
        visible={isOutputDescriptorQrVisible}
        onClose={() => {
          setIsOutputDescriptorQrVisible(false);
          setSelectedDescriptorType(null);
        }}
        title={`Wallet • Output Descriptor (${
          selectedDescriptorType === 'legacy'
            ? 'Legacy'
            : selectedDescriptorType === 'segwitNative'
            ? 'Native SegWit'
            : 'Nested SegWit'
        })`}
        value={
          selectedDescriptorType && keyshareInfo?.outputDescriptors
            ? keyshareInfo.outputDescriptors[selectedDescriptorType] || ''
            : ''
        }
        network={network as 'mainnet' | 'testnet'}
        showShareButton={true}
        topRightClose={true}
        nonDismissible={false}
      />
      {/* PSBT Transport Mode Selector */}
      <TransportModeSelector
        visible={isPSBTTransportModalVisible}
        onClose={() => {
          HapticFeedback.medium();
          setIsPSBTTransportModalVisible(false);
          setPendingPSBTParams(null);
        }}
        onSelect={(transport: 'local' | 'nostr') => {
          navigateToPSBTSigning(transport);
          setIsPSBTTransportModalVisible(false);
        }}
      />
      {/* Signed PSBT Modal */}
      {signedPsbt && (
        <SignedPSBTModal
          visible={isSignedPSBTModalVisible}
          signedPsbtBase64={signedPsbt}
          onClose={() => {
            HapticFeedback.medium();
            setIsSignedPSBTModalVisible(false);
            setSignedPsbt(null);
          }}
        />
      )}
    </SafeAreaView>
  );
};
const createStyles = (theme: any) =>
  StyleSheet.create({
    headerRightContainer: {
      paddingTop: 12,
      paddingBottom: 12,
      paddingRight: 16,
      paddingLeft: 8,
      justifyContent: 'center',
    },
    screenContainer: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 24,
      paddingTop: 12,
    },
    watchWalletCard: {
      marginBottom: 8,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    watchWalletCardExpanded: {
      // Additional styles when expanded if needed
    },
    watchWalletHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      backgroundColor: theme.colors.cardBackground,
    },
    watchWalletHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    watchWalletIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
      tintColor: theme.colors.text,
    },
    watchWalletTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    watchWalletSubtitle: {
      fontSize: theme.fontSizes?.base || 13,
      lineHeight: 18,
      color: theme.colors.textSecondary,
      marginBottom: 8,
    },
    watchWalletWarning: {
      fontSize: theme.fontSizes?.sm || 12,
      lineHeight: 16,
      color: theme.colors.textSecondary,
      fontStyle: 'italic',
    },
    watchWalletHint: {
      fontSize: theme.fontSizes?.sm || 12,
      lineHeight: 16,
      color: theme.colors.textSecondary,
      textDecorationLine: 'underline',
      marginTop: 12,
      marginBottom: 6,
    },
    watchWalletExpandIcon: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    watchWalletContent: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      borderTopWidth: 1,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent || theme.colors.primary
          : theme.colors.bitcoinOrange,
      overflow: 'hidden',
    },
    watchWalletContentExpanded: {
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    watchWalletDetailRow: {
      flexDirection: 'row',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border + '30',
      alignItems: 'center',
      marginBottom: 0,
    },
    watchWalletDetailLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
      width: 140,
      flexShrink: 0,
      marginRight: 12,
    },
    watchWalletValueContainer: {
      flex: 1,
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
    },
    watchWalletValueText: {
      flex: 1,
      flexShrink: 1,
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      minWidth: 0,
    },
    watchWalletButtonsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    watchWalletIconButton: {
      padding: 8,
      borderRadius: 6,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Subtle shadow for depth
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.15,
      shadowRadius: 2,
      elevation: 2,
    },
    watchWalletIconButtonIcon: {
      width: 16,
      height: 16,
      tintColor: theme.colors.textOnPrimary,
    },
    psbtSectionCard: {
      marginBottom: 8,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    psbtSectionCardExpanded: {
      // Additional styles when expanded if needed
    },
    psbtSectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      backgroundColor: theme.colors.cardBackground,
    },
    psbtSectionHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    psbtSectionIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
      tintColor: theme.colors.text,
    },
    psbtSectionTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    psbtSectionExpandIcon: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    psbtSectionContent: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      borderTopWidth: 1,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent || theme.colors.primary
          : theme.colors.bitcoinOrange,
      overflow: 'hidden',
    },
    psbtBodyContainer: {
      marginTop: 0,
      marginBottom: 8,
      padding: 12,
    },
  });
export default PSBTScreen;
