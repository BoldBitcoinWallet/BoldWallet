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
} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import SendBitcoinModal from './SendBitcoinModal';
import Toast from 'react-native-toast-message';
import TransactionList from './TransactionList';
import {CommonActions, useFocusEffect} from '@react-navigation/native';
import Big from 'big.js';
import ReceiveModal from './ReceiveModal';
import {dbg} from '../utils';
import {useTheme, themes} from '../theme';
import {debounce} from 'lodash';

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
    onPress={() => navigation.navigate('Wallet Settings')}>
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

const formatUSD = (price: any): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(price || 0));
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
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [hasNonZeroBalance, setHasNonZeroBalance] = useState<boolean>(false);
  const lastFetchTime = useRef<number>(0);
  const isFetching = useRef<boolean>(false);
  const FETCH_COOLDOWN = 10000; // 10 seconds cooldown

  const {theme} = useTheme();

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

  // Create debounced function outside of useCallback
  const debouncedFetch = useRef(
    debounce(async (force: boolean) => {
      if (!address || isFetching.current) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastFetchTime.current < FETCH_COOLDOWN) {
        return;
      }

      try {
        isFetching.current = true;
        const totalUTXO = await BBMTLibNativeModule.totalUTXO(address);
        lastFetchTime.current = now;

        if (!totalUTXO) {
          setBalanceBTC('0.00000000');
          setBalanceUSD('$0.00');
          setHasNonZeroBalance(false);
          return;
        }

        const balance = Big(totalUTXO);
        const newBalance = balance.sub(pendingSent).div(1e8).toFixed(8);
        setBalanceBTC(newBalance);

        if (Number(newBalance) > 0) {
          setHasNonZeroBalance(true);
        }

        if (btcRate) {
          setBalanceUSD(
            `$${formatUSD(Big(balance).mul(btcRate).div(1e8).toNumber())}`,
          );
        }
      } catch (error) {
        console.error('Error fetching wallet balance:', error);
        showErrorToast('Failed to fetch wallet balance. Please try again.');
      } finally {
        isFetching.current = false;
      }
    }, 1000),
  ).current;

  const fetchWalletBalance = useCallback(
    async (force = false) => {
      await debouncedFetch(force);
    },
    [debouncedFetch],
  );

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

      let base = netParams.split('@')[1];
      // Ensure base URL ends with a slash
      if (!base.endsWith('/')) {
        base = `${base}/`;
      }
      setApiBase(base);
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
      let api = await EncryptedStorage.getItem('api');
      if (api) {
        // Ensure API URL ends with a slash
        if (!api.endsWith('/')) {
          api = `${api}/`;
        }
        setApiBase(api);
        BBMTLibNativeModule.setAPI(net, api);
      } else {
        await EncryptedStorage.setItem('api', base);
        BBMTLibNativeModule.setAPI(net, base);
      }

      setIsInitialized(true);
      // Force initial balance fetch
      await fetchWalletBalance(true);
    } catch (error) {
      console.error('Error initializing wallet:', error);
      showErrorToast('Failed to initialize wallet. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [fetchWalletBalance, showErrorToast, isInitialized]);

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
        await fetchWalletBalance(true);
      } catch (error) {
        console.error('Error updating address:', error);
        showErrorToast('Failed to update address. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    updateAddress();
  }, [addressType, isInitialized, network, fetchWalletBalance, showErrorToast]);

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
          const formattedApi = api.endsWith('/') ? api : `${api}/`;
          setApiBase(formattedApi);
          BBMTLibNativeModule.setAPI(network, formattedApi);
        }
      } catch (error) {
        console.error('Error updating API:', error);
        showErrorToast('Failed to update API settings. Please try again.');
      }
    };

    updateAPI();
  }, [isInitialized, network, showErrorToast]);

  useEffect(() => {
    const fetchBtcPrice = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://mempool.space/api/v1/prices');
        const data = await response.json();
        setBtcRate(parseFloat(data.USD));
        setBtcPrice(`$${formatUSD(data.USD)}`);
      } catch (error) {
        console.error('Error fetching BTC price:', error);
        setBtcPrice('Unavailable');
      } finally {
        setLoading(false);
      }
    };

    fetchBtcPrice();
  }, []);

  async function refreshWalletBalance(
    pendingTxs: any[],
    pendingSentTotal: number,
  ) {
    setLoading(true);
    dbg('pending txs', pendingTxs);
    dbg('pending sent', pendingSentTotal);
    setPendingSent(pendingSentTotal);
    setLoading(false);
  }

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

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    contentContainer: {
      padding: 16,
    },
    walletHeader: {
      padding: 16,
      backgroundColor: theme.colors.primary,
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
      color: theme.colors.accent,
      textAlign: 'right',
    },
    balanceBTC: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.white,
    },
    balanceUSD: {
      fontSize: 16,
      color: theme.colors.background,
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
      color: theme.colors.textOnPrimary,
      marginTop: 8,
      textAlign: 'center',
      fontWeight: '600',
    },
    party: {
      marginBottom: 8,
      fontSize: 12,
      color: theme.colors.textOnPrimary,
      textAlign: 'center',
      fontWeight: '600',
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
      backgroundColor: theme.colors.accent,
    },
    settingsButton: {
      width: 50,
      backgroundColor: theme.colors.accent,
    },
    addressTypeModalButton: {
      width: 50,
      backgroundColor: theme.colors.cardBackground,
    },
    receiveButton: {
      flex: 1,
      backgroundColor: theme.colors.secondary,
    },
    modalOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.8)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 100,
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 12,
      padding: 20,
      width: '80%',
      alignItems: 'center',
    },
    modalText: {
      fontSize: 18,
      marginBottom: 10,
      textAlign: 'center',
      color: theme.colors.text,
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
      backgroundColor: theme.colors.cardBackground,
      padding: 16,
      borderRadius: 8,
      marginVertical: 8,
      width: '100%',
      borderWidth: 1,
      borderColor: theme.colors.border,
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
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 16,
    },
  });

  const refreshWalletData = useCallback(async () => {
    if (isRefreshing) {
      return;
    }
    try {
      setIsRefreshing(true);
      await fetchWalletBalance(true); // Force refresh
    } catch (error) {
      console.error('Error refreshing wallet data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchWalletBalance, isRefreshing]);

  useFocusEffect(
    useCallback(() => {
      if (isInitialized) {
        refreshWalletData();
      }
    }, [isInitialized, refreshWalletData]),
  );

  useEffect(() => {
    if (!isInitialized || !address) {
      return;
    }
    // Initial fetch
    fetchWalletBalance(true);

    // Set up interval for background updates
    const intervalId = setInterval(() => {
      if (hasNonZeroBalance) {
        fetchWalletBalance(false);
      }
    }, 60000);

    return () => {
      clearInterval(intervalId);
      debouncedFetch.cancel();
    };
  }, [
    isInitialized,
    address,
    fetchWalletBalance,
    hasNonZeroBalance,
    debouncedFetch,
  ]);

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
          <Text style={styles.party}>
            🗝 {capitalizeWords(party)}
            {'  '} {networkEmoji()} {capitalizeWords(network)}
            {'  '} {addressEmoji()} {capitalizeWords(addressType)}
          </Text>
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
        <TransactionList
          refreshing={isRefreshing}
          address={address}
          baseApi={apiBase}
          onUpdate={refreshWalletBalance}
          onReload={fetchWalletBalance}
        />
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
                await fetchWalletBalance(true);
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
                await fetchWalletBalance(true);
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
                await fetchWalletBalance(true);
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
