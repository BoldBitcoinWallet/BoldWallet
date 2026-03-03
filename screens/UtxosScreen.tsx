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
import moment from 'moment';
import {useTheme, themes} from '../theme';
import {COMMON_FONT_CONFIGS} from '../theme/fonts';
import {useUser} from '../context/UserContext';
import {
  HeaderPriceButton,
  HeaderProvider,
  HeaderNetwork,
} from '../components/Header';
import LocalCache from '../services/LocalCache';
import {WalletService} from '../services/WalletService';
import {presentFiat, getCurrencySymbol} from '../utils';
import AppPressable from '../components/AppPressable';
import {CacheIndicator} from '../components/CacheIndicator';

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
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [utxosWithPath, setUtxosWithPath] = useState<UtxoWithPath[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [utxoFetchTimestamp, setUtxoFetchTimestamp] = useState<number>(0);

  useEffect(() => {
    const loadCurrency = async () => {
      const stored = await LocalCache.getItem('currency');
      if (stored) setSelectedCurrency(stored);
    };
    loadCurrency();
  }, []);

  // Use same price source as WalletHome (WalletService.getBitcoinPrice)
  useEffect(() => {
    let cancelled = false;
    WalletService.getInstance()
      .getBitcoinPrice()
      .then(({rates}) => {
        if (cancelled) return;
        const currency = selectedCurrency || 'USD';
        const rate = rates?.[currency] ?? rates?.USD ?? 0;
        if (typeof rate === 'number' && rate > 0) {
          setBtcPrice(String(rate));
          setBtcRate(rate);
        } else {
          setBtcPrice('');
          setBtcRate(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBtcPrice('');
          setBtcRate(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCurrency]);

  const fetchUtxos = useCallback(async () => {
    const base = apiBase?.trim();
    if (!base) {
      setUtxosWithPath([]);
      setFetchError('No API configured');
      setLoading(false);
      return;
    }
    const cleanBase = base.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const apiUrl = `${cleanBase}/api`;
    const isTestnetApi = /\/testnet(\/|$)/.test(apiUrl);
    setFetchError(null);
    try {
      const walletService = WalletService.getInstance();
      const addressesWithPaths = await walletService.getHdAddressesWithPaths(
        network,
        addressType || 'segwit-native',
      );
      if (addressesWithPaths.length === 0) {
        setUtxosWithPath([]);
        setUtxoFetchTimestamp(Date.now());
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const merged: UtxoWithPath[] = [];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      for (const {address, derivationPath, chain, index} of addressesWithPaths) {
        if (!addressMatchesNetwork(address, isTestnetApi)) continue;
        try {
          const utxoUrl = `${apiUrl}/address/${encodeURIComponent(address)}/utxo`;
          const res = await fetch(utxoUrl, {signal: controller.signal});
          if (!res.ok) continue;
          const rawList: ApiUtxo[] = await res.json();
          if (!Array.isArray(rawList)) continue;
          for (const u of rawList) {
            merged.push({
              ...u,
              address,
              derivationPath,
              chain,
              chainIndex: index,
            });
          }
        } catch {
          // skip failed address
        }
      }
      clearTimeout(timeoutId);
      // Sort: receive first, then change; by chain index; then by block_time desc (newest first)
      merged.sort((a, b) => {
        if (a.chain !== b.chain) return a.chain === 'receive' ? -1 : 1;
        if (a.chainIndex !== b.chainIndex) return a.chainIndex - b.chainIndex;
        const ta = a.status?.block_time ?? 0;
        const tb = b.status?.block_time ?? 0;
        return tb - ta;
      });
      setUtxosWithPath(merged);
      setUtxoFetchTimestamp(Date.now());
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setFetchError('Request timed out');
      } else {
        setFetchError(e?.message || 'Failed to load UTXOs');
      }
      setUtxosWithPath([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBase, network, addressType]);

  useEffect(() => {
    setLoading(true);
    fetchUtxos();
  }, [fetchUtxos]);

  const headerLeft = useCallback(
    () => (
      <HeaderPriceButton
        btcPrice={btcPrice}
        selectedCurrency={selectedCurrency}
        onCurrencyPress={() =>
          navigation.navigate('Settings', {expandSection: 'advanced'})
        }
      />
    ),
    [btcPrice, selectedCurrency, navigation],
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

  const shortTxId = (txid: string) =>
    txid ? `${txid.slice(0, 6)}…${txid.slice(-6)}` : '—';
  const shortAddr = (addr: string) =>
    addr && addr.length > 12
      ? `${addr.slice(0, 6)}…${addr.slice(-6)}`
      : addr || '—';
  /** Format path for display: keep last segment visible (e.g. …/0/3). */
  const formatPath = (path: string) => {
    if (!path) return '—';
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) return `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    return path;
  };
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
        listHeader: {
          marginTop: 10,
        },
        cacheIndicatorWrap: {
          marginHorizontal: -16,
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
          alignSelf: 'flex-start',
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
          marginTop: 2,
          fontSize: (theme.fontSizes?.xs ?? 11) - 1,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          opacity: 0.7,
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
    [theme],
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
          accessibilityLabel={`${chainLabel(u.chain, u.chainIndex)} UTXO ${shortTxId(u.txid || '')} vout ${u.vout ?? 0}. Tap to open in explorer.`}>
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
              Addr:<Text style={styles.utxoLeftValue}> {shortAddr(u.address)}</Text>
            </Text>
            <Text
              style={[styles.utxoTime, {color: theme.colors.textSecondary}]}>
              {timestamp}
            </Text>
          </View>
          <View style={[styles.pathRow]}>
            <Text
              style={[styles.pathLabel, {color: theme.colors.textSecondary}]}
              numberOfLines={1}
              selectable>
              Path: <Text style={styles.utxoLeftValue}>{formatPath(u.derivationPath)}</Text>
            </Text>
            <Text
              style={[styles.pathFull, {color: theme.colors.textSecondary}]}
              numberOfLines={2}
              selectable>
              {u.derivationPath}
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
      <FlatList
        style={styles.flexOne}
        contentContainerStyle={styles.listContent}
        data={utxosWithPath}
        renderItem={renderUtxoItem}
        keyExtractor={item => `${item.txid}:${item.vout}:${item.address}`}
        ListEmptyComponent={ListEmpty}
        ListHeaderComponentStyle={styles.listHeader}
        ListHeaderComponent={
          <View>
            <View style={styles.cacheIndicatorWrap}>
              <CacheIndicator
                timestamps={{price: 0, balance: utxoFetchTimestamp}}
                onRefresh={onRefresh}
                theme={theme}
                isRefreshing={refreshing}
                usingCache={
                  !refreshing &&
                  utxoFetchTimestamp > 0 &&
                  Date.now() - utxoFetchTimestamp > 60000
                }
              />
            </View>
            <Text
              style={[
                styles.subtitle,
                {color: theme.colors.textSecondary},
              ]}
              numberOfLines={2}>
              Receive & change addresses · path shown per UTXO
            </Text>
          </View>
        }
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
    </View>
  );
};

export default UtxosScreen;
