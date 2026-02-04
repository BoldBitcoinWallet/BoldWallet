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
import {presentFiat, getCurrencySymbol, HapticFeedback} from '../utils';
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
    activeAddress,
  } = useUser();
  const [btcPrice, setBtcPrice] = useState<string>('');
  const [btcRate, setBtcRate] = useState<number>(0);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rawUtxos, setRawUtxos] = useState<ApiUtxo[]>([]);
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
    const addr = activeAddress?.trim();
    const base = apiBase?.trim();
    if (!addr || !base) {
      setRawUtxos([]);
      setFetchError(addr ? 'No API configured' : 'No wallet address');
      setLoading(false);
      return;
    }
    const cleanBase = base.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const apiUrl = `${cleanBase}/api`;
    const isTestnetApi = /\/testnet(\/|$)/.test(apiUrl);
    if (!addressMatchesNetwork(addr, isTestnetApi)) {
      setRawUtxos([]);
      setFetchError('Address and network mismatch');
      setLoading(false);
      return;
    }
    setFetchError(null);
    const utxoUrl = `${apiUrl}/address/${encodeURIComponent(addr)}/utxo`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(utxoUrl, {signal: controller.signal});
      clearTimeout(timeoutId);
      if (!res.ok) {
        setRawUtxos([]);
        setFetchError(`API error ${res.status}`);
        return;
      }
      const rawList: ApiUtxo[] = await res.json();
      if (!Array.isArray(rawList)) {
        setRawUtxos([]);
        return;
      }
      setRawUtxos(rawList);
      setUtxoFetchTimestamp(Date.now());
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setFetchError('Request timed out');
      } else {
        setFetchError(e?.message || 'Failed to load UTXOs');
      }
      setRawUtxos([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeAddress, apiBase]);

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
  const shortAddr =
    activeAddress && activeAddress.length > 12
      ? `${activeAddress.slice(0, 6)}…${activeAddress.slice(-6)}`
      : activeAddress || '—';

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
    ({item: u}: {item: ApiUtxo}) => {
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
        HapticFeedback.light();
        if (!baseUrl || !u.txid) {
          return;
        }
        const vout = u.vout ?? 0;
        const url = `${baseUrl}/tx/${u.txid}#vout=${vout}`;
        Linking.openURL(url).catch(() => {
          Alert.alert('Error', 'Could not open explorer');
        });
      };
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
          accessibilityLabel={`UTXO ${shortTxId(u.txid || '')} vout ${u.vout ?? 0}. Tap to open in explorer.`}>
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
              Addr:<Text style={styles.utxoLeftValue}> {shortAddr}</Text>
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
      shortAddr,
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
        data={rawUtxos}
        renderItem={renderUtxoItem}
        keyExtractor={item => `${item.txid}:${item.vout}`}
        ListEmptyComponent={ListEmpty}
        ListHeaderComponentStyle={styles.listHeader}
        ListHeaderComponent={
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
        }
        ListFooterComponent={
          rawUtxos.length > 0 ? (
            <View style={styles.endOfListWrap}>
              <Text style={[styles.endOfListText, {color: theme.colors.text}]}>
                No more UTXOs
              </Text>
              <Text
                style={[
                  styles.endOfListCount,
                  {color: theme.colors.textSecondary},
                ]}>
                {rawUtxos.length} in total
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
