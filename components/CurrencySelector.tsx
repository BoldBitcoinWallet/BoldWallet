import React, {useEffect, useState} from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  Image,
} from 'react-native';
import AppModal from './AppModal';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AppPressable from './AppPressable';
import GlassModalOverlay from './GlassModalOverlay';
import {DissolveFade} from './DissolveFade';
import Animated, {
  useSharedValue,
  withRepeat,
  withTiming,
  useAnimatedStyle,
  Easing,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import {useTheme} from '../theme';
import {presentFiat} from '../utils';
import {WalletService} from '../services/WalletService';
import {isWalletOnline} from '../services/walletOnlineStore';
interface Currency {
  code: string;
  name: string;
  symbol: string;
}
interface CurrencySelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (currency: Currency) => void;
  currentCurrency: string;
  availableCurrencies: {[key: string]: number};
  /** Fresh rates after the user taps refresh. */
  onRates?: (rates: {[key: string]: number}) => void;
}
const currencyNames: {[key: string]: string} = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  CNY: 'Chinese Yuan',
  INR: 'Indian Rupee',
  SGD: 'Singapore Dollar',
};
const currencySymbols: {[key: string]: string} = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'Fr',
  CNY: '¥',
  INR: '₹',
  SGD: 'S$',
};

function rawPriceRows(
  raw: Record<string, unknown> | null,
): {key: string; value: string}[] {
  if (!raw) {
    return [];
  }
  return Object.keys(raw)
    .sort((a, b) => {
      if (a === 'time') {
        return -1;
      }
      if (b === 'time') {
        return 1;
      }
      return a.localeCompare(b);
    })
    .map(key => ({
      key,
      value: raw[key] == null ? '' : String(raw[key]),
    }));
}

const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  visible,
  onClose,
  onSelect,
  currentCurrency,
  availableCurrencies,
  onRates,
}) => {
  const {theme} = useTheme();
  const {height, width} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const modalAnimation = useSharedValue(0);
  const refreshSpin = useSharedValue(0);
  const refreshSweep = useSharedValue(0);
  const [rates, setRates] = useState(availableCurrencies);
  const [refreshing, setRefreshing] = useState(false);
  const [rawPrices, setRawPrices] = useState<Record<string, unknown> | null>(
    null,
  );
  const [priceSourceUrl, setPriceSourceUrl] = useState<string | null>(null);
  const [priceResultVisible, setPriceResultVisible] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  useEffect(() => {
    setRates(availableCurrencies);
  }, [availableCurrencies]);

  useEffect(() => {
    if (!visible) {
      setPriceResultVisible(false);
      setRawPrices(null);
      setPriceSourceUrl(null);
      setStatusLine(null);
    }
  }, [visible]);

  // Animate modal on open/close (fade like other modals)
  useEffect(() => {
    if (visible) {
      modalAnimation.value = 0;
      modalAnimation.value = withTiming(1, {duration: 200});
    } else {
      modalAnimation.value = 0;
    }
  }, [visible, modalAnimation]);

  useEffect(() => {
    if (refreshing) {
      refreshSpin.value = 0;
      refreshSpin.value = withRepeat(
        withTiming(1, {duration: 700, easing: Easing.linear}),
        -1,
        false,
      );
      refreshSweep.value = 0;
      refreshSweep.value = withRepeat(
        withTiming(1, {duration: 900, easing: Easing.inOut(Easing.quad)}),
        -1,
        false,
      );
      return;
    }
    cancelAnimation(refreshSpin);
    cancelAnimation(refreshSweep);
    refreshSpin.value = 0;
    refreshSweep.value = 0;
  }, [refreshing, refreshSpin, refreshSweep]);

  const refreshIconStyle = useAnimatedStyle(() => ({
    transform: [{rotate: `${refreshSpin.value * 360}deg`}],
  }));

  const refreshBarStyle = useAnimatedStyle(() => ({
    transform: [{translateX: (refreshSweep.value * 1.4 - 0.4) * width}],
  }));

  const handleClose = () => {
    // Animate modal exit
    const finishCallback = () => {
      onClose();
    };
    modalAnimation.value = withTiming(0, {duration: 200}, () => {
      runOnJS(finishCallback)();
    });
  };
  const handleRefresh = async () => {
    if (refreshing) {
      return;
    }
    setRefreshing(true);
    setPriceResultVisible(false);
    setStatusLine(null);
    try {
      const result = await WalletService.getInstance().getBitcoinPrice({
        force: true,
      });
      if (result?.rates && Object.keys(result.rates).length > 0) {
        setRates(result.rates);
        onRates?.(result.rates);
      }
      if (result?.live && result.raw && typeof result.raw === 'object') {
        setRawPrices(result.raw);
        setPriceSourceUrl(
          typeof result.sourceUrl === 'string' && result.sourceUrl.length > 0
            ? result.sourceUrl
            : null,
        );
        setPriceResultVisible(true);
        return;
      }
      setRawPrices(null);
      setPriceSourceUrl(null);
      setPriceResultVisible(false);
      const hasCached =
        !!result?.rates &&
        Object.values(result.rates).some(
          rate => typeof rate === 'number' && rate > 0,
        );
      if (!isWalletOnline()) {
        setStatusLine('Wallet is offline. Turn Online to refresh prices.');
      } else if (hasCached) {
        setStatusLine(
          "Couldn't reach the price server. Showing last known prices.",
        );
      } else {
        setStatusLine("Couldn't reach the price server.");
      }
    } catch {
      setRawPrices(null);
      setPriceSourceUrl(null);
      setPriceResultVisible(false);
      setStatusLine("Couldn't reach the price server.");
    } finally {
      setRefreshing(false);
    }
  };

  // Convert available currencies object to array of Currency objects
  const currencies: Currency[] = Object.keys(rates)
    .filter(code => currencyNames[code]) // Only include currencies in our whitelist
    .map(code => ({
      code,
      name: currencyNames[code],
      symbol: currencySymbols[code] || code,
    }));
  const renderCurrencyItem = ({item}: {item: Currency}) => {
    const rate = rates[item.code];
    const priceLabel =
      typeof rate === 'number' && rate > 0
        ? `${presentFiat(rate)} ${item.symbol}`
        : '—';
    const selected = item.code === currentCurrency;
    return (
      <AppPressable
        style={[
          styles.currencyItem,
          selected && styles.selectedCurrency,
        ]}
        onPress={() => {
          onSelect(item);
          onClose();
        }}
        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, 1 Bitcoin equals ${priceLabel}`}>
        <Text style={[styles.currencyCode, selected && styles.selectedCurrencyText]}>
          {item.code}
        </Text>
        <Text
          style={[styles.currencyName, selected && styles.selectedCurrencyText]}
          numberOfLines={1}>
          {item.name}
        </Text>
        <Text
          style={[styles.currencyPrice, selected && styles.selectedCurrencyText]}
          numberOfLines={1}>
          {priceLabel}
        </Text>
      </AppPressable>
    );
  };
  const styles = StyleSheet.create({
    modalContainer: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalRoot: {
      flex: 1,
    },
    modalContent: {
      maxHeight: height * 0.8,
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
      borderLeftWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderRightWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderLeftColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
      borderRightColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
      paddingBottom: Math.max(0, insets.bottom),
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
    },
    headerTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    headerIcon: {
      width: 24,
      height: 24,
      marginRight: 10,
      tintColor: theme.colors.text,
    },
    title: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    refreshButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 4,
    },
    refreshIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.text,
    },
    closeButton: {
      padding: 8,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      color: theme.colors.text,
    },
    progressTrack: {
      height: 3,
      overflow: 'hidden',
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    progressFill: {
      height: 3,
      width: '40%',
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    statusLine: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      lineHeight: 18,
    },
    resultOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      paddingHorizontal: 24,
      backgroundColor: theme.colors.modalBackdrop,
    },
    resultList: {
      maxHeight: height * 0.5,
    },
    resultCard: {
      width: '100%',
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay30,
      padding: 16,
    },
    resultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    resultTitle: {
      flex: 1,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    resultHint: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      lineHeight: 18,
      marginBottom: 12,
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    resultKey: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    resultValue: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      marginLeft: 12,
    },
    resultUrlBlock: {
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    resultUrl: {
      marginTop: 4,
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
    },
    listContent: {
      padding: 0,
      paddingBottom: 20,
    },
    listWrapper: {
      backgroundColor: theme.colors.background,
    },
    currencyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      marginBottom: 0,
      marginHorizontal: 0,
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 0,
    },
    selectedCurrency: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent
          : theme.colors.bitcoinOrange,
    },
    selectedCurrencyText: {
      color: theme.colors.white,
    },
    currencyCode: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      width: 60,
    },
    currencyName: {
      fontSize: theme.fontSizes?.lg || 16,
      flex: 1,
      color: theme.colors.text,
    },
    currencyPrice: {
      flexShrink: 0,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginLeft: 12,
      textAlign: 'right',
    },
  });
  return (
    <AppModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={
        priceResultVisible ? () => setPriceResultVisible(false) : handleClose
      }>
      <View style={styles.modalRoot}>
      <GlassModalOverlay contentPosition="bottom" style={styles.modalContainer}>
        <DissolveFade
          shown={modalAnimation}
          coverColor={theme.colors.background}
          style={styles.modalContent}>
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Image
                source={require('../assets/currency-icon.png')}
                style={styles.headerIcon}
                resizeMode="contain"
              />
              <Text style={styles.title}>Select Currency</Text>
            </View>
            <View style={styles.headerActions}>
              <AppPressable
                onPress={handleRefresh}
                disabled={refreshing}
                style={styles.refreshButton}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                accessibilityRole="button"
                accessibilityLabel="Refresh Bitcoin prices">
                <Animated.View style={refreshing ? refreshIconStyle : undefined}>
                  <Image
                    source={require('../assets/refresh-icon.png')}
                    style={styles.refreshIcon}
                    resizeMode="contain"
                  />
                </Animated.View>
              </AppPressable>
              <AppPressable
                onPress={handleClose}
                style={styles.closeButton}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <Text style={styles.closeButtonText}>✕</Text>
              </AppPressable>
            </View>
          </View>
          {refreshing ? (
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, refreshBarStyle]} />
            </View>
          ) : null}
          {statusLine && !refreshing ? (
            <Text style={styles.statusLine}>{statusLine}</Text>
          ) : null}
          <View style={[styles.listWrapper, styles.listContent]}>
            {currencies.map(item => (
              <View key={item.code}>{renderCurrencyItem({item})}</View>
            ))}
          </View>
        </DissolveFade>
      </GlassModalOverlay>
      {priceResultVisible ? (
        <View style={styles.resultOverlay}>
          <AppPressable
            variant="none"
            haptic={false}
            onPress={() => setPriceResultVisible(false)}
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Dismiss prices"
          />
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <Text style={styles.resultTitle}>Prices returned</Text>
              <AppPressable
                onPress={() => setPriceResultVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close prices"
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text style={styles.closeButtonText}>✕</Text>
              </AppPressable>
            </View>
            <Text style={styles.resultHint}>
              {rawPrices
                ? 'Raw fields from the price server.'
                : 'The price server did not return a live quote.'}
            </Text>
            <ScrollView
              style={styles.resultList}
              keyboardShouldPersistTaps="handled">
              {priceSourceUrl ? (
                <View style={styles.resultUrlBlock}>
                  <Text style={styles.resultKey}>URL</Text>
                  <Text style={styles.resultUrl} selectable>
                    {priceSourceUrl}
                  </Text>
                </View>
              ) : null}
              {rawPriceRows(rawPrices).map(row => (
                <View key={row.key} style={styles.resultRow}>
                  <Text style={styles.resultKey}>{row.key}</Text>
                  <Text style={styles.resultValue}>{row.value}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
      </View>
    </AppModal>
  );
};
export default CurrencySelector;
