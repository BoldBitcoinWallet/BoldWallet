import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  NativeModules,
  Image,
  Alert,
  Platform,
  PermissionsAndroid,
  Modal,
  Animated,
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
import {useTheme, themes} from '../theme';
import {WalletService} from '../services/WalletService';
import WalletSkeleton from '../components/WalletSkeleton';
import {useWallet} from '../context/WalletContext';
import CurrencySelector from '../components/CurrencySelector';

const {BBMTLibNativeModule} = NativeModules;

const headerStyles = StyleSheet.create({
  actionButton: {
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: themes.lightPolished.colors.cardBackground,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 40,
    height: 40,
    resizeMode: 'contain',
    marginRight: 8,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});

const HeaderRightButton = ({navigation}: {navigation: any}) => (
  <TouchableOpacity
    style={[headerStyles.actionButton, headerStyles.settingsButton]}
    onPress={() => navigation.navigate('Settings')}>
    <Text>⚙️</Text>
  </TouchableOpacity>
);

const HeaderTitle = React.memo(() => (
  <View style={headerStyles.headerTitleContainer}>
    <Image
      source={require('../assets/icon.png')}
      style={headerStyles.headerLogo}
    />
    <Text style={headerStyles.headerTitleText}>Bold Home</Text>
  </View>
));

interface CacheTimestamp {
  price: number;
  balance: number;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: themes.lightPolished.colors.background,
  },
  contentContainer: {
    paddingTop: 16,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 0,
  },
  walletHeader: {
    padding: 16,
    backgroundColor: themes.lightPolished.colors.primary,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 0,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  btcLogo: {
    width: 40,
    height: 40,
    resizeMode: 'contain',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  btcPrice: {
    fontSize: 16,
    fontWeight: '500',
    color: themes.lightPolished.colors.white,
    marginRight: 6,
  },
  currencyBadge: {
    fontSize: 13,
    fontWeight: '500',
    color: themes.lightPolished.colors.white,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  balanceBTC: {
    fontSize: 24,
    fontWeight: 'bold',
    color: themes.lightPolished.colors.white,
    marginTop: 16,
    marginBottom: 4,
  },
  balanceFiat: {
    fontSize: 16,
    color: themes.lightPolished.colors.background,
    marginBottom: 16,
  },
  qrContainer: {
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  address: {
    fontSize: 14,
    color: themes.lightPolished.colors.textOnPrimary,
    marginTop: 8,
    textAlign: 'center',
    fontWeight: '600',
  },
  partyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 8,
    marginTop: 8,
  },
  partyLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  partyCenter: {
    flex: 1,
    alignItems: 'center',
  },
  partyRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  party: {
    fontSize: 12,
    color: themes.lightPolished.colors.textOnPrimary,
    fontWeight: '500',
  },
  partyText: {
    fontSize: 12,
    color: themes.lightPolished.colors.textOnPrimary,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    width: '100%',
  },
  actionButton: {
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  sendButton: {
    flex: 1,
    backgroundColor: themes.lightPolished.colors.accent,
  },
  settingsButton: {
    width: 50,
    backgroundColor: themes.lightPolished.colors.accent,
  },
  addressTypeModalButton: {
    width: 50,
    backgroundColor: themes.lightPolished.colors.cardBackground,
  },
  receiveButton: {
    flex: 1,
    backgroundColor: themes.lightPolished.colors.secondary,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  modalContent: {
    backgroundColor: themes.lightPolished.colors.background,
    borderRadius: 12,
    padding: 20,
    width: '80%',
    alignItems: 'center',
  },
  modalText: {
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center',
    color: themes.lightPolished.colors.text,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  blurredText: {
    opacity: 0.6,
  },
  addressTypeButton: {
    backgroundColor: themes.lightPolished.colors.cardBackground,
    padding: 16,
    borderRadius: 8,
    marginVertical: 8,
    width: '100%',
    borderWidth: 1,
    borderColor: themes.lightPolished.colors.border,
  },
  addressTypeButtonSelected: {
    borderColor: themes.lightPolished.colors.accent,
    borderWidth: 2,
  },
  addressTypeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
    marginBottom: 4,
  },
  addressTypeValue: {
    marginTop: 4,
    fontSize: 12,
    color: themes.lightPolished.colors.textSecondary,
    textAlign: 'left',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: themes.lightPolished.colors.text,
    marginBottom: 16,
  },
  scrollView: {
    flex: 1,
  },
  cacheIndicator: {
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  cacheText: {
    fontSize: 14,
    marginBottom: 0,
    marginTop: 0,
    textAlign: 'right',
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'left',
  },
  shimmerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    transform: [{translateX: -100}],
  },
  disabled: {
    opacity: 0.7,
  },
  transactionListContainer: {
    flex: 1,
    marginBottom: 0,
  },
});

const CacheIndicator: React.FC<{
  timestamps: CacheTimestamp;
  onRefresh: () => void;
  theme: any;
  isRefreshing?: boolean;
}> = ({timestamps, onRefresh, theme, isRefreshing = false}) => {
  const latestTimestamp = Math.max(timestamps.price, timestamps.balance);
  const shimmerValue = useRef(new Animated.Value(-100)).current;
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isUsingCache, setIsUsingCache] = useState(false);

  useEffect(() => {
    if (isRefreshing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerValue, {
            toValue: 100,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(shimmerValue, {
            toValue: -100,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      shimmerValue.setValue(-100);
    }
  }, [isRefreshing, shimmerValue]);

  // Update current time based on time difference
  useEffect(() => {
    const timeDiff = currentTime - latestTimestamp;
    const interval = timeDiff < 60000 ? 1000 : 60000; // 1 second if < 1 minute, else 1 minute

    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, interval);

    return () => clearInterval(timer);
  }, [latestTimestamp, currentTime]);

  // Check if we're using cache
  useEffect(() => {
    const timeDiff = Date.now() - latestTimestamp;
    const isCache = timeDiff > 60000; // More than 1 minute old
    setIsUsingCache(isCache);
  }, [latestTimestamp]);

  if (latestTimestamp === 0) {
    return null;
  }

  const getTimeAgo = (timestamp: number) => {
    const diffInSeconds = Math.floor((currentTime - timestamp) / 1000);

    // Handle edge cases
    if (diffInSeconds < 0) {
      return 'Just updated';
    }

    // Less than 10 seconds
    if (diffInSeconds < 10) {
      return 'Just updated';
    }

    // Less than a minute
    if (diffInSeconds < 60) {
      return `${diffInSeconds} seconds ago`;
    }

    // Less than an hour
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
      return `${diffInMinutes} ${
        diffInMinutes === 1 ? 'minute' : 'minutes'
      } ago`;
    }

    // Less than a day
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      const remainingMinutes = diffInMinutes % 60;
      if (remainingMinutes === 0) {
        return `${diffInHours} ${diffInHours === 1 ? 'hour' : 'hours'} ago`;
      }
      return `${diffInHours} ${
        diffInHours === 1 ? 'hour' : 'hours'
      } ${remainingMinutes} ${
        remainingMinutes === 1 ? 'minute' : 'minutes'
      } ago`;
    }

    // Less than a week
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) {
      return `${diffInDays} ${diffInDays === 1 ? 'day' : 'days'} ago`;
    }

    // Less than a month
    const diffInWeeks = Math.floor(diffInDays / 7);
    if (diffInWeeks < 4) {
      return `${diffInWeeks} ${diffInWeeks === 1 ? 'week' : 'weeks'} ago`;
    }

    // Less than a year
    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
      return `${diffInMonths} ${diffInMonths === 1 ? 'month' : 'months'} ago`;
    }

    // Years
    const diffInYears = Math.floor(diffInDays / 365);
    return `${diffInYears} ${diffInYears === 1 ? 'year' : 'years'} ago`;
  };

  const timeAgo = getTimeAgo(latestTimestamp);

  return (
    <TouchableOpacity
      style={[
        styles.cacheIndicator,
        {backgroundColor: theme.colors.cardBackground},
        isRefreshing && styles.disabled,
      ]}
      onPress={onRefresh}
      disabled={isRefreshing}>
      {isRefreshing && (
        <View style={styles.shimmerContainer}>
          <Animated.View
            style={[
              styles.shimmer,
              {
                transform: [{translateX: shimmerValue}],
              },
            ]}
          />
        </View>
      )}
      <Text style={[styles.refreshText, {color: theme.colors.accent}]}>
        {isRefreshing
          ? '🔄 Refreshing...'
          : isUsingCache
          ? '🔄 Tap to refresh data'
          : '🔄 Tap to refresh'}
      </Text>
      {!isRefreshing && (
        <Text style={[styles.cacheText, {color: theme.colors.textSecondary}]}>
          {isUsingCache ? (
            <>📱 Cached • {new Date(latestTimestamp).toLocaleTimeString()}</>
          ) : (
            <>{timeAgo} ⏰</>
          )}
        </Text>
      )}
    </TouchableOpacity>
  );
};

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
  const [_error, setError] = useState<string | null>(null);
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
  const walletService = WalletService.getInstance();
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

  const addressEmoji = () =>
    addressType === 'legacy'
      ? '🧱'
      : addressType === 'segwit-native'
      ? '🧬'
      : '♻️';

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

  const fetchData = useCallback(
    async (_force = false) => {
      try {
        // Only show loading state on initial load
        if (!isInitialized) {
          setLoading(true);
        }
        setError(null);
        setIsRefreshing(true);

        // Get current state from storage
        const net = (await EncryptedStorage.getItem('network')) || 'mainnet';
        const addrType =
          (await EncryptedStorage.getItem('addressType')) || 'legacy';
        const addr = await EncryptedStorage.getItem('currentAddress');
        const currency = (await EncryptedStorage.getItem('currency')) || 'USD';
        setSelectedCurrency(currency);

        if (!addr || !wallet?.baseApi) {
          dbg('WalletHome: Missing wallet address or baseApi');
          setLoading(false);
          return;
        }

        dbg('WalletHome: Fetching data for address:', addr);
        dbg('WalletHome: Current network:', net);
        dbg('WalletHome: Current address type:', addrType);

        // Validate address format based on network
        if (net === 'mainnet') {
          if (
            !addr.startsWith('1') &&
            !addr.startsWith('3') &&
            !addr.startsWith('bc1')
          ) {
            dbg('WalletHome: Invalid mainnet address format:', addr);
            throw new Error('Invalid mainnet address format');
          }
        } else if (net === 'testnet3') {
          if (
            !addr.startsWith('m') &&
            !addr.startsWith('n') &&
            !addr.startsWith('2') &&
            !addr.startsWith('tb1')
          ) {
            dbg('WalletHome: Invalid testnet address format:', addr);
            throw new Error('Invalid testnet address format');
          }
        }

        // Try to fetch fresh data first with timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('API refresh timed out'));
          }, 5000); // 5 second timeout
        });

        let freshData = null;
        try {
          freshData = await Promise.race([
            Promise.all([
              walletService.getBitcoinPrice(),
              walletService.getWalletBalance(addr, btcRate, _pendingSent, true),
            ]),
            timeoutPromise,
          ]);
        } catch (error) {
          dbg('WalletHome: Error fetching fresh data:', error);
          showErrorToast('Failed to refresh data');
        }

        // If we got fresh data, use it
        if (freshData) {
          const [freshPrice, freshBalance] = freshData;
          setPriceData(freshPrice.rates || {});
          setBtcPrice(freshPrice.rates?.[currency]?.toString() || '-');
          setBtcRate(freshPrice.rates?.[currency] || 0);
          setBalanceBTC(freshBalance.btc);
          // Calculate fiat balance using the new rate
          const fiatBalance =
            Number(freshBalance.btc) * (freshPrice.rates?.[currency] || 0);
          setBalanceFiat(fiatBalance.toFixed(2));

          // Update cache timestamps with fresh data
          setCacheTimestamps({
            price: walletService.getLastPriceFetch(),
            balance: walletService.getLastBalanceFetch(),
          });
        } else {
          // Fall back to cached data only if fresh data fetch failed
          const [cachedPrice, cachedBalance] = await Promise.all([
            walletService.getBitcoinPrice(),
            walletService.getWalletBalance(addr, btcRate, _pendingSent),
          ]);

          // Update UI with cached data
          setPriceData(cachedPrice.rates || {});
          setBtcPrice(cachedPrice.rates?.[currency]?.toString() || '-');
          setBtcRate(cachedPrice.rates?.[currency] || 0);
          setBalanceBTC(cachedBalance.btc);
          // Calculate fiat balance using the cached rate
          const fiatBalance =
            Number(cachedBalance.btc) * (cachedPrice.rates?.[currency] || 0);
          setBalanceFiat(fiatBalance.toFixed(2));

          // Keep original cache timestamps when using cached data
          setCacheTimestamps({
            price: walletService.getLastPriceFetch(),
            balance: walletService.getLastBalanceFetch(),
          });
        }
      } catch (error) {
        dbg('WalletHome: Error fetching data:', error);
        setError(error instanceof Error ? error.message : 'Unknown error');
        showErrorToast('Failed to fetch data');
        // Reset to empty state if no cache available
        if (!btcPrice || !balanceBTC) {
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
      wallet?.baseApi,
      btcRate,
      _pendingSent,
      showErrorToast,
      walletService,
      isInitialized,
      btcPrice,
      balanceBTC,
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

  const handleRefresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  // Add effect to initialize app
  useEffect(() => {
    const init = async () => {
      if (isInitialized) {
        return;
      }

      try {
        setLoading(true);
        const jks = await EncryptedStorage.getItem('keyshare');
        const ks = JSON.parse(jks || '{}');
        const path = "m/44'/0'/0'/0/0";
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );

        let net = await EncryptedStorage.getItem('network');
        if (!net) {
          net = 'mainnet';
          await EncryptedStorage.setItem('network', net);
        }

        const netParams = await BBMTLibNativeModule.setBtcNetwork(net);
        net = netParams.split('@')[0];

        // Generate addresses
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

        setLegacyAddress(legacyAddr);
        setSegwitAddress(segwitAddr);
        setSegwitCompatibleAddress(segwitCompAddr);
        setParty(ks.local_party_key);

        // Get current address type
        const currentAddressType =
          (await EncryptedStorage.getItem('addressType')) || 'legacy';
        setAddressType(currentAddressType);

        // Generate address based on current type
        const btcAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          currentAddressType,
        );

        setAddress(btcAddress);
        setNetwork(net || 'mainnet');

        // Override APIs if set
        let base = netParams.split('@')[1];
        // Ensure base URL ends with a slash
        if (!base.endsWith('/')) {
          base = `${base}/`;
        }
        let api = await EncryptedStorage.getItem('api');
        if (api) {
          // Ensure API URL ends with a slash
          if (api.endsWith('/')) {
            api = api.substring(0, api.length - 1);
          }
          BBMTLibNativeModule.setAPI(net, api);
          setApiBase(api);
        } else {
          await EncryptedStorage.setItem('api', base);
          setApiBase(base);
        }

        setIsInitialized(true);
        // Force initial balance fetch
        await fetchData(true);
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
      await walletService.clearCache();

      // Refresh wallet and data
      await wallet.refreshWallet();
      await fetchData(true);
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
    fetchData(true);
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
      const usdAmount = amountSats.times(btcRate).div(1e8).toFixed(2);
      const satoshiFees = feeSats.toString().split('.')[0];
      const usdFees = feeSats.times(btcRate).div(1e8).toFixed(2);
      navigation.dispatch(
        CommonActions.navigate({
          name: '📱📱 Pairing',
          params: {
            mode: 'send_btc',
            addressType,
            toAddress,
            satoshiAmount,
            usdAmount,
            satoshiFees,
            usdFees,
          },
        }),
      );
      setIsSendModalVisible(false);
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
          <TouchableOpacity onPress={handleBlurred}>
            <Text style={[styles.balanceBTC, isBlurred && styles.blurredText]}>
              {isBlurred
                ? '* * * * * * 🔓'
                : `${balanceBTC || '0.00000000'} BTC 🔒`}
            </Text>
          </TouchableOpacity>
          {btcRate > 0 && (
            <TouchableOpacity onPress={handleBlurred}>
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
          <View style={styles.partyContainer}>
            <View style={styles.partyLeft}>
              <Text
                style={styles.partyText}
                numberOfLines={1}
                adjustsFontSizeToFit>
                🗝 {capitalizeWords(party)}
              </Text>
            </View>
            <View style={styles.partyCenter}>
              <Text
                style={styles.partyText}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {networkEmoji()} {capitalizeWords(network)}
              </Text>
            </View>
            <View style={styles.partyRight}>
              <Text
                style={styles.partyText}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {addressEmoji()}{' '}
                {addressType === 'segwit-compatible'
                  ? 'Segwit Compatible'
                  : capitalizeWords(addressType)}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.sendButton]}
              onPress={() => setIsSendModalVisible(true)}>
              <Text style={styles.actionButtonText}>Send</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.addressTypeModalButton]}
              onPress={() => setIsAddressTypeModalVisible(true)}>
              <Text>{addressEmoji()}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.receiveButton]}
              onPress={() => setIsReceiveModalVisible(true)}>
              <Text style={styles.actionButtonText}>Receive</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {!loading && (
        <>
          <CacheIndicator
            timestamps={cacheTimestamps}
            onRefresh={() => fetchData(true)}
            theme={theme}
            isRefreshing={isRefreshing}
          />
          <View style={styles.transactionListContainer}>
            <TransactionList
              baseApi={apiBase}
              address={address}
              onUpdate={() => Promise.resolve()}
              onReload={handleRefresh}
              selectedCurrency={selectedCurrency}
              btcRate={btcRate}
              getCurrencySymbol={getCurrencySymbol}
            />
          </View>
        </>
      )}
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
              <Text style={styles.addressTypeLabel}>🧱 Legacy Address</Text>
              <Text style={styles.addressTypeValue}>
                {shorten(legacyAddress)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-native' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => handleAddressTypeChange('segwit-native')}>
              <Text style={styles.addressTypeLabel}>
                🧬 Segwit Native Address
              </Text>
              <Text style={styles.addressTypeValue}>
                {shorten(segwitAddress)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-compatible' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => handleAddressTypeChange('segwit-compatible')}>
              <Text style={styles.addressTypeLabel}>
                🔁 Segwit Compatible Address
              </Text>
              <Text style={styles.addressTypeValue}>
                {shorten(segwitCompatibleAddress)}
              </Text>
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
          btcToUsdRate={Big(btcRate)}
          walletBalance={Big(balanceBTC)}
          walletAddress={address}
          onClose={() => setIsSendModalVisible(false)}
          onSend={handleSend}
        />
      )}

      {isReceiveModalVisible && (
        <ReceiveModal
          address={address}
          addressType={addressType}
          baseApi={apiBase}
          network={network}
          visible={isReceiveModalVisible}
          onClose={() => setIsReceiveModalVisible(false)}
        />
      )}
    </SafeAreaView>
  );
};

export default WalletHome;
