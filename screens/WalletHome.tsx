import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  NativeModules,
  Image,
  Alert,
  Platform,
  PermissionsAndroid,
  Modal,
  DeviceEventEmitter,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppState} from 'react-native';
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
  HapticFeedback,
} from '../utils';
import {useTheme} from '../theme';
import {WalletService} from '../services/WalletService';
import WalletSkeleton from '../components/WalletSkeleton';
import {useUser} from '../context/UserContext';
import CurrencySelector from '../components/CurrencySelector';
import {createStyles} from '../components/Styles';
import {
  CacheIndicator,
  CacheTimestamp,
  CacheIndicatorHandle,
} from '../components/CacheIndicator';
import {HeaderRightButton, HeaderTitle} from '../components/Header';
import LocalCache from '../services/LocalCache';

const {BBMTLibNativeModule} = NativeModules;

const mainnetIcon = require('../assets/mainnet-icon.png');
const testnetIcon = require('../assets/testnet-icon.png');
const keyIcon = require('../assets/key-icon.png');

const WalletHome: React.FC<{navigation: any}> = ({navigation}) => {
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [isSendModalVisible, setIsSendModalVisible] = useState<boolean>(false);
  const [btcPrice, setBtcPrice] = useState<string>('');
  const [btcRate, setBtcRate] = useState(0);
  const [balanceBTC, setBalanceBTC] = useState<string>('0.00000000');
  const [balanceFiat, setBalanceFiat] = useState<string>('0');
  const [party, setParty] = useState<string>('');
  const [isBlurred, setIsBlurred] = useState<boolean>(true);
  const [isReceiveModalVisible, setIsReceiveModalVisible] = useState(false);

  // Additional state variables needed by fetchData
  const [_pendingSent, _setPendingSent] = useState(0);
  const [isAddressTypeModalVisible, setIsAddressTypeModalVisible] =
    React.useState(false);
  const [legacyAddress, setLegacyAddress] = React.useState('');
  const [segwitAddress, setSegwitAddress] = React.useState('');
  const [addressType, setAddressType] = React.useState('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [_error, setError] = useState<string>('');
  const [cacheTimestamps, setCacheTimestamps] = useState<CacheTimestamp>({
    price: 0,
    balance: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCurrencySelectorVisible, setIsCurrencySelectorVisible] =
    useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [priceData, setPriceData] = useState<{[key: string]: number}>({});
  const [segwitCompatibleAddress, setSegwitCompatibleAddress] =
    React.useState('');
  const [initialTransactions, setInitialTransactions] = useState<any[]>([]);

  // Helper function for showing error toasts
  const showErrorToast = useCallback((message: string) => {
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: message,
      position: 'top',
    });
  }, []);

  // Ref to prevent multiple concurrent fetchData calls
  const isFetchInProgressRef = useRef(false);
  // Ref to guard against concurrent re-initializations and refresh during network switch
  const isReinitInProgressRef = useRef(false);
  // Stable ref for fetchData to avoid circular dependencies
  const fetchDataRef = useRef<(() => Promise<void>) | null>(null);

  // Navigation hook for detecting screen changes
  const nav = useNavigation();

  // Use UserContext for unified user/network/address state
  const {
    activeNetwork,
    activeAddressType: userAddressType,
    activeAddress: userActiveAddress,
    setActiveNetwork,
    setActiveAddressType,
    activeApiProvider: apiBase,
    activeNetwork: network,
    legacyMainnetAddress: uxLegacyMainnet,
    segwitNativeMainnetAddress: uxSegwitMainnet,
    segwitCompatibleMainnetAddress: uxSegwitCompMainnet,
    legacyTestnetAddress: uxLegacyTestnet,
    segwitNativeTestnetAddress: uxSegwitTestnet,
    segwitCompatibleTestnetAddress: uxSegwitCompTestnet,
  } = useUser();

  // Keep local state in sync with UserContext
  useEffect(() => {
    if (userAddressType) setAddressType(userAddressType);
  }, [userAddressType]);

  useEffect(() => {
    if (userActiveAddress) setAddress(userActiveAddress);
  }, [userActiveAddress]);

  useEffect(() => {
    if (activeNetwork === 'mainnet') {
      if (uxLegacyMainnet) setLegacyAddress(uxLegacyMainnet);
      if (uxSegwitMainnet) setSegwitAddress(uxSegwitMainnet);
      if (uxSegwitCompMainnet) setSegwitCompatibleAddress(uxSegwitCompMainnet);
    } else {
      if (uxLegacyTestnet) setLegacyAddress(uxLegacyTestnet);
      if (uxSegwitTestnet) setSegwitAddress(uxSegwitTestnet);
      if (uxSegwitCompTestnet) setSegwitCompatibleAddress(uxSegwitCompTestnet);
    }
  }, [
    activeNetwork,
    uxLegacyMainnet,
    uxSegwitMainnet,
    uxSegwitCompMainnet,
    uxLegacyTestnet,
    uxSegwitTestnet,
    uxSegwitCompTestnet,
  ]);

  const fetchData = useCallback(async () => {
    try {
      dbg('fetchData...');

      if (!isInitialized) {
        dbg('WalletHome: Skipping fetch - not initialized');
        return;
      }

      if (isFetchInProgressRef.current || isReinitInProgressRef.current) {
        dbg('WalletHome: Skipping fetch - already in progress');
        return;
      }

      // Mark fetch as in progress
      isFetchInProgressRef.current = true;
      dbg('=== Starting data fetch...');

      // Prefer in-memory state (fresh), fallback to cache
      const addr = address || (await LocalCache.getItem('currentAddress'));
      const baseApi = apiBase || (await LocalCache.getItem('api'));
      const currency = (await LocalCache.getItem('currency')) || 'USD';

      if (!addr || !baseApi) {
        dbg('WalletHome: Missing wallet address or baseApi', {
          address: addr,
          apiBase: baseApi,
        });
        setLoading(false);
        setIsRefreshing(false);
        return;
      }

      // Set up API URL
      const cleanBaseApi = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
      const apiUrl = `${cleanBaseApi}/api`;

      // Ensure native module has correct settings
      await BBMTLibNativeModule.setAPI(network, apiUrl);

      // Set up timeout for API calls
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          setIsRefreshing(false);
          reject(new Error('API refresh timed out'));
        }, 5000); // 5 second timeout
      });

      let freshData;
      setIsRefreshing(true);

      try {
        dbg('fetching bitcoin price and wallet balance...');
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
          const rates = freshPrice.rates;
          if (rates && rates[currency]) {
            setPriceData(rates);
            setBtcPrice(rates[currency].toString());
            setBtcRate(rates[currency] || 0);
            setBalanceBTC(freshBalance.btc || '0.00000000');
            const fiatBalance = Number(freshBalance.btc * rates[currency]);
            setBalanceFiat(fiatBalance.toFixed(2));

            // Update cache timestamps with fresh data
            setCacheTimestamps({
              price: freshPrice.timestamp,
              balance: freshBalance.timestamp,
            });
          } else {
            setBtcPrice('-');
            setBalanceFiat('-');
          }
        } else {
          freshData = null;
        }
      } catch (error) {
        dbg('WalletHome: Error fetching fresh data:', error);
        // Show offline-only if we detect no internet
        try {
          const ping = await fetch('https://mempool.space/favicon.ico', {
            method: 'HEAD',
          });
          if (!ping.ok) {
            Toast.show({
              type: 'error',
              text1: 'No internet',
              text2: 'Using cached data',
              position: 'top',
            });
          }
        } catch {
          Toast.show({
            type: 'error',
            text1: 'No internet',
            text2: 'Using cached data',
            position: 'top',
          });
        }
      }

      // Fall back to cached data only if fresh data fetch failed
      if (!freshData) {
        const cachedPricePromise = WalletService.getInstance().getCachePrice();
        const cachedBalancePromise =
          WalletService.getInstance().getWalletBalance(
            addr,
            btcRate,
            _pendingSent,
          );
        const cachedResults = await Promise.all([
          cachedPricePromise,
          cachedBalancePromise,
        ]);
        const cachedPrice = cachedResults[0];
        const cachedBalance = cachedResults[1];
        if (cachedPrice && cachedBalance) {
          const rates = cachedPrice.rates || {};
          if (rates && rates[currency]) {
            setPriceData(rates);
            setBtcPrice(rates[currency].toString());
            setBtcRate(rates[currency] || 0);
            setBalanceBTC(cachedBalance.btc || '0.00000000');
            const fiatBalance =
              Number(cachedBalance.btc) * Number(rates[currency]);
            setBalanceFiat(fiatBalance.toFixed(2));
            setCacheTimestamps({
              price: cachedPrice.timestamp,
              balance: cachedBalance.timestamp,
            });
          } else {
            setBtcPrice('-');
            setBalanceFiat('-');
          }
        }
      }
    } catch (error: any) {
      dbg('WalletHome: Error fetching data:', error);
      let errMsg = 'Unknown error';
      if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof (error as any).message === 'string'
      ) {
        errMsg = (error as any).message || 'Unknown error';
      }
      setError(errMsg);
      showErrorToast('Failed to fetch data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      isFetchInProgressRef.current = false;
      dbg('=== Data fetch completed');
    }
  }, [
    isInitialized,
    network,
    btcRate,
    _pendingSent,
    showErrorToast,
    address,
    apiBase,
  ]);

  // Update the ref whenever fetchData changes
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Function to update address type modal with new network addresses
  const updateAddressTypeModal = useCallback(async (newNetwork: string) => {
    try {
      dbg(
        '=== updateAddressTypeModal: Updating addresses for network:',
        newNetwork,
      );

      // Try to get btcPub from storage first
      let btcPub = await EncryptedStorage.getItem('btcPub');

      // Fallback: derive btcPub if not found in storage
      if (!btcPub) {
        dbg('btcPub not found in storage, deriving from keyshare...');
        const jks = await EncryptedStorage.getItem('keyshare');
        if (jks) {
          const ks = JSON.parse(jks);
          const path = "m/44'/0'/0'/0/0";
          btcPub = await BBMTLibNativeModule.derivePubkey(
            ks.pub_key,
            ks.chain_code_hex,
            path,
          );
          // Store it for future use
          await EncryptedStorage.setItem('btcPub', btcPub!);
          dbg('btcPub derived and stored');
        }
      }

      if (btcPub) {
        // Generate addresses for all types for the new network
        const [legacyAddr, segwitAddr, segwitCompatibleAddr] =
          await Promise.all([
            BBMTLibNativeModule.btcAddress(btcPub!, newNetwork, 'P2PKH'),
            BBMTLibNativeModule.btcAddress(btcPub!, newNetwork, 'P2WPKH'),
            BBMTLibNativeModule.btcAddress(btcPub!, newNetwork, 'P2SH-P2WPKH'),
          ]);

        if (legacyAddr) setLegacyAddress(legacyAddr);
        if (segwitAddr) setSegwitAddress(segwitAddr);
        if (segwitCompatibleAddr)
          setSegwitCompatibleAddress(segwitCompatibleAddr);

        dbg('Address type modal updated for network:', newNetwork);
        dbg('Legacy:', legacyAddr);
        dbg('Segwit:', segwitAddr);
        dbg('Segwit Compatible:', segwitCompatibleAddr);
      } else {
        dbg('Could not get or derive btcPub for address generation');
      }
    } catch (error) {
      dbg('updateAddressTypeModal: Error updating addresses:', error);
    }
  }, []);

  // Function to update address for the new network
  const updateAddressForNetwork = useCallback(
    async (newNetwork: string) => {
      try {
        dbg(
          '=== updateAddressForNetwork: Updating address for network:',
          newNetwork,
        );

        // Get the current address type from cache or state
        const currentAddressType =
          addressType || (await LocalCache.getItem('addressType')) || 'P2WPKH';
        dbg(
          'Using address type:',
          currentAddressType,
          'for network:',
          newNetwork,
        );

        // Try to get btcPub from storage first
        let btcPub = await EncryptedStorage.getItem('btcPub');

        // Fallback: derive btcPub if not found in storage
        if (!btcPub) {
          dbg('btcPub not found in storage, deriving from keyshare...');
          const jks = await EncryptedStorage.getItem('keyshare');
          if (!jks) {
            dbg('No keyshare found for address generation');
            return;
          }

          const ks = JSON.parse(jks);
          const path = "m/44'/0'/0'/0/0";
          btcPub = await BBMTLibNativeModule.derivePubkey(
            ks.pub_key,
            ks.chain_code_hex,
            path,
          );
          // Store it for future use
          await EncryptedStorage.setItem('btcPub', btcPub!);
          dbg('btcPub derived and stored');
        }

        if (btcPub) {
          // Set up network parameters before generating address
          const netParams = await BBMTLibNativeModule.setBtcNetwork(newNetwork);
          const actualNet = netParams.split('@')[0];

          const newAddress = await BBMTLibNativeModule.btcAddress(
            btcPub!,
            actualNet,
            currentAddressType,
          );

          if (newAddress) {
            dbg(
              'updateAddressForNetwork: Generated new address:',
              newAddress,
              'for network:',
              newNetwork,
            );

            // Update state and cache
            setAddress(newAddress);
            await LocalCache.setItem('currentAddress', newAddress);
            await LocalCache.setItem('currentNetwork', newNetwork);

            // Also update the address type display if needed
            if (newNetwork === 'testnet3') {
              dbg('Testnet address generated and cached:', newAddress);
            } else {
              dbg('Mainnet address generated and cached:', newAddress);
            }
          } else {
            dbg('Failed to generate address for network:', newNetwork);
          }
        } else {
          dbg('Could not get or derive btcPub for address generation');
        }
      } catch (error) {
        dbg('updateAddressForNetwork: Error updating address:', error);
      }
    },
    [addressType],
  );

  // Initialize component and sync with NetworkContext
  useEffect(() => {
    const initializeOnMount = async () => {
      try {
        dbg(
          '=== Component mount - Initializing with current NetworkContext state',
        );
        dbg('Current network from context:', network);
        dbg('Current API from context:', apiBase);

        // Wait for NetworkContext to be properly initialized
        if (network && apiBase) {
          dbg('Mount - NetworkContext is ready, updating address if needed');
          await updateAddressForNetwork(network);
          await updateAddressTypeModal(network);
        } else {
          dbg('Mount - NetworkContext not ready yet, waiting...', {
            network,
            apiBase,
          });
        }
      } catch (error) {
        dbg('Mount initialization - Error:', error);
      }
    };

    initializeOnMount();
  }, [network, apiBase, updateAddressForNetwork, updateAddressTypeModal]);

  // Comprehensive re-initialization function
  const reinitializeWallet = useCallback(
    async (forceReinit: boolean = false) => {
      // Prevent multiple simultaneous re-initializations
      if (isReinitInProgressRef.current) {
        dbg(
          'reinitializeWallet: Re-initialization already in progress, skipping',
          {
            network,
            apiBase,
          },
        );
        return;
      }

      if (forceReinit) {
        dbg(
          '=== reinitializeWallet: Starting full re-initialization (forceReinit = true)',
          {
            network,
            apiBase,
          },
        );
        isReinitInProgressRef.current = true;
        setLoading(true);
      }

      try {
        const jks = await EncryptedStorage.getItem('keyshare');
        if (!jks) {
          dbg('WalletHome: No keyshare found during re-initialization');
          setLoading(false);
          setIsInitialized(true);
          return;
        }

        // Clear existing state
        setAddress('');
        setBalanceBTC('0.00000000');
        setBalanceFiat('0');
        setBtcPrice('');
        setBtcRate(0);
        setLegacyAddress('');
        setSegwitAddress('');
        setSegwitCompatibleAddress('');

        // Do NOT clear persistent cache here; we need it for offline startup
        // Only ensure service is initialized to read existing caches

        // Initialize WalletService
        const walletService = WalletService.getInstance();
        await walletService.initialize();

        const ks = JSON.parse(jks);
        const path = "m/44'/0'/0'/0/0";

        // Always derive btcPub fresh to ensure it's current
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );

        // Store btcPub for later use in address generation
        await EncryptedStorage.setItem('btcPub', btcPub);
        dbg('btcPub derived and stored during re-initialization');

        // Get current network from NetworkContext
        const net =
          network || (await LocalCache.getItem('network')) || 'mainnet';
        dbg('Re-initializing for network:', net);

        // Get current address type
        const addrType = (await LocalCache.getItem('addressType')) || 'legacy';
        setAddressType(addrType);

        // Set up network parameters
        const netParams = await BBMTLibNativeModule.setBtcNetwork(net);
        const actualNet = netParams.split('@')[0];

        // Generate all address types for the current network
        const [legacyAddr, segwitAddr, segwitCompAddr] = await Promise.all([
          BBMTLibNativeModule.btcAddress(btcPub, actualNet, 'legacy'),
          BBMTLibNativeModule.btcAddress(btcPub, actualNet, 'segwit-native'),
          BBMTLibNativeModule.btcAddress(
            btcPub,
            actualNet,
            'segwit-compatible',
          ),
        ]);

        // Store all addresses
        await LocalCache.setItem('legacyAddress', legacyAddr);
        await LocalCache.setItem('segwitAddress', segwitAddr);
        await LocalCache.setItem('segwitCompatibleAddress', segwitCompAddr);

        setLegacyAddress(legacyAddr);
        setSegwitAddress(segwitAddr);
        setSegwitCompatibleAddress(segwitCompAddr);

        const shareID = ks.local_party_key;
        const shareType =
          ks.keygen_committee_keys.length === 2 ? 'Basic' : 'Flexi';
        setParty(shareID + ' • ' + shareType);

        // Generate and store current address
        const btcAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          actualNet,
          addrType,
        );
        await LocalCache.setItem('currentAddress', btcAddress);
        setAddress(btcAddress);

        // Preload transactions from cache for this address (offline-friendly)
        try {
          const cachedTxs =
            await WalletService.getInstance().transactionsFromCache(btcAddress);
          setInitialTransactions(cachedTxs);
        } catch {}

        // Set up API URL from NetworkContext
        const api = apiBase || (await LocalCache.getItem('api'));
        if (api) {
          await BBMTLibNativeModule.setAPI(actualNet, api);
          dbg('API set for network:', actualNet, 'API:', api);
        }

        // Initialize UI directly from persistent wallet cache (exact v1.3.2 analogy)
        try {
          const cachedPrice = await WalletService.getInstance().getCachePrice();
          const cachedBal = await WalletService.getInstance().getBal(
            btcAddress,
          );
          const cachedTxs =
            await WalletService.getInstance().transactionsFromCache(btcAddress);

          const currency = (await LocalCache.getItem('currency')) || 'USD';
          if (cachedBal.timestamp > 0) {
            // timestamps

            setCacheTimestamps({
              price: cachedPrice.timestamp,
              balance: cachedBal.timestamp,
            });

            // price
            if (cachedPrice.timestamp > 0) {
              setPriceData(cachedPrice.rates);
              const r = cachedPrice.rates[currency] || cachedPrice.rate || 0;
              if (r && r > 0) {
                setBtcPrice(r.toString());
                setBtcRate(r);
              }
            }

            // balance
            if (cachedBal.timestamp > 0) {
              setBalanceBTC(cachedBal.btc || '0.00000000');
              const r =
                (cachedPrice.rates?.[currency] as number) ||
                (cachedPrice.rate as number) ||
                0;
              if (r && Number(cachedBal.btc) >= 0) {
                const fiatBalance = Number(cachedBal.btc) * r;
                setBalanceFiat(fiatBalance.toFixed(2));
              }
            }
            // initial transactions
            if (Array.isArray(cachedTxs) && cachedTxs.length > 0) {
              setInitialTransactions(cachedTxs);
            } else {
              // fallback to WalletService snapshots if persistent cache not found
              setCacheTimestamps({
                price: cachedPrice.timestamp,
                balance: cachedBal.timestamp,
              });
            }
          }
        } catch (error) {
          dbg('reinitializeWallet: Error re-initializing wallet:', error);
          showErrorToast('Failed to re-initialize wallet. Please try again.');
        }
      } finally {
        setLoading(false);
        isReinitInProgressRef.current = false;
      }
    },
    [network, apiBase, showErrorToast],
  );

  // Listen for navigation state changes to detect returning from settings
  useEffect(() => {
    const unsubscribe = nav.addListener('focus', async () => {
      dbg(
        '=== Navigation focus - Screen came into focus, reinitializing wallet',
      );

      // Full re-initialization when returning from settings
      // This ensures everything is properly set up for the current network
      if (network && apiBase) {
        dbg(
          'Focus - NetworkContext is ready, performing full re-initialization',
        );
        await reinitializeWallet(true);
      }
    });

    return unsubscribe;
  }, [nav, network, apiBase, reinitializeWallet]);

  // Listen for app state changes (simplified)
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: string) => {
      if (nextAppState === 'active') {
        dbg('=== App resumed, refreshing data');

        // Simply refresh data on app resume
        if (network && apiBase) {
          updateAddressForNetwork(network);
          updateAddressTypeModal(network);
          fetchDataRef.current?.();
        }
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    return () => {
      subscription?.remove();
    };
  }, [network, apiBase, updateAddressForNetwork, updateAddressTypeModal]);

  // No periodic check needed - NetworkContext is the single source of truth

  const cacheIndicatorRef = useRef<CacheIndicatorHandle>(null);
  const [isNetworkModalVisible, setIsNetworkModalVisible] = useState(false);
  const [isPartyModalVisible, setIsPartyModalVisible] = useState(false);

  const {theme} = useTheme();
  const styles = createStyles(theme);

  const headerRight = React.useCallback(
    () => <HeaderRightButton navigation={navigation} />,
    [navigation],
  );

  const networkIcon = () => (network === 'mainnet' ? mainnetIcon : testnetIcon);

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
        dbg(err);
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
    LocalCache.getItem('addressType').then(addrType => {
      setAddressType(addrType || 'legacy');
    });
    LocalCache.getItem('currency').then(currency => {
      setSelectedCurrency(currency || 'USD');
    });
  });

  // Simplified focus effect - just refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      dbg('=== Home screen focused, refreshing data');

      // Simple refresh - the NetworkContext should have the correct state
      if (network && apiBase && !isReinitInProgressRef.current) {
        dbg('Focus - Refreshing address and data for network:', network);
        updateAddressForNetwork(network);
        updateAddressTypeModal(network);
        fetchDataRef.current?.();
      }
    }, [network, apiBase, updateAddressForNetwork, updateAddressTypeModal]),
  );

  // Watch for network changes: derive address for that network, update modal previews, then refresh data
  useEffect(() => {
    if (network && apiBase && !isReinitInProgressRef.current) {
      (async () => {
        try {
          await updateAddressForNetwork(network);
          await updateAddressTypeModal(network);
        } catch (e) {
          dbg('Error updating address for network change', e);
        } finally {
          fetchDataRef.current?.();
        }
      })();
    }
  }, [network, apiBase, updateAddressForNetwork, updateAddressTypeModal]);

  const handleTransactionUpdate = useCallback(
    async (pendingTxs: any[], pending: number) => {
      _setPendingSent(pending);
      dbg('handleTransactionUpdate: Pending transactions:', pendingTxs);
      return Promise.resolve();
    },
    [],
  );

  const handleCurrencySelect = async (currency: {code: string}) => {
    setSelectedCurrency(currency.code);
    await LocalCache.setItem('currency', currency.code);
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
          navigation.reset({index: 0, routes: [{name: 'Welcome'}]});
          return;
        }

        // Initialize WalletService only after confirming we have a keyshare
        const walletService = WalletService.getInstance();
        await walletService.initialize();

        let ks: any = {};

        try {
          ks = JSON.parse(jks);
        } catch (error) {
          dbg('Error parsing keyshare:', error);
          navigation.reset({index: 0, routes: [{name: 'Home'}]});
          return;
        }

        if (!ks.pub_key || !ks.chain_code_hex || !ks.local_party_key) {
          dbg('Invalid pub_key or chain_code_hex or local_party_key');
          navigation.reset({index: 0, routes: [{name: 'Home'}]});
          return;
        }

        const path = "m/44'/0'/0'/0/0";
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );

        // Store btcPub for later use in address generation
        await EncryptedStorage.setItem('btcPub', btcPub);
        dbg('btcPub stored in EncryptedStorage for address generation');

        // Set default network if not set
        let net = await LocalCache.getItem('network');
        if (!net) {
          net = 'mainnet';
          await LocalCache.setItem('network', net);
          dbg('WalletHome: Setting default network to mainnet');
        }

        // Set default address type if not set
        let addrType = await LocalCache.getItem('addressType');
        if (!addrType) {
          addrType = 'legacy';
          await LocalCache.setItem('addressType', addrType);
          dbg('WalletHome: Setting default address type to legacy');
        }
        // Set default currency if not set
        let currency = (await LocalCache.getItem('currency')) || 'USD';
        // Get available currencies from price data
        const priceResponse = await walletService.getBitcoinPrice();
        const availableCurrencies = Object.keys(priceResponse.rates);
        currency = availableCurrencies.includes('USD')
          ? 'USD'
          : availableCurrencies[0];
        await LocalCache.setItem('currency', currency);
        dbg('WalletHome: Setting default currency to', currency);

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
        await LocalCache.setItem('legacyAddress', legacyAddr);
        await LocalCache.setItem('segwitAddress', segwitAddr);
        await LocalCache.setItem('segwitCompatibleAddress', segwitCompAddr);

        setLegacyAddress(legacyAddr);
        setSegwitAddress(segwitAddr);
        setSegwitCompatibleAddress(segwitCompAddr);

        const shareID = ks.local_party_key;
        const shareType =
          ks.keygen_committee_keys.length === 2 ? 'Basic' : 'Flexi';
        setParty(shareID + ' • ' + shareType);

        // Get current address type and generate address
        const currentAddressType = addrType;
        setAddressType(currentAddressType);

        // Generate and store current address
        const btcAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          currentAddressType,
        );
        await LocalCache.setItem('currentAddress', btcAddress);
        setAddress(btcAddress);

        // Set up API URL
        let base = netParams.split('@')[1];
        if (!base.endsWith('/')) {
          base = `${base}/`;
        }
        let api = await LocalCache.getItem('api');
        if (api) {
          if (api.endsWith('/')) {
            api = api.substring(0, api.length - 1);
          }
          BBMTLibNativeModule.setAPI(net, api);
        } else {
          await LocalCache.setItem('api', base);
        }
        // Initialize cache timestamps from WalletService (works offline)
        // Seed UI with cached price/balance immediately (no network needed)
        if (priceResponse && priceResponse.rates) {
          setPriceData(priceResponse.rates);
          const r = priceResponse.rates[currency] || priceResponse.rate || 0;
          if (r && r > 0) {
            setBtcPrice(r.toString());
            setBtcRate(r);
          }
        }
        const cachedBal = await WalletService.getInstance().getBal(address);
        if (cachedBal) {
          setBalanceBTC(cachedBal.btc || '0.00000000');
          const r =
            (priceResponse?.rates?.[currency] as number) ||
            (priceResponse?.rate as number) ||
            0;
          if (r && Number(cachedBal.btc) > 0) {
            const fiatBalance = Number(cachedBal.btc) * r;
            setBalanceFiat(fiatBalance.toFixed(2));
          }
        }
        setCacheTimestamps({
          price: priceResponse.timestamp,
          balance: priceResponse.timestamp,
        });
        setLoading(false);
        setIsInitialized(true);
        // Force initial balance fetch
        await fetchDataRef.current?.();
        dbg('Wallet initialization completed successfully');
      } catch (error) {
        dbg('Error initializing wallet:', error);
        showErrorToast('Failed to initialize wallet. Please try again.');
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [showErrorToast, isInitialized, address, navigation]);

  const handleAddressTypeChange = async (type: string) => {
    try {
      dbg('WalletHome: Starting address type change to:', type);
      setIsAddressTypeModalVisible(false);
      await setActiveAddressType(type as any);
      navigation.reset({index: 0, routes: [{name: 'Home'}]});
    } catch (error) {
      dbg('WalletHome: Error changing address type:', error);
      showErrorToast('Failed to change address type. Please try again.');
    }
  };

  // Remove the old interval effect since we're handling it in CacheIndicator now
  // Initial data fetch only when initialized and address is set
  useEffect(() => {
    if (!isInitialized || !address) {
      return;
    }

    // Only fetch once when initialized
    let mounted = true;

    const initialFetch = async () => {
      if (mounted && fetchDataRef.current) {
        await fetchDataRef.current();
      }
    };

    initialFetch();

    return () => {
      mounted = false;
    };
  }, [isInitialized, address]); // Removed fetchData from dependencies

  const handleBlurred = () => {
    const blurr = !isBlurred;
    setIsBlurred(blurr);
    LocalCache.setItem('mode', blurr ? 'private' : '');
  };

  const handleSend = async (to: string, amountSats: Big, feeSats: Big) => {
    if (!isSending && amountSats.gt(0) && feeSats.gt(0) && to) {
      setIsSending(true);
      const toAddress = to;
      const satoshiAmount = amountSats.toString().split('.')[0];
      const fiatAmount = amountSats.times(btcRate).div(1e8).toFixed(2);
      const satoshiFees = feeSats.toString().split('.')[0];
      const fiatFees = feeSats.times(btcRate).div(1e8).toFixed(2);
      setTimeout(() => {
        setIsSendModalVisible(false);
        setIsSending(false);
      }, 250);
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

  // Helper to switch network using UserContext
  const handleNetworkSwitch = async (toTestnet: boolean) => {
    dbg('=== Network switch started:', toTestnet ? 'testnet' : 'mainnet');
    HapticFeedback.light();
    const net = toTestnet ? 'testnet3' : 'mainnet';
    await setActiveNetwork(net);
    navigation.reset({index: 0, routes: [{name: 'Home'}]});
  };

  if (loading && !isInitialized) {
    return <WalletSkeleton />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <View style={styles.contentContainer}>
        <View style={styles.walletHeader}>
          <View style={styles.headerTop}>
            <Image
              source={require('../assets/bitcoin-logo.png')}
              style={styles.btcLogo}
            />
            <TouchableOpacity
              style={styles.priceContainer}
              onPress={() => {
                HapticFeedback.light();
                setIsCurrencySelectorVisible(true);
              }}>
              <Text style={styles.btcPrice}>
                {btcPrice ? presentFiat(btcPrice) : '-'}
              </Text>
              <Text style={styles.currencyBadge}>{selectedCurrency}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.balanceContainer}>
            <TouchableOpacity
              style={[styles.balanceRowWithMargin]}
              onPress={() => {
                HapticFeedback.light();
                handleBlurred();
              }}
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
                onPress={() => {
                  HapticFeedback.light();
                  handleBlurred();
                }}
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
          <View style={[styles.partyContainer, styles.rowFullWidth]}>
            <TouchableOpacity
              style={[
                styles.addressTypeContainer,
                styles.addressTypeClickable,
                styles.flexOneMinWidthZero,
                styles.partyGap,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setIsPartyModalVisible(true);
              }}
              activeOpacity={0.85}>
              <View style={styles.columnCenter}>
                <Text style={styles.partyLabel}>Device</Text>
                <View style={styles.rowCenterMarginTop2}>
                  <Image source={keyIcon} style={styles.networkIcon} />
                  <Text
                    style={styles.partyValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit>
                    {capitalizeWords(party)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeContainer,
                styles.addressTypeClickable,
                styles.flexOneMinWidthZero,
                styles.partyGap,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setIsNetworkModalVisible(true);
              }}
              activeOpacity={0.85}>
              <View style={styles.columnCenter}>
                <Text style={styles.partyLabel}>Network</Text>
                <View style={styles.rowCenterMarginTop2}>
                  <Image source={networkIcon()} style={styles.networkIcon} />
                  <Text
                    style={styles.partyValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit>
                    {capitalizeWords(network)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeContainer,
                styles.addressTypeClickable,
                styles.flexOneMinWidthZero,
                styles.partyGap,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setIsAddressTypeModalVisible(true);
              }}
              activeOpacity={0.85}>
              <View style={styles.columnCenter}>
                <Text style={styles.partyLabel}>Address Type</Text>
                <View style={styles.rowCenterMarginTop2}>
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
            </TouchableOpacity>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.sendButton]}
              onPress={() => {
                HapticFeedback.medium();
                setIsSendModalVisible(true);
              }}>
              <Image
                source={require('../assets/send-icon.png')}
                style={styles.actionButtonIcon}
                resizeMode="contain"
              />
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
            {/* Lock icon button replaces address type change button */}
            <TouchableOpacity
              style={[styles.actionButton, styles.addressTypeModalButton]}
              onPress={() => {
                HapticFeedback.light();
                // Emit a reload event to App.tsx to trigger authentication lock
                DeviceEventEmitter.emit('app:reload');
              }}>
              <Image
                source={require('../assets/locker-icon.png')}
                style={styles.addressTypeButtonIcon}
                resizeMode="contain"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.receiveButton]}
              onPress={() => {
                HapticFeedback.medium();
                setIsReceiveModalVisible(true);
              }}>
              <Image
                source={require('../assets/receive-icon.png')}
                style={styles.actionButtonIcon}
                resizeMode="contain"
              />
              <Text style={styles.receiveButtonText}>Receive</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <CacheIndicator
        ref={cacheIndicatorRef}
        timestamps={cacheTimestamps}
        onRefresh={() => fetchDataRef.current?.()}
        theme={theme}
        isRefreshing={isRefreshing}
        usingCache={
          !isRefreshing &&
          cacheTimestamps.price > 0 &&
          cacheTimestamps.balance > 0 &&
          Date.now() -
            Math.max(cacheTimestamps.price, cacheTimestamps.balance) >
            0
        }
      />

      {/* Provider Information Row */}
      <View style={styles.providerRow}>
        <View style={styles.providerItem}>
          <View style={styles.providerLeft}>
            <Image
              source={require('../assets/network-icon.png')}
              style={styles.providerIcon}
              resizeMode="contain"
            />
            <Text style={styles.providerLabel}>Provider</Text>
          </View>
          <Text style={styles.providerValue} numberOfLines={1}>
            {apiBase
              ? (() => {
                  const cleanUrl = apiBase
                    .replace('https://', '')
                    .replace('/api', '');
                  return cleanUrl;
                })()
              : 'Loading...'}
          </Text>
        </View>
      </View>

      <View style={styles.transactionListContainer}>
        <TransactionList
          baseApi={apiBase}
          address={address}
          onUpdate={handleTransactionUpdate}
          initialTransactions={initialTransactions}
          selectedCurrency={selectedCurrency}
          btcRate={btcRate}
          getCurrencySymbol={getCurrencySymbol}
          onPullRefresh={() => cacheIndicatorRef.current?.press()}
          isBlurred={isBlurred}
        />
      </View>
      <Modal
        visible={isAddressTypeModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsAddressTypeModalVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => {
            HapticFeedback.light();
            setIsAddressTypeModalVisible(false);
          }}
          activeOpacity={1}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Image
                source={require('../assets/key-icon.png')}
                style={styles.modalHeaderIcon}
              />
              <Text style={styles.modalHeaderTitle}>Select Address Format</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'legacy' && styles.addressTypeButtonSelected,
              ]}
              onPress={() => {
                HapticFeedback.selection();
                handleAddressTypeChange('legacy');
              }}>
              <Image
                source={require('../assets/bricks-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel} numberOfLines={1}>
                  Legacy (P2PKH)
                </Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(legacyAddress, 6)}
                </Text>
              </View>
              {addressType === 'legacy' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.modalOptionCheckIcon}
                  resizeMode="contain"
                />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-native' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => {
                HapticFeedback.selection();
                handleAddressTypeChange('segwit-native');
              }}>
              <Image
                source={require('../assets/dna-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel} numberOfLines={1}>
                  Native Segwit (Bech32)
                </Text>
                <View style={styles.addressTypeLabelRow}>
                  <Text style={styles.addressTypeValue} numberOfLines={1}>
                    {shorten(segwitAddress, 6)}
                  </Text>
                  <View style={styles.recommendBadge}>
                    <Text style={styles.recommendBadgeText}>Recommended</Text>
                  </View>
                </View>
              </View>
              {addressType === 'segwit-native' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.modalOptionCheckIcon}
                  resizeMode="contain"
                />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-compatible' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => {
                HapticFeedback.selection();
                handleAddressTypeChange('segwit-compatible');
              }}>
              <Image
                source={require('../assets/recycle-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel} numberOfLines={1}>
                  Segwit Compat (P2SH)
                </Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(segwitCompatibleAddress, 6)}
                </Text>
              </View>
              {addressType === 'segwit-compatible' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.modalOptionCheckIcon}
                  resizeMode="contain"
                />
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      <CurrencySelector
        visible={isCurrencySelectorVisible}
        onClose={() => setIsCurrencySelectorVisible(false)}
        onSelect={handleCurrencySelect}
        currentCurrency={selectedCurrency}
        availableCurrencies={priceData}
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
      {/* Network Switch Modal */}
      <Modal
        visible={isNetworkModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsNetworkModalVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => {
            HapticFeedback.light();
            setIsNetworkModalVisible(false);
          }}
          activeOpacity={1}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Image
                source={require('../assets/network-icon.png')}
                style={styles.modalHeaderIcon}
              />
              <Text style={styles.modalHeaderTitle}>
                Select Bitcoin Network
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                network === 'mainnet' && styles.addressTypeButtonSelected,
              ]}
              onPress={async () => {
                await handleNetworkSwitch(false);
              }}>
              <Image
                source={require('../assets/mainnet-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>Mainnet</Text>
                <Text style={styles.addressTypeValue}>
                  Real Bitcoin, Main Net
                </Text>
              </View>
              {network === 'mainnet' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.modalOptionCheckIcon}
                  resizeMode="contain"
                />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                network !== 'mainnet' && styles.addressTypeButtonSelected,
              ]}
              onPress={async () => {
                await handleNetworkSwitch(true);
              }}>
              <Image
                source={require('../assets/testnet-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>Testnet</Text>
                <Text style={styles.addressTypeValue}>
                  Fake Bitcoin, Test Net
                </Text>
              </View>
              {network !== 'mainnet' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.modalOptionCheckIcon}
                  resizeMode="contain"
                />
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      {/* Keyshare Party Info Modal */}
      <Modal
        visible={isPartyModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsPartyModalVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => {
            HapticFeedback.light();
            setIsPartyModalVisible(false);
          }}
          activeOpacity={1}>
          <View style={styles.modalContentCompact}>
            <View style={styles.modalHeaderRowCompact}>
              <Image
                source={require('../assets/key-icon.png')}
                style={styles.modalHeaderIconCompact}
              />
              <Text style={styles.modalHeaderTitleCompact}>
                Device Keyshare
              </Text>
            </View>

            <Text style={styles.modalTextCompact}>
              This device stores{' '}
              <Text style={styles.modalBoldTextCompact}>one part</Text> of your
              wallet's keyshare. Devices must work together to manage your
              wallet.
            </Text>

            <View style={styles.warningBoxCompact}>
              <Text style={styles.warningTextCompact}>
                ⚠️ Keep keyshares safe. Losing a device or backup permanently
                locks out your Bitcoin.
              </Text>
            </View>

            <Text style={styles.modalTipTextCompact}>
              💡 Store backups separately — never together.
            </Text>

            <TouchableOpacity
              style={styles.backupButtonCompact}
              onPress={() => {
                HapticFeedback.medium();
                setIsPartyModalVisible(false);
                if (typeof navigation.navigate === 'function') {
                  navigation.navigate('Settings');
                }
              }}
              activeOpacity={0.7}>
              <Text style={styles.backupButtonTextCompact}>
                Security Settings &gt; Backup
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

export default WalletHome;
