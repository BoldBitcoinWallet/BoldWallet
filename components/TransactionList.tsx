import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useImperativeHandle,
  useMemo,
} from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Animated,
  Easing,
  Image,
} from 'react-native';
import AppPressable from './AppPressable';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import mempoolClient from '../services/MempoolClient';
import Toast from 'react-native-toast-message';
import moment from 'moment';
import {
  dbg,
  presentFiat,
  HapticFeedback,
  isCanceledError,
  formatBitcoinDisplay,
} from '../utils';
import {useUser} from '../context/UserContext';
import {themes, useTheme as useAppTheme, lightTheme} from '../theme';
import AppText from './AppText';
import {COMMON_FONT_CONFIGS} from '../theme/fonts';
import TransactionListSkeleton from './TransactionListSkeleton';
import {WalletService} from '../services/WalletService';
import TransactionDetailsModal from './TransactionDetailsModal';
import transactionRepository from '../services/repositories/TransactionRepository';
import merchantLabelRepository from '../services/repositories/MerchantLabelRepository';
import apiQueue from '../services/ApiQueue';
import transactionSyncer from '../services/sync/TransactionSyncer';
import HistoricalPriceService, {
  getHistoricalRateKey,
} from '../services/HistoricalPriceService';
import {
  sortMempoolTransactionsForDisplay as sortTxs,
  getMempoolTransactionAmounts,
} from '../utils/transactionListUtils';

// Add icon imports
const inIcon = require('../assets/in-icon.png');
const outIcon = require('../assets/out-icon.png');
const consolidateIcon = require('../assets/consolidate-icon.png');
const pendingIcon = require('../assets/pending-icon.png');

type AnimationType = 'send' | 'receive' | 'consolidate' | 'rebalance' | 'none';

/** Renders a status icon with an appropriate looping animation for pending states. */
const AnimatedStatusIcon = React.memo(
  ({
    source,
    style,
    animationType,
  }: {
    source: any;
    style: any;
    animationType: AnimationType;
  }) => {
    const anim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
      if (animationType === 'none') {
        anim.setValue(0);
        return;
      }
      let loop: Animated.CompositeAnimation;
      switch (animationType) {
        // Arrow slides up + fades then resets: conveys outgoing motion
        case 'send':
          loop = Animated.loop(
            Animated.sequence([
              Animated.timing(anim, {
                toValue: 1,
                duration: 700,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(anim, {
                toValue: 0,
                duration: 300,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.delay(300),
            ]),
          );
          break;
        // Arrow slides down + brightens then resets: conveys incoming motion
        case 'receive':
          loop = Animated.loop(
            Animated.sequence([
              Animated.timing(anim, {
                toValue: 1,
                duration: 700,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(anim, {
                toValue: 0,
                duration: 300,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.delay(300),
            ]),
          );
          break;
        // Slow continuous rotation: conveys merging/gathering
        case 'consolidate':
          loop = Animated.loop(
            Animated.timing(anim, {
              toValue: 1,
              duration: 1400,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
          );
          break;
        // Scale pulse: conveys spreading/redistributing
        case 'rebalance':
          loop = Animated.loop(
            Animated.sequence([
              Animated.timing(anim, {
                toValue: 1,
                duration: 600,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(anim, {
                toValue: 0,
                duration: 600,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
            ]),
          );
          break;
        default:
          return;
      }
      loop.start();
      return () => loop.stop();
    }, [animationType, anim]);

    let animStyle: object = {};
    switch (animationType) {
      case 'send':
        animStyle = {
          opacity: anim.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [1, 0.35, 1],
          }),
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -4],
              }),
            },
          ],
        };
        break;
      case 'receive':
        animStyle = {
          opacity: anim.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.35, 1, 0.35],
          }),
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-4, 0],
              }),
            },
          ],
        };
        break;
      case 'consolidate':
        animStyle = {
          transform: [
            {
              rotate: anim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '360deg'],
              }),
            },
          ],
        };
        break;
      case 'rebalance':
        animStyle = {
          opacity: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.4, 1],
          }),
          transform: [
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.8, 1.15],
              }),
            },
          ],
        };
        break;
    }

    return (
      <Animated.Image
        source={source}
        style={[style, animStyle]}
        resizeMode="contain"
      />
    );
  },
);
interface TransactionListProps {
  /** Single address (legacy). Use addresses for multi-address (HD wallet) mode. */
  address?: string;
  /** All HD addresses (receive + change) for wallet-level transaction list. */
  addresses?: string[];
  network?: string;
  addressType?: string;
  baseApi: string;
  onUpdate: (pendingTxs: any[], pending: number) => Promise<any>;
  initialTransactions?: any[];
  selectedCurrency?: string;
  btcRate?: number;
  getCurrencySymbol?: (currency: string) => string;
  onPullRefresh?: () => void;
  isBlurred?: boolean;
}
export interface TransactionListHandle {
  refresh: (useFullList?: boolean) => Promise<void> | void;
}
const TransactionList = React.forwardRef<
  TransactionListHandle,
  TransactionListProps
>(
  (
    {
      address,
      addresses,
      network,
      addressType,
      baseApi,
      onUpdate,
      initialTransactions = [],
      selectedCurrency = 'USD',
      btcRate: _btcRate = 0,
      getCurrencySymbol = currency => currency,
      onPullRefresh,
      isBlurred = false,
    },
    ref,
  ) => {
    const isMultiAddress = Array.isArray(addresses) && addresses.length > 0;
    const effectiveAddress = isMultiAddress ? addresses![0] : address;
    const [transactions, setTransactions] =
      useState<any[]>(initialTransactions);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastSeenTxId, setLastSeenTxId] = useState<string | null>(null);
    // Per-address cursors for multi-address pagination (null = address exhausted)
    const [addressCursors, setAddressCursors] = useState<
      Record<string, string | null>
    >({});
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
    const isFetching = useRef(false);
    const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
    const [isDetailsModalVisible, setIsDetailsModalVisible] = useState(false);
    const {theme: appTheme} = useAppTheme();
    const {showSats, balanceFormattingEnabled} = useUser();
    const insets = useSafeAreaInsets();
    // Add refs to track mounting state and prevent memory leaks
    const isMounted = useRef(true);
    const abortController = useRef<AbortController | null>(null);
    const isRefreshingRef = useRef(false);
    /** When true, next sync uses full `addresses` (e.g. after long-press rebuild). */
    const useFullSyncOnceRef = useRef(false);
    const ourAddresses = useMemo(
      () => (isMultiAddress ? new Set(addresses!) : null),
      [isMultiAddress, addresses],
    );
    const isOurAddress = useCallback(
      (addr: string) =>
        ourAddresses ? ourAddresses.has(addr) : addr === effectiveAddress,
      [ourAddresses, effectiveAddress],
    );
    const [addressPathMap, setAddressPathMap] = useState<Record<
      string,
      {derivationPath: string; chain: 'receive' | 'change'; index: number}
    > | null>(null);
    /** Historical BTC rate per (currency_timestampDay) for confirmed txs; fiat shown only when present. */
    const [historicalRatesMap, setHistoricalRatesMap] = useState<
      Record<string, number>
    >({});
    // Load derivation paths for our HD addresses so we can show path per tx row
    useEffect(() => {
      let cancelled = false;
      const loadPaths = async () => {
        if (!network || !addressType) {
          setAddressPathMap(null);
          return;
        }
        try {
          const list =
            await WalletService.getInstance().getHdAddressesWithPaths(
              network,
              addressType,
            );
          if (cancelled) {
            return;
          }
          const map: Record<
            string,
            {derivationPath: string; chain: 'receive' | 'change'; index: number}
          > = {};
          for (const item of list) {
            map[item.address] = {
              derivationPath: item.derivationPath,
              chain: item.chain,
              index: item.index,
            };
          }
          setAddressPathMap(map);
        } catch {
          if (!cancelled) {
            setAddressPathMap(null);
          }
        }
      };
      loadPaths();
      return () => {
        cancelled = true;
      };
    }, [network, addressType]);
    // Fetch historical rates for confirmed txs so we can show fiat at tx-time (not current rate).
    useEffect(() => {
      if (!baseApi || !selectedCurrency || transactions.length === 0) return;
      // Map key → raw block_time so we never have to re-parse the key string.
      const keysToFetch = new Map<string, number>();
      for (const tx of transactions) {
        if (tx.sentAt) continue; // pending — will use live rate
        const blockTime = tx.status?.block_time;
        if (typeof blockTime !== 'number' || !Number.isFinite(blockTime))
          continue;
        const key = getHistoricalRateKey(selectedCurrency, blockTime);
        keysToFetch.set(key, blockTime);
      }
      if (
        selectedTransaction?.status?.block_time &&
        !selectedTransaction.sentAt
      ) {
        const bt = selectedTransaction.status.block_time;
        keysToFetch.set(getHistoricalRateKey(selectedCurrency, bt), bt);
      }
      let cancelled = false;
      (async () => {
        for (const [key, blockTime] of keysToFetch) {
          if (cancelled) break;
          const rate = await HistoricalPriceService.getHistoricalRate(
            selectedCurrency,
            blockTime,
            baseApi,
          );
          if (cancelled) break;
          if (rate != null && rate > 0) {
            setHistoricalRatesMap(prev =>
              prev[key] === rate ? prev : {...prev, [key]: rate},
            );
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      baseApi,
      selectedCurrency,
      transactions,
      selectedTransaction?.txid,
      selectedTransaction?.status?.block_time,
      selectedTransaction?.sentAt,
    ]);
    const getTransactionAmounts = useCallback(
      (tx: any, addrOrAddrs?: string | string[]) =>
        getMempoolTransactionAmounts(tx, isOurAddress, addrOrAddrs),
      [isOurAddress],
    );
    // Memoize fetchTransactions to prevent unnecessary re-renders
    const memoizedFetchTransactions = useCallback(
      async (url: string | undefined, silent: boolean = false) => {
        dbg('memoizedFetchTransactions...');
        // Prevent multiple simultaneous fetches
        if (isFetching.current) {
          dbg('Fetch already in progress, skipping');
          // Clear refresh state if this was a refresh attempt
          if (isRefreshingRef.current) {
            setIsRefreshing(false);
          }
          return;
        }
        // Set loading state
        if (isMounted.current) {
          setLoading(true);
          isFetching.current = true;
        }
        // Cancel any ongoing requests
        if (abortController.current) {
          abortController.current.abort();
        }
        abortController.current = new AbortController();
        // Function to load from cache
        const loadFromCache = async () => {
          dbg('Loading from cache...');
          const cachedTransactions =
            isMultiAddress && network && addressType
              ? await WalletService.getInstance().transactionsFromCacheForWallet(
                  network,
                  addressType,
                )
              : await WalletService.getInstance().transactionsFromCache(
                  address || '',
                );
          if (isMounted.current) {
            // No need to update cache when loading from cache
            setTransactions(cachedTransactions);
            setHasMoreTransactions(cachedTransactions.length > 0);
            if (cachedTransactions.length > 0) {
              setLastSeenTxId(
                cachedTransactions[cachedTransactions.length - 1].txid,
              );
            }
            // Clear refresh state when loading from cache
            setIsRefreshing(false);
          }
        };
        try {
          if (!url || url === '') {
            dbg('URL is empty, loading from cache only');
            await loadFromCache();
            if (isMounted.current) {
              isFetching.current = false;
              setLoading(false);
              setIsRefreshing(false);
            }
            return;
          }
          // Guard against network/address mismatch using baseApi
          const isTestnetApi = /\/testnet(\/|$)/.test(url);
          const addressMatchesNetwork = (a: string, testnetApi: boolean) => {
            if (!a) return false;
            if (testnetApi) {
              return (
                a.startsWith('m') ||
                a.startsWith('n') ||
                a.startsWith('2') ||
                a.startsWith('tb1')
              );
            }
            return (
              a.startsWith('1') || a.startsWith('3') || a.startsWith('bc1')
            );
          };
          const addrToCheck = isMultiAddress ? addresses?.[0] : address;
          if (
            !addrToCheck ||
            !addressMatchesNetwork(addrToCheck, isTestnetApi)
          ) {
            dbg('TransactionList: address/baseApi mismatch; loading from DB', {
              address: addrToCheck,
              url,
            });
            // Show cached data rather than blanking the list on a mismatch
            await loadFromCache();
            return;
          }
          dbg(
            'TransactionList: Guard passed. Address matches network. Proceeding to fetch.',
            {
              address: addrToCheck,
              isTestnetApi,
              isMultiAddress,
            },
          );
          const cleanBaseApi = url.replace(/\/+$/, '').replace(/\/api\/?$/, '');
          let responseData: any[];
          let multiHasMore = false;
          if (isMultiAddress && addresses && addresses.length > 0 && network) {
            try {
              // After long-press rebuild parent calls refresh(true) → use full list; else active set only
              let syncAddressList: string[];
              if (useFullSyncOnceRef.current) {
                useFullSyncOnceRef.current = false;
                syncAddressList = addresses;
              } else {
                const effectiveAddressType =
                  addressType || 'segwit-native';
                const activeWithPaths =
                  await WalletService.getInstance().getActiveAddressesWithPaths(
                    network,
                    effectiveAddressType,
                  );
                syncAddressList =
                  activeWithPaths.length > 0
                    ? activeWithPaths.map(a => a.address)
                    : addresses;
              }
              await apiQueue.enqueue(
                'Syncing transactions…',
                setProgress =>
                  transactionSyncer.syncAddressesAtomic(
                    syncAddressList.map(a => ({address: a, network})),
                    `${cleanBaseApi}/api`,
                    setProgress,
                  ),
              );
              const cursors =
                WalletService.getInstance().getTransactionCursorsForAddresses(
                  network,
                  addresses,
                );
              if (isMounted.current) {
                setAddressCursors(cursors);
                setHasMoreTransactions(
                  Object.values(cursors).some(c => c !== null),
                );
              }
              await loadFromCache();
              return;
            } catch (e) {
              dbg('TransactionList: atomic tx sync failed', e);
              if (isMounted.current && !silent) {
                Toast.show({
                  type: 'info',
                  text1: 'Could not fetch transactions',
                  text2: 'Using cached data.',
                  position: 'top',
                });
              }
              await loadFromCache();
              return;
            }
          }
          if (isMultiAddress && addresses && addresses.length > 0) {
            let fetchList: string[];
            if (useFullSyncOnceRef.current) {
              useFullSyncOnceRef.current = false;
              fetchList = addresses;
            } else if (network && (addressType || 'segwit-native')) {
              const activeWithPaths =
                await WalletService.getInstance().getActiveAddressesWithPaths(
                  network,
                  addressType || 'segwit-native',
                );
              fetchList =
                activeWithPaths.length > 0
                  ? activeWithPaths.map(a => a.address)
                  : addresses;
            } else {
              fetchList = addresses;
            }
            const result =
              await WalletService.getInstance().fetchTransactionsForAddresses(
                cleanBaseApi,
                fetchList,
              );
            responseData = result.txs;
            setAddressCursors(result.cursors);
            multiHasMore = Object.values(result.cursors).some(c => c !== null);
          } else {
            const apiUrl = `${cleanBaseApi}/api/address/${address}/txs`;
            dbg('Starting fetch transactions from:', apiUrl);
            const response = await mempoolClient.get<any[]>(apiUrl, {
              signal: abortController.current.signal,
            });
            if (!response.ok) {
              // HTTP-level error (not a thrown exception) — fall back to DB
              dbg('TransactionList: non-ok response, loading from DB');
              await loadFromCache();
              return;
            }
            responseData = response.data ?? [];
          }
          dbg(
            'TransactionList: Received response with',
            responseData.length,
            'transactions',
          );
          if (!isMounted.current) {
            dbg('Component unmounted, skipping state updates');
            return;
          }
          const cached = (() => {
            if (isMultiAddress && addresses!.length > 0) {
              const merged: Record<string, any> = {};
              for (const addr of addresses!) {
                const p = transactionRepository.getPendingTxMap(
                  addr,
                  network || 'mainnet',
                );
                Object.assign(merged, p);
              }
              return merged;
            }
            return transactionRepository.getPendingTxMap(
              address!,
              network || 'mainnet',
            );
          })();
          const addrForAmounts = isMultiAddress ? addresses! : address;
          let pending = 0;
          let pendingTxs = responseData
            .filter((tx: any) => !tx.status || !tx.status.confirmed)
            .map((tx: any) => {
              const {sent} = getTransactionAmounts(tx, addrForAmounts);
              if (!isNaN(sent) && sent > 0) {
                pending += Number(sent);
              }
              return tx;
            });
          // Update cache - remove confirmed txs from pending
          for (const tx of responseData) {
            if (cached[tx.txid]) {
              delete cached[tx.txid];
              transactionRepository.removePending(
                tx.txid,
                network || 'mainnet',
              );
            }
          }
          const workingData = [...responseData];
          for (const txID in cached) {
            const validTxID = /^[a-fA-F0-9]{64}$/.test(txID);
            if (!validTxID) {
              delete cached[txID];
            } else {
              workingData.unshift({
                txid: txID,
                from: cached[txID].from,
                to: cached[txID].to,
                amount: cached[txID].satoshiAmount,
                satoshiAmount: cached[txID].satoshiAmount,
                satoshiFees: cached[txID].satoshiFees,
                sentAt: cached[txID].sentAt,
                status: {
                  confirmed: false,
                  block_height: null,
                },
              });
            }
          }
          await onUpdate(pendingTxs, pending);
          const uniqueTransactions = workingData.reduce(
            (acc: any[], tx: any) => {
              const existingTx = acc.find(t => t.txid === tx.txid);
              if (!existingTx) {
                acc.push(tx);
              } else {
                // If we have a duplicate, keep the confirmed one
                const existingIsPending =
                  !existingTx.status || !existingTx.status.confirmed;
                const newIsPending = !tx.status || !tx.status.confirmed;
                if (existingIsPending && !newIsPending) {
                  // Replace pending with confirmed
                  const index = acc.indexOf(existingTx);
                  acc[index] = tx;
                }
              }
              return acc;
            },
            [],
          );
          const newTransactions = uniqueTransactions.sort((a: any, b: any) => {
            // If either transaction is pending (no status or no block_height), prioritize it
            const aIsPending = !a.status || !a.status.block_height;
            const bIsPending = !b.status || !b.status.block_height;
            if (aIsPending && !bIsPending) {
              return -1;
            } // a is pending, show it first
            if (!aIsPending && bIsPending) {
              return 1;
            } // b is pending, show it first
            if (aIsPending && bIsPending) {
              // If both are pending, sort by sentAt timestamp if available
              const aTime = a.sentAt || 0;
              const bTime = b.sentAt || 0;
              return bTime - aTime; // Most recent pending first
            }
            // For confirmed transactions, sort by block height
            return (b.status.block_height || 0) - (a.status.block_height || 0);
          });
          if (isMultiAddress && network && addressType) {
            WalletService.getInstance().updateTransactionsCacheForWallet(
              network,
              addressType,
              newTransactions,
            );
          } else {
            WalletService.getInstance().updateTransactionsCache(
              address!,
              newTransactions,
            );
          }
          if (isMounted.current) {
            dbg(
              'TransactionList: Merging',
              newTransactions.length,
              'API transactions into state',
            );
            // Merge API page into existing state — never replace, so historical
            // txs loaded via fetchMore are preserved even when the API returns a
            // shorter first page.
            setTransactions(prev => {
              if (prev.length === 0) {
                return newTransactions;
              }
              const merged = new Map(prev.map((tx: any) => [tx.txid, tx]));
              for (const tx of newTransactions) {
                // API data takes precedence: updates confirmation status, block height, etc.
                merged.set(tx.txid, tx);
              }
              return sortTxs(Array.from(merged.values()));
            });
            setHasMoreTransactions(
              isMultiAddress ? multiHasMore : newTransactions.length > 0,
            );
            if (!isMultiAddress && newTransactions.length > 0) {
              setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
            }
            // Clear refresh state on successful API response
            setIsRefreshing(false);
          }
        } catch (error: any) {
          if (isCanceledError(error)) {
            dbg('Request canceled');
            // Clear refresh state on cancel
            if (isMounted.current) {
              setIsRefreshing(false);
            }
          } else {
            dbg('Error fetching transactions:', error);
            if (isMounted.current && !silent) {
              Toast.show({
                type: 'error',
                text1: 'Error loading transactions',
                text2: `Check your connection or try again.\n\n(${String(
                  error,
                ).slice(0, 60)}...)`,
              });
              dbg('Error loading transactions:', error);
              // Always fallback to cache on any error
              await loadFromCache();
            }
          }
        } finally {
          if (isMounted.current) {
            isFetching.current = false;
            setLoading(false);
            setLoadingMore(false);
          }
        }
      },
      [
        address,
        addresses,
        isMultiAddress,
        network,
        addressType,
        getTransactionAmounts,
        onUpdate,
      ],
    );
    // For user pull-to-refresh
    const handlePullRefresh = useCallback(async () => {
      if (isRefreshingRef.current || isFetching.current) {
        return;
      }
      HapticFeedback.medium();
      setIsRefreshing(true);
      // Invalidate before parent balance sync so mempool address stats are fresh.
      if (baseApi) {
        const cleanBase = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
        mempoolClient.invalidate(`${cleanBase}/api/address/`);
      }
      onPullRefresh?.();
      try {
        await memoizedFetchTransactions(baseApi);
      } catch {
        // Error is already handled in memoizedFetchTransactions
      } finally {
        if (isMounted.current) {
          setIsRefreshing(false);
        }
      }
    }, [baseApi, memoizedFetchTransactions, onPullRefresh]);
    // Expose imperative refresh method so parents (e.g., WalletHome) can trigger
    // the same behavior as a user pull-to-refresh gesture.
    useImperativeHandle(
      ref,
      () => ({
        refresh: (useFullList?: boolean) => {
          if (useFullList === true) {
            useFullSyncOnceRef.current = true;
          }
          handlePullRefresh();
        },
      }),
      [handlePullRefresh],
    );
    // Cleanup on unmount
    useEffect(() => {
      return () => {
        isMounted.current = false;
        if (abortController.current) {
          abortController.current.abort();
        }
      };
    }, []);
    // Sync isRefreshing state to ref to avoid effect re-runs
    useEffect(() => {
      isRefreshingRef.current = isRefreshing;
    }, [isRefreshing]);
    // Fix transaction refresh handling
    useEffect(() => {
      const hasAddress = address || (isMultiAddress && addresses && addresses.length > 0);
      if (!hasAddress || !baseApi || baseApi === '') {
        dbg('Skipping transaction fetch - address/baseApi not initialized', {
          address,
          addresses: isMultiAddress ? addresses?.length : 0,
          baseApi,
        });
        // Don't wipe existing transactions — the addresses may be temporarily
        // undefined during a state transition. Preserve whatever is on screen.
        setLoading(false);
        setIsRefreshing(false);
        return;
      }
      // Pre-populate from DB so cached rows are visible while the live fetch runs.
      let mounted = true;
      (async () => {
        try {
          const cached =
            isMultiAddress && network && addressType
              ? await WalletService.getInstance().transactionsFromCacheForWallet(
                  network,
                  addressType,
                )
              : await WalletService.getInstance().transactionsFromCache(
                  address || '',
                );
          if (mounted && cached.length > 0) {
            setTransactions(cached);
          }
        } catch {
          // Non-critical — the live fetch will populate state when connectivity
          // is available.
        }
      })();
      setHasMoreTransactions(true);
      setLastSeenTxId(null);

      const controller = new AbortController();
      abortController.current = controller;
      const fetchData = async (silent: boolean = false) => {
        if (!mounted || isFetching.current || isRefreshingRef.current) {
          dbg('Skipping fetch - conditions not met:', {
            mounted,
            isFetching: isFetching.current,
            isRefreshing: isRefreshingRef.current,
          });
          return;
        }
        try {
          dbg('Starting fetch transactions');
          await memoizedFetchTransactions(baseApi, silent);
        } catch (error: any) {
          dbg('error in fetch', error);
          if (!isCanceledError(error)) {
            dbg('Error in fetch:', error);
          }
        }
      };
      // Initial fetch
      if (!isFetching.current && !isRefreshingRef.current) {
        fetchData(true);
      }
      return () => {
        dbg('Cleaning up fetch effect');
        mounted = false;
        if (abortController.current) {
          abortController.current.abort();
        }
        // Reset states on cleanup
        isFetching.current = false;
        setLoading(false);
        setIsRefreshing(false);
      };
    }, [
      address,
      addresses,
      isMultiAddress,
      network,
      addressType,
      baseApi,
      memoizedFetchTransactions,
    ]);
    // Memoized transaction status checker
    const getTransactionStatus = useCallback(
      (tx: any) => {
        const isSending =
          !!tx?.sentAt ||
          !!tx.vin?.some((input: any) =>
            isOurAddress(input.prevout?.scriptpubkey_address || ''),
          );
        if (tx.sentAt || !tx.status?.confirmed) {
          return {
            confirmed: false,
            text: isSending ? 'Sending' : 'Receiving',
            icon: pendingIcon,
          };
        }
        return {
          confirmed: true,
          text: isSending ? 'Sent' : 'Received',
          icon: isSending ? outIcon : inIcon,
        };
      },
      [isOurAddress],
    );

    const fetchMore = useCallback(async () => {
      if (loadingMore || !isMounted.current) {
        dbg('Skipping fetchMore — already in flight or unmounted');
        return;
      }

      // ── Multi-address path ─────────────────────────────────────────────────
      if (isMultiAddress) {
        if (!baseApi || !addresses?.length) {
          return;
        }
        const hasOpenCursor = Object.values(addressCursors).some(
          c => c !== null,
        );
        if (!hasOpenCursor) {
          setHasMoreTransactions(false);
          return;
        }
        dbg(
          'fetchMore (multi-address): fetching next page with cursors',
          addressCursors,
        );
        setLoadingMore(true);
        try {
          const cleanBaseApi = baseApi
            .replace(/\/+$/, '')
            .replace(/\/api\/?$/, '');
          const result =
            await WalletService.getInstance().fetchMoreTransactionsForAddresses(
              cleanBaseApi,
              addressCursors,
            );
          if (!isMounted.current) {
            return;
          }
          const stillHasMore = Object.values(result.cursors).some(
            c => c !== null,
          );
          setAddressCursors(result.cursors);
          setHasMoreTransactions(stillHasMore);
          if (result.txs.length > 0) {
            setTransactions(prev => {
              const existingIds = new Set(prev.map((tx: any) => tx.txid));
              const newTxs = result.txs.filter(
                (tx: any) => !existingIds.has(tx.txid),
              );
              if (newTxs.length === 0) {
                return prev;
              }
              const merged = sortTxs([...prev, ...newTxs]);
              if (network && addressType) {
                WalletService.getInstance().updateTransactionsCacheForWallet(
                  network,
                  addressType,
                  merged,
                );
              }
              dbg(
                'fetchMore (multi-address): appended',
                newTxs.length,
                'new txs, total',
                merged.length,
              );
              return merged;
            });
          }
        } catch (error: any) {
          if (!isCanceledError(error)) {
            dbg('fetchMore (multi-address) error:', error);
            Toast.show({
              type: 'error',
              text1: 'Error loading more transactions',
            });
          }
        } finally {
          if (isMounted.current) {
            setLoadingMore(false);
          }
        }
        return;
      }

      // ── Single-address path ────────────────────────────────────────────────
      if (!lastSeenTxId || !address || !baseApi) {
        dbg('Skipping fetchMore (single):', {lastSeenTxId, address, baseApi});
        return;
      }
      dbg('Starting fetch more from:', lastSeenTxId);
      setLoadingMore(true);
      try {
        // Ensure baseApi doesn't end with a slash and add a single slash
        const cleanBaseApi = baseApi.replace(/\/+$/, '');
        const response = await mempoolClient.get<any[]>(
          `${cleanBaseApi}/address/${address}/txs/chain/${lastSeenTxId}`,
          {signal: abortController.current?.signal},
        );
        if (!response.ok) {
          // API error during pagination — leave hasMoreTransactions true so
          // the user can retry without losing the ability to paginate.
          dbg('fetchMore: non-ok response, keeping pagination state');
          return;
        }
        const newTransactions = response.data ?? [];
        dbg('Received more transactions:', newTransactions.length);
        if (!isMounted.current) {
          dbg('Component unmounted during fetch more');
          return;
        }
        // Only set hasMoreTransactions to false on a genuine empty page
        if (newTransactions.length === 0) {
          dbg('No more transactions to load');
          setHasMoreTransactions(false);
          return;
        }
        const cached = transactionRepository.getPendingTxMap(
          address!,
          network || 'mainnet',
        );
        dbg('Cached transactions for fetch more:', Object.keys(cached).length);
        setTransactions(prevTransactions => {
          try {
            const existingIds = new Set(prevTransactions.map(tx => tx.txid));
            const filteredTransactions = newTransactions.filter(
              (tx: any) => !existingIds.has(tx.txid),
            );
            dbg('New unique transactions:', filteredTransactions.length);
            // Process pending transactions
            let pending = 0;
            let pendingTxs = filteredTransactions
              .filter((tx: any) => !tx.status || !tx.status.confirmed)
              .map((tx: any) => {
                const {sent} = getTransactionAmounts(
                  tx,
                  isMultiAddress ? addresses : address,
                );
                if (!isNaN(sent) && sent > 0) {
                  pending += Number(sent);
                }
                return tx;
              });
            dbg('New pending transactions:', pendingTxs.length);
            // Update cache
            filteredTransactions.filter((tx: any) => {
              if (cached[tx.txid]) {
                delete cached[tx.txid];
                dbg('delete from cache in fetch more', tx.txid);
                transactionRepository.removePending(
                  tx.txid,
                  network || 'mainnet',
                );
              }
            });
            // Add cached transactions
            for (const txID in cached) {
              dbg('prepending from cache in fetch more', txID, cached[txID]);
              const validTxID = /^[a-fA-F0-9]{64}$/.test(txID);
              if (!validTxID) {
                delete cached[txID];
              } else {
                filteredTransactions.unshift({
                  txid: txID,
                  from: cached[txID].from,
                  to: cached[txID].to,
                  amount: cached[txID].satoshiAmount,
                  satoshiAmount: cached[txID].satoshiAmount,
                  satoshiFees: cached[txID].satoshiFees,
                  sentAt: cached[txID].sentAt,
                  status: {
                    confirmed: false,
                    block_height: null,
                  },
                });
              }
            }
            onUpdate(pendingTxs, pending);
            dbg('Updated pending transactions in fetch more');
            const txs = [...prevTransactions, ...filteredTransactions];
            dbg('Caching transactions:', txs.length);
            WalletService.getInstance().updateTransactionsCache(
              address,
              txs,
              false, // isFromCache
            );
            return txs;
          } catch (error: any) {
            dbg('Error in setTransactions:', error);
            return prevTransactions;
          }
        });
        // Only update lastSeenTxId if we have new transactions
        if (newTransactions.length > 0) {
          setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
          dbg(
            'Set new last seen txid:',
            newTransactions[newTransactions.length - 1].txid,
          );
        }
      } catch (error: any) {
        dbg('error in fetch more', error);
        if (!isCanceledError(error)) {
          dbg('Error fetching more transactions:', error);
          dbg('Error details in fetch more:', error.message);
          Toast.show({
            type: 'error',
            text1: 'Error loading more transactions',
            text2: 'Check your connection or try again.',
          });
        }
      } finally {
        if (isMounted.current) {
          setLoadingMore(false);
          dbg('Fetch more completed, loading more:', false);
        }
      }
    }, [
      loadingMore,
      lastSeenTxId,
      address,
      addresses,
      baseApi,
      getTransactionAmounts,
      onUpdate,
      isMultiAddress,
      addressCursors,
      network,
      addressType,
    ]);
    // Add effect to handle initialTransactions changes
    useEffect(() => {
      if (initialTransactions && initialTransactions.length > 0) {
        setTransactions(initialTransactions);
      }
    }, [initialTransactions]);
    const styles = StyleSheet.create({
      container: {
        flex: 1,
      },
      list: {
        flex: 1,
        backgroundColor: appTheme.colors.background, // White in light mode, dark in dark mode
        marginTop: Platform.OS === 'ios' ? -insets.top : 0,
      },
      listContent: {
        flexGrow: 1,
        paddingBottom: 8 + insets.bottom,
      },
      transactionItem: {
        padding: 10,
        marginVertical: 3,
        backgroundColor:
          appTheme.colors.background === '#ffffff'
            ? '#ffffff' // White in light mode
            : appTheme.colors.cardBackground, // Dark card in dark mode
        borderRadius: 10,
        elevation: 1,
        shadowColor: appTheme.colors.shadowColor,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.05,
        shadowRadius: 1,
        borderWidth: 1,
        borderColor:
          appTheme.colors.background === '#ffffff'
            ? appTheme.colors.blackOverlay05 // Original light mode border
            : appTheme.colors.border + '40', // Dark border in dark mode
      },
      transactionItemPressed: {
        opacity: 0.7,
        backgroundColor:
          appTheme.colors.background === '#ffffff'
            ? appTheme.colors.blackOverlay05 // Light mode pressed background
            : appTheme.colors.whiteOverlay10, // Dark mode pressed background
      },
      transactionRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginVertical: 2,
      },
      endOfListWrap: {
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 10,
      },
      endOfListText: {
        textAlign: 'center',
        fontSize: appTheme.fontSizes?.lg || 16,
        fontFamily: appTheme.fontFamilies?.regular,
        color: appTheme.colors.text,
        marginBottom: 4,
      },
      endOfListCount: {
        textAlign: 'center',
        fontSize: appTheme.fontSizes?.base || 13,
        fontFamily: appTheme.fontFamilies?.regular,
        color: appTheme.colors.textSecondary,
      },
      status: {
        fontSize: appTheme.fontSizes?.lg || 16, // Increased from 13px for better readability
        fontFamily: appTheme.fontFamilies?.bold,
        color: appTheme.colors.text,
        opacity: 0.9,
      },
      amount: {
        fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
        fontSize:
          appTheme.fontSizes?.md ||
          COMMON_FONT_CONFIGS.bitcoinAmountMono.fontSize,
        letterSpacing: COMMON_FONT_CONFIGS.bitcoinAmountMono.letterSpacing,
        color: appTheme.colors.text,
        opacity: 0.95,
      },
      fiatAmount: {
        fontSize: appTheme.fontSizes?.base || 13, // Increased from 12px for better accessibility
        fontFamily: appTheme.fontFamilies?.monospace,
        color: appTheme.colors.text,
        opacity: 0.6,
      },
      address: {
        fontSize: appTheme.fontSizes?.base || 13,
        fontFamily: appTheme.fontFamilies?.monospaceMedium,
        color: appTheme.colors.text,
        opacity: 0.6,
        marginRight: 4,
      },
      addressText: {
        fontSize: appTheme.fontSizes?.base || 13,
        fontFamily: appTheme.fontFamilies?.monospace,
        color: appTheme.colors.text,
        opacity: 0.8,
      },
      pathText: {
        fontSize: appTheme.fontSizes?.xs || 11,
        fontFamily: appTheme.fontFamilies?.monospace,
        color: appTheme.colors.textSecondary,
        opacity: 0.8,
        marginTop: 2,
      },
      pathIndexText: {
        fontSize: appTheme.fontSizes?.xs || 11,
        fontFamily: appTheme.fontFamilies?.regular,
        color: appTheme.colors.textSecondary,
        opacity: 0.8,
      },
      txId: {
        fontSize: appTheme.fontSizes?.base || 13,
        fontFamily: appTheme.fontFamilies?.monospaceMedium,
        color: appTheme.colors.text,
        opacity: 0.6,
      },
      timestamp: {
        fontSize: appTheme.fontSizes?.xs || 11,
        fontFamily: appTheme.fontFamilies?.regular,
        color: appTheme.colors.text,
        opacity: 0.5,
      },
      timestampRow: {
        flexDirection: 'row',
        alignItems: 'center',
      },
      txText: {
        fontSize: appTheme.fontSizes?.base || 13,
        fontFamily: appTheme.fontFamilies?.monospace,
        color: appTheme.colors.text,
        opacity: 0.8,
      },
      emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
      },
      emptyText: {
        fontSize: appTheme.fontSizes?.md || 15,
        fontFamily: appTheme.fontFamilies?.regular,
        color: appTheme.colors.text,
        textAlign: 'center',
        opacity: 0.7,
      },
      addressRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginVertical: 2,
      },
      addressContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
      },
      statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
      },
      statusIcon: {
        width: 20,
        height: 20,
        marginRight: 8,
        tintColor: appTheme.colors.text, // Use theme text color for icons in dark mode
      },
      linkIcon: {
        width: 16,
        height: 16,
        marginRight: 4,
        tintColor: appTheme.colors.textSecondary, // Use theme secondary text color for link icon
      },
      merchantIconWrap: {
        position: 'relative',
        width: 20,
        height: 20,
        marginRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
      },
      merchantIcon: {
        width: 20,
        height: 20,
        borderRadius: 4,
      },
      merchantFallbackIcon: {
        width: 20,
        height: 20,
        tintColor: appTheme.colors.text,
      },
      merchantCheckBadge: {
        position: 'absolute',
        bottom: -3,
        right: -3,
        backgroundColor: appTheme.colors.bitcoinOrange,
        width: 12,
        height: 12,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: appTheme.colors.cardBackground,
      },
      merchantCheckText: {
        fontSize: appTheme.fontSizes?.xs || 10,
        fontFamily: appTheme.fontFamilies?.bold,
        color: appTheme.colors.textOnPrimary,
        lineHeight: appTheme.fontSizes?.xs || 10,
        includeFontPadding: false,
      },
      rowChevron: {
        fontSize: appTheme.fontSizes?.lg || 16,
        fontFamily: appTheme.fontFamilies?.regular,
        color: appTheme.colors.textSecondary,
        marginLeft: 4,
        lineHeight: appTheme.fontSizes?.lg || 16,
      },
    });
    // Memoized render item with currency support
    const renderItem = useCallback(
      ({item}: any) => {
        const {text: status, icon: statusIcon} = getTransactionStatus(item);
        const {sent, received} = getTransactionAmounts(
          item,
          isMultiAddress ? addresses : address,
        );
        const txTime = item.sentAt || item.status.block_time * 1000;
        const txConf = item.sentAt ? false : item.status.confirmed;
        const timestamp = txConf
          ? txTime < Date.now()
            ? moment(txTime).fromNow()
            : 'Recently confirmed'
          : 'Pending confirmation';
        const shortTxId = `${item.txid.slice(0, 3)}…${item.txid.slice(-3)}`;

        const isSending = status.includes('Sen');
        // Get the relevant address(es) based on transaction type
        let relevantAddresses: string[] = [];
        let relevantAddress: string | null = null;
        if (isSending) {
          // For sent transactions: collect ALL recipient addresses (outputs that aren't ours)
          relevantAddresses =
            item?.vout
              ?.filter(
                (output: any) => !isOurAddress(output.scriptpubkey_address),
              )
              .map((output: any) => output.scriptpubkey_address)
              .filter((addr: string) => addr) || [];
          relevantAddresses = [...new Set(relevantAddresses)];
          relevantAddress = relevantAddresses[0] || null;
        } else {
          // For received transactions: show the first input address that's not ours (the sender)
          relevantAddress =
            item?.vin?.find(
              (input: any) =>
                !isOurAddress(input.prevout?.scriptpubkey_address || ''),
            )?.prevout?.scriptpubkey_address || null;
          relevantAddresses = [];
        }

        const merchantLabel = merchantLabelRepository.resolveForOutboundTx(
          item.txid,
          network,
          isSending
            ? relevantAddresses.length > 0
              ? relevantAddresses
              : relevantAddress
              ? [relevantAddress]
              : []
            : relevantAddress
            ? [relevantAddress]
            : [],
        );
        const merchantName = merchantLabel?.platform?.trim() || '';
        const isLightMode =
          appTheme.colors.background === lightTheme.colors.background;
        const merchantLogoUrl = merchantLabel
          ? isLightMode && merchantLabel.logoLightUrl
            ? merchantLabel.logoLightUrl
            : merchantLabel.logoUrl
          : undefined;
        const merchantLogo = merchantLogoUrl ? {uri: merchantLogoUrl} : null;
        const brantaVerified =
          isSending &&
          !!network &&
          merchantLabelRepository.isVerifiedTx(item.txid, network);
        // Follow global BTC/sats toggle (WalletHome)
        // sent === 0: all outputs landed on our own addresses — self-directed tx.
        // Distinguish by number of internal outputs:
        //   1 internal output  → classic UTXO merge      → Consolidation
        //   2+ internal outputs → spreading across paths  → Rebalancing
        const isSelfTransfer = isSending && sent === 0;
        const confirmed = item.sentAt ? false : item.status?.confirmed;
        const internalOutputCount = isSelfTransfer
          ? (item.vout ?? []).filter((o: any) =>
              isOurAddress(o.scriptpubkey_address || ''),
            ).length
          : 0;
        const isConsolidation = isSelfTransfer && internalOutputCount <= 1;
        const isRebalancing = isSelfTransfer && internalOutputCount > 1;
        let info = isSelfTransfer
          ? `+${formatBitcoinDisplay(received, {
              inSats: showSats,
              formatted: balanceFormattingEnabled,
            })}`
          : isSending
          ? `-${formatBitcoinDisplay(sent, {
              inSats: showSats,
              formatted: balanceFormattingEnabled,
            })}`
          : `+${formatBitcoinDisplay(received, {
              inSats: showSats,
              formatted: balanceFormattingEnabled,
            })}`;
        const brantaTitle = merchantName || 'merchant';
        const finalStatus = brantaVerified
          ? confirmed
            ? `Sent to ${brantaTitle}`
            : `Paying ${brantaTitle}`
          : isConsolidation
          ? confirmed
            ? 'Consolidated'
            : 'Consolidating'
          : isRebalancing
          ? confirmed
            ? 'Rebalanced'
            : 'Rebalancing'
          : status;
        const finalIcon = isSelfTransfer
          ? confirmed
            ? consolidateIcon
            : pendingIcon
          : statusIcon;
        // Historical rate at tx time for confirmed txs; current live rate for pending/unconfirmed.
        const isPendingTx = !!item.sentAt || !item.status?.confirmed;
        const blockTime = isPendingTx ? null : item.status?.block_time;
        const historicalKey =
          typeof blockTime === 'number' && Number.isFinite(blockTime)
            ? getHistoricalRateKey(selectedCurrency, blockTime)
            : null;
        const historicalRate =
          historicalKey != null
            ? historicalRatesMap[historicalKey] ?? null
            : null;
        // Pending/unconfirmed txs fall back to the current live rate from WalletHome.
        const effectiveRate =
          historicalRate != null && historicalRate > 0
            ? historicalRate
            : isPendingTx && _btcRate > 0
            ? _btcRate
            : null;
        const getFiatAmount = (btcAmount: number) => {
          if (effectiveRate == null || effectiveRate <= 0) return null;
          return presentFiat(btcAmount * effectiveRate);
        };
        const fiatAmount =
          effectiveRate != null && effectiveRate > 0
            ? isConsolidation
              ? getFiatAmount(received)
              : isSending
              ? getFiatAmount(sent)
              : getFiatAmount(received)
            : null;
        const openDetails = () => {
          setSelectedTransaction(item);
          setIsDetailsModalVisible(true);
        };
        return (
          <AppPressable
            style={({pressed}) => [
              styles.transactionItem,
              pressed && styles.transactionItemPressed,
            ]}
            onPress={openDetails}
            android_ripple={{
              color:
                appTheme.colors.background === '#ffffff'
                  ? 'rgba(0,0,0,0.15)'
                  : 'rgba(255,255,255,0.15)',
              borderless: false,
            }}>
            {/* 1. TOP ROW: Status and Amount */}
            <View style={styles.transactionRow}>
              <View style={styles.statusContainer}>
                {brantaVerified ? (
                  <View style={styles.merchantIconWrap}>
                    {merchantLogo ? (
                      <Image
                        source={merchantLogo}
                        style={styles.merchantIcon}
                        resizeMode="contain"
                      />
                    ) : (
                      <AnimatedStatusIcon
                        source={outIcon}
                        style={styles.merchantFallbackIcon}
                        animationType={confirmed ? 'none' : 'send'}
                      />
                    )}
                    <View style={styles.merchantCheckBadge}>
                      <AppText style={styles.merchantCheckText}>✓</AppText>
                    </View>
                  </View>
                ) : (
                  <AnimatedStatusIcon
                    source={finalIcon}
                    style={styles.statusIcon}
                    animationType={
                      confirmed
                        ? 'none'
                        : isConsolidation
                        ? 'consolidate'
                        : isRebalancing
                        ? 'rebalance'
                        : isSending
                        ? 'send'
                        : 'receive'
                    }
                  />
                )}
                <AppText style={styles.status}>{finalStatus}</AppText>
              </View>
              <AppText
                style={[
                  styles.amount,
                  isSending
                    ? {
                        color:
                          appTheme.colors.background === '#ffffff'
                            ? themes.cryptoVibrant.colors.accent
                            : appTheme.colors.bitcoinOrange,
                      }
                    : {color: themes.cryptoVibrant.colors.secondary},
                ]}>
                {isBlurred ? '***' : info}
              </AppText>
            </View>

            {/* 2. MIDDLE ROW: Addresses and Fiat */}
            {relevantAddress && (
              <View style={styles.addressRow}>
                <View style={styles.addressContainer}>
                  <AppText style={styles.address}>
                    {isSending ? 'To: ' : 'Fr: '}
                    {merchantLabel ? (
                      <AppText
                        style={[
                          styles.addressText,
                          {fontFamily: appTheme.fontFamilies?.medium},
                        ]}>
                        {merchantLabel.platform}
                        {'\n'}
                        <AppText style={styles.addressText}>
                          {relevantAddress.slice(0, 3)}…
                          {relevantAddress.slice(-3)}
                          {isSending && relevantAddresses.length > 1 && (
                            <AppText style={styles.addressText}>
                              {' '}
                              (+{relevantAddresses.length - 1})
                            </AppText>
                          )}
                        </AppText>
                      </AppText>
                    ) : (
                      <AppText style={styles.addressText}>
                        {relevantAddress.slice(0, 3)}…
                        {relevantAddress.slice(-3)}
                        {isSending && relevantAddresses.length > 1 && (
                          <AppText style={styles.addressText}>
                            {' '}
                            (+{relevantAddresses.length - 1})
                          </AppText>
                        )}
                      </AppText>
                    )}
                  </AppText>
                </View>
                <AppText variant="caption" tone="muted" style={styles.fiatAmount}>
                  {isBlurred
                    ? '***'
                    : fiatAmount != null
                    ? `${getCurrencySymbol(selectedCurrency)}${fiatAmount}`
                    : '—'}
                </AppText>
              </View>
            )}

            {/* 3. BOTTOM ROW: TxID and Timestamp */}
            <View style={styles.transactionRow}>
              <AppText variant="caption" tone="muted" style={styles.txId}>
                Tx:<AppText style={styles.txText}> {shortTxId}</AppText>
              </AppText>
              <View style={styles.timestampRow}>
                <AppText variant="caption" tone="muted" style={styles.timestamp}>
                  {timestamp}
                </AppText>
                <AppText style={styles.rowChevron}>›</AppText>
              </View>
            </View>

          </AppPressable>
        );
      },
      [
        getTransactionStatus,
        getTransactionAmounts,
        address,
        addresses,
        isMultiAddress,
        isOurAddress,
        _btcRate,
        network,
        appTheme.colors.background,
        appTheme.colors.bitcoinOrange,
        appTheme.fontFamilies?.medium,
        styles.transactionRow,
        styles.statusContainer,
        styles.statusIcon,
        styles.status,
        styles.amount,
        styles.addressRow,
        styles.addressContainer,
        styles.address,
        styles.addressText,
        styles.fiatAmount,
        styles.txId,
        styles.txText,
        styles.timestamp,
        styles.timestampRow,
        styles.rowChevron,
        styles.merchantIconWrap,
        styles.merchantIcon,
        styles.merchantFallbackIcon,
        styles.merchantCheckBadge,
        styles.merchantCheckText,
        styles.transactionItem,
        styles.transactionItemPressed,
        isBlurred,
        getCurrencySymbol,
        selectedCurrency,
        historicalRatesMap,
        balanceFormattingEnabled,
        showSats,
      ],
    );
    const renderEmptyComponent = useCallback(() => {
      if (loading) {
        return <TransactionListSkeleton noContainerPadding={true} />;
      }
      return (
        <View style={styles.emptyContainer}>
          <AppText style={styles.emptyText}>No transactions yet</AppText>
        </View>
      );
    }, [loading, styles.emptyContainer, styles.emptyText]);
    const safeAreaStyle = useMemo(
      () => ({
        paddingTop: Platform.OS === 'android' ? 0 : insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }),
      [insets.top, insets.left, insets.right],
    );
    return (
      <View style={[styles.container, safeAreaStyle]}>
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={transactions}
          renderItem={renderItem}
          contentInsetAdjustmentBehavior="never"
          keyExtractor={item => {
            const isPending = !item.status || !item.status.confirmed;
            const timestamp = item.sentAt || item.status?.block_time || 0;
            return `${item.txid}-${
              isPending ? 'pending' : 'confirmed'
            }-${timestamp}`;
          }}
          onEndReached={hasMoreTransactions ? fetchMore : null}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={renderEmptyComponent}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" />
            ) : !hasMoreTransactions && transactions.length > 0 ? (
              <View style={styles.endOfListWrap}>
                <AppText style={styles.endOfListText}>
                  No more transactions
                </AppText>
                <AppText style={styles.endOfListCount}>
                  {transactions.length} in total
                </AppText>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handlePullRefresh}
              progressViewOffset={0}
              enabled={true}
              tintColor={
                appTheme.colors.background === '#ffffff'
                  ? appTheme.colors.accent || appTheme.colors.primary
                  : appTheme.colors.bitcoinOrange ||
                    appTheme.colors.secondary ||
                    appTheme.colors.white
              }
              colors={
                Platform.OS === 'android'
                  ? [
                      appTheme.colors.background === '#ffffff'
                        ? appTheme.colors.accent || appTheme.colors.primary
                        : appTheme.colors.bitcoinOrange ||
                          appTheme.colors.secondary ||
                          appTheme.colors.white,
                    ]
                  : undefined
              }
            />
          }
        />
        {selectedTransaction && (
          <TransactionDetailsModal
            visible={isDetailsModalVisible}
            transaction={selectedTransaction}
            onClose={() => {
              setIsDetailsModalVisible(false);
              setSelectedTransaction(null);
            }}
            baseApi={baseApi}
            selectedCurrency={selectedCurrency}
            historicalRate={(() => {
              const selTx = selectedTransaction;
              // Confirmed: use historical rate at block time.
              if (!selTx?.sentAt && selTx?.status?.block_time != null) {
                return (
                  historicalRatesMap[
                    getHistoricalRateKey(
                      selectedCurrency,
                      selTx.status.block_time,
                    )
                  ] ?? null
                );
              }
              // Pending / unconfirmed: show value at current live rate.
              return _btcRate > 0 ? _btcRate : null;
            })()}
            getCurrencySymbol={getCurrencySymbol}
            status={
              selectedTransaction
                ? (() => {
                    const {text, confirmed} =
                      getTransactionStatus(selectedTransaction);
                    const {sent} = getTransactionAmounts(
                      selectedTransaction,
                      isMultiAddress ? addresses : address,
                    );
                    const isSelf = text.includes('Sen') && sent === 0;
                    if (!isSelf) {
                      return {confirmed, text};
                    }
                    const internalOuts = (
                      selectedTransaction.vout ?? []
                    ).filter((o: any) =>
                      isOurAddress(o.scriptpubkey_address || ''),
                    ).length;
                    const label =
                      internalOuts <= 1
                        ? confirmed
                          ? 'Consolidation'
                          : 'Consolidating'
                        : confirmed
                        ? 'Rebalanced'
                        : 'Rebalancing';
                    return {confirmed, text: label};
                  })()
                : null
            }
            amounts={
              selectedTransaction
                ? getTransactionAmounts(
                    selectedTransaction,
                    isMultiAddress ? addresses : address,
                  )
                : null
            }
            addressPathMap={addressPathMap}
            isBlurred={isBlurred}
            network={network}
          />
        )}
      </View>
    );
  },
);
export default TransactionList;
