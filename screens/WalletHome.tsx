import React, {useEffect, useState, useCallback} from 'react';
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
} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import SendBitcoinModal from './SendBitcoinModal';
import Toast from 'react-native-toast-message';
import TransactionList from '../components/TransactionList';
import {CommonActions} from '@react-navigation/native';
import Big from 'big.js';
import ReceiveModal from './ReceiveModal';
import {dbg} from '../utils';
import {useTheme, themes} from '../theme';
import {WalletService, Transaction} from '../services/WalletService';
import WalletSkeleton from '../components/WalletSkeleton';
import {formatDistanceToNow} from 'date-fns';
import {useWallet} from '../context/WalletContext';

const {BBMTLibNativeModule} = NativeModules;

const headerStyles = StyleSheet.create({
  actionButton: {
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: themes.lightPolished.colors.cardBackground,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 40,
    height: 40,
    resizeMode: 'contain',
    marginRight: 8,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});

const HeaderRightButton = ({navigation}: {navigation: any}) => (
  <TouchableOpacity
    style={[headerStyles.actionButton, headerStyles.settingsButton]}
    onPress={() => navigation.navigate('Settings')}>
    <Text>⚙️</Text>
  </TouchableOpacity>
);

const HeaderTitle = React.memo(() => (
  <View style={headerStyles.headerTitleContainer}>
    <Image
      source={require('../assets/icon.png')}
      style={headerStyles.headerLogo}
    />
    <Text style={headerStyles.headerTitleText}>Bold Home</Text>
  </View>
));

interface CacheTimestamp {
  price: number;
  balance: number;
  transactions: number;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: themes.lightPolished.colors.background,
  },
  contentContainer: {
    paddingTop: 16,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 0,
  },
  walletHeader: {
    padding: 16,
    backgroundColor: themes.lightPolished.colors.primary,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 0,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  btcLogo: {
    width: 40,
    height: 40,
    resizeMode: 'contain',
  },
  btcPrice: {
    fontSize: 18,
    fontWeight: '600',
    color: themes.lightPolished.colors.accent,
    textAlign: 'right',
  },
  balanceBTC: {
    fontSize: 24,
    fontWeight: 'bold',
    color: themes.lightPolished.colors.white,
    marginTop: 16,
    marginBottom: 4,
  },
  balanceUSD: {
    fontSize: 16,
    color: themes.lightPolished.colors.background,
    marginBottom: 16,
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
    color: themes.lightPolished.colors.textOnPrimary,
    marginTop: 8,
    textAlign: 'center',
    fontWeight: '600',
  },
  partyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 8,
    marginTop: 8,
  },
  partyLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  partyCenter: {
    flex: 1,
    alignItems: 'center',
  },
  partyRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  party: {
    fontSize: 12,
    color: themes.lightPolished.colors.textOnPrimary,
    fontWeight: '500',
  },
  partyText: {
    fontSize: 12,
    color: themes.lightPolished.colors.textOnPrimary,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    width: '100%',
  },
  actionButton: {
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  sendButton: {
    flex: 1,
    backgroundColor: themes.lightPolished.colors.accent,
  },
  settingsButton: {
    width: 50,
    backgroundColor: themes.lightPolished.colors.accent,
  },
  addressTypeModalButton: {
    width: 50,
    backgroundColor: themes.lightPolished.colors.cardBackground,
  },
  receiveButton: {
    flex: 1,
    backgroundColor: themes.lightPolished.colors.secondary,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  modalContent: {
    backgroundColor: themes.lightPolished.colors.background,
    borderRadius: 12,
    padding: 20,
    width: '80%',
    alignItems: 'center',
  },
  modalText: {
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center',
    color: themes.lightPolished.colors.text,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  blurredText: {
    opacity: 0.6,
  },
  addressTypeButton: {
    backgroundColor: themes.lightPolished.colors.cardBackground,
    padding: 16,
    borderRadius: 8,
    marginVertical: 8,
    width: '100%',
    borderWidth: 1,
    borderColor: themes.lightPolished.colors.border,
  },
  addressTypeButtonSelected: {
    borderColor: themes.lightPolished.colors.accent,
    borderWidth: 2,
  },
  addressTypeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
    marginBottom: 4,
  },
  addressTypeValue: {
    marginTop: 4,
    fontSize: 12,
    color: themes.lightPolished.colors.textSecondary,
    textAlign: 'left',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: themes.lightPolished.colors.text,
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
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  cacheText: {
    fontSize: 14,
    marginBottom: 4,
    marginTop: 0,
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '600',
  },
  transactionListContainer: {
    flex: 1,
    marginBottom: 0,
  },
});

const CacheIndicator: React.FC<{
  timestamps: CacheTimestamp;
  onRefresh: () => void;
  theme: any;
}> = ({timestamps, onRefresh, theme}) => {
  const latestTimestamp = Math.max(
    timestamps.price,
    timestamps.balance,
    timestamps.transactions,
  );

  if (latestTimestamp === 0) {
    return null;
  }

  const timeAgo = formatDistanceToNow(latestTimestamp, {addSuffix: true});

  return (
    <TouchableOpacity
      style={[
        styles.cacheIndicator,
        {backgroundColor: theme.colors.cardBackground},
      ]}
      onPress={onRefresh}>
      <Text style={[styles.cacheText, {color: theme.colors.textSecondary}]}>
        📱 Last updated {timeAgo}
      </Text>
      <Text style={[styles.refreshText, {color: theme.colors.accent}]}>
        Tap to refresh data
      </Text>
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
  const [balanceUSD, setBalanceUSD] = useState<string>('0');
  const [apiBase, setApiBase] = useState<string>('');
  const [party, setParty] = useState<string>('');
  const [isBlurred, setIsBlurred] = useState<boolean>(true);
  const [isReceiveModalVisible, setIsReceiveModalVisible] = useState(false);
  const [pendingSent, setPendingSent] = useState(0);
  const [addressType, setAddressType] = React.useState('');
  const [isAddressTypeModalVisible, setIsAddressTypeModalVisible] =
    React.useState(false);
  const [legacyAddress, setLegacyAddress] = React.useState('');
  const [segwitAddress, setSegwitAddress] = React.useState('');
  const [segwitCompatibleAddress, setSegwitCompatibleAddress] =
    React.useState('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [_error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cacheTimestamps, setCacheTimestamps] = useState<CacheTimestamp>({
    price: 0,
    balance: 0,
    transactions: 0,
  });

  const {theme} = useTheme();
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

  const shorten = (x: string, y = 12) => `${x.slice(0, y)}...${x.slice(-y)}`;

  const capitalizeWords = (str: string) => {
    return str
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const addressEmoji = () =>
    addressType === 'legacy'
      ? '🧱'
      : addressType === 'segwit-native'
      ? '🧬'
      : '♻️';

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
    async (force = false) => {
      if (!wallet?.address || !wallet?.baseApi) {
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // First get cached data to show immediately
        const [cachedPrice, cachedBalance, cachedTransactions] =
          await Promise.all([
            walletService.getBitcoinPrice(),
            walletService.getWalletBalance(
              wallet.address,
              btcRate,
              pendingSent,
            ),
            walletService.getTransactions(wallet.address, wallet.baseApi),
          ]);

        // Update UI with cached data
        setBtcPrice(cachedPrice.price);
        setBtcRate(cachedPrice.rate);
        setBalanceBTC(cachedBalance.btc);
        setBalanceUSD(cachedBalance.usd);
        setTransactions(cachedTransactions.transactions);
        setCacheTimestamps({
          price: walletService.getLastPriceFetch(),
          balance: walletService.getLastBalanceFetch(),
          transactions: walletService.getLastTxFetch(wallet.address),
        });

        // If not forcing refresh, we're done
        if (!force) {
          setLoading(false);
          return;
        }

        // Force refresh in background
        try {
          const [freshPrice, freshBalance, freshTransactions] =
            await Promise.all([
              walletService.getBitcoinPrice(),
              walletService.getWalletBalance(
                wallet.address,
                btcRate,
                pendingSent,
                true,
              ),
              walletService.getTransactions(wallet.address, wallet.baseApi),
            ]);

          // Only update UI if we got fresh data
          if (freshTransactions.transactions.length > 0) {
            setBtcPrice(freshPrice.price);
            setBtcRate(freshPrice.rate);
            setBalanceBTC(freshBalance.btc);
            setBalanceUSD(freshBalance.usd);
            setTransactions(freshTransactions.transactions);
          }

          setCacheTimestamps({
            price: walletService.getLastPriceFetch(),
            balance: walletService.getLastBalanceFetch(),
            transactions: walletService.getLastTxFetch(wallet.address),
          });
        } catch (refreshError: any) {
          // Only show error if it's not a "canceled" error
          if (refreshError.message !== 'canceled') {
            setError(refreshError.message);
            dbg('Error refreshing data:', refreshError);
          }
          // Keep using cached data
          setCacheTimestamps({
            price: walletService.getLastPriceFetch(),
            balance: walletService.getLastBalanceFetch(),
            transactions: walletService.getLastTxFetch(wallet.address),
          });
        }
      } catch (error: any) {
        // Only show error if it's not a "canceled" error
        if (error.message !== 'canceled') {
          setError(error.message);
          dbg('Error fetching data:', error);
        }
        // Keep using cached data
        setCacheTimestamps({
          price: walletService.getLastPriceFetch(),
          balance: walletService.getLastBalanceFetch(),
          transactions: walletService.getLastTxFetch(wallet.address),
        });
      } finally {
        setLoading(false);
      }
    },
    [wallet?.address, wallet?.baseApi, btcRate, pendingSent, walletService],
  );

  const handlePendingTransactions = useCallback(
    async (pendingTxs: Transaction[], pendingSentTotal: number) => {
      setPendingSent(pendingSentTotal);
      return Promise.resolve();
    },
    [],
  );

  const handleRefresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  const initializeApp = useCallback(async () => {
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
  }, [fetchData, showErrorToast, isInitialized]);

  // Add effect to handle address type changes
  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    const updateAddress = async () => {
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

        const btcAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          network,
          addressType,
        );

        setAddress(btcAddress);
        // Force refresh after address change
        await fetchData(true);
      } catch (error) {
        dbg('Error updating address:', error);
        showErrorToast('Failed to update address. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    updateAddress();
  }, [addressType, isInitialized, network, fetchData, showErrorToast]);

  // Add effect to initialize app
  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // Add effect to handle network changes
  useEffect(() => {
    if (!isInitialized || !network) {
      return;
    }

    const updateAPI = async () => {
      try {
        const api = await EncryptedStorage.getItem('api');
        if (api) {
          // Ensure API URL ends with a slash
          const formattedApi = api.endsWith('/')
            ? api.substring(0, api.length - 1)
            : api;
          setApiBase(formattedApi);
          BBMTLibNativeModule.setAPI(network, formattedApi);
        }
      } catch (error) {
        dbg('Error updating API:', error);
        showErrorToast('Failed to update API settings. Please try again.');
      }
    };

    updateAPI();
  }, [isInitialized, network, showErrorToast]);

  useEffect(() => {
    if (!isInitialized || !address) {
      return;
    }

    // Initial data fetch
    fetchData(true);

    // Only update UI timestamp every minute
    const intervalId = setInterval(() => {
      const currentTime = Date.now();
      setCacheTimestamps(prev => ({
        ...prev,
        price: currentTime,
        balance: currentTime,
        transactions: currentTime,
      }));
    }, 60000);

    return () => clearInterval(intervalId);
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

  if (loading) {
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
            <Text style={styles.btcPrice}>{btcPrice}</Text>
          </View>
          <TouchableOpacity onPress={handleBlurred}>
            <Text style={[styles.balanceBTC, isBlurred && styles.blurredText]}>
              {isBlurred ? '* * * * * * 🔓' : `${balanceBTC} BTC 🔒`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleBlurred}>
            <Text style={[styles.balanceUSD, isBlurred && styles.blurredText]}>
              {isBlurred ? '* * *' : balanceUSD}
            </Text>
          </TouchableOpacity>
          <View style={styles.partyContainer}>
            <View style={styles.partyLeft}>
              <Text style={styles.partyText} numberOfLines={1} adjustsFontSizeToFit>
                🗝 {capitalizeWords(party)}
              </Text>
            </View>
            <View style={styles.partyCenter}>
              <Text style={styles.partyText} numberOfLines={1} adjustsFontSizeToFit>
                {networkEmoji()} {capitalizeWords(network)}
              </Text>
            </View>
            <View style={styles.partyRight}>
              <Text style={styles.partyText} numberOfLines={1} adjustsFontSizeToFit>
                {addressEmoji()} {addressType === 'segwit-compatible' ? 'Segwit Compatible' : capitalizeWords(addressType)}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.sendButton]}
              onPress={() => setIsSendModalVisible(true)}>
              <Text style={styles.actionButtonText}>Send</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.addressTypeModalButton]}
              onPress={() => setIsAddressTypeModalVisible(true)}>
              <Text>{addressEmoji()}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.receiveButton]}
              onPress={() => setIsReceiveModalVisible(true)}>
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
          />
          <View style={styles.transactionListContainer}>
            <TransactionList
              baseApi={apiBase}
              address={address}
              onUpdate={handlePendingTransactions}
              onReload={handleRefresh}
              refreshing={false}
              initialTransactions={transactions}
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
              onPress={async () => {
                setIsAddressTypeModalVisible(false);
                await EncryptedStorage.setItem('addressType', 'legacy');
                setAddressType('legacy');
                // Force refresh after address type change
                await fetchData(true);
              }}>
              <Text style={styles.addressTypeLabel}>🧱 Legacy Address</Text>
              <Text style={styles.addressTypeValue}>
                {shorten(legacyAddress)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-native' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={async () => {
                setIsAddressTypeModalVisible(false);
                await EncryptedStorage.setItem('addressType', 'segwit-native');
                setAddressType('segwit-native');
                // Force refresh after address type change
                await fetchData(true);
              }}>
              <Text style={styles.addressTypeLabel}>
                🧬 Segwit Native Address
              </Text>
              <Text style={styles.addressTypeValue}>
                {shorten(segwitAddress)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addressTypeButton,
                addressType === 'segwit-compatible' &&
                  styles.addressTypeButtonSelected,
              ]}
              onPress={async () => {
                setIsAddressTypeModalVisible(false);
                await EncryptedStorage.setItem(
                  'addressType',
                  'segwit-compatible',
                );
                setAddressType('segwit-compatible');
                // Force refresh after address type change
                await fetchData(true);
              }}>
              <Text style={styles.addressTypeLabel}>
                🔁 Segwit Compatible Address
              </Text>
              <Text style={styles.addressTypeValue}>
                {shorten(segwitCompatibleAddress)}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
          baseApi={apiBase}
          network={network}
          visible={isReceiveModalVisible}
          onClose={() => setIsReceiveModalVisible(false)}
        />
      )}
    </SafeAreaView>
  );
};

export default WalletHome;
