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
  ViewStyle,
  TextStyle,
  ImageStyle,
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
import {useTheme} from '../theme';
import {WalletService} from '../services/WalletService';
import WalletSkeleton from '../components/WalletSkeleton';
import {useWallet} from '../context/WalletContext';
import CurrencySelector from '../components/CurrencySelector';

const {BBMTLibNativeModule} = NativeModules;

interface Theme {
  colors: {
    background: string;
    cardBackground: string;
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    textSecondary: string;
    textOnPrimary: string;
    white: string;
    border: string;
  };
}

interface Styles {
  actionButton: ViewStyle;
  settingsButton: ViewStyle;
  headerTitleContainer: ViewStyle;
  headerLogo: ImageStyle;
  headerTitleText: TextStyle;
  container: ViewStyle;
  contentContainer: ViewStyle;
  walletHeader: ViewStyle;
  headerTop: ViewStyle;
  btcLogo: ImageStyle;
  priceContainer: ViewStyle;
  btcPrice: TextStyle;
  currencyBadge: TextStyle;
  balanceContainer: ViewStyle;
  balanceRow: ViewStyle;
  balanceBTC: TextStyle;
  balanceFiat: TextStyle;
  balanceIcon: ImageStyle;
  blurredText: TextStyle;
  balanceHint: TextStyle;
  qrContainer: ViewStyle;
  address: TextStyle;
  partyContainer: ViewStyle;
  partyLeft: ViewStyle;
  partyCenter: ViewStyle;
  partyRight: ViewStyle;
  party: TextStyle;
  partyText: TextStyle;
  partyLabel: TextStyle;
  partyValue: TextStyle;
  actions: ViewStyle;
  sendButton: ViewStyle;
  addressTypeModalButton: ViewStyle;
  addressTypeButtonText: TextStyle;
  addressTypeButtonIcon: ImageStyle;
  receiveButton: ViewStyle;
  modalOverlay: ViewStyle;
  modalContent: ViewStyle;
  modalText: TextStyle;
  actionButtonText: TextStyle;
  addressTypeButton: ViewStyle;
  addressTypeButtonSelected: ViewStyle;
  addressTypeLabel: TextStyle;
  addressTypeValue: TextStyle;
  addressTypeIcon: ImageStyle;
  modalAddressTypeIcon: ImageStyle;
  addressTypeContent: ViewStyle;
  modalTitle: TextStyle;
  scrollView: ViewStyle;
  cacheIndicator: ViewStyle;
  refreshText: TextStyle;
  refreshIcon: ImageStyle;
  cacheText: TextStyle;
  shimmerContainer: ViewStyle;
  shimmer: ViewStyle;
  disabled: ViewStyle;
  transactionListContainer: ViewStyle;
  sectionHeader: ViewStyle;
  sectionTitle: TextStyle;
  sectionSubtitle: TextStyle;
  emptyStateContainer: ViewStyle;
  emptyStateText: TextStyle;
  emptyStateIcon: ImageStyle;
  actionButtonIcon: ImageStyle;
  addressTypeContainer: ViewStyle;
}

const createStyles = (theme: Theme): Styles => ({
  actionButton: {
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.colors.cardBackground,
  },
  headerTitleContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  headerLogo: {
    width: 40,
    height: 40,
    resizeMode: 'contain' as const,
    marginRight: 8,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    paddingTop: 12,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 0,
  },
  walletHeader: {
    padding: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    alignItems: 'center' as const,
    marginBottom: 0,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  headerTop: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    width: '100%',
    marginBottom: 8,
  },
  btcLogo: {
    width: 32,
    height: 32,
    resizeMode: 'contain' as const,
  },
  priceContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  btcPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.white,
    marginRight: 6,
  },
  currencyBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.white,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  balanceContainer: {
    alignItems: 'center' as const,
    width: '100%',
    paddingVertical: 4,
    marginBottom: 4,
  },
  balanceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    width: '100%',
    justifyContent: 'center' as const,
  },
  balanceBTC: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.white,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  balanceFiat: {
    fontSize: 16,
    color: theme.colors.white,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  balanceIcon: {
    width: 18,
    height: 18,
    tintColor: theme.colors.white,
    opacity: 0.9,
  },
  blurredText: {
    opacity: 0.7,
    letterSpacing: 2,
  },
  balanceHint: {
    fontSize: 10,
    color: theme.colors.textOnPrimary,
    opacity: 0.7,
    marginTop: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
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
    color: theme.colors.textOnPrimary,
    marginTop: 8,
    textAlign: 'center' as const,
    fontWeight: '600',
  },
  partyContainer: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    width: '100%',
    marginTop: 8,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    padding: 8,
  },
  partyLeft: {
    flex: 1,
    alignItems: 'flex-start' as const,
  },
  partyCenter: {
    flex: 1,
    alignItems: 'center' as const,
  },
  partyRight: {
    flex: 1,
    alignItems: 'flex-end' as const,
  },
  party: {
    fontSize: 12,
    color: theme.colors.textOnPrimary,
    fontWeight: '500',
  },
  partyText: {
    fontSize: 12,
    color: theme.colors.textOnPrimary,
    fontWeight: '500',
    opacity: 0.9,
  },
  partyLabel: {
    fontSize: 10,
    color: theme.colors.textOnPrimary,
    opacity: 0.7,
    marginBottom: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  partyValue: {
    fontSize: 12,
    color: theme.colors.textOnPrimary,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginTop: 8,
    width: '100%',
    gap: 6,
  },
  sendButton: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  addressTypeModalButton: {
    width: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
  },
  addressTypeButtonText: {
    color: theme.colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  addressTypeButtonIcon: {
    width: 20,
    height: 20,
    tintColor: theme.colors.textOnPrimary,
    opacity: 0.9,
  },
  receiveButton: {
    flex: 1,
    backgroundColor: theme.colors.secondary,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 100,
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    padding: 20,
    width: '80%',
    alignItems: 'center' as const,
  },
  modalText: {
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center' as const,
    color: theme.colors.text,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  addressTypeButton: {
    backgroundColor: theme.colors.cardBackground,
    padding: 16,
    borderRadius: 8,
    marginVertical: 8,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  addressTypeButtonSelected: {
    borderColor: theme.colors.accent,
    borderWidth: 2,
  },
  addressTypeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  addressTypeValue: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'left' as const,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  addressTypeIcon: {
    width: 16,
    height: 16,
    tintColor: theme.colors.white,
    opacity: 0.9,
  },
  modalAddressTypeIcon: {
    width: 24,
    height: 24,
    tintColor: theme.colors.text,
    opacity: 0.9,
  },
  addressTypeContent: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
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
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 1,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'left' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  refreshIcon: {
    width: 16,
    height: 16,
    tintColor: theme.colors.accent,
    opacity: 0.9,
  },
  cacheText: {
    fontSize: 13,
    marginBottom: 0,
    marginTop: 0,
    textAlign: 'right' as const,
    opacity: 0.7,
  },
  shimmerContainer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    transform: [{translateX: -100}],
  },
  disabled: {
    opacity: 0.7,
  },
  transactionListContainer: {
    flex: 1,
    marginBottom: 0,
    padding: 16,
    paddingTop: 0,
    backgroundColor: theme.colors.background,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 0,
    paddingVertical: 12,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    opacity: 0.9,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 20,
    marginTop: 20,
  },
  emptyStateText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  emptyStateIcon: {
    width: 48,
    height: 48,
    opacity: 0.5,
    marginBottom: 8,
  },
  actionButtonIcon: {
    width: 18,
    height: 18,
    tintColor: '#fff',
  },
  addressTypeContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
});

const HeaderRightButton: React.FC<{navigation: any}> = ({navigation}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  
  return (
    <TouchableOpacity
      style={[styles.actionButton, styles.settingsButton]}
      onPress={() => navigation.navigate('Settings')}>
      <Text>⚙️</Text>
    </TouchableOpacity>
  );
};

const HeaderTitle: React.FC = () => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  
  return (
    <View style={styles.headerTitleContainer}>
      <Image
        source={require('../assets/icon.png')}
        style={styles.headerLogo}
      />
      <Text style={styles.headerTitleText}>Bold Home</Text>
    </View>
  );
};

interface CacheTimestamp {
  price: number;
  balance: number;
}

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
        createStyles(theme).cacheIndicator,
        {
          backgroundColor: isRefreshing
            ? theme.colors.cardBackground
            : theme.colors.background,
        },
        isRefreshing && createStyles(theme).disabled,
      ]}
      onPress={onRefresh}
      disabled={isRefreshing}>
      {isRefreshing && (
        <View style={createStyles(theme).shimmerContainer}>
          <Animated.View
            style={[
              createStyles(theme).shimmer,
              {
                transform: [{translateX: shimmerValue}],
              },
            ]}
          />
        </View>
      )}
      <View style={createStyles(theme).refreshText}>
        <Image
          source={require('../assets/refresh-icon.png')}
          style={[
            createStyles(theme).refreshIcon,
            isRefreshing && {transform: [{rotate: '45deg'}]},
          ]}
          resizeMode="contain"
        />
        <Text
          style={{
            color: isRefreshing
              ? theme.colors.textSecondary
              : theme.colors.accent,
          }}>
          {isRefreshing
            ? 'Refreshing...'
            : isUsingCache
            ? 'Tap to refresh data'
            : 'Tap to refresh'}
        </Text>
      </View>
      {!isRefreshing && (
        <Text style={[createStyles(theme).cacheText, {color: theme.colors.textSecondary}]}>
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
  const styles = createStyles(theme);
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
          <View style={styles.balanceContainer}>
            <TouchableOpacity
              style={styles.balanceRow}
              onPress={handleBlurred}
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
                style={[styles.balanceRow, {marginTop: 4}]}
                onPress={handleBlurred}
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
          <View style={styles.partyContainer}>
            <View style={styles.partyLeft}>
              <Text style={styles.partyLabel}>Keyshare Party</Text>
              <Text
                style={styles.partyValue}
                numberOfLines={1}
                adjustsFontSizeToFit>
                🗝 {capitalizeWords(party)}
              </Text>
            </View>
            <View style={styles.partyCenter}>
              <Text style={styles.partyLabel}>Network</Text>
              <Text
                style={styles.partyValue}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {networkEmoji()} {capitalizeWords(network)}
              </Text>
            </View>
            <View style={styles.partyRight}>
              <Text style={styles.partyLabel}>Address Type</Text>
              <View style={styles.addressTypeContainer}>
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
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.sendButton]}
              onPress={() => setIsSendModalVisible(true)}>
              <Image
                source={require('../assets/send-icon.png')}
                style={styles.actionButtonIcon}
                resizeMode="contain"
              />
              <Text style={styles.actionButtonText}>Send</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.addressTypeModalButton]}
              onPress={() => setIsAddressTypeModalVisible(true)}>
              <Image
                source={getAddressTypeIcon()}
                style={styles.addressTypeButtonIcon}
                resizeMode="contain"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.receiveButton]}
              onPress={() => setIsReceiveModalVisible(true)}>
              <Image
                source={require('../assets/receive-icon.png')}
                style={styles.actionButtonIcon}
                resizeMode="contain"
              />
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
              <Image
                source={require('../assets/bricks-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>Legacy Address</Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(legacyAddress)}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-native' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => handleAddressTypeChange('segwit-native')}>
              <Image
                source={require('../assets/dna-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>
                  Segwit Native Address
                </Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(segwitAddress)}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-compatible' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={() => handleAddressTypeChange('segwit-compatible')}>
              <Image
                source={require('../assets/recycle-icon.png')}
                style={styles.modalAddressTypeIcon}
                resizeMode="contain"
              />
              <View style={styles.addressTypeContent}>
                <Text style={styles.addressTypeLabel}>
                  Segwit Compatible Address
                </Text>
                <Text style={styles.addressTypeValue}>
                  {shorten(segwitCompatibleAddress)}
                </Text>
              </View>
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
          onClose={() => setIsReceiveModalVisible(false)}
        />
      )}
    </SafeAreaView>
  );
};

export default WalletHome;
