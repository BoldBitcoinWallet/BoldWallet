import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import Toast from 'react-native-toast-message';
import moment from 'moment';
import {useTheme, themes} from '../theme';
import {COMMON_FONT_CONFIGS} from '../theme/fonts';
import {useUser} from '../context/UserContext';
import {
  HeaderPriceButton,
  HeaderProvider,
  HeaderNetwork,
} from '../components/Header';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import utxoRepository from '../services/repositories/UtxoRepository';
import priceRepository from '../services/repositories/PriceRepository';
import {WalletService} from '../services/WalletService';
import utxoSyncer from '../services/sync/UtxoSyncer';
import database from '../services/Database';
import mempoolClient from '../services/MempoolClient';
import {presentFiat, getCurrencySymbol, dbg} from '../utils';
import AppPressable from '../components/AppPressable';
import {CacheIndicator} from '../components/CacheIndicator';
import CurrencySelector from '../components/CurrencySelector';

/** Mempool.space UTXO item: txid, vout, value (sats), status { confirmed, block_height?, block_hash?, block_time? }. */
type ApiUtxo = {
  txid: string;
  vout: number;
  value: number;
  status?: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
};

/** UTXO with HD context: address, derivation path, and chain (receive vs change). */
export type UtxoWithPath = ApiUtxo & {
  address: string;
  derivationPath: string;
  chain: 'receive' | 'change';
  chainIndex: number;
};

/**
 * Convert StoredUtxo rows from the DB into the UtxoWithPath shape used by the UI.
 * Chain and index are resolved from the addressesWithPaths lookup first; if the
 * address is not found there (e.g. pre-load without fresh derivation), they are
 * parsed directly from the stored derivation path (e.g. "m/84'/0'/0'/1/3" →
 * chain=change, index=3).
 * The result is sorted: receive before change, by chain index, newest confirmed first.
 */
function storedToUtxoWithPath(
  stored: ReturnType<typeof utxoRepository.getUtxosForAddresses>,
  addressesWithPaths: Array<{
    address: string;
    derivationPath: string;
    chain: 'receive' | 'change';
    index: number;
  }>,
): UtxoWithPath[] {
  const mapped: UtxoWithPath[] = stored.map(u => {
    const info = addressesWithPaths.find(a => a.address === u.address);
    const parts = (u.derivationPath ?? '').split('/');
    const chainNum = parseInt(parts.at(-2) ?? '', 10);
    const chainIdx = parseInt(parts.at(-1) ?? '', 10);
    return {
      txid: u.txid,
      vout: u.vout,
      value: u.valueSats,
      status: {
        confirmed: u.isConfirmed,
        block_height: u.blockHeight ?? undefined,
        block_time: u.blockTime ?? undefined,
      },
      address: u.address,
      derivationPath: u.derivationPath ?? info?.derivationPath ?? '',
      chain: info?.chain ?? (chainNum === 1 ? 'change' : 'receive'),
      chainIndex: info?.index ?? (Number.isNaN(chainIdx) ? 0 : chainIdx),
    };
  });
  mapped.sort((a, b) => {
    if (a.chain !== b.chain) return a.chain === 'receive' ? -1 : 1;
    if (a.chainIndex !== b.chainIndex) return a.chainIndex - b.chainIndex;
    return (b.status?.block_time ?? 0) - (a.status?.block_time ?? 0);
  });
  return mapped;
}

function addressMatchesNetwork(addr: string, isTestnetApi: boolean): boolean {
  if (!addr) return false;
  if (isTestnetApi) {
    return (
      ['m', 'n', '2', 't'].some(p => addr.startsWith(p)) ||
      addr.startsWith('tb1')
    );
  }
  return (
    ['1', '3', 'b'].some(p => addr.startsWith(p)) || addr.startsWith('bc1')
  );
}

const UtxosScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const {theme} = useTheme();
  const {
    activeApiProvider: apiBase,
    activeNetwork: network,
    activeAddressType: addressType,
  } = useUser();
  const [btcPrice, setBtcPrice] = useState<string>('');
  const [btcRate, setBtcRate] = useState<number>(0);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [priceData, setPriceData] = useState<{[key: string]: number}>({});
  const [isCurrencySelectorVisible, setIsCurrencySelectorVisible] =
    useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [utxosWithPath, setUtxosWithPath] = useState<UtxoWithPath[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [utxoFetchTimestamp, setUtxoFetchTimestamp] = useState<number>(0);
  const [refreshStatusMessage, setRefreshStatusMessage] = useState<
    string | null
  >(null);
  const [refreshProgress, setRefreshProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    const loadCurrency = async () => {
      const stored = appConfigRepository.get(CONFIG_KEYS.CURRENCY);
      if (stored) setSelectedCurrency(stored);
    };
    loadCurrency();
  }, []);

  // DB-first: seed price from SQLite immediately, then refresh via API.
  useEffect(() => {
    let cancelled = false;
    const currency = selectedCurrency || 'USD';

    // Phase 1 — instant DB read
    const cached = priceRepository.getCachedPrice(currency);
    if (cached) {
      setPriceData(cached.rates);
      setBtcPrice(String(cached.rate));
      setBtcRate(cached.rate);
    }

    // Phase 2 — background API refresh → DB → UI
    WalletService.getInstance()
      .getBitcoinPrice()
      .then(({rates}) => {
        if (cancelled) return;
        if (rates) setPriceData(rates);
        const rate = rates?.[currency] ?? rates?.USD ?? 0;
        if (typeof rate === 'number' && rate > 0) {
          setBtcPrice(String(rate));
          setBtcRate(rate);
        }
      })
      .catch(() => {
        // API failed — DB data (if any) is already showing
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCurrency]);

  const fetchUtxos = useCallback(async () => {
    const base = apiBase?.trim();
    if (!base) {
      setFetchError('No API configured');
      setLoading(false);
      return;
    }
    const cleanBase = base.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const apiUrl = `${cleanBase}/api`;
    const isTestnetApi = /\/testnet(\/|$)/.test(apiUrl);
    setFetchError(null);

    // Resolve HD addresses once, outside the try block so the catch can use them.
    let addressesWithPaths: Awaited<
      ReturnType<typeof WalletService.prototype.getHdAddressesWithPaths>
    > = [];
    try {
      addressesWithPaths =
        await WalletService.getInstance().getHdAddressesWithPaths(
          network,
          addressType || 'segwit-native',
        );
    } catch {
      // Derivation failed — fall through to DB-only path below.
    }

    if (addressesWithPaths.length === 0) {
      // No addresses derived yet — show whatever the DB has for this network + address type.
      const allNetworkUtxos = utxoRepository.getUtxosForNetwork(
        network,
        addressType || 'segwit-native',
      );
      setUtxosWithPath(storedToUtxoWithPath(allNetworkUtxos, []));
      setUtxoFetchTimestamp(Date.now());
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setRefreshStatusMessage('Syncing UTXOs…');

    const addressesForSyncer = addressesWithPaths
      .filter(({address}) => addressMatchesNetwork(address, isTestnetApi))
      .map(({address, derivationPath}) => ({
        address,
        network,
        derivationPath: derivationPath ?? undefined,
      }));

    try {
      if (addressesForSyncer.length > 0) {
        await utxoSyncer.syncAddresses(
          addressesForSyncer,
          apiUrl,
          (current, total) => setRefreshProgress({current, total}),
        );
      }
      const allFromDB = utxoRepository.getUtxosForAddresses(
        addressesWithPaths.map(a => a.address),
        network,
      );
      setUtxosWithPath(storedToUtxoWithPath(allFromDB, addressesWithPaths));
      setUtxoFetchTimestamp(Date.now());
      setFetchError(null);
    } catch (e: any) {
      Toast.show({
        type: 'error',
        text1: 'Could not fetch UTXOs',
        text2: 'Using cached data.',
        visibilityTime: 4000,
      });
      const stored = utxoRepository.getUtxosForAddresses(
        addressesWithPaths.map(a => a.address),
        network,
      );
      setUtxosWithPath(storedToUtxoWithPath(stored, addressesWithPaths));
      setFetchError(
        e?.name === 'AbortError'
          ? 'Request timed out'
          : e?.message || 'Failed to load UTXOs',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
      setRefreshStatusMessage(null);
      setRefreshProgress(null);
    }
  }, [apiBase, network, addressType]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Phase 1 — read from DB immediately so the list is never blank on launch.
      let hadCachedData = false;
      try {
        const addrs = await WalletService.getInstance().getHdAddressesWithPaths(
          network,
          addressType || 'segwit-native',
        );
        if (!cancelled && addrs.length > 0) {
          const stored = utxoRepository.getUtxosForAddresses(
            addrs.map(a => a.address),
            network,
          );
          if (!cancelled && stored.length > 0) {
            hadCachedData = true;
            setUtxosWithPath(storedToUtxoWithPath(stored, addrs));
            setLoading(false); // cached list visible; API will update in background
          }
        }
      } catch {
        // Pre-load failed — API fetch below will still populate the list
      }

      // Phase 2 — live API fetch (updates the already-visible cached list).
      if (!cancelled) {
        if (!hadCachedData) {
          setLoading(true); // no cached data yet — show spinner
        }
        fetchUtxos();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchUtxos, network, addressType]);

  const handleCurrencySelect = useCallback(
    (currency: {code: string}) => {
      setSelectedCurrency(currency.code);
      appConfigRepository.set(CONFIG_KEYS.CURRENCY, currency.code);
      if (priceData[currency.code]) {
        setBtcPrice(String(priceData[currency.code]));
        setBtcRate(priceData[currency.code]);
      }
    },
    [priceData],
  );

  const headerLeft = useCallback(
    () => (
      <HeaderPriceButton
        btcPrice={btcPrice}
        selectedCurrency={selectedCurrency}
        onCurrencyPress={() => setIsCurrencySelectorVisible(true)}
      />
    ),
    [btcPrice, selectedCurrency],
  );
  const headerTitle = useCallback(
    () => <HeaderProvider apiBase={apiBase} />,
    [apiBase],
  );
  const headerRight = useCallback(
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
      headerStyle: {backgroundColor: theme.colors.background},
      headerTitleContainerStyle: {flex: 1, minWidth: 0, marginHorizontal: 0},
    });
  }, [
    navigation,
    headerLeft,
    headerTitle,
    headerRight,
    theme.colors.background,
  ]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchUtxos();
  }, [fetchUtxos]);

  const isDarkMode = theme.colors.background !== '#ffffff';
  const cardBg = isDarkMode ? theme.colors.cardBackground : '#ffffff';
  const cardBorder = isDarkMode
    ? theme.colors.border + '40'
    : theme.colors.blackOverlay05 ?? 'rgba(0,0,0,0.06)';
  const receivedColor = themes.cryptoVibrant.colors.secondary;

  /** Confirmed / unconfirmed breakdown derived from the already-loaded UTXO list.
   *  Zero extra API calls — same data source as the list below, always in sync. */
  const balanceSummary = useMemo(() => {
    let confirmedSats = 0;
    let unconfirmedSats = 0;
    let confirmedCount = 0;
    let unconfirmedCount = 0;
    for (const u of utxosWithPath) {
      if (u.status?.confirmed) {
        confirmedSats += u.value;
        confirmedCount++;
      } else {
        unconfirmedSats += u.value;
        unconfirmedCount++;
      }
    }
    const totalSats = confirmedSats + unconfirmedSats;
    const fmt = (sats: number) => (sats / 1e8).toFixed(8);
    const fiat = (sats: number) =>
      btcRate > 0
        ? getCurrencySymbol(selectedCurrency || 'USD') +
          presentFiat((sats / 1e8) * btcRate)
        : null;
    return {
      confirmedSats,
      unconfirmedSats,
      totalSats,
      confirmedCount,
      unconfirmedCount,
      fmt,
      fiat,
    };
  }, [utxosWithPath, btcRate, selectedCurrency]);

  const shortTxId = (txid: string) =>
    txid ? `${txid.slice(0, 6)}…${txid.slice(-6)}` : '—';
  const shortAddr = (addr: string) =>
    addr && addr.length > 12
      ? `${addr.slice(0, 6)}…${addr.slice(-6)}`
      : addr || '—';
  const chainLabel = (chain: 'receive' | 'change', index: number) =>
    chain === 'receive' ? `Receive #${index}` : `Change #${index}`;

  const baseUrl = apiBase?.trim()
    ? apiBase.replace(/\/+$/, '').replace(/\/api\/?$/, '')
    : '';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {flex: 1},
        flexOne: {flex: 1},
        utxoHeaderStyle: {
          padding: 0,
          backgroundColor: isDarkMode
            ? 'rgba(255,255,255,0.07)'
            : 'rgba(26,43,60,0.88)',
          borderRadius: 16,
          alignItems: 'stretch' as const,
          marginHorizontal: 16,
          marginVertical: 12,
          borderWidth: isDarkMode ? 1 : 0.5,
          borderColor: isDarkMode
            ? 'rgba(255,255,255,0.18)'
            : 'rgba(255,255,255,0.12)',
          borderTopWidth: isDarkMode ? 1.5 : 0.5,
          borderTopColor: isDarkMode
            ? 'rgba(255,255,255,0.30)'
            : 'rgba(255,255,255,0.18)',
          borderLeftWidth: isDarkMode ? 1.5 : 0.5,
          borderLeftColor: isDarkMode
            ? 'rgba(255,255,255,0.22)'
            : 'rgba(255,255,255,0.15)',
          position: 'relative' as const,
          zIndex: 3,
          elevation: isDarkMode ? 8 : 4,
          shadowColor: isDarkMode ? '#000' : 'rgba(26,43,60,0.35)',
          shadowOffset: {width: 0, height: isDarkMode ? 6 : 4},
          shadowOpacity: isDarkMode ? 0.35 : 0.15,
          shadowRadius: isDarkMode ? 12 : 8,
          overflow: 'hidden' as const,
        },
        listHeader: {
          marginTop: 0,
        },
        cacheIndicatorWrap: {
          margin: 0,
        },
        listContent: {
          paddingHorizontal: 16,
          paddingBottom: 32,
          flexGrow: 1,
        },
        subtitle: {
          fontSize: theme.fontSizes?.base || 14,
          textAlign: 'center',
          marginBottom: 16,
          paddingHorizontal: 8,
        },
        utxoCard: {
          padding: 10,
          marginVertical: 3,
          borderRadius: 10,
          borderWidth: 1,
          ...(Platform.OS === 'ios'
            ? {
                shadowColor: '#000',
                shadowOffset: {width: 0, height: 1},
                shadowOpacity: 0.05,
                shadowRadius: 1,
              }
            : {elevation: 1}),
        },
        utxoRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginVertical: 2,
        },
        utxoLeft: {
          fontSize: theme.fontSizes?.base || 13,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          flex: 1,
          marginRight: 8,
          opacity: 0.9,
        },
        utxoLeftValue: {
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          opacity: 0.95,
        },
        utxoAmount: {
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          fontSize: theme.fontSizes?.md || 15,
          letterSpacing: COMMON_FONT_CONFIGS.bitcoinAmountMono.letterSpacing,
          opacity: 0.95,
        },
        utxoFiat: {
          fontSize: theme.fontSizes?.base || 13,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          opacity: 0.6,
        },
        utxoTime: {
          fontSize: theme.fontSizes?.xs || 11,
          opacity: 0.5,
        },
        chainBadge: {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          justifyContent: 'space-between' as const,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
          marginBottom: 6,
        },
        chainBadgeReceive: {
          backgroundColor: theme.colors.receivedOverlay15,
        },
        chainBadgeChange: {
          backgroundColor: theme.colors.primary + '20',
        },
        chainBadgeText: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: theme.fontFamilies?.bold,
        },
        pathRow: {
          marginTop: 4,
          paddingTop: 4,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border + '60',
        },
        pathLabel: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          opacity: 0.7,
        },
        pathFull: {
          marginLeft: 'auto' as const,
          fontSize: (theme.fontSizes?.xs ?? 11) - 1,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          opacity: 0.7,
          textAlign: 'right' as const,
        },
        summaryCard: {
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 6,
        },
        summaryCardWrap: {
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
        summaryTitleRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        },
        summaryTitle: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.bold,
          letterSpacing: 0.8,
          textTransform: 'uppercase' as const,
          opacity: 0.7,
        },
        countBadge: {
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 10,
          borderWidth: isDarkMode ? 0.5 : 0,
          borderColor: 'rgba(255,255,255,0.12)',
          backgroundColor: isDarkMode
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(255,255,255,0.10)',
        },
        countBadgeText: {
          fontSize: theme.fontSizes?.xs || 10,
          fontFamily: theme.fontFamilies?.medium,
          opacity: 0.85,
        },
        heroTotalWrap: {
          alignItems: 'center',
          paddingVertical: 6,
          marginBottom: 2,
        },
        heroTotalBtc: {
          fontSize: theme.fontSizes?.xl || 18,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          letterSpacing: -0.3,
        },
        heroTotalFiat: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          marginTop: 2,
          opacity: 0.7,
        },
        summaryRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        summaryDivider: {
          height: StyleSheet.hairlineWidth,
          marginVertical: 8,
          backgroundColor: isDarkMode
            ? 'rgba(255,255,255,0.15)'
            : 'rgba(255,255,255,0.12)',
        },
        summaryLabel: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
        },
        summaryCount: {
          fontSize: theme.fontSizes?.xs || 10,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          marginLeft: 4,
          opacity: 0.6,
        },
        summaryBtc: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          letterSpacing: COMMON_FONT_CONFIGS.bitcoinAmountMono.letterSpacing,
        },
        summaryFiat: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          marginTop: 1,
          textAlign: 'right',
          opacity: 0.6,
        },
        summaryRight: {
          alignItems: 'flex-end',
        },
        summaryLabelRow: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        statusDot: {
          width: 7,
          height: 7,
          borderRadius: 4,
          marginRight: 6,
        },
        statusDotHollow: {
          width: 7,
          height: 7,
          borderRadius: 4,
          borderWidth: 1.5,
          marginRight: 6,
        },
        emptyWrap: {
          paddingVertical: 32,
          paddingHorizontal: 24,
          alignItems: 'center',
        },
        emptyTitle: {
          fontSize: theme.fontSizes?.lg || 17,
          fontFamily: theme.fontFamilies?.bold,
          marginBottom: 8,
        },
        emptyHint: {
          fontSize: theme.fontSizes?.base || 14,
          textAlign: 'center',
          lineHeight: 20,
        },
        loadingHint: {
          marginTop: 12,
        },
        endOfListWrap: {
          alignItems: 'center',
          paddingVertical: 16,
          paddingHorizontal: 10,
        },
        endOfListText: {
          textAlign: 'center',
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          marginBottom: 4,
        },
        endOfListCount: {
          textAlign: 'center',
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
        },
      }),
    [theme, isDarkMode],
  );

  const renderUtxoItem = useCallback(
    ({item: u}: {item: UtxoWithPath}) => {
      const blockTime =
        u.status?.block_time != null ? u.status.block_time * 1000 : null;
      const timestamp = blockTime
        ? moment(blockTime).isAfter(moment().subtract(7, 'days'))
          ? moment(blockTime).fromNow()
          : moment(blockTime).format('MMM D, YYYY · h:mm A')
        : 'Unconfirmed';
      const valueBtc = (u.value / 1e8).toFixed(8);
      const valueFiat =
        getCurrencySymbol(selectedCurrency || 'USD') +
        presentFiat((u.value / 1e8) * btcRate);
      const openInExplorer = () => {
        if (!baseUrl || !u.txid) return;
        const vout = u.vout ?? 0;
        const url = `${baseUrl}/tx/${u.txid}#vout=${vout}`;
        Linking.openURL(url).catch(() => {
          Alert.alert('Error', 'Could not open explorer');
        });
      };
      const isReceive = u.chain === 'receive';
      return (
        <AppPressable
          style={[
            styles.utxoCard,
            {backgroundColor: cardBg, borderColor: cardBorder},
          ]}
          onPress={openInExplorer}
          android_ripple={{
            color: isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
            borderless: false,
          }}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`${chainLabel(
            u.chain,
            u.chainIndex,
          )} UTXO ${shortTxId(u.txid || '')} vout ${
            u.vout ?? 0
          }. Tap to open in explorer.`}>
          <View
            style={[
              styles.chainBadge,
              isReceive ? styles.chainBadgeReceive : styles.chainBadgeChange,
            ]}>
            <Text
              style={[
                styles.chainBadgeText,
                {
                  color: isReceive
                    ? theme.colors.received
                    : theme.colors.primary,
                },
              ]}>
              {chainLabel(u.chain, u.chainIndex)}
            </Text>
            <Text
              style={[styles.pathFull, {color: theme.colors.textSecondary}]}
              numberOfLines={1}
              selectable>
              {u.derivationPath}
            </Text>
          </View>
          <View style={styles.utxoRow}>
            <Text
              style={[styles.utxoLeft, {color: theme.colors.text}]}
              numberOfLines={1}
              selectable>
              TxId:
              <Text style={styles.utxoLeftValue}>
                {' '}
                {shortTxId(u.txid || '')}
              </Text>
            </Text>
            <Text
              style={[styles.utxoAmount, {color: receivedColor}]}
              selectable>
              +{valueBtc} BTC
            </Text>
          </View>
          <View style={styles.utxoRow}>
            <Text
              style={[styles.utxoLeft, {color: theme.colors.text}]}
              numberOfLines={1}>
              Vout:<Text style={styles.utxoLeftValue}> {u.vout ?? 0}</Text>
            </Text>
            <Text
              style={[styles.utxoFiat, {color: theme.colors.text}]}
              numberOfLines={1}>
              {valueFiat}
            </Text>
          </View>
          <View style={styles.utxoRow}>
            <Text
              style={[styles.utxoLeft, {color: theme.colors.text}]}
              numberOfLines={1}
              selectable>
              Addr:
              <Text style={styles.utxoLeftValue}> {shortAddr(u.address)}</Text>
            </Text>
            <Text
              style={[styles.utxoTime, {color: theme.colors.textSecondary}]}>
              {timestamp}
            </Text>
          </View>
        </AppPressable>
      );
    },
    [
      theme,
      styles,
      cardBg,
      cardBorder,
      selectedCurrency,
      btcRate,
      isDarkMode,
      receivedColor,
      baseUrl,
    ],
  );

  const ListEmpty = useCallback(() => {
    if (loading) {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text
            style={[
              styles.emptyHint,
              styles.loadingHint,
              {color: theme.colors.textSecondary},
            ]}>
            Loading UTXOs…
          </Text>
        </View>
      );
    }
    if (fetchError) {
      return (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyTitle, {color: theme.colors.text}]}>
            {fetchError}
          </Text>
          <Text style={[styles.emptyHint, {color: theme.colors.textSecondary}]}>
            Check network and API in Settings
            {'\n'}Pull to retry.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <Text style={[styles.emptyTitle, {color: theme.colors.text}]}>
          No UTXOs
        </Text>
      </View>
    );
  }, [loading, fetchError, theme, styles]);

  return (
    <View
      style={[styles.container, {backgroundColor: theme.colors.background}]}>
      {/* Top card — dedicated UTXO header */}

      <View style={styles.utxoHeaderStyle}>
        <View style={styles.summaryCard}>
          {/* Title row */}
          <View style={styles.summaryTitleRow}>
            <Text
              style={[
                styles.summaryTitle,
                {color: theme.colors.textOnPrimary},
              ]}>
              UTXO Balance
            </Text>
            <View style={styles.countBadge}>
              <Text
                style={[
                  styles.countBadgeText,
                  {color: theme.colors.textOnPrimary},
                ]}>
                {utxosWithPath.length}{' '}
                {utxosWithPath.length === 1 ? 'UTXO' : 'UTXOs'}
              </Text>
            </View>
          </View>

          {/* Hero total */}
          <View style={styles.heroTotalWrap}>
            <Text
              style={[styles.heroTotalBtc, {color: theme.colors.textOnPrimary}]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {balanceSummary.fmt(balanceSummary.totalSats)} BTC
            </Text>
            {balanceSummary.fiat(balanceSummary.totalSats) && (
              <Text
                style={[
                  styles.heroTotalFiat,
                  {color: theme.colors.textOnPrimary},
                ]}>
                {balanceSummary.fiat(balanceSummary.totalSats)}
              </Text>
            )}
          </View>

          {/* Divider */}
          <View style={styles.summaryDivider} />

          {/* Confirmed row */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryLabelRow}>
              <View
                style={[styles.statusDot, {backgroundColor: receivedColor}]}
              />
              <Text style={[styles.summaryLabel, {color: receivedColor}]}>
                Confirmed
              </Text>
              <Text
                style={[
                  styles.summaryCount,
                  {color: theme.colors.textOnPrimary},
                ]}>
                {balanceSummary.confirmedCount}
              </Text>
            </View>
            <View style={styles.summaryRight}>
              <Text style={[styles.summaryBtc, {color: receivedColor}]}>
                {balanceSummary.fmt(balanceSummary.confirmedSats)} BTC
              </Text>
              {balanceSummary.fiat(balanceSummary.confirmedSats) && (
                <Text
                  style={[
                    styles.summaryFiat,
                    {color: theme.colors.textOnPrimary},
                  ]}>
                  {balanceSummary.fiat(balanceSummary.confirmedSats)}
                </Text>
              )}
            </View>
          </View>

          {/* Pending row — only when there are unconfirmed UTXOs */}
          {balanceSummary.unconfirmedCount > 0 && (
            <View style={styles.summaryRow}>
              <View style={styles.summaryLabelRow}>
                <View
                  style={[
                    styles.statusDotHollow,
                    {borderColor: theme.colors.warning},
                  ]}
                />
                <Text
                  style={[styles.summaryLabel, {color: theme.colors.warning}]}>
                  Pending
                </Text>
                <Text
                  style={[
                    styles.summaryCount,
                    {color: theme.colors.textSecondary},
                  ]}>
                  {balanceSummary.unconfirmedCount}
                </Text>
              </View>
              <View style={styles.summaryRight}>
                <Text
                  style={[styles.summaryBtc, {color: theme.colors.warning}]}>
                  +{balanceSummary.fmt(balanceSummary.unconfirmedSats)} BTC
                </Text>
                {balanceSummary.fiat(balanceSummary.unconfirmedSats) && (
                  <Text
                    style={[
                      styles.summaryFiat,
                      {color: theme.colors.textSecondary},
                    ]}>
                    {balanceSummary.fiat(balanceSummary.unconfirmedSats)}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      </View>

      <View style={styles.cacheIndicatorWrap}>
        <CacheIndicator
          timestamps={{price: 0, balance: utxoFetchTimestamp}}
          onRefresh={onRefresh}
          onAbortRequested={() => mempoolClient.abortAll()}
          onLongPress={async () => {
            const effectiveType = addressType || 'segwit-native';
            const api =
              apiBase
                ?.trim()
                ?.replace(/\/+$/, '')
                ?.replace(/\/api\/?$/, '') || 'https://mempool.space';
            setRefreshing(true);
            try {
              dbg(
                '[UtxosScreen] Long-press: clearing wallet cache + full reconstruction',
              );
              setRefreshStatusMessage('Clearing cache…');
              database.clearWalletCacheData();
              mempoolClient.invalidateAll();
              WalletService.getInstance().invalidateAddressCache();
              setRefreshStatusMessage('Discovering addresses…');
              await WalletService.getInstance().discoverHdIndexesForNetwork(
                network,
                effectiveType,
                `${api}/api`,
                chain =>
                  setRefreshStatusMessage(
                    `Scanning ${
                      chain === 'external' ? 'receive' : 'change'
                    } addresses…`,
                  ),
              );
              setRefreshStatusMessage('Rebuilding wallet data…');
            } catch (e) {
              dbg('[UtxosScreen] Long-press reconstruction error', e);
            }
            setRefreshStatusMessage(null);
            onRefresh();
          }}
          theme={theme}
          isRefreshing={refreshing}
          statusMessage={refreshStatusMessage ?? undefined}
          progress={refreshProgress ?? undefined}
          usingCache={
            !refreshing &&
            utxoFetchTimestamp > 0 &&
            Date.now() - utxoFetchTimestamp > 60000
          }
        />
      </View>

      <FlatList
        style={styles.flexOne}
        contentContainerStyle={styles.listContent}
        data={utxosWithPath}
        renderItem={renderUtxoItem}
        keyExtractor={item => `${item.txid}:${item.vout}:${item.address}`}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={
          utxosWithPath.length > 0 ? (
            <View style={styles.endOfListWrap}>
              <Text style={[styles.endOfListText, {color: theme.colors.text}]}>
                No more UTXOs
              </Text>
              <Text
                style={[
                  styles.endOfListCount,
                  {color: theme.colors.textSecondary},
                ]}>
                {utxosWithPath.length} in total (all addresses)
              </Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.textSecondary}
          />
        }
      />
      <CurrencySelector
        visible={isCurrencySelectorVisible}
        onClose={() => setIsCurrencySelectorVisible(false)}
        onSelect={handleCurrencySelect}
        currentCurrency={selectedCurrency}
        availableCurrencies={priceData}
      />
    </View>
  );
};

export default UtxosScreen;
