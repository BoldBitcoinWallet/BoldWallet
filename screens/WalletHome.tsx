import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  View,
  Text,
  NativeModules,
  Image,
  Alert,
  Platform,
  PermissionsAndroid,
  Linking,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import QRScanner from '../components/QRScanner';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppState} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import SendBitcoinModal from './SendBitcoinModal';
import Toast from 'react-native-toast-message';
import TransactionList from '../components/TransactionList';
import {CommonActions} from '@react-navigation/native';
import Big from 'big.js';
import ReceiveModal from './ReceiveModal';
import RestoringIndexesModal from '../components/RestoringIndexesModal';
import SignedPSBTModal from './SignedPSBTModal';
import LegacyWalletModal from '../components/LegacyWalletModal';
import ExtensionPairingModal from '../components/ExtensionPairingModal';
import AppText from '../components/AppText';
import {
  dbg,
  presentFiat,
  formatBitcoinDisplay,
  getCurrencySymbol,
  HapticFeedback,
  getKeyshareLabel,
  getDerivePathForNetwork,
  getReceivePath,
  isLegacyWallet,
  decodeSendBitcoinQR,
  getResetToMainTabsWallet,
} from '../utils';
import {validate as validateBitcoinAddress} from 'bitcoin-address-validation';
import {useTheme} from '../theme';
import {
  WalletService,
  validateBitcoinAddressEnhanced,
} from '../services/WalletService';
import WalletSkeleton from '../components/WalletSkeleton';
import {useUser} from '../context/UserContext';
import CurrencySelector from '../components/CurrencySelector';
import TransportModeSelector from '../components/TransportModeSelector';
import QRCodeModal from '../components/QRCodeModal';
import {createStyles} from '../components/Styles';
import {
  CacheIndicator,
  CacheTimestamp,
  CacheIndicatorHandle,
} from '../components/CacheIndicator';
import {
  HeaderPriceButton,
  HeaderProvider,
  HeaderNetwork,
} from '../components/Header';
import LocalCache from '../services/LocalCache';
import {getExternalIndex} from '../services/HdIndexService';
import {
  parsePairingCodeFromScannedData,
  computeExtensionBindResponseQr,
} from '../utils/extensionBind';
const {BBMTLibNativeModule} = NativeModules;

type RouteParams = {
  txId?: string;
  signedPsbt?: string;
};
const WalletHome: React.FC<{navigation: any}> = ({navigation}) => {
  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [isSendModalVisible, setIsSendModalVisible] = useState<boolean>(false);
  const [isTransportModalVisible, setIsTransportModalVisible] =
    useState<boolean>(false);
  const [pendingSendParams, setPendingSendParams] = useState<{
    to: string;
    amountSats: Big;
    feeSats: Big;
    spendingHash: string;
  } | null>(null);
  const [currentDerivationPath, setCurrentDerivationPath] =
    useState<string>('');
  const [scannedAddressType, setScannedAddressType] = useState<string>(''); // Address type from scanned QR code
  const [scannedNetwork, setScannedNetwork] = useState<string>(''); // Network from scanned QR code
  const [computedFromAddress, setComputedFromAddress] = useState<string>(''); // Computed from address for send transaction
  const [btcPrice, setBtcPrice] = useState<string>('');
  const [btcRate, setBtcRate] = useState(0);
  const [balanceBTC, setBalanceBTC] = useState<string>('0.00000000');
  const [balanceFiat, setBalanceFiat] = useState<string>('0');
  const [_party, setParty] = useState<string>('');
  const [isBlurred, setIsBlurred] = useState<boolean>(false);
  const [isReceiveModalVisible, setIsReceiveModalVisible] = useState(false);
  const [isRestoringIndexes, setIsRestoringIndexes] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    chain: 'external' | 'internal';
    index: number;
    gapIndex: number;
  } | null>(null);
  const [receivePathInfo, setReceivePathInfo] = useState<{
    path: string;
    index: number;
  } | null>(null);
  const [isSignedPSBTModalVisible, setIsSignedPSBTModalVisible] =
    useState(false);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);
  // Additional state variables needed by fetchData
  const [_pendingSent, _setPendingSent] = useState(0);
  const [isLegacyWalletModalVisible, setIsLegacyWalletModalVisible] =
    React.useState(false);
  const [_legacyAddress, setLegacyAddress] = React.useState('');
  const [_segwitAddress, setSegwitAddress] = React.useState('');
  const [addressType, setAddressType] = React.useState('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [_error, setError] = useState<string>('');
  const [cacheTimestamps, setCacheTimestamps] = useState<CacheTimestamp>({
    price: 0,
    balance: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCheckingBalanceForSend, setIsCheckingBalanceForSend] =
    useState(false);
  const [isCurrencySelectorVisible, setIsCurrencySelectorVisible] =
    useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [isQRScannerVisible, setIsQRScannerVisible] = useState(false);
  const [extensionResponseQrData, setExtensionResponseQrData] = useState<
    string | null
  >(null);
  const [isExtensionResponseQrVisible, setIsExtensionResponseQrVisible] =
    useState(false);
  const [isExtensionPairingModalVisible, setIsExtensionPairingModalVisible] =
    useState(false);
  const [pendingExtensionPairingCode, setPendingExtensionPairingCode] =
    useState<string | null>(null);
  const extensionQrModalStyles = React.useMemo(
    () => StyleSheet.create({qrPadding: {padding: 16}}),
    [],
  );
  const lastInvalidQrRef = useRef<{data: string; time: number}>({
    data: '',
    time: 0,
  });
  const extensionBindAlertShownRef = useRef(false);

  const proceedWithExtensionBind = useCallback(
    async (pairingCode: string) => {
      try {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (!keyshareJSON) {
          extensionBindAlertShownRef.current = false;
          Alert.alert('Error', 'Keyshare not found.');
          return;
        }
        const keyshare = JSON.parse(keyshareJSON);
        const pubKey = keyshare.pub_key || '';
        const chainCode = keyshare.chain_code_hex || '';
        if (!pubKey || !chainCode) {
          extensionBindAlertShownRef.current = false;
          Alert.alert('Error', 'Keyshare info is not available.');
          return;
        }
        const qrDataBase64 = await computeExtensionBindResponseQr(
          pairingCode,
          pubKey,
          chainCode,
        );
        setExtensionResponseQrData(qrDataBase64);
        setIsExtensionResponseQrVisible(true);
      } catch (e) {
        dbg('Extension bind from scan failed:', e);
        extensionBindAlertShownRef.current = false;
        Alert.alert('Error', 'Failed to generate response QR.');
      }
    },
    [],
  );

  const [initialSendAddress, setInitialSendAddress] = useState<string | null>(
    null,
  );
  const [scannedFromQR, setScannedFromQR] = useState(false); // Track if data came from QR scan
  const [priceData, setPriceData] = useState<{[key: string]: number}>({});
  const [_segwitCompatibleAddress, setSegwitCompatibleAddress] =
    React.useState('');
  const [initialTransactions, setInitialTransactions] = useState<any[]>([]);
  const [walletAddresses, setWalletAddresses] = useState<string[]>([]);
  // Animation and visual feedback states
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const balanceUpdateAnimation = useSharedValue(1);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const previousBalanceRef = useRef<string>('0.00000000');
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
  // Ref to control TransactionList (imperative refresh)
  const transactionListRef = useRef<
    import('../components/TransactionList').TransactionListHandle | null
  >(null);
  // Navigation hook for detecting screen changes
  const nav = useNavigation();
  // Use UserContext for unified user/network/address state
  const {
    activeNetwork,
    activeAddressType: userAddressType,
    activeAddress: userActiveAddress,
    activeApiProvider: apiBase,
    activeNetwork: network,
    legacyMainnetAddress: uxLegacyMainnet,
    segwitNativeMainnetAddress: uxSegwitMainnet,
    segwitCompatibleMainnetAddress: uxSegwitCompMainnet,
    legacyTestnetAddress: uxLegacyTestnet,
    segwitNativeTestnetAddress: uxSegwitTestnet,
    segwitCompatibleTestnetAddress: uxSegwitCompTestnet,
    showSats,
    setShowSats: setShowSatsGlobal,
    balanceFormattingEnabled,
    showMempoolPlayground,
    showUtxosTab,
    showPsbtTab,
    showWalletTab,
    refresh: refreshUserContext,
  } = useUser();
  // Keep local state in sync with UserContext
  useEffect(() => {
    if (userAddressType) {
      dbg(`[WalletHome] Syncing addressType from UserContext:`, {
        timestamp: Date.now(),
        userAddressType,
        currentAddressType: addressType,
        willUpdate: userAddressType !== addressType,
      });
      setAddressType(userAddressType);
    }
  }, [userAddressType, addressType]);
  useEffect(() => {
    if (userActiveAddress) {
      dbg(`[WalletHome] Syncing address from UserContext:`, {
        timestamp: Date.now(),
        userActiveAddress: userActiveAddress
          ? `${userActiveAddress.substring(
              0,
              8,
            )}...${userActiveAddress.substring(userActiveAddress.length - 8)}`
          : 'EMPTY',
        currentAddress: address
          ? `${address.substring(0, 8)}...${address.substring(
              address.length - 8,
            )}`
          : 'EMPTY',
        willUpdate: userActiveAddress !== address,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join(' -> '),
      });
      setAddress(userActiveAddress);
    }
  }, [userActiveAddress, address]);
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
      // CRITICAL: Prefer userActiveAddress from UserContext (single source of truth)
      // This prevents using stale/wrong addresses during state updates
      const addr =
        userActiveAddress ||
        address ||
        (await LocalCache.getItem('currentAddress'));
      const baseApi = apiBase || (await LocalCache.getItem('api'));
      const currency = (await LocalCache.getItem('currency')) || 'USD';
      dbg(`[WalletHome] fetchData - Using address:`, {
        timestamp: Date.now(),
        userActiveAddress: userActiveAddress
          ? `${userActiveAddress.substring(
              0,
              8,
            )}...${userActiveAddress.substring(userActiveAddress.length - 8)}`
          : 'EMPTY',
        localAddress: address
          ? `${address.substring(0, 8)}...${address.substring(
              address.length - 8,
            )}`
          : 'EMPTY',
        finalAddress: addr
          ? `${addr.substring(0, 8)}...${addr.substring(addr.length - 8)}`
          : 'EMPTY',
        addressSource: userActiveAddress
          ? 'UserContext'
          : address
          ? 'localState'
          : 'cache',
      });
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
      setIsBalanceLoading(true);
      setBalanceError(null);
      try {
        dbg('fetching bitcoin price and wallet balance...');
        const effectiveAddressType = addressType || userAddressType || 'segwit-native';
        freshData = await Promise.race([
          Promise.all([
            WalletService.getInstance().getBitcoinPrice(),
            WalletService.getInstance().getWalletBalanceAggregate(
              network,
              effectiveAddressType,
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
            // Normalize balance to ensure no negative zero
            const normalizedBTC = freshBalance.btc || '0.00000000';
            const balanceNum = parseFloat(normalizedBTC);
            const finalBTC = balanceNum <= 0 ? '0.00000000' : normalizedBTC;
            setBalanceBTC(finalBTC);
            const fiatBalance = Number(freshBalance.btc * rates[currency]);
            setBalanceFiat(Math.max(0, fiatBalance).toFixed(2));
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
        const effectiveAddressType = addressType || userAddressType || 'segwit-native';
        const cachedBalancePromise =
          WalletService.getInstance().getCachedAggregateBalance(
            network,
            effectiveAddressType,
          ).then(
            c => c ?? WalletService.getInstance().getWalletBalance(
              addr,
              btcRate,
              _pendingSent,
            ),
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
            // Normalize balance to ensure no negative zero
            const normalizedBTC = cachedBalance.btc || '0.00000000';
            const balanceNum = parseFloat(normalizedBTC);
            const finalBTC = balanceNum <= 0 ? '0.00000000' : normalizedBTC;
            // Animate balance update if it changed
            if (finalBTC !== previousBalanceRef.current) {
              // Trigger fade animation
              balanceUpdateAnimation.value = 0;
              balanceUpdateAnimation.value = withTiming(1, {duration: 300});
              previousBalanceRef.current = finalBTC;
              // Haptic feedback on balance update
              HapticFeedback.light();
            }
            setBalanceBTC(finalBTC);
            const fiatBalance =
              Number(cachedBalance.btc) * Number(rates[currency]);
            setBalanceFiat(Math.max(0, fiatBalance).toFixed(2));
            setCacheTimestamps({
              price: cachedPrice.timestamp,
              balance: cachedBalance.timestamp,
            });
            setBalanceError(null); // Clear any previous errors
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
      setBalanceError('Failed to load balance');
      showErrorToast('Failed to fetch data');
    } finally {
      setLoading(false);
      setIsBalanceLoading(false);
      setIsRefreshing(false);
      isFetchInProgressRef.current = false;
      dbg('=== Data fetch completed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isInitialized,
    network,
    btcRate,
    _pendingSent,
    showErrorToast,
    userActiveAddress,
    address,
    apiBase,
    addressType,
    userAddressType,
  ]);
  // Load HD addresses for multi-address transaction list
  useEffect(() => {
    if (!isInitialized || !network || !(addressType || userAddressType)) return;
    const effectiveType = addressType || userAddressType || 'segwit-native';
    WalletService.getInstance()
      .getHdAddressesWithPaths(network, effectiveType)
      .then(arr => setWalletAddresses(arr.map(a => a.address)))
      .catch(() => setWalletAddresses([]));
  }, [isInitialized, network, addressType, userAddressType]);
  // Update the ref whenever fetchData changes
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);
  // Function to check balance specifically for send button
  const checkBalanceForSend = useCallback(async (): Promise<number> => {
    try {
      dbg('checkBalanceForSend: Starting balance check...');
      const addr =
        userActiveAddress ||
        address ||
        (await LocalCache.getItem('currentAddress'));
      const baseApi = apiBase || (await LocalCache.getItem('api'));
      if (!addr || !baseApi) {
        dbg('checkBalanceForSend: Missing wallet address or baseApi');
        return 0;
      }
      // Set up API URL
      const cleanBaseApi = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
      const apiUrl = `${cleanBaseApi}/api`;
      // Ensure native module has correct settings
      await BBMTLibNativeModule.setAPI(network, apiUrl);
      // Set up timeout (5 seconds)
      const timeoutPromise = new Promise<number>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Balance check timed out'));
        }, 5000);
      });
      // Fetch aggregate balance (all HD addresses)
      const effectiveAddressType =
        addressType || userAddressType || 'segwit-native';
      const balancePromise = WalletService.getInstance().getWalletBalanceAggregate(
        network,
        effectiveAddressType,
        btcRate,
        _pendingSent,
        true,
      );
      const balanceResult = await Promise.race([
        balancePromise,
        timeoutPromise,
      ]);
      if (
        balanceResult &&
        typeof balanceResult === 'object' &&
        'btc' in balanceResult
      ) {
        const newBalance = parseFloat((balanceResult as any).btc || '0');
        dbg('checkBalanceForSend: Balance fetched:', newBalance);
        // Update balance state - normalize to ensure no negative zero
        const normalizedBTC = (balanceResult as any).btc || '0.00000000';
        const balanceNum = parseFloat(normalizedBTC);
        const finalBTC = balanceNum <= 0 ? '0.00000000' : normalizedBTC;
        setBalanceBTC(finalBTC);
        if (btcRate > 0) {
          const fiatBalance = Number((balanceResult as any).btc) * btcRate;
          setBalanceFiat(Math.max(0, fiatBalance).toFixed(2));
        }
        return newBalance;
      }
      return 0;
    } catch (error: any) {
      dbg('checkBalanceForSend: Error checking balance:', error);
      return 0;
    }
  }, [
    userActiveAddress,
    address,
    apiBase,
    network,
    btcRate,
    _pendingSent,
    addressType,
    userAddressType,
  ]);
  // Function to update address type modal with new network addresses
  const updateAddressTypeModal = useCallback(
    async (newNetwork: string) => {
      try {
        dbg(
          '=== updateAddressTypeModal: Updating addresses for network:',
          newNetwork,
        );
        // Always derive btcPub fresh to ensure it matches the current address type
        // This ensures consistency when the address type might have changed
        let btcPub: string | null = null;
        const jks = await EncryptedStorage.getItem('keyshare');
        if (!jks) {
          dbg('No keyshare found for address generation');
          return;
        }
        const ks = JSON.parse(jks);
        // Get current address type for derivation path - use state or cache
        const currentAddressType =
          addressType ||
          (await LocalCache.getItem('addressType')) ||
          'segwit-native';
        // Check if this is a legacy wallet (created before migration timestamp)
        const useLegacyPath = isLegacyWallet(ks.created_at);
        // Use newNetwork (not network) to ensure we're using the correct network
        const path = getDerivePathForNetwork(
          newNetwork,
          currentAddressType,
          useLegacyPath,
        );
        btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        // Store it for future use
        if (btcPub) {
          await EncryptedStorage.setItem('btcPub', btcPub);
          dbg('btcPub derived and stored for address type modal');
        }
        if (btcPub) {
          // Generate addresses for all types for the new network
          // Use correct address type constants: 'legacy', 'segwit-native', 'segwit-compatible'
          const [legacyAddr, segwitAddr, segwitCompatibleAddr] =
            await Promise.all([
              BBMTLibNativeModule.btcAddress(btcPub!, newNetwork, 'legacy'),
              BBMTLibNativeModule.btcAddress(
                btcPub!,
                newNetwork,
                'segwit-native',
              ),
              BBMTLibNativeModule.btcAddress(
                btcPub!,
                newNetwork,
                'segwit-compatible',
              ),
            ]);
          if (legacyAddr) setLegacyAddress(legacyAddr);
          if (segwitAddr) setSegwitAddress(segwitAddr);
          if (segwitCompatibleAddr)
            setSegwitCompatibleAddress(segwitCompatibleAddr);
          dbg('Address type modal updated for network:', newNetwork);
          dbg('Legacy:', legacyAddr);
          dbg('Segwit:', segwitAddr);
          dbg('Nested SegWit:', segwitCompatibleAddr);
        } else {
          dbg('Could not get or derive btcPub for address generation');
        }
      } catch (error) {
        dbg('updateAddressTypeModal: Error updating addresses:', error);
      }
    },
    [addressType],
  );
  // Function to update address for the new network
  const updateAddressForNetwork = useCallback(
    async (newNetwork: string) => {
      try {
        dbg(
          '=== updateAddressForNetwork: Updating address for network:',
          newNetwork,
        );
        // Get the current address type - prefer UserContext (single source of truth),
        // then state, then cache, then default
        const currentAddressType =
          userAddressType ||
          addressType ||
          (await LocalCache.getItem('addressType')) ||
          'segwit-native';
        dbg(
          'Using address type:',
          currentAddressType,
          'for network:',
          newNetwork,
          '(from UserContext:',
          userAddressType,
          ', from state:',
          addressType,
          ')',
        );
        // Always derive btcPub fresh to ensure it matches the current address type
        // This prevents issues where btcPub was derived with a different address type
        let btcPub: string | null = null;
        const jks = await EncryptedStorage.getItem('keyshare');
        if (!jks) {
          dbg('No keyshare found for address generation');
          return;
        }
        const ks = JSON.parse(jks);
        const useLegacyPath = isLegacyWallet(ks.created_at);
        const externalIndex = await getExternalIndex(newNetwork, currentAddressType);
        const path = getReceivePath(
          newNetwork,
          currentAddressType,
          useLegacyPath,
          externalIndex,
        );
        btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        // Store it for future use
        if (btcPub) {
          await EncryptedStorage.setItem('btcPub', btcPub);
          dbg(
            'btcPub derived and stored with address type:',
            currentAddressType,
          );
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
            const timestamp = Date.now();
            dbg(
              '[WalletHome] updateAddressForNetwork: Generated new address:',
              {
                timestamp,
                address: newAddress,
                shortAddress: `${newAddress.substring(
                  0,
                  8,
                )}...${newAddress.substring(newAddress.length - 8)}`,
                network: newNetwork,
                addressType: currentAddressType,
                derivationPath: path,
                stackTrace: new Error().stack
                  ?.split('\n')
                  .slice(1, 4)
                  .join(' -> '),
              },
            );
            // Update state and cache
            dbg(`[WalletHome] setAddress() called with:`, {
              timestamp: Date.now(),
              address: newAddress,
              shortAddress: `${newAddress.substring(
                0,
                8,
              )}...${newAddress.substring(newAddress.length - 8)}`,
              previousAddress: address
                ? `${address.substring(0, 8)}...${address.substring(
                    address.length - 8,
                  )}`
                : 'EMPTY',
            });
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
    [addressType, userAddressType, address],
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
        const currentAddressType =
          (await LocalCache.getItem('addressType')) || 'segwit-native';
        const useLegacyPath = isLegacyWallet(ks.created_at);
        const externalIndex = await getExternalIndex(network, currentAddressType);
        const path = getReceivePath(
          network,
          currentAddressType,
          useLegacyPath,
          externalIndex,
        );
        // Always derive btcPub fresh to ensure it's current (HD: at current external index)
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
        const addrType =
          (await LocalCache.getItem('addressType')) || 'segwit-native';
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
        // Get keyshare label (KeyShare1/2/3) or fallback to local_party_key
        const keyshareLabel = getKeyshareLabel(ks);
        const shareID = keyshareLabel || ks.local_party_key || '';
        setParty(shareID);
        // Generate and store current address
        const btcAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          actualNet,
          addrType,
        );
        dbg(`[WalletHome] reinitializeWallet - Setting address:`, {
          timestamp: Date.now(),
          address: btcAddress
            ? `${btcAddress.substring(0, 8)}...${btcAddress.substring(
                btcAddress.length - 8,
              )}`
            : 'EMPTY',
          network: actualNet,
          addressType: addrType,
          previousAddress: address
            ? `${address.substring(0, 8)}...${address.substring(
                address.length - 8,
              )}`
            : 'EMPTY',
        });
        await LocalCache.setItem('currentAddress', btcAddress);
        setAddress(btcAddress);
        // Preload transactions from cache (wallet-level for HD, single-addr fallback)
        try {
          const cachedTxs =
            await WalletService.getInstance().transactionsFromCacheForWallet(
              actualNet,
              addrType,
            );
          setInitialTransactions(Array.isArray(cachedTxs) ? cachedTxs : []);
        } catch {
          try {
            const fallback =
              await WalletService.getInstance().transactionsFromCache(btcAddress);
            setInitialTransactions(Array.isArray(fallback) ? fallback : []);
          } catch {}
        }
        // Set up API URL from NetworkContext
        const api = apiBase || (await LocalCache.getItem('api'));
        if (api) {
          await BBMTLibNativeModule.setAPI(actualNet, api);
          dbg('API set for network:', actualNet, 'API:', api);
        }
        // Initialize UI directly from persistent wallet cache (exact v1.3.2 analogy)
        try {
          const cachedPrice = await WalletService.getInstance().getCachePrice();
          const cachedAggregate =
            await WalletService.getInstance().getCachedAggregateBalance(
              actualNet,
              addrType,
            );
          const cachedBal =
            cachedAggregate ??
            (await WalletService.getInstance().getBal(btcAddress));
          const cachedTxs =
            await WalletService.getInstance().transactionsFromCacheForWallet(
              actualNet,
              addrType,
            ).catch(() =>
              WalletService.getInstance().transactionsFromCache(btcAddress),
            );
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
              // Normalize balance to ensure no negative zero
              const normalizedBTC = cachedBal.btc || '0.00000000';
              const balanceNum = parseFloat(normalizedBTC);
              const finalBTC = balanceNum <= 0 ? '0.00000000' : normalizedBTC;
              setBalanceBTC(finalBTC);
              const r =
                (cachedPrice.rates?.[currency] as number) ||
                (cachedPrice.rate as number) ||
                0;
              if (r && Number(cachedBal.btc) >= 0) {
                const fiatBalance = Number(cachedBal.btc) * r;
                setBalanceFiat(Math.max(0, fiatBalance).toFixed(2));
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
    [network, apiBase, showErrorToast, address],
  );
  // Listen for navigation state changes to detect returning from settings
  useEffect(() => {
    const unsubscribe = nav.addListener('focus', async () => {
      const focusTime = Date.now();
      dbg(
        '[WalletHome] === Navigation focus - Screen came into focus, reinitializing wallet',
        {
          timestamp: focusTime,
          network,
          apiBase,
          currentAddress: address
            ? `${address.substring(0, 8)}...${address.substring(
                address.length - 8,
              )}`
            : 'EMPTY',
          userActiveAddress: userActiveAddress
            ? `${userActiveAddress.substring(
                0,
                8,
              )}...${userActiveAddress.substring(userActiveAddress.length - 8)}`
            : 'EMPTY',
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join(' -> '),
        },
      );
      // Full re-initialization when returning from settings
      // This ensures everything is properly set up for the current network
      if (network && apiBase) {
        dbg(
          '[WalletHome] Focus - NetworkContext is ready, performing full re-initialization',
          {
            timestamp: Date.now(),
            network,
            apiBase,
          },
        );
        await reinitializeWallet(true);
      }
    });
    return unsubscribe;
  }, [nav, network, apiBase, reinitializeWallet, address, userActiveAddress]);
  // Listen for app state changes (simplified)
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: string) => {
      if (nextAppState === 'active') {
        const resumeTime = Date.now();
        dbg('[WalletHome] === App resumed, refreshing data', {
          timestamp: resumeTime,
          network,
          apiBase,
          currentAddress: address
            ? `${address.substring(0, 8)}...${address.substring(
                address.length - 8,
              )}`
            : 'EMPTY',
          userActiveAddress: userActiveAddress
            ? `${userActiveAddress.substring(
                0,
                8,
              )}...${userActiveAddress.substring(userActiveAddress.length - 8)}`
            : 'EMPTY',
          addressType,
          userAddressType,
        });
        // Simply refresh data on app resume
        if (network && apiBase) {
          dbg('[WalletHome] App resumed - calling updateAddressForNetwork', {
            timestamp: Date.now(),
            network,
          });
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
  }, [
    network,
    apiBase,
    updateAddressForNetwork,
    updateAddressTypeModal,
    address,
    userActiveAddress,
    addressType,
    userAddressType,
  ]);
  // No periodic check needed - NetworkContext is the single source of truth
  const cacheIndicatorRef = useRef<CacheIndicatorHandle>(null);
  const {theme} = useTheme();
  const isDarkMode = theme.colors.background !== '#ffffff';
  const styles = {
    ...createStyles(theme),
    sendButtonDisabled: {
      opacity: 0.6,
    } as const,
    balanceContainer: {
      ...createStyles(theme).balanceContainer,
      backgroundColor: isDarkMode
        ? theme.colors.blackOverlay30 // Darker background in dark mode
        : theme.colors.whiteOverlay08, // Original light mode background
      borderColor: isDarkMode
        ? theme.colors.whiteOverlay25 // Match eye and sats button border color in dark mode
        : theme.colors.whiteOverlay15, // Original light mode border
    },
  };
  const headerLeft = React.useCallback(
    () => (
      <HeaderPriceButton
        btcPrice={btcPrice}
        selectedCurrency={selectedCurrency}
        onCurrencyPress={() => setIsCurrencySelectorVisible(true)}
      />
    ),
    [btcPrice, selectedCurrency],
  );
  const headerTitle = React.useCallback(
    () => <HeaderProvider apiBase={apiBase} />,
    [apiBase],
  );
  const headerRight = React.useCallback(
    () => (
      <HeaderNetwork
        network={network}
        onPress={() =>
          navigation.navigate('Settings', {expandSection: 'advanced'})
        }
      />
    ),
    [network, navigation],
  );
  useEffect(() => {
    navigation.setOptions({
      headerLeft,
      headerTitle,
      headerRight,
      headerTitleAlign: 'center',
      headerStyle: {
        backgroundColor: theme.colors.background,
      },
      headerTitleContainerStyle: {
        flex: 1,
        minWidth: 0,
        marginHorizontal: 0,
      },
    });
  }, [
    navigation,
    headerLeft,
    headerTitle,
    headerRight,
    theme.colors.background,
  ]);
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
      setAddressType(addrType || 'segwit-native');
    });
    LocalCache.getItem('currency').then(currency => {
      setSelectedCurrency(currency || 'USD');
    });
    // Load balance visibility preference
    LocalCache.getItem('balanceHidden').then(hidden => {
      setIsBlurred(hidden === 'true');
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
  // Check for txId in route params and show success alert with explorer link
  useEffect(() => {
    const txId = route.params?.txId;
    if (txId && apiBase) {
      // Construct explorer URL (same pattern as TransactionDetailsModal)
      const baseUrl = apiBase.replace(/\/+$/, '').replace(/\/api\/?$/, '');
      const explorerLink = `${baseUrl}/tx/${txId}`;
      // Show alert with Cancel/Close and Explore buttons
      Alert.alert(
        '✔️ Transaction Sent',
        `TxID: ${txId.substring(0, 8)}...${txId.substring(txId.length - 8)}`,
        [
          {
            text: 'Close',
            style: 'cancel',
            onPress: () => {
              // Clear the txId from route params to prevent showing again
              transactionListRef.current?.refresh?.();
              navigation.setParams({txId: undefined});
            },
          },
          {
            text: '🔎 Explorer',
            style: 'default',
            onPress: () => {
              transactionListRef.current?.refresh?.();
              // Clear the txId from route params
              navigation.setParams({txId: undefined});
              Linking.openURL(explorerLink).catch(err => {
                dbg('Error opening explorer link:', err);
                Alert.alert('Error', 'Failed to open explorer link');
              });
            },
          },
        ],
        {cancelable: false},
      );
    }
  }, [route.params?.txId, apiBase, navigation]);
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
          navigation.reset(getResetToMainTabsWallet({}, { showPlay: activeNetwork === 'mainnet' && showMempoolPlayground, showUtxos: showUtxosTab, showPsbt: showPsbtTab, showWallet: showWalletTab }));
          return;
        }
        if (!ks.pub_key || !ks.chain_code_hex || !ks.local_party_key) {
          dbg('Invalid pub_key or chain_code_hex or local_party_key');
          navigation.reset(getResetToMainTabsWallet({}, { showPlay: activeNetwork === 'mainnet' && showMempoolPlayground, showUtxos: showUtxosTab, showPsbt: showPsbtTab, showWallet: showWalletTab }));
          return;
        }
        const currentAddressType =
          (await LocalCache.getItem('addressType')) || 'segwit-native';
        const useLegacyPath = isLegacyWallet(ks.created_at);
        const externalIndex = await getExternalIndex(network, currentAddressType);
        const path = getReceivePath(
          network,
          currentAddressType,
          useLegacyPath,
          externalIndex,
        );
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
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
          addrType = 'segwit-native';
          await LocalCache.setItem('addressType', addrType);
          dbg('WalletHome: Setting default address type to segwit-native');
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
        // Get keyshare label (KeyShare1/2/3) or fallback to local_party_key
        const keyshareLabel = getKeyshareLabel(ks);
        const shareID = keyshareLabel || ks.local_party_key || '';
        setParty(shareID);
        // Get current address type and generate address
        setAddressType(addrType);
        // Generate and store current address
        const btcAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          addrType,
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
          // Normalize balance to ensure no negative zero
          const normalizedBTC = cachedBal.btc || '0.00000000';
          const balanceNum = parseFloat(normalizedBTC);
          const finalBTC = balanceNum <= 0 ? '0.00000000' : normalizedBTC;
          setBalanceBTC(finalBTC);
          const r =
            (priceResponse?.rates?.[currency] as number) ||
            (priceResponse?.rate as number) ||
            0;
          if (r && Number(cachedBal.btc) > 0) {
            const fiatBalance = Number(cachedBal.btc) * r;
            setBalanceFiat(Math.max(0, fiatBalance).toFixed(2));
          }
        }
        setCacheTimestamps({
          price: priceResponse.timestamp,
          balance: priceResponse.timestamp,
        });
        setLoading(false);
        setIsInitialized(true);
        // Check if this is a legacy wallet and show migration modal if needed
        // Modal shows by default unless user checked "do not remind" (flag = "yes")
        if (useLegacyPath) {
          const doNotRemind = await LocalCache.getItem(
            'legacyWalletModalDoNotRemind',
          );
          if (doNotRemind !== 'yes') {
            // Small delay to ensure UI is ready
            setTimeout(() => {
              setIsLegacyWalletModalVisible(true);
            }, 500);
          }
        }
        // Force initial balance fetch
        await fetchDataRef.current?.();
        dbg('Wallet initialization completed successfully');
      } catch (error) {
        dbg('Error initializing wallet:', error);
        showErrorToast('Failed to initialize wallet. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [showErrorToast, isInitialized, address, navigation, network, activeNetwork, showMempoolPlayground, showUtxosTab, showPsbtTab, showWalletTab]);
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
  }, [isInitialized, address, activeNetwork, showMempoolPlayground]);
  const handleBlurred = () => {
    const blurr = !isBlurred;
    setIsBlurred(blurr);
    LocalCache.setItem('balanceHidden', blurr ? 'true' : 'false');
  };
  const handleSend = async (
    to: string,
    amountSats: Big,
    feeSats: Big,
    spendingHash: string,
  ) => {
    if (!isSending && amountSats.gt(0) && feeSats.gt(0) && to) {
      setIsSending(true);
      // Close send modal immediately
      setIsSendModalVisible(false);
      // Check if keyshare supports Nostr (has nostr_npub)
      try {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (keyshareJSON) {
          const keyshare = JSON.parse(keyshareJSON);
          const hasNostrSupport =
            keyshare.nostr_npub && keyshare.nostr_npub.trim() !== '';
          if (!hasNostrSupport) {
            // Keyshare was generated with local mode, navigate directly to MobilesPairing
            const toAddress = to;
            const satoshiAmount = amountSats.toString().split('.')[0];
            const fiatAmount = amountSats.times(btcRate).div(1e8).toFixed(2);
            const satoshiFees = feeSats.toString().split('.')[0];
            const fiatFees = feeSats.times(btcRate).div(1e8).toFixed(2);
            // CRITICAL: In send mode, ALL parameters MUST come from route params (no fallbacks)
            // If scanned from QR, use QR values; otherwise use computed values from handleSend
            let addressTypeToUse = '';
            let derivationPathToUse = '';
            let networkToUse = '';
            let fromAddressToUse = '';
            if (scannedFromQR) {
              // Use values from scanned QR code
              addressTypeToUse =
                scannedAddressType && scannedAddressType.trim() !== ''
                  ? scannedAddressType
                  : '';
              derivationPathToUse =
                currentDerivationPath && currentDerivationPath.trim() !== ''
                  ? currentDerivationPath
                  : '';
              networkToUse =
                scannedNetwork && scannedNetwork.trim() !== ''
                  ? scannedNetwork
                  : '';
              fromAddressToUse = '';
            } else {
              // Use computed values from handleSend (sender device)
              // Compute derivation path if not already set
              addressTypeToUse = addressType || 'segwit-native';
              if (
                !currentDerivationPath ||
                currentDerivationPath.trim() === ''
              ) {
                const useLegacyPath = isLegacyWallet(keyshare.created_at);
                const normalizedNetwork =
                  network === 'testnet3' ? 'testnet' : network || 'mainnet';
                const externalIndex = await getExternalIndex(
                  network || 'mainnet',
                  addressTypeToUse,
                );
                derivationPathToUse = getReceivePath(
                  normalizedNetwork,
                  addressTypeToUse,
                  useLegacyPath,
                  externalIndex,
                );
              } else {
                derivationPathToUse = currentDerivationPath;
              }
              networkToUse = network || 'mainnet'; // Keep native format
              fromAddressToUse = computedFromAddress;
            }
            // Validate required parameters
            if (!addressTypeToUse || addressTypeToUse.trim() === '') {
              Alert.alert(
                'Error',
                'Address type is required for send transaction',
              );
              setIsSending(false);
              return;
            }
            if (!derivationPathToUse || derivationPathToUse.trim() === '') {
              Alert.alert(
                'Error',
                'Derivation path is required for send transaction',
              );
              setIsSending(false);
              return;
            }
            if (!networkToUse || networkToUse.trim() === '') {
              Alert.alert('Error', 'Network is required for send transaction');
              setIsSending(false);
              return;
            }
            const navigationParams = {
              mode: 'send_btc',
              addressType: addressTypeToUse.trim(), // MANDATORY: address type from sender or QR
              toAddress,
              satoshiAmount,
              fiatAmount,
              satoshiFees,
              fiatFees,
              selectedCurrency,
              spendingHash,
              derivationPath: derivationPathToUse.trim(), // MANDATORY: derivation path from sender or QR
              network: networkToUse.trim(), // MANDATORY: network from sender or QR (native format)
            };
            dbg(
              '=== WalletHome: Navigating to MobilesPairing (no Nostr support) ===',
              {
                scannedFromQR,
                params: {
                  addressType: addressTypeToUse,
                  derivationPath: derivationPathToUse,
                  network: networkToUse,
                  fromAddress: fromAddressToUse,
                  toAddress,
                  satoshiAmount,
                  satoshiFees,
                },
                source: {
                  scannedAddressType,
                  scannedNetwork,
                  currentDerivationPath,
                  computedFromAddress,
                  walletAddressType: addressType,
                  walletNetwork: network,
                },
              },
            );
            navigation.dispatch(
              CommonActions.navigate({
                name: 'Devices Pairing',
                params: navigationParams,
              }),
            );
            setIsSending(false);
            setScannedFromQR(false);
            setScannedAddressType('');
            setCurrentDerivationPath('');
            setScannedNetwork('');
            setComputedFromAddress('');
            return;
          }
        }
      } catch (error) {
        dbg('Error checking keyshare for Nostr support:', error);
        // Continue to show transport selector if check fails
      }
      // CRITICAL: Compute derivation path, from address, and ensure network is in native format
      // This ensures all parameters are correctly propagated to pairing screens
      let derivationPath = '';
      let fromAddress = '';
      try {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (keyshareJSON) {
          const keyshare = JSON.parse(keyshareJSON);
          const useLegacyPath = isLegacyWallet(keyshare.created_at);
          const currentAddressType = addressType || 'segwit-native';
          const normalizedNetwork =
            network === 'testnet3' ? 'testnet' : network;
          const externalIndex = await getExternalIndex(
            network || 'mainnet',
            currentAddressType,
          );
          derivationPath = getReceivePath(
            normalizedNetwork,
            currentAddressType,
            useLegacyPath,
            externalIndex,
          );
          // Derive the public key using the computed derivation path (current receive address)
          const publicKey = await BBMTLibNativeModule.derivePubkey(
            keyshare.pub_key,
            keyshare.chain_code_hex,
            derivationPath,
          );
          // Compute from address using native network format (requires 'testnet3' not 'testnet')
          const nativeNetwork = network || 'mainnet'; // Keep native format
          fromAddress = await BBMTLibNativeModule.btcAddress(
            publicKey,
            nativeNetwork,
            currentAddressType,
          );
          dbg(
            '=== WalletHome: Computed derivation path and from address for sender device ===',
            {
              network: nativeNetwork,
              normalizedNetwork,
              addressType: currentAddressType,
              derivationPath,
              fromAddress,
              useLegacyPath,
            },
          );
        }
      } catch (error) {
        dbg(
          'Error computing derivation path and from address for send:',
          error,
        );
      }
      setCurrentDerivationPath(derivationPath);
      setComputedFromAddress(fromAddress);
      // Store params and show transport selector after a brief delay to ensure send modal is closed
      setPendingSendParams({to, amountSats, feeSats, spendingHash});
      setTimeout(() => {
        setIsTransportModalVisible(true);
        setIsSending(false);
      }, 300);
    }
  };
  const navigateToPairing = async (transport: 'local' | 'nostr') => {
    if (!pendingSendParams) return;
    const {to, amountSats, feeSats, spendingHash} = pendingSendParams;
    const toAddress = to;
    const satoshiAmount = amountSats.toString().split('.')[0];
    const fiatAmount = amountSats.times(btcRate).div(1e8).toFixed(2);
    const satoshiFees = feeSats.toString().split('.')[0];
    const fiatFees = feeSats.times(btcRate).div(1e8).toFixed(2);
    // CRITICAL: In send mode, ALL parameters MUST come from route params (no fallbacks)
    // If scanned from QR, use QR values; otherwise use computed values from handleSend
    let addressTypeToUse = '';
    let derivationPathToUse = '';
    let networkToUse = '';
    let fromAddressToUse = '';
    if (scannedFromQR) {
      // Use values from scanned QR code
      addressTypeToUse =
        scannedAddressType && scannedAddressType.trim() !== ''
          ? scannedAddressType
          : '';
      derivationPathToUse =
        currentDerivationPath && currentDerivationPath.trim() !== ''
          ? currentDerivationPath
          : '';
      networkToUse =
        scannedNetwork && scannedNetwork.trim() !== '' ? scannedNetwork : '';
      // For QR scan, fromAddress will be computed by pairing screen from derivationPath
      fromAddressToUse = '';
    } else {
      // Use computed values from handleSend (sender device)
      addressTypeToUse = addressType || 'segwit-native';
      derivationPathToUse = currentDerivationPath;
      networkToUse = network || 'mainnet'; // Keep native format
      fromAddressToUse = computedFromAddress;
    }
    // Validate required parameters
    if (!addressTypeToUse || addressTypeToUse.trim() === '') {
      Alert.alert('Error', 'Address type is required for send transaction');
      return;
    }
    if (!derivationPathToUse || derivationPathToUse.trim() === '') {
      Alert.alert('Error', 'Derivation path is required for send transaction');
      return;
    }
    if (!networkToUse || networkToUse.trim() === '') {
      Alert.alert('Error', 'Network is required for send transaction');
      return;
    }
    const routeName =
      transport === 'local' ? 'Devices Pairing' : 'Nostr Connect';
    const navigationParams = {
      mode: 'send_btc',
      addressType: addressTypeToUse.trim(), // MANDATORY: address type from sender or QR
      toAddress,
      satoshiAmount,
      fiatAmount,
      satoshiFees,
      fiatFees,
      selectedCurrency,
      spendingHash,
      derivationPath: derivationPathToUse.trim(), // MANDATORY: derivation path from sender or QR
      network: networkToUse.trim(), // MANDATORY: network from sender or QR (native format)
    };
    dbg('=== WalletHome: Navigating to pairing screen ===', {
      routeName,
      transport,
      scannedFromQR,
      params: {
        addressType: addressTypeToUse,
        derivationPath: derivationPathToUse,
        network: networkToUse,
        fromAddress: fromAddressToUse,
        toAddress,
        satoshiAmount,
        satoshiFees,
      },
      source: {
        scannedAddressType,
        scannedNetwork,
        currentDerivationPath,
        computedFromAddress,
        walletAddressType: addressType,
        walletNetwork: network,
      },
    });
    navigation.dispatch(
      CommonActions.navigate({
        name: routeName,
        params: navigationParams,
      }),
    );
    setPendingSendParams(null);
    setScannedFromQR(false); // Reset flag
    setScannedAddressType(''); // Reset scanned address type
    setCurrentDerivationPath(''); // Reset derivation path
    setScannedNetwork(''); // Reset scanned network
    setComputedFromAddress(''); // Reset computed from address
  };
  // Process scanned QR data: if raw data is a valid address for current network, open SendBitcoinModal; else try decodeSendBitcoinQR
  const processScannedQRData = useCallback(
    (qrData: string) => {
      dbg('Scanned QR data:', qrData.substring(0, 100));
      const trimmed = qrData.trim();

      // Extension pairing: pairing_code=... from Bold extension QR
      const pairingCode = parsePairingCodeFromScannedData(trimmed);
      if (pairingCode) {
        if (extensionBindAlertShownRef.current) return;
        extensionBindAlertShownRef.current = true;
        setIsQRScannerVisible(false);
        setPendingExtensionPairingCode(pairingCode);
        setIsExtensionPairingModalVisible(true);
        return;
      }

      // Support BIP-21: "bitcoin:<address>" or "bitcoin:<address>?amount=..."
      const addressCandidate = trimmed.startsWith('bitcoin:')
        ? trimmed.replace(/^bitcoin:/i, '').split('?')[0].trim()
        : trimmed;
      const networkForValidation =
        network === 'testnet3' ? 'testnet' : (network || 'mainnet');
      if (
        addressCandidate &&
        validateBitcoinAddressEnhanced(
          addressCandidate,
          networkForValidation,
        )
      ) {
        setInitialSendAddress(addressCandidate);
        setIsSendModalVisible(true);
        return;
      }
      const otherNetwork =
        networkForValidation === 'mainnet' ? 'testnet' : 'mainnet';
      if (
        addressCandidate &&
        validateBitcoinAddressEnhanced(addressCandidate, otherNetwork)
      ) {
        const now = Date.now();
        if (
          lastInvalidQrRef.current.data === qrData &&
          now - lastInvalidQrRef.current.time < 2000
        ) {
          return;
        }
        lastInvalidQrRef.current = {data: qrData, time: now};
        const currentLabel =
          networkForValidation === 'mainnet' ? 'mainnet' : 'testnet';
        const addressLabel =
          otherNetwork === 'mainnet' ? 'mainnet' : 'testnet';
        Alert.alert(
          'Wrong network',
          `This address is for ${addressLabel} but you're on ${currentLabel}. Switch network in Settings or scan an address for ${currentLabel}.`,
        );
        return;
      }
      const decoded = decodeSendBitcoinQR(qrData) as {
      toAddress: string;
      amountSats: string;
      feeSats: string;
      spendingHash?: string;
      addressType?: string;
      derivationPath?: string;
      network?: string;
    } | null;
    if (
      !decoded ||
      !decoded.toAddress ||
      !decoded.amountSats ||
      !decoded.feeSats
    ) {
      const now = Date.now();
      if (
        lastInvalidQrRef.current.data === qrData &&
        now - lastInvalidQrRef.current.time < 2000
      ) {
        return;
      }
      lastInvalidQrRef.current = {data: qrData, time: now};
      Alert.alert(
        'Invalid QR Code',
        'The scanned QR code does not contain valid send bitcoin data. Please scan the QR code from the device that initiated the transaction.',
      );
      return;
    }
    // Validate Bitcoin address
    if (!validateBitcoinAddress(decoded.toAddress)) {
      Alert.alert(
        'Invalid Address',
        'The scanned QR code contains an invalid Bitcoin address.',
      );
      return;
    }
    // Convert to Big for consistency
    const amountSats = Big(decoded.amountSats);
    const feeSats = Big(decoded.feeSats);
    if (amountSats.lte(0) || feeSats.lte(0)) {
      Alert.alert(
        'Invalid Amount',
        'The scanned QR code contains invalid amount or fee values.',
      );
      return;
    }
    // Store address type, derivation path, and network from QR code if available
    // These are critical to ensure the second device uses the same source address and network
    dbg('=== WalletHome: Processing scanned QR code data ===', {
      decoded: {
        toAddress: decoded.toAddress,
        amountSats: decoded.amountSats,
        feeSats: decoded.feeSats,
        spendingHash: decoded.spendingHash,
        addressType: decoded.addressType,
        derivationPath: decoded.derivationPath,
        network: decoded.network,
      },
    });
    if (decoded.addressType) {
      setScannedAddressType(decoded.addressType);
      dbg('WalletHome: Address type from QR code:', decoded.addressType);
    }
    if (decoded.derivationPath) {
      setCurrentDerivationPath(decoded.derivationPath);
      dbg('WalletHome: Derivation path from QR code:', decoded.derivationPath);
    }
    if (decoded.network) {
      // Keep native format from QR code (native module requires 'testnet3' not 'testnet')
      setScannedNetwork(decoded.network);
      dbg('WalletHome: Network from QR code:', decoded.network);
    }
    // Store params and mark as scanned from QR
    setPendingSendParams({
      to: decoded.toAddress,
      amountSats,
      feeSats,
      spendingHash: decoded.spendingHash || '',
    });
    setScannedFromQR(true);
    // Show transport selector immediately (no QR code shown since data came from scan)
    setTimeout(() => {
      setIsTransportModalVisible(true);
    }, 300);
    },
    [network],
  );
  // Handle QR scan for send bitcoin data
  const handleScanQRForSend = useCallback(() => {
    setIsQRScannerVisible(true);
  }, []);
  // Animated style for balance update
  const balanceAnimatedStyle = useAnimatedStyle(() => ({
    opacity: balanceUpdateAnimation.value,
  }));

  if (loading && !isInitialized) {
    return <WalletSkeleton />;
  }
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <View style={styles.contentContainer}>
        <View style={styles.walletHeader}>
          <View style={styles.balanceContainer}>
            {/* Eye icon on left */}
            <AppPressable
              onPress={() => {
                handleBlurred();
              }}
              style={styles.balanceEyeIcon}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
              accessibilityLabel={isBlurred ? 'Show balance' : 'Hide balance'}
              accessibilityRole="button">
              <Image
                source={
                  isBlurred
                    ? require('../assets/eye-off-icon.png')
                    : require('../assets/eye-on-icon.png')
                }
                style={styles.balanceIcon}
                resizeMode="contain"
                accessibilityLabel={
                  isBlurred ? 'Balance hidden' : 'Balance visible'
                }
              />
            </AppPressable>
            {/* Balance content in center */}
            <View style={styles.balanceContentContainer}>
              {balanceError && !isBlurred ? (
                <View style={styles.balanceErrorContainer}>
                  <AppText style={styles.balanceErrorText}>{balanceError}</AppText>
                </View>
              ) : (
                <>
                  <Animated.View
                    style={[styles.balanceRowWithMargin, balanceAnimatedStyle]}
                    pointerEvents="box-none">
                    <AppPressable
                      style={styles.balanceTouchable}
                      onPress={() => {
                        handleBlurred();
                      }}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                      accessibilityLabel={`Bitcoin balance: ${
                        isBlurred
                          ? 'hidden'
                          : formatBitcoinDisplay(balanceBTC || '0', {
                              inSats: showSats,
                              formatted: balanceFormattingEnabled,
                            })
                      }`}
                      accessibilityHint="Double tap to toggle balance visibility"
                      accessibilityRole="button">
                      {isBalanceLoading && !isBlurred && !isRefreshing ? (
                        <ActivityIndicator
                          size="small"
                          color={theme.colors.white}
                          style={styles.balanceLoadingIndicator}
                        />
                      ) : (
                        <Text
                          style={styles.balanceBTC}
                          numberOfLines={1}
                          adjustsFontSizeToFit={true}
                          minimumFontScale={0.4}
                          allowFontScaling={true}>
                          {isBlurred
                            ? showSats
                              ? '********* ₿'
                              : '********* BTC'
                            : formatBitcoinDisplay(balanceBTC || '0', {
                                inSats: showSats,
                                formatted: balanceFormattingEnabled,
                              })}
                        </Text>
                      )}
                    </AppPressable>
                  </Animated.View>
                  {btcRate > 0 && (
                    <Animated.View
                      style={[
                        styles.balanceRowWithMargin,
                        balanceAnimatedStyle,
                      ]}
                      pointerEvents="box-none">
                      <AppPressable
                        style={styles.balanceTouchable}
                        onPress={() => {
                          handleBlurred();
                        }}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        accessibilityLabel={`Fiat balance: ${
                          isBlurred
                            ? 'hidden'
                            : (() => {
                                const fiatValue =
                                  balanceFiat === '-' ? '0' : balanceFiat;
                                return balanceFormattingEnabled
                                  ? `${getCurrencySymbol(
                                      selectedCurrency,
                                    )}${presentFiat(fiatValue)}`
                                  : `${getCurrencySymbol(
                                      selectedCurrency,
                                    )}${fiatValue}`;
                              })()
                        }`}
                        accessibilityHint="Double tap to toggle balance visibility"
                        accessibilityRole="button">
                        {isBalanceLoading && !isBlurred && !isRefreshing ? (
                          <ActivityIndicator
                            size="small"
                            color={theme.colors.white}
                            style={styles.balanceLoadingIndicator}
                          />
                        ) : (
                          <Text
                            style={styles.balanceFiat}
                            numberOfLines={1}
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.5}
                            allowFontScaling={true}>
                            {isBlurred
                              ? `${getCurrencySymbol(selectedCurrency)} ******`
                              : (() => {
                                  const fiatValue =
                                    balanceFiat === '-' ? '0' : balanceFiat;
                                  return balanceFormattingEnabled
                                    ? `${getCurrencySymbol(
                                        selectedCurrency,
                                      )}${presentFiat(fiatValue)}`
                                    : `${getCurrencySymbol(
                                        selectedCurrency,
                                      )}${fiatValue}`;
                                })()}
                          </Text>
                        )}
                      </AppPressable>
                    </Animated.View>
                  )}
                </>
              )}
            </View>
            {/* Unit toggle on right - always visible */}
            <View style={styles.balanceUnitToggleContainer}>
              <AppPressable
                onPress={() => {
                  setShowSatsGlobal(!showSats);
                }}
                style={styles.balanceUnitToggle}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                accessibilityLabel={`Switch to ${
                  showSats ? 'BTC' : 'sats'
                }`}
                accessibilityRole="button">
                <AppText style={styles.balanceUnitToggleText}>
                  {showSats ? '₿' : 'BTC'}
                </AppText>
              </AppPressable>
            </View>
          </View>
          <View style={styles.actions}>
            <AppPressable
              style={[
                styles.actionButton,
                styles.sendButton,
                styles.flexOneMinWidthZero,
                isCheckingBalanceForSend && styles.sendButtonDisabled,
              ]}
              onPress={async () => {
                // Check if balance is 0 or empty
                const balance = parseFloat(balanceBTC || '0');
                if (balance <= 0) {
                  // Balance might not be loaded yet, check it
                  setIsCheckingBalanceForSend(true);
                  try {
                    const newBalance = await checkBalanceForSend();
                    if (newBalance > 0) {
                      // Balance found, open modal
                      setIsSendModalVisible(true);
                    } else {
                      // Still zero, show alert
                      Alert.alert(
                        'Insufficient Balance',
                        "You don't have any satoshis to send.",
                      );
                    }
                  } catch (error) {
                    dbg('Error checking balance for send:', error);
                    // On error, just re-enable button and let user retry
                  } finally {
                    setIsCheckingBalanceForSend(false);
                  }
                  return;
                }
                setIsSendModalVisible(true);
              }}
              disabled={isCheckingBalanceForSend}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
              accessibilityLabel={
                isCheckingBalanceForSend ? 'Checking balance' : 'Send Bitcoin'
              }
              accessibilityHint="Double tap to send Bitcoin. Checking balance if needed."
              accessibilityRole="button"
              accessibilityState={{disabled: isCheckingBalanceForSend}}>
              {isCheckingBalanceForSend ? (
                <ActivityIndicator size="small" color={theme.colors.white} />
              ) : (
                <>
                  <Image
                    source={require('../assets/send-icon.png')}
                    style={styles.actionButtonIcon}
                    resizeMode="contain"
                    accessibilityLabel="Send icon"
                  />
                  <AppText style={styles.sendButtonText} tone="onPrimary">
                    Send
                  </AppText>
                </>
              )}
            </AppPressable>
            {/* Scan QR button replaces lock button in action row */}
            <AppPressable
              style={[styles.actionButton, styles.addressTypeModalButton]}
              onPress={handleScanQRForSend}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
              accessibilityLabel="Scan QR code"
              accessibilityHint="Double tap to scan QR code for sending Bitcoin"
              accessibilityRole="button">
              <Image
                source={require('../assets/scan-icon.png')}
                style={styles.addressTypeButtonIcon}
                resizeMode="contain"
                accessibilityLabel="Scan QR code icon"
              />
            </AppPressable>
            <AppPressable
              style={[
                styles.actionButton,
                styles.receiveButton,
                styles.flexOneMinWidthZero,
              ]}
              onPress={async () => {
                try {
                  const ws = WalletService.getInstance();
                  const effectiveAddressType =
                    addressType || 'segwit-native';
                  const restoreDoneKey = `hd_restore_done_${network}_${effectiveAddressType}`;
                  const restoreDone =
                    (await LocalCache.getItem(restoreDoneKey)) === 'yes';

                  // Only run full restore discovery once per (network, addressType)
                  if (!restoreDone) {
                    setIsRestoringIndexes(true);
                    setRestoreProgress(null);
                    const apiUrl =
                      apiBase ||
                      (network === 'mainnet'
                        ? 'https://mempool.space/api'
                        : 'https://mempool.space/testnet/api');
                    await ws.discoverHdIndexesForNetwork(
                      network,
                      effectiveAddressType,
                      apiUrl,
                      (chain, index, gapIndex) =>
                        setRestoreProgress({chain, index, gapIndex}),
                    );
                    await refreshUserContext();
                  }

                  const info = await ws.getCurrentReceivePathInfo(
                    network,
                    effectiveAddressType,
                  );
                  setReceivePathInfo(info);
                  dbg('[WalletHome] Receive modal: path info', {
                    index: info?.index,
                    path: info?.path,
                  });
                  setIsReceiveModalVisible(true);
                } catch (e) {
                  dbg(
                    '[WalletHome] Receive modal: discovery or path info error',
                    e,
                  );
                  setReceivePathInfo(null);
                  setIsReceiveModalVisible(true);
                } finally {
                  setIsRestoringIndexes(false);
                  setRestoreProgress(null);
                }
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
              accessibilityLabel="Receive Bitcoin"
              accessibilityHint="Double tap to view your Bitcoin address and QR code"
              accessibilityRole="button">
              <Image
                source={require('../assets/receive-icon.png')}
                style={styles.actionButtonIcon}
                resizeMode="contain"
                accessibilityLabel="Receive icon"
              />
              <AppText style={styles.receiveButtonText} tone="onPrimary">
                Receive
              </AppText>
            </AppPressable>
          </View>
        </View>
      </View>
      <CacheIndicator
        ref={cacheIndicatorRef}
        timestamps={cacheTimestamps}
        onRefresh={() => {
          // Trigger the same behavior as a user pull-to-refresh on the list
          transactionListRef.current?.refresh?.();
        }}
        theme={theme}
        isRefreshing={isRefreshing}
        usingCache={
          !isRefreshing &&
          cacheTimestamps.price > 0 &&
          cacheTimestamps.balance > 0 &&
          Date.now() -
            Math.max(cacheTimestamps.price, cacheTimestamps.balance) >
            60000
        }
      />
      <View style={styles.transactionListContainer}>
        <TransactionList
          ref={transactionListRef}
          baseApi={apiBase}
          address={walletAddresses.length > 0 ? undefined : address}
          addresses={walletAddresses.length > 0 ? walletAddresses : undefined}
          network={network}
          addressType={addressType || userAddressType}
          onUpdate={handleTransactionUpdate}
          initialTransactions={initialTransactions}
          selectedCurrency={selectedCurrency}
          btcRate={btcRate}
          getCurrencySymbol={getCurrencySymbol}
          onPullRefresh={() => fetchDataRef.current?.()}
          isBlurred={isBlurred}
        />
      </View>
      {/* Scan QR Button - Hidden, accessible via SendBitcoinModal or other means */}
      {/* QR Scanner Modal */}
      <QRScanner
        visible={isQRScannerVisible}
        onClose={() => setIsQRScannerVisible(false)}
        onScan={(data: string) => {
          setIsQRScannerVisible(false);
          processScannedQRData(data);
        }}
        mode="single"
        title="Scan Send Bitcoin QR"
        subtitle="Point camera to Sending Device QR"
      />
      {/* Extension bind: response QR when scan detected pairing_code */}
      <QRCodeModal
        visible={isExtensionResponseQrVisible}
        onClose={() => {
          setIsExtensionResponseQrVisible(false);
          setExtensionResponseQrData(null);
          extensionBindAlertShownRef.current = false;
        }}
        title="Bold Extension • Scan this QR"
        value={extensionResponseQrData || ''}
        network={network as 'mainnet' | 'testnet'}
        showShareButton={false}
        topRightClose={true}
        nonDismissible={false}
        qrSize={320}
        contentMaxWidth={400}
        qrContentStyle={extensionQrModalStyles.qrPadding}
      />
      <ExtensionPairingModal
        visible={isExtensionPairingModalVisible}
        onClose={() => {
          extensionBindAlertShownRef.current = false;
          setIsExtensionPairingModalVisible(false);
          setPendingExtensionPairingCode(null);
        }}
        onConfirm={() => {
          if (pendingExtensionPairingCode) {
            proceedWithExtensionBind(pendingExtensionPairingCode);
            setPendingExtensionPairingCode(null);
            setIsExtensionPairingModalVisible(false);
          }
        }}
      />
      <LegacyWalletModal
        visible={isLegacyWalletModalVisible}
        onCancel={() => setIsLegacyWalletModalVisible(false)}
        onUnderstand={() => setIsLegacyWalletModalVisible(false)}
      />
      <CurrencySelector
        visible={isCurrencySelectorVisible}
        onClose={() => setIsCurrencySelectorVisible(false)}
        onSelect={handleCurrencySelect}
        currentCurrency={selectedCurrency}
        availableCurrencies={priceData}
      />
      {isSendModalVisible && (
        <SendBitcoinModal
          visible={isSendModalVisible}
          btcToFiatRate={Big(btcRate)}
          walletBalance={Big(balanceBTC)}
          walletAddress={address}
          onClose={() => {
            setIsSendModalVisible(false);
            setInitialSendAddress(null);
          }}
          onSend={handleSend}
          selectedCurrency={selectedCurrency}
          initialAddress={initialSendAddress ?? undefined}
        />
      )}
      <TransportModeSelector
        visible={isTransportModalVisible}
        onClose={() => {
          setIsTransportModalVisible(false);
          setPendingSendParams(null);
          setScannedFromQR(false);
          setScannedAddressType(''); // Reset scanned address type
          setCurrentDerivationPath(''); // Reset derivation path
        }}
        onSelect={(transport: 'local' | 'nostr') => {
          navigateToPairing(transport);
          setIsTransportModalVisible(false);
        }}
        title="Select Signing Method"
        description=""
        sendBitcoinData={
          pendingSendParams
            ? {
                toAddress: pendingSendParams.to,
                amountSats: pendingSendParams.amountSats
                  .toString()
                  .split('.')[0],
                feeSats: pendingSendParams.feeSats.toString().split('.')[0],
                spendingHash: pendingSendParams.spendingHash,
                addressType: addressType || '',
                derivationPath: currentDerivationPath,
                // Keep native format for QR code (native module requires 'testnet3' not 'testnet')
                network: network || 'mainnet',
                fromAddress: address, // Current wallet address (from address)
                fiatAmount: pendingSendParams.amountSats
                  .times(btcRate)
                  .div(1e8)
                  .toFixed(2),
                fiatFees: pendingSendParams.feeSats
                  .times(btcRate)
                  .div(1e8)
                  .toFixed(2),
                selectedCurrency: selectedCurrency,
              }
            : null
        }
        showQRCode={!scannedFromQR} // Don't show QR if data came from scan
      />
      <RestoringIndexesModal
        visible={isRestoringIndexes}
        chain={restoreProgress?.chain}
        index={restoreProgress?.index}
        gapIndex={restoreProgress?.gapIndex}
      />
      {isReceiveModalVisible && (
        <ReceiveModal
          address={address}
          addressType={addressType}
          baseApi={apiBase}
          network={network as 'mainnet' | 'testnet'}
          onClose={() => {
            setIsReceiveModalVisible(false);
            setReceivePathInfo(null);
          }}
          receivePathInfo={receivePathInfo}
        />
      )}
      {/* Signed PSBT Modal */}
      {signedPsbt && (
        <SignedPSBTModal
          visible={isSignedPSBTModalVisible}
          signedPsbtBase64={signedPsbt}
          onClose={() => {
            setIsSignedPSBTModalVisible(false);
            setSignedPsbt(null);
          }}
        />
      )}
    </SafeAreaView>
  );
};
export default WalletHome;
