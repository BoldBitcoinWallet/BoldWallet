/**
 * Addresses tab — DB-first list of receive/change HD addresses with balances.
 * UI reads only from SQLite; API sync writes DB then re-reads.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import {useFocusEffect} from '@react-navigation/native';
import {useTheme, type ThemeColors} from '../theme';
import {useUser} from '../context/UserContext';
import {HeaderProvider, HeaderNetwork} from '../components/Header';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import walletRepository from '../services/repositories/WalletRepository';
import balanceRepository from '../services/repositories/BalanceRepository';
import utxoRepository from '../services/repositories/UtxoRepository';
import transactionRepository from '../services/repositories/TransactionRepository';
import priceRepository from '../services/repositories/PriceRepository';
import syncRepository from '../services/repositories/SyncRepository';
import balanceSyncer from '../services/sync/BalanceSyncer';
import utxoSyncer from '../services/sync/UtxoSyncer';
import {WalletService} from '../services/WalletService';
import {
  presentFiat,
  getCurrencySymbol,
  dbg,
  getReceivePath,
  getChangePath,
  isLegacyWallet,
} from '../utils';
import AppPressable from '../components/AppPressable';
import AppText from '../components/AppText';
import ReceiveModal from './ReceiveModal';

/** Match BalanceSyncer BALANCE_DB_TTL_MS — freshness for lazy sync skip. */
const BALANCE_DB_TTL_MS = 20_000;
const PAIRS_PER_PAGE = 5;

export type AddressViewMode = 'smart' | 'hd_order';

export type AddressTier = 'active' | 'used' | 'unused';

export type AddressRowVm = {
  key: string;
  chain: 'receive' | 'change';
  idx: number;
  address: string;
  derivationPath: string;
  /** null when no row in address_balances yet */
  balanceSats: number | null;
  pendingSats: number | null;
  fetchedAt: number | null;
  /** UTXO or balance; tx history only; or neither */
  tier: AddressTier;
};

type AddressRowBase = Omit<AddressRowVm, 'tier'>;

function buildRowVms(
  network: string,
  addressType: string,
  useLegacyPath: boolean,
  pairCount: number,
): AddressRowBase[] {
  const rows: AddressRowBase[] = [];
  for (let pairIdx = 0; pairIdx < pairCount; pairIdx++) {
    for (const chain of [0, 1] as const) {
      const wa = walletRepository.getAddressAt(
        network,
        addressType,
        chain,
        pairIdx,
      );
      if (!wa) continue;
      const ch: 'receive' | 'change' = chain === 0 ? 'receive' : 'change';
      const path =
        chain === 0
          ? getReceivePath(network, addressType, useLegacyPath, pairIdx)
          : getChangePath(network, addressType, useLegacyPath, pairIdx);
      const bal = balanceRepository.getBalance(wa.address, network);
      rows.push({
        key: `${ch}-${pairIdx}-${wa.address}`,
        chain: ch,
        idx: pairIdx,
        address: wa.address,
        derivationPath: path,
        balanceSats: bal ? bal.balanceSats : null,
        pendingSats: bal ? bal.pendingSats : null,
        fetchedAt: bal ? bal.fetchedAt : null,
      });
    }
  }
  return rows;
}

function applyAddressViewMode(
  base: AddressRowBase[],
  network: string,
  viewMode: AddressViewMode,
): AddressRowVm[] {
  if (!base.length) return [];
  const addrs = base.map(r => r.address);
  const utxos = utxoRepository.getUtxosForAddresses(addrs, network);
  const utxoAddrs = new Set(utxos.map(u => u.address));
  const lastActivity =
    transactionRepository.getLastActivityTimestampsForAddresses(addrs, network);

  const withTier: AddressRowVm[] = base.map(r => {
    const bal = r.balanceSats ?? 0;
    const pend = r.pendingSats ?? 0;
    const totalSats = bal + pend;
    const hasUtxo = utxoAddrs.has(r.address);
    const active = hasUtxo || totalSats > 0;
    const last = lastActivity.get(r.address);
    const used = !active && last != null;
    const tier: AddressTier = active ? 'active' : used ? 'used' : 'unused';
    return {...r, tier};
  });

  if (viewMode === 'hd_order') {
    return withTier;
  }

  const chainOrd = (c: 'receive' | 'change') => (c === 'receive' ? 0 : 1);
  const tierOrd = (t: AddressTier) =>
    t === 'active' ? 0 : t === 'used' ? 1 : 2;

  return [...withTier].sort((a, b) => {
    const td = tierOrd(a.tier) - tierOrd(b.tier);
    if (td !== 0) return td;
    const la = lastActivity.get(a.address) ?? -1;
    const lb = lastActivity.get(b.address) ?? -1;
    if (la !== lb) return lb - la;
    if (a.idx !== b.idx) return a.idx - b.idx;
    return chainOrd(a.chain) - chainOrd(b.chain);
  });
}

function tierPillTheme(tier: AddressTier, colors: ThemeColors) {
  switch (tier) {
    case 'active':
      return {
        pillBg: colors.receivedOverlay15,
        pillBorder: colors.success + '55',
        pillText: colors.success,
        label: 'Active',
      };
    case 'used':
      return {
        pillBg: colors.warningBg,
        pillBorder: colors.warningBorder,
        pillText: colors.warningText,
        label: 'Used',
      };
    default:
      return {
        pillBg: colors.blackOverlay06,
        pillBorder: colors.border + '80',
        pillText: colors.textSecondary,
        label: 'Unused',
      };
  }
}

function needsLazyBalanceSync(address: string, network: string): boolean {
  const bal = balanceRepository.getBalance(address, network);
  if (bal == null) {
    return true;
  }
  const entityKey = `${address}_${network}`;
  return !syncRepository.isFresh('balance', entityKey, BALANCE_DB_TTL_MS);
}

const AddressesScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const {theme} = useTheme();
  const {
    activeApiProvider: apiBase,
    activeNetwork: network,
    activeAddressType: addressType,
  } = useUser();
  const [btcRate, setBtcRate] = useState<number | null>(null);

  const [pairCount, setPairCount] = useState(PAIRS_PER_PAGE);
  const [viewMode, setViewMode] = useState<AddressViewMode>(() => {
    const v = appConfigRepository.get(CONFIG_KEYS.ADDRESSES_VIEW_MODE);
    return v === 'hd_order' ? 'hd_order' : 'smart';
  });
  const [rows, setRows] = useState<AddressRowVm[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [legacyCreatedAt, setLegacyCreatedAt] = useState<number | null>(null);
  const lazySyncInFlight = useRef(false);
  const loadMoreInFlight = useRef(false);
  const pairCountRef = useRef(PAIRS_PER_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [receiveModalRow, setReceiveModalRow] = useState<AddressRowVm | null>(
    null,
  );
  /** Which list row is syncing balance/UTXO before opening ReceiveModal (key matches item.key). */
  const [rowModalSyncKey, setRowModalSyncKey] = useState<string | null>(null);
  const rowModalSyncRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await EncryptedStorage.getItem('keyshare');
        if (!raw) return;
        const ks = JSON.parse(raw);
        const ca = ks?.created_at;
        setLegacyCreatedAt(
          typeof ca === 'number' ? ca : ca != null ? Number(ca) : null,
        );
      } catch {
        setLegacyCreatedAt(null);
      }
    })();
  }, []);

  const useLegacyPath = useMemo(
    () =>
      legacyCreatedAt != null && !Number.isNaN(legacyCreatedAt)
        ? isLegacyWallet(legacyCreatedAt)
        : false,
    [legacyCreatedAt],
  );

  const computeRowsFromDb = useCallback((): AddressRowVm[] => {
    const base = buildRowVms(network, addressType, useLegacyPath, pairCount);
    return applyAddressViewMode(base, network, viewMode);
  }, [network, addressType, useLegacyPath, pairCount, viewMode]);

  const reloadFromDb = useCallback(() => {
    setRows(computeRowsFromDb());
  }, [computeRowsFromDb]);

  useEffect(() => {
    pairCountRef.current = pairCount;
  }, [pairCount]);

  const toggleViewMode = useCallback(() => {
    setViewMode(m => {
      const next: AddressViewMode = m === 'smart' ? 'hd_order' : 'smart';
      appConfigRepository.set(CONFIG_KEYS.ADDRESSES_VIEW_MODE, next);
      return next;
    });
  }, []);

  /**
   * DB-first: read current row → invalidate cache → API sync writes SQLite →
   * recompute rows from DB → open ReceiveModal with fresh balances/tier.
   */
  const onAddressRowPress = useCallback(
    async (item: AddressRowVm) => {
      if (!apiBase) {
        setReceiveModalRow(item);
        return;
      }
      if (rowModalSyncRef.current) return;
      rowModalSyncRef.current = true;
      setRowModalSyncKey(item.key);
      try {
        syncRepository.invalidate('balance', `${item.address}_${network}`);
        syncRepository.invalidate('utxos', `${item.address}_${network}`);
        try {
          await balanceSyncer.syncAddresses(
            [{address: item.address, network}],
            apiBase,
          );
        } catch (e) {
          dbg('AddressesScreen: row balance sync', item.address.slice(0, 8), e);
        }
        try {
          await utxoSyncer.syncAddresses(
            [
              {
                address: item.address,
                network,
                derivationPath: item.derivationPath,
              },
            ],
            apiBase,
          );
        } catch (e) {
          dbg('AddressesScreen: row utxo sync', item.address.slice(0, 8), e);
        }
        const next = computeRowsFromDb();
        setRows(next);
        setReceiveModalRow(next.find(r => r.key === item.key) ?? item);
      } catch (e) {
        dbg('AddressesScreen: onAddressRowPress', e);
        setReceiveModalRow(item);
      } finally {
        rowModalSyncRef.current = false;
        setRowModalSyncKey(null);
      }
    },
    [apiBase, network, computeRowsFromDb],
  );

  useFocusEffect(
    useCallback(() => {
      reloadFromDb();
      let cancelled = false;
      const currency = appConfigRepository.get(CONFIG_KEYS.CURRENCY) || 'USD';
      const cached = priceRepository.getCachedPrice(currency);
      if (cached) {
        setBtcRate(cached.rate);
      }
      WalletService.getInstance()
        .getBitcoinPrice()
        .then(({rates}) => {
          if (cancelled) return;
          const rate = rates?.[currency] ?? rates?.USD ?? 0;
          if (typeof rate === 'number' && rate > 0) {
            setBtcRate(rate);
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [reloadFromDb]),
  );

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current) return;
    loadMoreInFlight.current = true;
    setLoadingMore(true);
    try {
      const startIdx = pairCountRef.current;
      const endIdx = startIdx + PAIRS_PER_PAGE - 1;
      await WalletService.getInstance().ensureWalletAddressPairIndices(
        network,
        addressType,
        useLegacyPath,
        startIdx,
        endIdx,
      );
      const next = startIdx + PAIRS_PER_PAGE;
      pairCountRef.current = next;
      setPairCount(next);
    } catch (e) {
      dbg('AddressesScreen: loadMore', e);
    } finally {
      loadMoreInFlight.current = false;
      setLoadingMore(false);
    }
  }, [network, addressType, useLegacyPath]);

  useEffect(() => {
    reloadFromDb();
  }, [pairCount, reloadFromDb]);

  const visibleAddressesForSync = useMemo(
    () => rows.map(r => ({address: r.address, network})),
    [rows, network],
  );

  const visibleUtxoEntries = useMemo(
    () =>
      rows.map(r => ({
        address: r.address,
        network,
        derivationPath: r.derivationPath,
      })),
    [rows, network],
  );

  /** Lazy background balance sync for rows missing or stale balance metadata. */
  useEffect(() => {
    if (!apiBase || !rows.length) return;
    if (lazySyncInFlight.current) return;

    const run = async () => {
      lazySyncInFlight.current = true;
      try {
        for (const r of rows) {
          if (!needsLazyBalanceSync(r.address, network)) continue;
          try {
            await balanceSyncer.syncAddresses(
              [{address: r.address, network}],
              apiBase,
            );
          } catch (e) {
            dbg('AddressesScreen: lazy balance sync', r.address.slice(0, 8), e);
          }
        }
        reloadFromDb();
      } finally {
        lazySyncInFlight.current = false;
      }
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [rows, apiBase, network, reloadFromDb]);

  /** One address per call: BalanceSyncer/UtxoSyncer batch-all-or-nothing semantics would skip writes if any address failed. */
  const onHeaderRefresh = useCallback(async () => {
    if (!apiBase || refreshing) return;
    setRefreshing(true);
    try {
      for (const {address} of visibleAddressesForSync) {
        syncRepository.invalidate('balance', `${address}_${network}`);
      }
      for (const entry of visibleUtxoEntries) {
        syncRepository.invalidate('utxos', `${entry.address}_${network}`);
      }
      for (const {address} of visibleAddressesForSync) {
        try {
          await balanceSyncer.syncAddresses([{address, network}], apiBase);
        } catch (e) {
          dbg('AddressesScreen: refresh balance', address.slice(0, 8), e);
        }
      }
      for (const entry of visibleUtxoEntries) {
        try {
          await utxoSyncer.syncAddresses([entry], apiBase);
        } catch (e) {
          dbg('AddressesScreen: refresh utxo', entry.address.slice(0, 8), e);
        }
      }
      reloadFromDb();
    } finally {
      setRefreshing(false);
    }
  }, [
    apiBase,
    refreshing,
    visibleAddressesForSync,
    visibleUtxoEntries,
    network,
    reloadFromDb,
  ]);

  const headerLeft = useCallback(() => {
    const isDarkMode = theme.colors.background !== '#ffffff';
    const containerBg = isDarkMode
      ? theme.colors.border
      : theme.colors.cardBackground;
    const containerBorderColor = isDarkMode
      ? theme.colors.border + '80'
      : theme.colors.blackOverlay10;
    const refreshColBg = isDarkMode
      ? theme.colors.border
      : theme.colors.cardBackground;
    const pillHeight = 36;
    const innerRadius = 9;
    const segmentDividerColor = theme.colors.textSecondary;
    const modeLabel = viewMode === 'smart' ? 'AUTO' : 'HD';
    const xs = theme.fontSizes?.xs || 10;

    return (
      <View style={styles.headerChipWrap}>
        <View
          style={[
            styles.headerChipOuter,
            {
              height: pillHeight,
              borderColor: containerBorderColor,
              backgroundColor: containerBg,
            },
          ]}>
          <View style={styles.headerChipRow}>
            <AppPressable
              onPress={onHeaderRefresh}
              disabled={refreshing || !apiBase}
              style={[
                styles.headerChipSegment,
                styles.headerChipRefreshCol,
                {
                  backgroundColor: refreshColBg,
                  borderTopLeftRadius: innerRadius,
                  borderBottomLeftRadius: innerRadius,
                },
              ]}
              accessibilityLabel="Refresh address balances"
              accessibilityRole="button"
              android_ripple={{color: 'rgba(0,0,0,0.08)'}}>
              {refreshing ? (
                <ActivityIndicator
                  size="small"
                  color={
                    isDarkMode ? theme.colors.secondary : theme.colors.primary
                  }
                />
              ) : (
                <Image
                  source={require('../assets/refresh-icon.png')}
                  style={[
                    styles.headerChipRefreshIcon,
                    {tintColor: theme.colors.text},
                  ]}
                  resizeMode="contain"
                />
              )}
            </AppPressable>
            <View
              style={[
                styles.headerChipDividerV,
                {backgroundColor: segmentDividerColor},
              ]}
            />
            <AppPressable
              onPress={toggleViewMode}
              style={[
                styles.headerChipSegment,
                styles.headerChipSegmentGrow,
                {
                  backgroundColor: containerBg,
                  borderTopRightRadius: innerRadius,
                  borderBottomRightRadius: innerRadius,
                },
              ]}
              accessibilityLabel={
                viewMode === 'smart'
                  ? 'Address order: smart, tap to switch to derivation order'
                  : 'Address order: derivation, tap to switch to smart order'
              }
              accessibilityRole="button"
              android_ripple={{color: 'rgba(0,0,0,0.08)'}}>
              <AppText
                style={[
                  styles.headerModeLetter,
                  {
                    fontSize: xs,
                    fontFamily: theme.fontFamilies?.bold,
                    color: isDarkMode
                      ? theme.colors.secondary
                      : theme.colors.primary,
                  },
                ]}
                numberOfLines={1}>
                {modeLabel}
              </AppText>
            </AppPressable>
          </View>
        </View>
      </View>
    );
  }, [apiBase, onHeaderRefresh, refreshing, theme, toggleViewMode, viewMode]);
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

  const renderRow = useCallback(
    ({item}: {item: AddressRowVm}) => {
      const currency = appConfigRepository.get(CONFIG_KEYS.CURRENCY) || 'USD';
      const rate = btcRate ?? priceRepository.getCurrentRate(currency);
      const totalSats =
        item.balanceSats != null && item.pendingSats != null
          ? item.balanceSats + item.pendingSats
          : null;
      const fiat =
        rate != null && totalSats != null
          ? presentFiat((totalSats / 1e8) * rate)
          : null;
      const sym = getCurrencySymbol(currency);
      const btcStr = totalSats != null ? (totalSats / 1e8).toFixed(8) : '—';

      const {colors, fontFamilies} = theme;
      const monoMed = fontFamilies?.monospaceMedium ?? fontFamilies?.monospace;
      const monoReg = fontFamilies?.monospace;
      const labelFace = fontFamilies?.medium ?? fontFamilies?.regular;
      const tierVis = tierPillTheme(item.tier, colors);
      const isDark = colors.background !== '#ffffff';
      const rowShadow = Platform.select({
        ios: {
          shadowColor: colors.shadowColor,
          shadowOffset: {width: 0, height: 1},
          shadowOpacity: isDark ? 0.22 : 0.07,
          shadowRadius: 4,
        },
        android: {elevation: 2},
        default: {},
      });
      const checkedStr =
        item.fetchedAt != null
          ? `Checked ${new Date(item.fetchedAt).toLocaleString()}`
          : 'Balance not synced yet';

      const rowSyncing = rowModalSyncKey === item.key;
      const syncIndicatorColor = isDark ? colors.secondary : colors.primary;
      /** Dark theme `primary` is a gray — use teal accent for index; light uses navy primary. */
      const indexNumColor = isDark ? colors.secondary : colors.primary;

      return (
        <View style={styles.rowOuter}>
          <AppPressable
            onPress={() => onAddressRowPress(item)}
            disabled={rowModalSyncKey !== null}
            accessibilityRole="button"
            accessibilityLabel={`Receive details for ${item.chain} address ${item.idx}`}
            accessibilityHint="Refreshes balance then opens QR code, copy, and share"
            android_ripple={{
              color: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
              foreground: true,
            }}
            style={({pressed}) => [
              styles.row,
              rowShadow,
              {
                borderColor: pressed
                  ? colors.primary + 'aa'
                  : colors.border + (isDark ? '88' : '66'),
                backgroundColor: pressed
                  ? isDark
                    ? colors.whiteOverlay08
                    : colors.blackOverlay04
                  : colors.cardBackground,
              },
            ]}>
            <View style={styles.rowLine1}>
              <View style={styles.rowTypeLeftWrap}>
                <AppText
                  style={[
                    styles.rowTypeLabel,
                    {color: colors.text, fontFamily: labelFace},
                  ]}
                  numberOfLines={1}>
                  {item.chain === 'receive' ? 'Receive' : 'Change'}
                </AppText>
                <AppText
                  style={[
                    styles.rowIdxMono,
                    {fontFamily: monoMed, color: indexNumColor},
                  ]}
                  numberOfLines={1}>
                  {item.idx}
                </AppText>
              </View>
              <AppText
                style={[
                  styles.rowPathRight,
                  {fontFamily: monoMed, color: colors.textSecondary},
                ]}
                numberOfLines={2}
                selectable>
                {item.derivationPath}
              </AppText>
            </View>
            <View
              style={[
                styles.rowLine1Separator,
                {
                  backgroundColor: isDark
                    ? colors.whiteOverlay12
                    : colors.blackOverlay10,
                },
              ]}
            />
            <View style={styles.rowLine2}>
              <View
                style={[
                  styles.tierPill,
                  {
                    backgroundColor: tierVis.pillBg,
                    borderColor: tierVis.pillBorder,
                  },
                ]}>
                <AppText
                  style={[
                    styles.tierPillText,
                    {color: tierVis.pillText, fontFamily: labelFace},
                  ]}>
                  {tierVis.label}
                </AppText>
              </View>
              <AppText
                style={[
                  styles.rowDateRight,
                  {fontFamily: monoReg, color: colors.textSecondary},
                ]}
                numberOfLines={1}>
                {checkedStr}
              </AppText>
            </View>
            <View
              style={[
                styles.addrBlock,
                {
                  borderColor: colors.border + (isDark ? '66' : '44'),
                  backgroundColor: isDark
                    ? colors.whiteOverlay08
                    : colors.blackOverlay03,
                },
              ]}>
              <AppText
                selectable
                style={[
                  styles.addrMono,
                  {fontFamily: monoReg, color: colors.text},
                ]}
                numberOfLines={3}>
                {item.address}
              </AppText>
            </View>
            <View style={styles.balRow}>
              <View style={styles.balLeft}>
                <AppText
                  style={[
                    styles.btcLabel,
                    {color: colors.textSecondary, fontFamily: labelFace},
                  ]}>
                  BTC
                </AppText>
                <AppText
                  style={[
                    styles.btcVal,
                    {fontFamily: monoMed, color: colors.text},
                  ]}>
                  {btcStr}
                </AppText>
              </View>
              <AppText
                style={[
                  styles.fiatText,
                  {fontFamily: monoMed, color: colors.textSecondary},
                ]}
                numberOfLines={1}>
                {fiat != null ? `${sym}${fiat}` : '—'}
              </AppText>
            </View>
          </AppPressable>
          {rowSyncing ? (
            <View
              style={[
                styles.rowSyncOverlay,
                {
                  backgroundColor: isDark
                    ? colors.whiteOverlay15
                    : colors.blackOverlay30,
                },
              ]}
              pointerEvents="none">
              <ActivityIndicator size="small" color={syncIndicatorColor} />
            </View>
          ) : null}
        </View>
      );
    },
    [btcRate, theme, onAddressRowPress, rowModalSyncKey],
  );

  const empty = !rows.length;

  /** Dark theme primary is a gray; use secondary (teal) for spinner/label contrast on cards. */
  const isDarkMode = theme.colors.background !== '#ffffff';
  const loadMoreAccent = isDarkMode
    ? theme.colors.secondary
    : theme.colors.primary;
  const loadMoreSurface = isDarkMode
    ? theme.colors.whiteOverlay10
    : theme.colors.blackOverlay04;
  const loadMoreBorder = isDarkMode
    ? theme.colors.border + 'aa'
    : theme.colors.border + '75';

  return (
    <View
      style={[styles.container, {backgroundColor: theme.colors.background}]}>
      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          empty ? (
            <AppText tone="muted" style={styles.empty}>
              No addresses in wallet cache yet. Run sync or wallet discovery,
              then open this tab again.
            </AppText>
          ) : null
        }
        ListFooterComponent={
          <AppPressable
            onPress={loadMore}
            disabled={loadingMore}
            style={[
              styles.loadMore,
              {
                borderColor: loadMoreBorder,
                backgroundColor: loadMoreSurface,
              },
            ]}
            accessibilityLabel={
              loadingMore
                ? 'Loading more addresses'
                : 'Show 5 more address pairs'
            }
            accessibilityState={{busy: loadingMore}}
            android_ripple={{
              color: isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
            }}>
            {loadingMore ? (
              <View style={styles.loadMoreLoadingRow}>
                <ActivityIndicator size="small" color={loadMoreAccent} />
                <AppText
                  style={[
                    styles.loadMoreLoadingText,
                    {
                      color: theme.colors.textSecondary,
                      fontFamily: theme.fontFamilies?.medium,
                    },
                  ]}>
                  Loading…
                </AppText>
              </View>
            ) : (
              <AppText
                style={[
                  styles.loadMoreLabel,
                  {
                    color: loadMoreAccent,
                    fontFamily: theme.fontFamilies?.bold,
                  },
                ]}>
                Show more
              </AppText>
            )}
          </AppPressable>
        }
      />
      {receiveModalRow ? (
        <ReceiveModal
          address={receiveModalRow.address}
          addressType={addressType}
          baseApi={apiBase ?? ''}
          network={network as 'mainnet' | 'testnet'}
          pathChain={receiveModalRow.chain}
          receivePathInfo={{
            path: receiveModalRow.derivationPath,
            index: receiveModalRow.idx,
            address: receiveModalRow.address,
          }}
          onClose={() => setReceiveModalRow(null)}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1},
  listContent: {padding: 16, paddingBottom: 32},
  headerChipWrap: {marginLeft: 16, justifyContent: 'center'},
  headerChipOuter: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    minWidth: 100,
  },
  headerChipRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: '100%',
  },
  headerModeLetter: {letterSpacing: 0.4},
  headerChipSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  headerChipSegmentGrow: {flex: 1, minWidth: 56},
  headerChipRefreshCol: {minWidth: 44, paddingHorizontal: 8},
  headerChipDividerV: {width: 1, alignSelf: 'stretch'},
  headerChipRefreshIcon: {width: 18, height: 18},
  rowLine1: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 0,
  },
  rowLine1Separator: {
    height: StyleSheet.hairlineWidth,
    marginTop: 8,
    marginBottom: 10,
    alignSelf: 'stretch',
  },
  rowTypeLeftWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexShrink: 0,
    maxWidth: '44%',
  },
  rowTypeLabel: {
    fontSize: 15,
    letterSpacing: 0.2,
  },
  rowIdxMono: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  rowPathRight: {
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  rowLine2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  tierPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  tierPillText: {
    fontSize: 10,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  rowDateRight: {
    fontSize: 10,
    flex: 1,
    textAlign: 'right',
    minWidth: 0,
  },
  rowOuter: {
    position: 'relative',
    marginBottom: 12,
  },
  rowSyncOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  addrBlock: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  addrMono: {
    fontSize: 12,
    lineHeight: 18,
  },
  balRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  balLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  btcLabel: {fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase'},
  btcVal: {fontSize: 15, fontVariant: ['tabular-nums']},
  fiatText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
    maxWidth: '54%',
  },
  empty: {textAlign: 'center', padding: 24},
  loadMore: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    minWidth: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 22,
  },
  loadMoreLoadingText: {
    fontSize: 13,
  },
  loadMoreLabel: {
    fontSize: 15,
  },
});

export default AddressesScreen;
