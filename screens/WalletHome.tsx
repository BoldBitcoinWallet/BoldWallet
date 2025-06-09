import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  NativeModules,
  Image,
  Alert,
  Platform,
  PermissionsAndroid,
  Modal,
} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import SendBitcoinModal from './SendBitcoinModal';
import Toast from 'react-native-toast-message';
import TransactionList from '../components/TransactionList';
import {CommonActions} from '@react-navigation/native';
import Big from 'big.js';
import ReceiveModal from './ReceiveModal';
import {
  capitalizeWords,
  dbg,
  shorten,
  presentFiat,
  getCurrencySymbol,
} from '../utils';
import {useTheme} from '../theme';
import {WalletService} from '../services/WalletService';
import WalletSkeleton from '../components/WalletSkeleton';
import {useWallet} from '../context/WalletContext';
import CurrencySelector from '../components/CurrencySelector';
import {createStyles} from '../components/Styles';
import {CacheIndicator, CacheTimestamp} from '../components/CacheIndicator';
import {HeaderRightButton, HeaderTitle} from '../components/Header';

const {BBMTLibNativeModule} = NativeModules;

const WalletHome: React.FC<{navigation: any}> = ({navigation}) => {
  const [address, setAddress] = useState<string>('');
  const [network, setNetwork] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [isSendModalVisible, setIsSendModalVisible] = useState<boolean>(false);
  const [btcPrice, setBtcPrice] = useState<string>('');
  const [btcRate, setBtcRate] = useState(0);
  const [balanceBTC, setBalanceBTC] = useState<string>('0.00000000');
  const [balanceFiat, setBalanceFiat] = useState<string>('0');
  const [apiBase, setApiBase] = useState<string>('');
  const [party, setParty] = useState<string>('');
  const [isBlurred, setIsBlurred] = useState<boolean>(true);
  const [isReceiveModalVisible, setIsReceiveModalVisible] = useState(false);
  const [_pendingSent, _setPendingSent] = useState(0);
  const [addressType, setAddressType] = React.useState('');
  const [isAddressTypeModalVisible, setIsAddressTypeModalVisible] =
    React.useState(false);
  const [legacyAddress, setLegacyAddress] = React.useState('');
  const [segwitAddress, setSegwitAddress] = React.useState('');
  const [segwitCompatibleAddress, setSegwitCompatibleAddress] =
    React.useState('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [_error, setError] = useState<string>('');
  const [cacheTimestamps, setCacheTimestamps] = useState<CacheTimestamp>({
    price: 0,
    balance: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCurrencySelectorVisible, setIsCurrencySelectorVisible] =
    useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [priceData, setPriceData] = useState<{[key: string]: number}>({});

  const {theme} = useTheme();
  const styles = createStyles(theme);
  const wallet = useWallet();

  const showErrorToast = useCallback((message: string) => {
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: message,
      position: 'top',
    });
  }, []);

  const headerRight = React.useCallback(
    () => <HeaderRightButton navigation={navigation} />,
    [navigation],
  );

  const networkEmoji = () => (network === 'mainnet' ? '🌐' : '🔨');

  const headerTitle = React.useCallback(() => <HeaderTitle />, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight,
      headerTitle,
    });
  }, [navigation, headerRight, headerTitle]);

  useEffect(() => {
    navigation.setOptions({
      headerRight,
    });
  }, [navigation, headerRight]);

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'This app needs access to your camera for QR Scanning',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.warn(err);
        return false;
      }
    } else {
      return true;
    }
  };

  useEffect(() => {
    const checkPermission = async () => {
      const hasPermission = await requestCameraPermission();
      if (!hasPermission) {
        Alert.alert(
          'Camera Permission Denied',
          'You need to grant camera permissions to use this feature.',
        );
      }
    };
    checkPermission();
  }, []);

  useEffect(() => {
    EncryptedStorage.getItem('addressType').then(addrType => {
      setAddressType(addrType || 'legacy');
    });
  });

  const handleTransactionUpdate = useCallback(
    async (pendingTxs: any[], pending: number) => {
      _setPendingSent(pending);
      return Promise.resolve();
    },
    [],
  );

  const fetchData = useCallback(
    async () => {
      try {
        if (!isInitialized) {
          dbg('WalletHome: Skipping fetch - not initialized');
          return;
        }

        const addr = await EncryptedStorage.getItem('currentAddress');
        const baseApi = await EncryptedStorage.getItem('api');
        const currency = await EncryptedStorage.getItem('currency') || 'USD';

        if (!addr || !baseApi) {
          dbg('WalletHome: Missing wallet address or baseApi');
          setLoading(false);
          setIsRefreshing(false);
          return;
        }

        // Set up API URL
        const cleanBaseApi = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
        const apiUrl = `${cleanBaseApi}/api`;

        // Ensure native module has correct settings
        await BBMTLibNativeModule.setAPI(network, apiUrl);
        if (apiUrl) {
          setApiBase(apiUrl);
        }

        // Set up timeout for API calls
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('API refresh timed out'));
          }, 5000); // 5 second timeout
        });

        let freshData;
        try {
          freshData = await Promise.race([
            Promise.all([
              WalletService.getInstance().getBitcoinPrice(),
              WalletService.getInstance().getWalletBalance(
                addr,
                btcRate,
                _pendingSent,
                true,
              ),
            ]),
            timeoutPromise,
          ]);

          if (Array.isArray(freshData) && freshData.length === 2) {
            const [freshPrice, freshBalance] = freshData;
            const rates = freshPrice.rates || {};
            setPriceData(rates);
            setBtcPrice((rates[currency] !== undefined && rates[currency] !== null) ? rates[currency].toString() : '-');
            setBtcRate(rates[currency] || 0);
            setBalanceBTC(freshBalance.btc !== null && freshBalance.btc !== undefined ? freshBalance.btc : '0.00000000');
            const fiatBalance =
              Number(freshBalance.btc) * (rates[currency] || 0);
            setBalanceFiat(fiatBalance.toFixed(2));
          }

          // Update cache timestamps with fresh data
          setCacheTimestamps({
            price: WalletService.getInstance().getLastPriceFetch(),
            balance: WalletService.getInstance().getLastBalanceFetch(),
          });
        } catch (error) {
          dbg('WalletHome: Error fetching fresh data:', error);
          showErrorToast('Failed to refresh data');
        }

        // Fall back to cached data only if fresh data fetch failed
        if (!freshData) {
          const cachedPricePromise = WalletService.getInstance().getBitcoinPrice();
          const cachedBalancePromise = WalletService.getInstance().getWalletBalance(
            addr,
            btcRate,
            _pendingSent,
          );
          const cachedResults = await Promise.all([cachedPricePromise, cachedBalancePromise]);
          const cachedPrice = cachedResults[0];
          const cachedBalance = cachedResults[1];
          if (cachedPrice && cachedBalance) {
            const rates = cachedPrice.rates || {};
            setPriceData(rates);
            setBtcPrice((rates[currency] !== undefined && rates[currency] !== null) ? rates[currency].toString() : '-');
            setBtcRate(rates[currency] || 0);
            setBalanceBTC(cachedBalance.btc !== null && cachedBalance.btc !== undefined ? cachedBalance.btc : '0.00000000');
            const fiatBalance =
              Number(cachedBalance.btc) * (rates[currency] || 0);
            setBalanceFiat(fiatBalance.toFixed(2));
          }

          // Keep original cache timestamps when using cached data
          setCacheTimestamps({
            price: WalletService.getInstance().getLastPriceFetch(),
            balance: WalletService.getInstance().getLastBalanceFetch(),
          });
        }
      } catch (error) {
        dbg('WalletHome: Error fetching data:', error);
        let errMsg = 'Unknown error';
        if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
          errMsg = (error as any).message || 'Unknown error';
        }
        setError(errMsg);
        showErrorToast('Failed to fetch data');
        // Reset to empty state if no cache available
        if (!btcPrice || typeof btcPrice !== 'string' || !balanceBTC || typeof balanceBTC !== 'string') {
          setBtcPrice('');
          setBtcRate(0);
          setBalanceBTC('0.00000000');
          setBalanceFiat('');
        }
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [
      btcRate,
      _pendingSent,
      showErrorToast,
      isInitialized,
      btcPrice,
      balanceBTC,
      network,
    ],
  );

  const handleCurrencySelect = async (currency: {code: string}) => {
    setSelectedCurrency(currency.code);
    await EncryptedStorage.setItem('currency', currency.code);
    if (priceData[currency.code]) {
      const formattedPrice = priceData[currency.code].toFixed(2);
      setBtcPrice(formattedPrice);
      setBtcRate(priceData[currency.code]);
      // Update fiat balance with new currency rate
      if (balanceBTC) {
        const newBalance = Number(balanceBTC) * priceData[currency.code];
        setBalanceFiat(newBalance.toFixed(2));
      }
    }
  };

  // Add effect to initialize app
  useEffect(() => {
    const init = async () => {
      if (isInitialized) {
        return;
      }

      try {
        setLoading(true);
        const jks = await EncryptedStorage.getItem('keyshare');
        if (!jks) {
          dbg('WalletHome: No keyshare found during initialization');
          setLoading(false);
          setIsInitialized(true);
          return;
        }

        // Initialize WalletService only after confirming we have a keyshare
        const walletService = WalletService.getInstance();
        await walletService.initialize();

        const ks = JSON.parse(jks);
        const path = "m/44'/0'/0'/0/0";
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );

        // Set default network if not set
        let net = await EncryptedStorage.getItem('network');
        if (!net) {
          net = 'mainnet';
          await EncryptedStorage.setItem('network', net);
          dbg('WalletHome: Setting default network to mainnet');
        }

        // Set default address type if not set
        let addrType = await EncryptedStorage.getItem('addressType');
        if (!addrType) {
          addrType = 'legacy';
          await EncryptedStorage.setItem('addressType', addrType);
          dbg('WalletHome: Setting default address type to legacy');
        }

        // Set default currency if not set
        let currency = await EncryptedStorage.getItem('currency');
        if (!currency) {
          currency = 'USD';
          await EncryptedStorage.setItem('currency', currency);
          dbg('WalletHome: Setting default currency to USD');
        }

        const netParams = await BBMTLibNativeModule.setBtcNetwork(net);
        net = netParams.split('@')[0];

        // Generate all address types
        const legacyAddr = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          'legacy',
        );
        const segwitAddr = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          'segwit-native',
        );
        const segwitCompAddr = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          'segwit-compatible',
        );

        // Store all addresses
        await EncryptedStorage.setItem('legacyAddress', legacyAddr);
        await EncryptedStorage.setItem('segwitAddress', segwitAddr);
        await EncryptedStorage.setItem('segwitCompatibleAddress', segwitCompAddr);

        setLegacyAddress(legacyAddr);
        setSegwitAddress(segwitAddr);
        setSegwitCompatibleAddress(segwitCompAddr);
        setParty(ks.local_party_key);

        // Get current address type and generate address
        const currentAddressType = addrType;
        setAddressType(currentAddressType);

        // Generate and store current address
        const btcAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          currentAddressType,
        );
        await EncryptedStorage.setItem('currentAddress', btcAddress);
        setAddress(btcAddress);
        setNetwork(net);

        // Set up API URL
        let base = netParams.split('@')[1];
        if (!base.endsWith('/')) {
          base = `${base}/`;
        }
        let api = await EncryptedStorage.getItem('api');
        if (api) {
          if (api.endsWith('/')) {
            api = api.substring(0, api.length - 1);
          }
          BBMTLibNativeModule.setAPI(net, api);
          setApiBase(api);
        } else {
          await EncryptedStorage.setItem('api', base);
          setApiBase(base);
        }

        // Initialize cache timestamps
        setCacheTimestamps({
          price: Date.now(),
          balance: Date.now(),
        });

        setIsInitialized(true);
        // Force initial balance fetch
        await fetchData();
      } catch (error) {
        dbg('Error initializing wallet:', error);
        showErrorToast('Failed to initialize wallet. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [fetchData, showErrorToast, isInitialized]);

  const handleAddressTypeChange = async (type: string) => {
    try {
      dbg('WalletHome: Starting address type change to:', type);
      setIsAddressTypeModalVisible(false);

      // Update storage and local state
      await EncryptedStorage.setItem('addressType', type);
      setAddressType(type);

      // Generate new address
      const jks = await EncryptedStorage.getItem('keyshare');
      const ks = JSON.parse(jks || '{}');
      const path = "m/44'/0'/0'/0/0";
      const btcPub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );

      const currentNetwork =
        (await EncryptedStorage.getItem('network')) || 'mainnet';
      const newAddress = await BBMTLibNativeModule.btcAddress(
        btcPub,
        currentNetwork,
        type,
      );

      // Save new address and clear caches
      await EncryptedStorage.setItem('currentAddress', newAddress);
      setAddress(newAddress);
      await WalletService.getInstance().clearCache();

      // Refresh wallet and data
      await wallet.refreshWallet();
      await fetchData();
    } catch (error) {
      dbg('WalletHome: Error changing address type:', error);
      showErrorToast('Failed to change address type. Please try again.');
    }
  };

  // Remove the old interval effect since we're handling it in CacheIndicator now
  useEffect(() => {
    if (!isInitialized || !address) {
      return;
    }

    // Initial data fetch
    fetchData();
  }, [isInitialized, address, fetchData]);

  const handleBlurred = () => {
    const blurr = !isBlurred;
    setIsBlurred(blurr);
    EncryptedStorage.setItem('mode', blurr ? 'private' : '');
  };

  const handleSend = async (to: string, amountSats: Big, feeSats: Big) => {
    if (amountSats.gt(0) && feeSats.gt(0) && to) {
      const toAddress = to;
      const satoshiAmount = amountSats.toString().split('.')[0];
      const fiatAmount = amountSats.times(btcRate).div(1e8).toFixed(2);
      const satoshiFees = feeSats.toString().split('.')[0];
      const fiatFees = feeSats.times(btcRate).div(1e8).toFixed(2);
      navigation.dispatch(
        CommonActions.navigate({
          name: '📱📱 Pairing',
          params: {
            mode: 'send_btc',
            addressType,
            toAddress,
            satoshiAmount,
            fiatAmount,
            satoshiFees,
            fiatFees,
            selectedCurrency,
          },
        }),
      );
      setIsSendModalVisible(false);
    }
  };

  const getAddressTypeIcon = () => {
    switch (addressType) {
      case 'legacy':
        return require('../assets/bricks-icon.png');
      case 'segwit-native':
        return require('../assets/dna-icon.png');
      case 'segwit-compatible':
        return require('../assets/recycle-icon.png');
      default:
        return require('../assets/bricks-icon.png');
    }
  };

  if (loading && !isInitialized) {
    return <WalletSkeleton />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.contentContainer}>
        <View style={styles.walletHeader}>
          <View style={styles.headerTop}>
            <Image
              source={require('../assets/bitcoin-logo.png')}
              style={styles.btcLogo}
            />
            <TouchableOpacity
              style={styles.priceContainer}
              onPress={() => setIsCurrencySelectorVisible(true)}>
              <Text style={styles.btcPrice}>
                {btcPrice ? presentFiat(btcPrice) : '-'}
              </Text>
              <Text style={styles.currencyBadge}>{selectedCurrency}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.balanceContainer}>
            <TouchableOpacity
              style={[styles.balanceRowWithMargin]}
              onPress={handleBlurred}
              activeOpacity={0.7}>
              <Text
                style={[styles.balanceBTC, isBlurred && styles.blurredText]}>
                {isBlurred
                  ? '* * * * * *'
                  : `${balanceBTC || '0.00000000'} BTC`}
              </Text>
              <Image
                source={
                  isBlurred
                    ? require('../assets/eye-off-icon.png')
                    : require('../assets/eye-on-icon.png')
                }
                style={styles.balanceIcon}
                resizeMode="contain"
              />
            </TouchableOpacity>
            {btcRate > 0 && (
              <TouchableOpacity
                style={[styles.balanceRowWithMargin]}
                onPress={handleBlurred}
                activeOpacity={0.7}>
                <Text
                  style={[styles.balanceFiat, isBlurred && styles.blurredText]}>
                  {isBlurred
                    ? '* * *'
                    : `${getCurrencySymbol(selectedCurrency)}${presentFiat(
                        balanceFiat,
                      )}`}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={styles.balanceHint}>
              {isBlurred ? 'Tap to reveal balance' : 'Tap to hide balance'}
            </Text>
          </View>
          <View style={styles.partyContainer}>
            <View style={styles.partyLeft}>
              <Text style={styles.partyLabel}>Keyshare Party</Text>
              <Text
                style={styles.partyValue}
                numberOfLines={1}
                adjustsFontSizeToFit>
                🗝 {capitalizeWords(party)}
              </Text>
            </View>
            <View style={styles.partyCenter}>
              <Text style={styles.partyLabel}>Network</Text>
              <Text
                style={styles.partyValue}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {networkEmoji()} {capitalizeWords(network)}
              </Text>
            </View>
            <View style={styles.partyRight}>
              <Text style={styles.partyLabel}>Address Type</Text>
              <View style={styles.addressTypeContainer}>
                <Image
                  source={getAddressTypeIcon()}
                  style={styles.addressTypeIcon}
                  resizeMode="contain"
                />
                <Text
                  style={styles.partyValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit>
                  {addressType === 'segwit-compatible'
                    ? 'Segwit Compatible'
                    : addressType === 'segwit-native'
                    ? 'Segwit Native'
                    : 'Legacy'}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.sendButton]}
              onPress={() => setIsSendModalVisible(true)}>
              <Image
                source={require('../assets/send-icon.png')}
                style={styles.actionButtonIcon}
                resizeMode="contain"
              />
              <Text style={styles.actionButtonText}>Send</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.addressTypeModalButton]}
              onPress={() => setIsAddressTypeModalVisible(true)}>
              <Image
                source={getAddressTypeIcon()}
                style={styles.addressTypeButtonIcon}
                resizeMode="contain"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.receiveButton]}
              onPress={() => setIsReceiveModalVisible(true)}>
              <Image
                source={require('../assets/receive-icon.png')}
                style={styles.actionButtonIcon}
                resizeMode="contain"
              />
              <Text style={styles.actionButtonText}>Receive</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <CacheIndicator
        timestamps={cacheTimestamps}
        onRefresh={() => fetchData()}
        theme={theme}
        isRefreshing={isRefreshing}
      />
      <View style={styles.transactionListContainer}>
        <TransactionList
          baseApi={apiBase}
          address={address}
          onUpdate={handleTransactionUpdate}
          selectedCurrency={selectedCurrency}
          btcRate={btcRate}
          getCurrencySymbol={getCurrencySymbol}
        />
      </View>
      <Modal
        visible={isAddressTypeModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsAddressTypeModalVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setIsAddressTypeModalVisible(false)}
          activeOpacity={1}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Address Type</Text>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'legacy' && styles.addressTypeButtonSelected,
              ]}
              onPress={() => handleAddressTypeChange('legacy')}>
              <Image
                source={require('../assets/bricks-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>Legacy Address</Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(legacyAddress)}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-native' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => handleAddressTypeChange('segwit-native')}>
              <Image
                source={require('../assets/dna-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>
                  Segwit Native Address
                </Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(segwitAddress)}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-compatible' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => handleAddressTypeChange('segwit-compatible')}>
              <Image
                source={require('../assets/recycle-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>
                  Segwit Compatible Address
                </Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(segwitCompatibleAddress)}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      <CurrencySelector
        visible={isCurrencySelectorVisible}
        onClose={() => setIsCurrencySelectorVisible(false)}
        onSelect={handleCurrencySelect}
        currentCurrency={selectedCurrency}
      />
      <Toast />
      {isSendModalVisible && (
        <SendBitcoinModal
          visible={isSendModalVisible}
          btcToFiatRate={Big(btcRate)}
          walletBalance={Big(balanceBTC)}
          walletAddress={address}
          onClose={() => setIsSendModalVisible(false)}
          onSend={handleSend}
          selectedCurrency={selectedCurrency}
        />
      )}

      {isReceiveModalVisible && (
        <ReceiveModal
          address={address}
          addressType={addressType}
          baseApi={apiBase}
          network={network}
          onClose={() => setIsReceiveModalVisible(false)}
        />
      )}
    </SafeAreaView>
  );
};

export default WalletHome;
