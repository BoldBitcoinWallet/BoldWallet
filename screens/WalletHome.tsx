import React, {useEffect, useState, useCallback, useRef, useMemo} from 'react';
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
  withRepeat,
  withSequence,
  useAnimatedStyle,
} from 'react-native-reanimated';
import QRScanner from '../components/QRScanner';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
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
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';

import walletRepository from '../services/repositories/WalletRepository';
import balanceRepository from '../services/repositories/BalanceRepository';
import priceRepository from '../services/repositories/PriceRepository';
import {getExternalIndex} from '../services/HdIndexService';
import syncCoordinator, {
  type SyncStatus,
} from '../services/sync/SyncCoordinator';
import apiQueue from '../services/ApiQueue';
import database from '../services/Database';
import mempoolClient from '../services/MempoolClient';
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
  // Seed from persisted config so the wallet UI can render immediately
  const cachedAddress =
    appConfigRepository.get(CONFIG_KEYS.CURRENT_ADDRESS) || '';
  const hasCachedData = cachedAddress.length > 0;
  const [address, setAddress] = useState<string>(cachedAddress);
  const [loading, setLoading] = useState<boolean>(!hasCachedData);
  const [isSendModalVisible, setIsSendModalVisible] = useState<boolean>(false);
  const [isTransportModalVisible, setIsTransportModalVisible] =
    useState<boolean>(false);
  const [pendingSendParams, setPendingSendParams] = useState<{
    to: string;
    amountSats: Big;
    feeSats: Big;
    spendingHash: string;
    utxosJson?: string | null;
    utxoCount?: number;
    changeAddress?: string | null;
  } | null>(null);
  const [currentDerivationPath, setCurrentDerivationPath] =
    useState<string>('');
  const [scannedAddressType, setScannedAddressType] = useState<string>(''); // Address type from scanned QR code
  const [scannedNetwork, setScannedNetwork] = useState<string>(''); // Network from scanned QR code
  const [computedFromAddress, setComputedFromAddress] = useState<string>(''); // Computed from address for send transaction
  const [btcPrice, setBtcPrice] = useState<string>('');
  const [btcRate, setBtcRate] = useState(0);
  const [balanceBTC, setBalanceBTC] = useState<string>('-');
  const [balanceFiat, setBalanceFiat] = useState<string>('0');
  const [pendingSats, setPendingSats] = useState<number>(0);
  const [_party, setParty] = useState<string>('');
  const [isBlurred, setIsBlurred] = useState<boolean>(
    appConfigRepository.get(CONFIG_KEYS.BALANCE_HIDDEN) === 'true',
  );
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
    address: string;
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
  const [addressType, setAddressType] = React.useState(
    appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || '',
  );
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const isInitializedRef = useRef(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [_error, _setError] = useState<string>('');
  const [cacheTimestamps, setCacheTimestamps] = useState<CacheTimestamp>({
    price: 0,
    balance: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [apiQueueState, setApiQueueState] = useState<{
    label: string | null;
    progress?: {current: number; total: number};
  } | null>(null);
  const [isCheckingBalanceForSend, setIsCheckingBalanceForSend] =
    useState(false);
  const [isCurrencySelectorVisible, setIsCurrencySelectorVisible] =
    useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(
    appConfigRepository.get(CONFIG_KEYS.CURRENCY) || 'USD',
  );
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
  const [isReceiveBusy, setIsReceiveBusy] = useState(false);
  const extensionQrModalStyles = React.useMemo(
    () => StyleSheet.create({qrPadding: {padding: 16}}),
    [],
  );
  const lastInvalidQrRef = useRef<{data: string; time: number}>({
    data: '',
    time: 0,
  });
  const extensionBindAlertShownRef = useRef(false);

  const proceedWithExtensionBind = useCallback(async (pairingCode: string) => {
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
  }, []);

  const [initialSendAddress, setInitialSendAddress] = useState<string | null>(
    null,
  );
  const [scannedFromQR, setScannedFromQR] = useState(false); // Track if data came from QR scan
  const [priceData, setPriceData] = useState<{[key: string]: number}>({});
  const [_segwitCompatibleAddress, setSegwitCompatibleAddress] =
    React.useState('');
  const [initialTransactions, setInitialTransactions] = useState<any[]>([]);
  // Seed walletAddresses from DB synchronously so refreshFromDB / SyncCoordinator
  // can use them before the async HD derivation completes.
  const [walletAddresses, setWalletAddresses] = useState<string[]>(() => {
    if (!hasCachedData) return [];
    const initNet = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
    const initType =
      appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || 'segwit-native';
    const receive = walletRepository.getAddresses(initNet, initType, 0);
    const change = walletRepository.getAddresses(initNet, initType, 1);
    return [...receive, ...change].map(a => a.address);
  });
  const [walletAddressesReady, setWalletAddressesReady] = useState(() => {
    if (!hasCachedData) return false;
    const initNet = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
    const initType =
      appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || 'segwit-native';
    const hdState = walletRepository.getHdState(initNet, initType);
    return !!hdState?.restoreDone;
  });
  // Animation and visual feedback states
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const balanceUpdateAnimation = useSharedValue(1);
  const shimmerOpacity = useSharedValue(1.0);
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
  useEffect(() => {
    const unsub = apiQueue.subscribe(state => {
      setApiQueueState(
        state?.label != null
          ? {
              label: state.label,
              progress: state.progress,
            }
          : null,
      );
    });
    return unsub;
  }, []);
  // DB → UI: read balance and price from SQLite and update React state.
  // This is the single source of truth for what the UI displays.
  // Called after init, after API syncs, and after SyncCoordinator cycles.
  const refreshFromDB = useCallback(() => {
    const currency = appConfigRepository.get(CONFIG_KEYS.CURRENCY) || 'USD';
    const effectiveType = addressType || userAddressType || 'segwit-native';

    // Sum per-address balances for the known wallet addresses.
    // The SyncCoordinator writes per-address entries; summing them
    // gives the correct total for the current address type.
    let totalSats = 0;
    let totalPending = 0;
    let newestFetch = 0;
    const addrs =
      walletAddresses.length > 0 ? walletAddresses : address ? [address] : [];

    for (const a of addrs) {
      const stored = balanceRepository.getBalance(a, network);
      if (stored) {
        totalSats += stored.balanceSats;
        totalPending += stored.pendingSats;
        if (stored.fetchedAt > newestFetch) newestFetch = stored.fetchedAt;
      }
    }

    // Fallback: synthetic aggregate written by getWalletBalanceAggregate
    if (newestFetch === 0) {
      const agg = balanceRepository.getBalance(
        `aggregate_${network}_${effectiveType}`,
        network,
      );
      if (agg) {
        totalSats = agg.balanceSats;
        totalPending = agg.pendingSats;
        newestFetch = agg.fetchedAt;
      }
    }

    const btc = (totalSats / 1e8).toFixed(8);
    const balStr = totalSats > 0 ? btc : newestFetch > 0 ? '0.00000000' : '-';
    if (
      balStr !== previousBalanceRef.current &&
      previousBalanceRef.current !== '0.00000000'
    ) {
      balanceUpdateAnimation.value = 0;
      balanceUpdateAnimation.value = withTiming(1, {duration: 300});
      HapticFeedback.light();
    }
    previousBalanceRef.current = balStr;
    setBalanceBTC(balStr);
    setPendingSats(totalPending);

    // Price from DB
    const dbPrice = priceRepository.getCachedPrice(currency);
    if (dbPrice && dbPrice.rate > 0) {
      setPriceData(dbPrice.rates);
      setBtcPrice(dbPrice.rate.toString());
      setBtcRate(dbPrice.rate);
      const fiat = (totalSats / 1e8) * dbPrice.rate;
      setBalanceFiat(Math.max(0, fiat).toFixed(2));
      setCacheTimestamps({price: dbPrice.timestamp, balance: newestFetch});
    }

    setBalanceError(null);
    dbg('[BALANCE] refreshFromDB:', {
      addresses: addrs.length,
      totalSats,
      totalPending,
      btcDisplay: balStr,
      priceRate: dbPrice?.rate ?? 0,
    });
  }, [
    network,
    addressType,
    userAddressType,
    walletAddresses,
    address,
    balanceUpdateAnimation,
  ]);
  const refreshFromDBRef = useRef(refreshFromDB);
  useEffect(() => {
    refreshFromDBRef.current = refreshFromDB;
  }, [refreshFromDB]);

  // API → DB → UI: trigger API calls that write to DB, then refresh UI from DB.
  // Even if APIs fail, refreshFromDB still runs and shows whatever is in the DB.
  const fetchData = useCallback(async (activeOnly: boolean = true) => {
    if (!isInitializedRef.current) {
      dbg('[BALANCE] fetchData: SKIPPED — not initialized');
      return;
    }
    if (isFetchInProgressRef.current || isReinitInProgressRef.current) {
      dbg(
        '[BALANCE] fetchData: SKIPPED —',
        isFetchInProgressRef.current
          ? 'fetch in progress'
          : 'reinit in progress',
      );
      return;
    }
    isFetchInProgressRef.current = true;
    setIsRefreshing(true);
    setIsBalanceLoading(true);

    const baseApi = apiBase || appConfigRepository.get('api');
    if (!baseApi || !network) {
      refreshFromDBRef.current();
      isFetchInProgressRef.current = false;
      setLoading(false);
      setIsRefreshing(false);
      setIsBalanceLoading(false);
      return;
    }

    // Ensure native module has correct API URL
    const cleanBaseApi = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const apiUrl = `${cleanBaseApi}/api`;
    await BBMTLibNativeModule.setAPI(network, apiUrl);

    try {
      const effectiveAddressType =
        addressType || userAddressType || 'segwit-native';
      // API → DB: getWalletBalanceAggregate writes per-address + aggregate to SQLite
      // activeOnly: true = lightweight (active set); false = full sync (long-press only).
      await apiQueue.enqueue('Syncing balance…', setProgress =>
        WalletService.getInstance().getWalletBalanceAggregate(
          network,
          effectiveAddressType,
          btcRate,
          _pendingSent,
          true,
          setProgress,
          activeOnly,
        ),
      );
      // UI: reflect balance and tx updates immediately while progress continues
      refreshFromDBRef.current();
      transactionListRef.current?.refresh?.();
      // API → DB: getBitcoinPrice writes rates to price_rates table
      await apiQueue.enqueue('Syncing fiat rate…', () =>
        WalletService.getInstance().getBitcoinPrice(),
      );
    } catch (error) {
      dbg('[BALANCE] fetchData: API sync error (will read from DB):', error);
    }

    // DB → UI: always read from DB regardless of API success
    refreshFromDBRef.current();

    // Sync walletAddresses with the current HD index state
    try {
      const addrType = addressType || userAddressType || 'segwit-native';
      const freshAddrs =
        await WalletService.getInstance().getHdAddressesWithPaths(
          network,
          addrType,
        );
      const freshList = freshAddrs.map(a => a.address);
      setWalletAddresses(prev => {
        const same =
          prev.length === freshList.length &&
          prev.every((a, i) => a === freshList[i]);
        return same ? prev : freshList;
      });
      setWalletAddressesReady(true);
    } catch {
      // Non-critical
    }

    setLoading(false);
    setIsBalanceLoading(false);
    setIsRefreshing(false);
    isFetchInProgressRef.current = false;
    dbg('=== Data fetch completed');
  }, [network, btcRate, _pendingSent, apiBase, addressType, userAddressType]);
  // Load HD addresses for multi-address transaction list.
  // If discovery has never been run for this (network, addressType), run it first
  // so indexes are correct — otherwise getHdAddressesWithPaths returns only 1 receive + 1 change.
  // walletAddressesReady is set to true once derivation has settled so TransactionList
  // is never given a partial address list.
  useEffect(() => {
    if (!isInitialized || !network || !(addressType || userAddressType)) return;
    const effectiveType = addressType || userAddressType || 'segwit-native';
    const restoreDone =
      walletRepository.getHdState(network, effectiveType)?.restoreDone === true;
    // Only blank out the address list when we need full HD discovery.
    // When restoreDone is true the derive resolves from cache in <5 ms and
    // the DB-seeded addresses are already valid — flipping to false would
    // cause TransactionList to wipe its cached rows for no reason.
    if (!restoreDone) {
      setWalletAddressesReady(false);
    }
    let cancelled = false;
    const load = async () => {
      try {
        const ws = WalletService.getInstance();
        if (!restoreDone) {
          dbg(
            '[WalletHome] HD restore not done for',
            network,
            effectiveType,
            '- running discovery',
          );
          const apiUrl =
            appConfigRepository.get('api') ||
            (network === 'mainnet'
              ? 'https://mempool.space/api'
              : 'https://mempool.space/testnet/api');
          await ws.discoverHdIndexesForNetwork(network, effectiveType, apiUrl);
        }
        if (cancelled) return;
        const arr = await ws.getHdAddressesWithPaths(network, effectiveType);
        if (cancelled) return;
        setWalletAddresses(arr.map(a => a.address));
        setWalletAddressesReady(true);
      } catch (e) {
        dbg('[WalletHome] Address list load error', e);
        if (!cancelled) {
          setWalletAddresses([]);
          setWalletAddressesReady(true);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
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
        appConfigRepository.get(CONFIG_KEYS.CURRENT_ADDRESS);
      const baseApi = apiBase || appConfigRepository.get('api');
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
      const balancePromise =
        WalletService.getInstance().getWalletBalanceAggregate(
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
      // API wrote to DB — refresh UI from DB
      refreshFromDBRef.current();
      if (
        balanceResult &&
        typeof balanceResult === 'object' &&
        'btc' in balanceResult
      ) {
        const newBalance = parseFloat((balanceResult as any).btc || '0');
        dbg('checkBalanceForSend: Balance fetched:', newBalance);
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
          isInitializedRef.current = true;
          setIsInitialized(true);
          return;
        }
        // Reset address slots so stale receive addresses are not shown while
        // the new ones are being derived.  Do NOT clear balance/price — show
        // the last-known DB value instead so the user never sees 0 on unlock.
        setAddress('');
        setLegacyAddress('');
        setSegwitAddress('');
        setSegwitCompatibleAddress('');

        // DB → UI: preload balance/price from SQLite immediately (no async work).
        // Prevents balance flashing '-' / 0 on lock-unlock.
        refreshFromDBRef.current();

        // Do NOT clear persistent cache here; we need it for offline startup
        // Only ensure service is initialized to read existing caches
        // Initialize WalletService
        const walletService = WalletService.getInstance();
        await walletService.initialize();
        const ks = JSON.parse(jks);
        const currentAddressType =
          appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || 'segwit-native';
        const useLegacyPath = isLegacyWallet(ks.created_at);
        const externalIndex = await getExternalIndex(
          network,
          currentAddressType,
        );
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
          network || appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
        dbg('Re-initializing for network:', net);
        // Get current address type
        const addrType =
          appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || 'segwit-native';
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
        appConfigRepository.set('legacyAddress', legacyAddr);
        appConfigRepository.set('segwitAddress', segwitAddr);
        appConfigRepository.set('segwitCompatibleAddress', segwitCompAddr);
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
        appConfigRepository.set(CONFIG_KEYS.CURRENT_ADDRESS, btcAddress);
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
              await WalletService.getInstance().transactionsFromCache(
                btcAddress,
              );
            setInitialTransactions(Array.isArray(fallback) ? fallback : []);
          } catch {}
        }
        // Set up API URL from NetworkContext
        const api = apiBase || appConfigRepository.get('api');
        if (api) {
          await BBMTLibNativeModule.setAPI(actualNet, api);
          dbg('API set for network:', actualNet, 'API:', api);
        }
        // DB → UI: read balance/price from SQLite
        refreshFromDBRef.current();
      } finally {
        setLoading(false);
        isReinitInProgressRef.current = false;
      }
      // Fetch live balance/price now that the reinit guard has been cleared.
      // Without this, reinitializeWallet only shows cached data and never
      // triggers a network refresh, so returning from settings after a
      // "clear cache" always shows 0 BTC until the user pulls to refresh.
      await fetchDataRef.current?.();
    },
    [network, apiBase, address],
  );
  // Listen for navigation state changes to detect returning from settings.
  // Guarded by isInitializedRef so the very first focus (mount) is a no-op —
  // the init effect handles initial boot.  Subsequent focuses (e.g. returning
  // from Settings) run reinitializeWallet which re-derives addresses & fetches
  // live data.
  useEffect(() => {
    const unsubscribe = nav.addListener('focus', async () => {
      if (!isInitializedRef.current) {
        dbg('[WalletHome] Focus - skipping, init effect in progress');
        return;
      }
      if (!network || !apiBase) {
        return;
      }
      dbg('[WalletHome] === Navigation focus - reinitializing wallet', {
        timestamp: Date.now(),
        network,
        apiBase,
      });
      await reinitializeWallet(true);
    });
    return unsubscribe;
  }, [nav, network, apiBase, reinitializeWallet]);
  // Listen for app state changes — just refresh balance/price on resume.
  // Address derivation is unnecessary here (nothing changes while backgrounded).
  // SyncCoordinator has its own AppState listener for background sync.
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (
        nextAppState === 'active' &&
        isInitializedRef.current &&
        network &&
        apiBase
      ) {
        dbg('[WalletHome] === App resumed, scheduling fetchData');
        fetchDataRef.current?.();
      }
    };
    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );
    return () => {
      subscription?.remove();
    };
  }, [network, apiBase]);
  // No periodic check needed - NetworkContext is the single source of truth
  const cacheIndicatorRef = useRef<CacheIndicatorHandle>(null);
  const {theme} = useTheme();
  const isDarkMode = theme.colors.background !== '#ffffff';
  const styles = {
    ...createStyles(theme),
    sendButtonDisabled: {
      opacity: 0.6,
    } as const,
    ...StyleSheet.create({
      shimmerBTC: {
        height: 38,
        width: '60%',
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.25)',
        alignSelf: 'center',
      },
      shimmerFiat: {
        height: 22,
        width: '38%',
        borderRadius: 6,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignSelf: 'center',
      },
      pendingChip: {
        alignSelf: 'center',
        marginTop: 6,
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 12,
        backgroundColor: 'rgba(255,179,0,0.18)',
      },
      pendingChipText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#FFB300',
        letterSpacing: 0.2,
      },
    }),
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
  // addressType, selectedCurrency, isBlurred are seeded from appConfigRepository
  // in their useState initializers — no effect needed.
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
    appConfigRepository.set(CONFIG_KEYS.CURRENCY, currency.code);
    refreshFromDBRef.current();
  };
  // Add effect to initialize app
  useEffect(() => {
    const init = async () => {
      if (isInitialized) {
        return;
      }
      try {
        // Seed balance + price from DB before the async native init chain.
        // State initializers already seeded address/addressType/walletAddresses
        // from appConfigRepository + walletRepository, so refreshFromDB will
        // find the right per-address balance rows immediately.
        dbg('[BALANCE] init: pre-skeleton DB seed via refreshFromDB');
        refreshFromDBRef.current();

        setLoading(true);
        const jks = await EncryptedStorage.getItem('keyshare');
        if (!jks) {
          dbg('WalletHome: No keyshare found during initialization');
          setLoading(false);
          isInitializedRef.current = true;
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
          navigation.reset(
            getResetToMainTabsWallet(
              {},
              {
                showPlay: activeNetwork === 'mainnet' && showMempoolPlayground,
                showUtxos: showUtxosTab,
                showPsbt: showPsbtTab,
                showWallet: showWalletTab,
              },
            ),
          );
          return;
        }
        if (!ks.pub_key || !ks.chain_code_hex || !ks.local_party_key) {
          dbg('Invalid pub_key or chain_code_hex or local_party_key');
          navigation.reset(
            getResetToMainTabsWallet(
              {},
              {
                showPlay: activeNetwork === 'mainnet' && showMempoolPlayground,
                showUtxos: showUtxosTab,
                showPsbt: showPsbtTab,
                showWallet: showWalletTab,
              },
            ),
          );
          return;
        }
        const currentAddressType =
          appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || 'segwit-native';
        const useLegacyPath = isLegacyWallet(ks.created_at);
        const externalIndex = await getExternalIndex(
          network,
          currentAddressType,
        );
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
        let net = appConfigRepository.get(CONFIG_KEYS.NETWORK);
        if (!net) {
          net = 'mainnet';
          appConfigRepository.set(CONFIG_KEYS.NETWORK, net);
          dbg('WalletHome: Setting default network to mainnet');
        }
        // Set default address type if not set
        let addrType = appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE);
        if (!addrType) {
          addrType = 'segwit-native';
          appConfigRepository.set(CONFIG_KEYS.ADDRESS_TYPE, addrType);
          dbg('WalletHome: Setting default address type to segwit-native');
        }
        // Use cached price for fast init — the live price will be fetched by
        // fetchData() right after isInitialized is set to true.  Calling
        // getBitcoinPrice() here would block initialization for 5-35 s while
        // the round-robin tries every endpoint on a slow connection.
        let currency = appConfigRepository.get(CONFIG_KEYS.CURRENCY);
        const priceResponse = await walletService.getCachePrice();
        if (!currency) {
          const availableCurrencies = Object.keys(priceResponse.rates);
          currency = availableCurrencies.includes('USD')
            ? 'USD'
            : availableCurrencies[0] || 'USD';
          appConfigRepository.set(CONFIG_KEYS.CURRENCY, currency);
          dbg('WalletHome: Setting default currency to', currency);
        } else {
          dbg('WalletHome: Using saved currency', currency);
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
        appConfigRepository.set('legacyAddress', legacyAddr);
        appConfigRepository.set('segwitAddress', segwitAddr);
        appConfigRepository.set('segwitCompatibleAddress', segwitCompAddr);
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
        appConfigRepository.set(CONFIG_KEYS.CURRENT_ADDRESS, btcAddress);
        setAddress(btcAddress);
        // Set up API URL
        let base = netParams.split('@')[1];
        if (!base.endsWith('/')) {
          base = `${base}/`;
        }
        let api = appConfigRepository.get('api');
        if (api) {
          if (api.endsWith('/')) {
            api = api.substring(0, api.length - 1);
          }
          BBMTLibNativeModule.setAPI(net, api);
        } else {
          appConfigRepository.set('api', base);
        }
        // DB → UI: seed price + balance from SQLite
        refreshFromDBRef.current();
        setLoading(false);
        isInitializedRef.current = true;
        setIsInitialized(true);
        // Check if this is a legacy wallet and show migration modal if needed
        // Modal shows by default unless user checked "do not remind" (flag = "yes")
        if (useLegacyPath) {
          const doNotRemind = appConfigRepository.get(
            CONFIG_KEYS.LEGACY_WALLET_DO_NOT_REMIND,
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
  }, [
    showErrorToast,
    isInitialized,
    address,
    navigation,
    network,
    activeNetwork,
    showMempoolPlayground,
    showUtxosTab,
    showPsbtTab,
    showWalletTab,
  ]);
  // Start background sync once the full HD address set is known.
  // SyncCoordinator writes deltas to SQLite; the UI reads from the DB.
  useEffect(() => {
    if (!walletAddressesReady || !apiBase || !network) {
      return;
    }
    const addrs =
      walletAddresses.length > 0 ? walletAddresses : address ? [address] : [];
    if (addrs.length === 0) {
      return;
    }
    const cleanApi = apiBase.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const effectiveAddrType = addressType || userAddressType || 'segwit-native';
    syncCoordinator.start({
      addresses: addrs.map(a => ({address: a, network})),
      network,
      addressType: effectiveAddrType,
      apiBase: `${cleanApi}/api`,
      onSyncComplete: () => {
        dbg(
          '[WalletHome] SyncCoordinator cycle complete — refreshing UI from DB',
        );
        refreshFromDBRef.current();
      },
      onAddressesChanged: (newAddrs: string[]) => {
        dbg(
          '[WalletHome] SyncCoordinator discovered new addresses',
          newAddrs.length,
        );
        setWalletAddresses(newAddrs);
      },
      onSyncStatus: setSyncStatus,
    });
    return () => {
      syncCoordinator.stop();
    };
  }, [
    walletAddressesReady,
    walletAddresses,
    address,
    network,
    apiBase,
    addressType,
    userAddressType,
  ]);
  const handleBlurred = () => {
    const blurr = !isBlurred;
    setIsBlurred(blurr);
    appConfigRepository.set(
      CONFIG_KEYS.BALANCE_HIDDEN,
      blurr ? 'true' : 'false',
    );
  };
  const handleSend = async (
    to: string,
    amountSats: Big,
    feeSats: Big,
    spendingHash: string,
    utxosJson?: string | null,
    changeAddress?: string | null,
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
      // Store params and show transport selector after a brief delay
      const parsedUtxoCount = (() => {
        if (!utxosJson) return undefined;
        try {
          return (JSON.parse(utxosJson) as unknown[]).length;
        } catch {
          return undefined;
        }
      })();
      setPendingSendParams({
        to,
        amountSats,
        feeSats,
        spendingHash,
        utxosJson: utxosJson ?? null,
        utxoCount: parsedUtxoCount,
        changeAddress: changeAddress ?? null,
      });
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
    const navigationParams: Record<string, unknown> = {
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
    if (
      pendingSendParams.utxosJson &&
      pendingSendParams.utxosJson.trim() !== ''
    ) {
      navigationParams.utxosJson = pendingSendParams.utxosJson;
    }
    if (
      pendingSendParams.changeAddress &&
      pendingSendParams.changeAddress.trim() !== ''
    ) {
      navigationParams.changeAddress = pendingSendParams.changeAddress;
    }
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
        ? trimmed
            .replace(/^bitcoin:/i, '')
            .split('?')[0]
            .trim()
        : trimmed;
      const networkForValidation =
        network === 'testnet3' ? 'testnet' : network || 'mainnet';
      if (
        addressCandidate &&
        validateBitcoinAddressEnhanced(addressCandidate, networkForValidation)
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
        const addressLabel = otherNetwork === 'mainnet' ? 'mainnet' : 'testnet';
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
        utxosJson?: string;
        changeAddress?: string;
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
        dbg(
          'WalletHome: Derivation path from QR code:',
          decoded.derivationPath,
        );
      }
      if (decoded.network) {
        // Keep native format from QR code (native module requires 'testnet3' not 'testnet')
        setScannedNetwork(decoded.network);
        dbg('WalletHome: Network from QR code:', decoded.network);
      }
      // Optional: derive UTXO count when QR carries utxosJson
      let utxoCount: number | undefined;
      if (decoded.utxosJson) {
        try {
          const parsed = JSON.parse(decoded.utxosJson);
          if (Array.isArray(parsed)) {
            utxoCount = parsed.length;
          }
        } catch (e) {
          dbg('WalletHome: Failed to parse utxosJson from QR', e);
        }
      }
      // Store params and mark as scanned from QR
      setPendingSendParams({
        to: decoded.toAddress,
        amountSats,
        feeSats,
        spendingHash: decoded.spendingHash || '',
        utxosJson: decoded.utxosJson || null,
        utxoCount,
        changeAddress: decoded.changeAddress || null,
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

  // Pulse the balance text opacity while loading so the value stays readable
  // but the user can see a refresh is in progress.
  useEffect(() => {
    if (isBalanceLoading) {
      shimmerOpacity.value = withRepeat(
        withSequence(
          withTiming(1.0, {duration: 600}),
          withTiming(0.45, {duration: 600}),
        ),
        -1,
        false,
      );
    } else {
      shimmerOpacity.value = withTiming(1.0, {duration: 200});
    }
  }, [isBalanceLoading, shimmerOpacity]);

  const shimmerAnimStyle = useAnimatedStyle(() => ({
    opacity: shimmerOpacity.value,
  }));

  /**
   * Fiat display value derived from balanceBTC × btcRate so the two rows are
   * always consistent.  Falls back to the stored balanceFiat only when the
   * price has not been loaded yet (btcRate === 0).
   */
  const displayFiat = useMemo(() => {
    if (balanceFiat === '-') {
      return '-';
    }
    if (btcRate > 0) {
      return (parseFloat(balanceBTC || '0') * btcRate).toFixed(2);
    }
    return balanceFiat;
  }, [balanceBTC, balanceFiat, btcRate]);

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
                  <AppText style={styles.balanceErrorText}>
                    {balanceError}
                  </AppText>
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
                      <Animated.View style={shimmerAnimStyle}>
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
                      </Animated.View>
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
                                  displayFiat === '-' ? '0' : displayFiat;
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
                        <Animated.View style={shimmerAnimStyle}>
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
                                    displayFiat === '-' ? '0' : displayFiat;
                                  const symbol =
                                    getCurrencySymbol(selectedCurrency);
                                  const formattedFiat = balanceFormattingEnabled
                                    ? presentFiat(fiatValue)
                                    : fiatValue;
                                  return isNaN(Number(formattedFiat))
                                    ? '-'
                                    : symbol + formattedFiat;
                                })()}
                          </Text>
                        </Animated.View>
                      </AppPressable>
                    </Animated.View>
                  )}
                  {!isBlurred && pendingSats !== 0 && (
                    <View style={styles.pendingChip}>
                      <AppText style={styles.pendingChipText}>
                        {pendingSats > 0
                          ? `⏳ +${(pendingSats / 1e8).toFixed(8)} BTC incoming`
                          : `⏳ ${(pendingSats / 1e8).toFixed(8)} BTC outgoing`}
                      </AppText>
                    </View>
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
                accessibilityLabel={`Switch to ${showSats ? 'BTC' : 'sats'}`}
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
              disabled={isReceiveBusy || isRestoringIndexes}
              onPress={async () => {
                if (isReceiveBusy || isRestoringIndexes) {
                  return;
                }
                try {
                  setIsReceiveBusy(true);
                  const ws = WalletService.getInstance();
                  const effectiveAddressType = addressType || 'segwit-native';
                  const apiUrl =
                    apiBase ||
                    (network === 'mainnet'
                      ? 'https://mempool.space/api'
                      : 'https://mempool.space/testnet/api');
                  const restoreDone =
                    walletRepository.getHdState(network, effectiveAddressType)
                      ?.restoreDone === true;

                  // Only run full restore discovery once per (network, addressType)
                  if (!restoreDone) {
                    setIsRestoringIndexes(true);
                    setRestoreProgress(null);
                    await ws.discoverHdIndexesForNetwork(
                      network,
                      effectiveAddressType,
                      apiUrl,
                      (chain, index, gapIndex) =>
                        setRestoreProgress({chain, index, gapIndex}),
                    );
                    await refreshUserContext();
                  }

                  // Lightweight frontier bump: if current receive address is already used,
                  // advance external index so the next receive shows a fresh address.
                  await ws.bumpExternalIndexIfCurrentUsed(
                    network,
                    effectiveAddressType,
                    apiUrl,
                  );

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
                  setIsReceiveBusy(false);
                }
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
              accessibilityLabel="Receive Bitcoin"
              accessibilityHint="Double tap to view your Bitcoin address and QR code"
              accessibilityRole="button">
              {isReceiveBusy || isRestoringIndexes ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Image
                    source={require('../assets/receive-icon.png')}
                    style={styles.actionButtonIcon}
                    resizeMode="contain"
                    accessibilityLabel="Receive icon"
                  />
                  <AppText style={styles.receiveButtonText} tone="onPrimary">
                    Receive
                  </AppText>
                </>
              )}
            </AppPressable>
          </View>
        </View>
      </View>
      <CacheIndicator
        ref={cacheIndicatorRef}
        timestamps={cacheTimestamps}
        statusMessage={syncStatus?.label ?? apiQueueState?.label ?? undefined}
        progress={syncStatus?.progress ?? apiQueueState?.progress}
        onRefresh={() => {
          fetchData();
        }}
        onLongPress={async () => {
          const effectiveType =
            addressType || userAddressType || 'segwit-native';
          const api =
            apiBase ||
            appConfigRepository.get('api') ||
            (network === 'mainnet'
              ? 'https://mempool.space/api'
              : 'https://mempool.space/testnet/api');
          setIsRefreshing(true);
          try {
            dbg(
              '[WalletHome] Long-press: clearing wallet cache + full reconstruction',
            );
            setSyncStatus({label: 'Clearing cache…'});
            database.clearWalletCacheData();
            mempoolClient.invalidateAll();
            WalletService.getInstance().invalidateAddressCache();
            setSyncStatus({label: 'Discovering addresses…'});
            await WalletService.getInstance().discoverHdIndexesForNetwork(
              network,
              effectiveType,
              api,
              chain =>
                setSyncStatus({
                  label: `Scanning ${
                    chain === 'external' ? 'receive' : 'change'
                  } addresses…`,
                }),
            );
            setSyncStatus({label: 'Rebuilding wallet data…'});
            const arr =
              await WalletService.getInstance().getHdAddressesWithPaths(
                network,
                effectiveType,
              );
            setWalletAddresses(arr.map(a => a.address));
          } catch (e) {
            dbg('[WalletHome] Long-press reconstruction error', e);
          }
          setSyncStatus(null);
          await fetchData(false); // full sync after long-press rebuild
          transactionListRef.current?.refresh?.();
        }}
        theme={theme}
        isRefreshing={isRefreshing || !!syncStatus}
        usingCache={
          !isRefreshing &&
          !syncStatus &&
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
          address={
            walletAddressesReady && walletAddresses.length === 0
              ? address
              : undefined
          }
          addresses={
            walletAddressesReady && walletAddresses.length > 0
              ? walletAddresses
              : undefined
          }
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
                utxosJson: pendingSendParams.utxosJson || null,
                utxoCount: pendingSendParams.utxoCount,
                changeAddress: pendingSendParams.changeAddress || null,
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
          address={receivePathInfo?.address ?? address}
          addressType={addressType}
          baseApi={apiBase}
          network={network as 'mainnet' | 'testnet'}
          onClose={() => {
            setIsReceiveModalVisible(false);
            setReceivePathInfo(null);
            // Refresh balance and tx history after closing receive (e.g. after sharing address).
            fetchDataRef.current?.();
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
