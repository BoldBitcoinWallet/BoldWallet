/* eslint-disable react-native/no-inline-styles */
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  SafeAreaView,
  Linking,
} from 'react-native';
import {NativeModules} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import EncryptedStorage from 'react-native-encrypted-storage';
import {
  CommonActions,
  RouteProp,
  useFocusEffect,
  useRoute,
} from '@react-navigation/native';
import Share from 'react-native-share';
import theme from '../theme';

const {BBMTLibNativeModule} = NativeModules;

const MobilesPairing = ({navigation}: any) => {
  const timeout = 30;
  const discoveryPort = 55055;

  const [status, setStatus] = useState('');
  const [localIP, setLocalIP] = useState<string | null>(null);
  const [localDevice, setLocalDevice] = useState<string | null>(null);
  const [peerIP, setPeerIP] = useState<string | null>(null);
  const [peerDevice, setPeerDevice] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [countdown, setCountdown] = useState(timeout);
  const [isPreParamsReady, setIsPreParamsReady] = useState(false);
  const [isKeygenReady, setIsKeygenReady] = useState(false);
  const [isKeysignReady, setIsKeysignReady] = useState(false);
  const [isPrepared, setIsPrepared] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [doingMPC, setDoingMPC] = useState(false);
  const [mpcDone, setMpcDone] = useState(false);
  const [isMaster, setIsMaster] = useState(false);

  const [prepCounter, setPrepCounter] = useState(0);
  const [keypair, setKeypair] = useState('');
  const [peerPubkey, setPeerPubkey] = useState('');
  const [data, setData] = useState('');
  const [shareName, setShareName] = useState('');

  const [keyshare, setKeyshare] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const confirmPasswordRef = useRef<TextInput>(null);

  type RouteParams = {
    mode?: string;
    toAddress: string;
    satoshiAmount: Big;
    usdAmount: Big;
    satoshiFees: Big;
    usdFees: Big;
  };

  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const isSendBitcoin = route.params?.mode === 'send_btc';
  const title = isSendBitcoin
    ? '🗝 Co-Signing Your Transaction'
    : 'Self Custody Superior Control \n Threshold Signatures Scheme Grade';

  const [checks, setChecks] = useState({
    sameNetwork: false,
    twoDevices: false,
  });

  const [backupChecks, setBackupChecks] = useState({
    deviceOne: false,
    deviceTwo: false,
  });

  const allChecked = Object.values(checks).every(Boolean);
  const allBackupChecked = Object.values(backupChecks).every(Boolean);

  const connectionAnimation = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const waitMS = (ms = 1000) => new Promise((res, _) => setTimeout(res, ms));

  const toggleBackedup = (key: keyof typeof backupChecks) => {
    setBackupChecks(prev => ({...prev, [key]: !prev[key]}));
  };

  const toggleCheck = (key: keyof typeof checks) => {
    setChecks(prev => ({...prev, [key]: !prev[key]}));
  };

  const togglePrepared = () => {
    setIsPrepared(!isPrepared);
  };

  const toggleKeygenReady = () => {
    setIsKeygenReady(!isKeygenReady);
  };

  const toggleKeysignReady = () => {
    setIsKeysignReady(!isKeysignReady);
  };

  const stringToHex = (str: string) => {
    return Array.from(str)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  };

  const hexToString = (hex: string) => {
    return ((hex || '').match(/.{1,2}/g) || [''])
      .map((byte: string) => String.fromCharCode(parseInt(byte, 16)))
      .join('');
  };

  const normalizeAlphaNumUnderscore = (input: string): string => {
    return input.replace(/[^a-zA-Z0-9]/g, '_');
  };

  const formatUSD = (price: Big) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price.toNumber());

  const sat2btcStr = (sats: Big) => sats.div(1e8).toFixed(8);

  const preparams = () => {
    setIsPreparing(true);
    setIsPreParamsReady(false);
    setPrepCounter(0);
    const path = `${RNFS.DocumentDirectoryPath}/${normalizeAlphaNumUnderscore(
      localDevice!!,
    )}.json`;
    const timeoutMinutes = 2;
    BBMTLibNativeModule.preparams(path, String(timeoutMinutes))
      .then(() => {
        setIsPreParamsReady(true);
      })
      .catch((error: any) => {
        setIsPreParamsReady(false);
        Alert.alert('Error', error?.toString() || 'Unknown error occurred');
      })
      .finally(() => {
        setIsPreparing(false);
        setPrepCounter(0);
      });
  };

  const randomSeed = (length = 32) => {
    let result = '';
    const characters = '0123456789abcdef';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  };

  const mpcTssSetup = async () => {
    try {
      setDoingMPC(true);
      setMpcDone(false);
      setPrepCounter(0);

      if (isMaster) {
        const relay = await BBMTLibNativeModule.runRelay(String(discoveryPort));
        console.log('relay start:', relay, localDevice);
      }

      await waitMS(2000);
      const ip = isMaster ? localIP : peerIP;
      const server = `http://${ip}:${discoveryPort}`;

      const partyID = isMaster ? 'KeyShare1' : 'KeyShare2';
      const peerID = isMaster ? 'KeyShare2' : 'KeyShare1';
      const partiesCSV = `${partyID},${peerID}`;
      const sessionID = await BBMTLibNativeModule.sha256(`${data}/${server}`);
      const kp = JSON.parse(keypair);
      const encKey = peerPubkey;
      const decKey = kp.privateKey;
      const sessionKey = '';
      const ppm = `${RNFS.DocumentDirectoryPath}/ppm.json`;

      setShareName(partyID);

      BBMTLibNativeModule.mpcTssSetup(
        server,
        partyID,
        ppm,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        data,
      )
        .then(async (result: any) => {
          console.log('keygen result', result.substring(0, 40));
          setKeyshare(result);
          await EncryptedStorage.setItem('keyshare', result);
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [route],
            }),
          );
          setMpcDone(true);
        })
        .catch((e: any) => {
          console.error('keygen error', e);
        })
        .finally(async () => {
          if (isMaster) {
            await waitMS(2000);
            BBMTLibNativeModule.stopRelay(localDevice);
            console.log('relay stop:', localDevice);
          }
          setDoingMPC(false);
        });
    } catch (e) {
      if (isMaster) {
        await waitMS(2000);
        BBMTLibNativeModule.stopRelay(localDevice);
        console.log('relay stop:', localDevice);
      }
      setDoingMPC(false);
    }
  };

  const runKeysign = async () => {
    setDoingMPC(true);
    setMpcDone(false);
    setPrepCounter(0);

    try {
      if (isMaster) {
        const relay = await BBMTLibNativeModule.runRelay(String(discoveryPort));
        console.log('relay start:', relay, localDevice);
      }

      await waitMS(2000);

      const server = `http://${isMaster ? localIP : peerIP}:${discoveryPort}`;

      const jks = await EncryptedStorage.getItem('keyshare');
      const ks = JSON.parse(jks || '{}');
      const path = "m/44'/0'/0'/0/0";
      const btcPub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      const btcAddress = await BBMTLibNativeModule.p2khAddress(
        btcPub,
        'testnet3',
      );
      const partyID = ks.local_party_key;
      const partiesCSV = ks.keygen_committee_keys.join(',');
      const sessionID = await BBMTLibNativeModule.sha256(`${data}/${server}`);
      const kp = JSON.parse(keypair);
      const encKey = peerPubkey;
      const decKey = kp.privateKey;
      const sessionKey = '';
      const decoded = data.split(':');
      const satoshiAmount = `${decoded[1]}`;
      const satoshiFees = `${decoded[2]}`;
      const peerShare = `${decoded[3]}`;
      if (peerShare === partyID) {
        throw 'Please Use Two Different Shares per Device';
      }
      try {
        console.log(
          partyID,
          'calling keysign with',
          JSON.stringify(
            {
              localDevice,
              server,
              partyID,
              partiesCSV,
              sessionID,
              sessionKey,
              encKey,
              decKey,
              jks: jks?.substring(0, 20) + '...',
              path,
              // BTC
              btcPub,
              btcAddress,
              toAddress: route.params.toAddress,
              satoshiAmount,
              satoshiFees,
            },
            null,
            4,
          ),
        );
      } catch (e) {
        console.error('got exception', e);
      }

      await BBMTLibNativeModule.mpcSendBTC(
        // TSS
        server,
        partyID,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        jks,
        path,
        // BTC
        btcPub,
        btcAddress,
        route.params.toAddress,
        satoshiAmount,
        satoshiFees,
      )
        .then(async (txId: any) => {
          console.log(partyID, 'txID', txId);
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{name: 'Bold Home'}],
            }),
          );
          setMpcDone(true);
        })
        .catch((e: any) => {
          Alert.alert(
            'Operation Error',
            `Could not sign and send transaction.\n${e?.message}`,
          );
          console.log(partyID, 'keysign error', e);
        })
        .finally(async () => {
          if (isMaster) {
            await waitMS(2000);
            stopRelay();
          }
          setDoingMPC(false);
        });
    } catch (e) {
      if (isMaster) {
        await waitMS(2000);
        stopRelay();
      }
      setDoingMPC(false);
    }
  };

  function stopRelay() {
    try {
      BBMTLibNativeModule.stopRelay(localDevice);
      console.log(localDevice, 'relay stop:');
    } catch (e) {
      console.log(localDevice, 'error stoping relay');
    }
  }

  async function backupShare() {
    if (!password || !confirmPassword) {
      Alert.alert(
        'Password Required',
        'Please enter and verify your password.',
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        'Password Mismatch',
        'Passwords do not match. Please try again.',
      );
      return;
    }
    try {
      const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
        keyshare,
        await BBMTLibNativeModule.sha256(password),
      );
      await Share.open({
        title: 'Backup Your Keyshare',
        isNewTask: true,
        message:
          'Save this encrypted file securely. It is required for wallet recovery.',
        url: `data:text/plain;base64,${encryptedKeyshare}`,
        type: 'text/plain',
        filename: `${shareName.toLocaleLowerCase()}_${normalizeAlphaNumUnderscore(
          new Date().toLocaleString(),
        )}.share`,
        failOnCancel: false,
      });
    } catch (error) {
      console.error('Error encrypting or sharing keyshare:', error);
      Alert.alert('Error', 'Failed to encrypt or share the keyshare.');
    }
  }

  useEffect(() => {
    if (isPreparing) {
      const interval = setInterval(() => {
        setPrepCounter(prevCounter => prevCounter + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isPreparing]);

  useEffect(() => {
    if (doingMPC) {
      const interval = setInterval(() => {
        setPrepCounter(prevCounter => prevCounter + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [doingMPC]);

  useEffect(() => {
    if (isPairing) {
      const interval = setInterval(() => {
        setCountdown(prevCount => (prevCount > 0 ? prevCount - 1 : 0));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isPairing]);

  useEffect(() => {
    if (!peerIP) {
      animationRef.current = Animated.loop(
        Animated.timing(connectionAnimation, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      );
      animationRef.current.start();
    } else {
      animationRef.current?.stop();
      Animated.timing(connectionAnimation, {
        toValue: 1,
        duration: 300,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    }
  }, [peerIP, connectionAnimation]);

  async function initiatePairing() {
    if (!allChecked) {
      return;
    }

    setIsPairing(true);
    setStatus('Fetching local IP...');
    setCountdown(timeout);

    const jkp = await BBMTLibNativeModule.eciesKeypair();
    setKeypair(jkp);

    const kp = JSON.parse(jkp);

    try {
      const ip = await BBMTLibNativeModule.getLanIp('pairing');
      const deviceName = await DeviceInfo.getDeviceName();
      setLocalDevice(deviceName);
      setStatus('Starting peer discovery...');
      const promises = [listenForPeerPromise(kp, stringToHex(deviceName))];
      if (ip) {
        setLocalIP(ip);
        discoverPeerPromise(stringToHex(deviceName), kp.publicKey, ip);
      }
      const result = await Promise.race(promises);
      if (result) {
        console.log('Got Result', result);
        const raw = result.split(',');
        console.log({deviceName, raw});
        const peerInfo = raw[0].split('@');
        const _peerIP = peerInfo[0].split(':')[0];
        setPeerIP(_peerIP);
        const _peerDevice = hexToString(peerInfo[1]);
        setPeerDevice(_peerDevice);
        const _peerPubkey = peerInfo[2];
        setPeerPubkey(_peerPubkey);
        const localInfo = raw[1].split('@');
        const _localIP = localInfo[0].split(':')[0];
        setLocalIP(_localIP);
        const thisIDs = _localIP.split(':')[0];
        const nextIDs = _peerIP.split(':')[0];
        const thisID = Number(thisIDs.split('.')[3]);
        const peerID = Number(nextIDs.split('.')[3]);
        const master = thisID > peerID;
        setIsMaster(master);

        setStatus('Devices Discovery Completed');
        await waitMS(1000);

        if (master) {
          let _data = randomSeed(64);
          if (isSendBitcoin) {
            const jks = await EncryptedStorage.getItem('keyshare');
            const ks = JSON.parse(jks || '{}');
            _data += ':' + route.params.satoshiAmount.toString();
            _data += ':' + route.params.satoshiFees.toString();
            _data += ':' + ks.local_party_key;
          }
          console.log('publishing data', _data, 'peer pubkey', _peerPubkey);
          await BBMTLibNativeModule.publishData(
            String(discoveryPort),
            String(timeout),
            _peerPubkey,
            _data,
          );
          setData(_data);
          console.log('data published');
        } else {
          await waitMS(2000);
          const peerURL = `http://${_peerIP}:${discoveryPort}`;
          const rawFetched = await BBMTLibNativeModule.fetchData(
            peerURL,
            kp.privateKey,
          );
          console.log('fetched data', rawFetched);
          setData(rawFetched);
        }
      } else {
        setStatus('Pairing timed out. Please try again.');
        Alert.alert('Pairing Timeout', 'No peer device was detected.');
      }
    } catch (error) {
      console.error('Pairing Error:', error);
      setStatus('An error occurred during pairing.');
      setPeerIP(null);
      setLocalIP(null);
      Alert.alert('Error', error?.toString() || 'Unknown error occurred');
    } finally {
      setIsPairing(false);
    }
  }

  async function listenForPeerPromise(
    kp: any,
    deviceName: string,
  ): Promise<string | null> {
    try {
      const result = await BBMTLibNativeModule.listenForPeer(
        deviceName,
        kp.publicKey,
        String(discoveryPort),
        String(timeout),
      );
      return result;
    } catch (error) {
      console.warn('ListenForPeer Error:', error);
      return null;
    }
  }

  const discoverPeerPromise = async (
    deviceName: string,
    pubkey: string,
    ip: string,
  ): Promise<string | null> => {
    const until = Date.now() + timeout;
    const discoveryTimeout = 10;
    while (Date.now() < until) {
      try {
        const result = await BBMTLibNativeModule.discoverPeer(
          deviceName,
          pubkey,
          ip,
          String(discoveryPort),
          String(discoveryTimeout),
        );
        if (result) {
          return result;
        }
      } catch (error) {
        console.warn('DiscoverPeer Error:', error);
      }
    }
    return '';
  };

  useFocusEffect(
    useCallback(() => {
      console.log('MobilesPairing screen focused');
      return () => {
        console.log('MobilesPairing screen blurred');
      };
    }, []),
  );

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flexContainer}
        behavior={'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.innerContainer}>
            {/* Checklist Section */}
            {!isPairing && !peerIP && (
              <View style={styles.informationCard}>
                <Image
                  style={{width: 128, height: 128}}
                  source={require('../assets/playstore-icon.png')}
                />
                <Text style={styles.securityText}>{title}</Text>
                <Text style={styles.checklistPairing}>
                  Please Check Before Proceeding:
                </Text>
                {[
                  {
                    key: 'twoDevices',
                    label: 'Your Two Mobiles are Nearby 📱📱',
                  },
                  {
                    key: 'sameNetwork',
                    label: "They're on the same WiFi/Hotspot 📶",
                  },
                ].map(item => (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.checkboxContainer}
                    onPress={() =>
                      toggleCheck(item.key as keyof typeof checks)
                    }>
                    <View
                      style={[
                        styles.checkbox,
                        checks[item.key as keyof typeof checks] &&
                          styles.checked,
                      ]}
                    />
                    <Text style={styles.checkboxLabel}>{item.label}</Text>
                  </TouchableOpacity>
                ))}

                {/* Pairing Button */}
                {!isPairing && !peerIP && (
                  <TouchableOpacity
                    style={
                      allChecked ? styles.pairButtonOn : styles.pairButtonOff
                    }
                    onPress={initiatePairing}
                    disabled={!allChecked}>
                    <Text style={styles.pairButtonText}>Start Pairing</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {/* Pairing Visual */}
            {!mpcDone && (isPairing || peerIP) && (
              <View style={styles.informationCard}>
                <View style={styles.deviceContainer}>
                  <View style={styles.deviceWrapper}>
                    <Image
                      source={require('../assets/phone-icon.png')}
                      style={[
                        styles.deviceIcon,
                        localIP ? styles.deviceActive : styles.deviceInactive,
                      ]}
                    />
                    {localDevice && (
                      <Text style={styles.deviceName}>{localDevice}</Text>
                    )}
                  </View>
                  <View style={styles.statusLine}>
                    <Animated.View
                      style={[
                        styles.connectionLine,
                        {
                          width: connectionAnimation.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                          backgroundColor: theme.colors.primary,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.deviceWrapper}>
                    <Image
                      source={require('../assets/phone-icon.png')}
                      style={[
                        styles.deviceIcon,
                        peerIP ? styles.deviceActive : styles.deviceInactive,
                      ]}
                    />
                    {peerIP && (
                      <Text style={styles.deviceName}>
                        {peerDevice || 'Peer Device'}
                      </Text>
                    )}
                  </View>
                </View>
                {/* Show Countdown Timer During Pairing */}
                {isPairing && !peerIP && (
                  <View style={{marginTop: 10}}>
                    <Text style={styles.statusText}>{status}</Text>
                    <Text style={styles.countdownText}>
                      Time remaining: {countdown} seconds
                    </Text>
                    <ActivityIndicator
                      size="large"
                      color={theme.colors.accent}
                      style={styles.loader}
                    />
                  </View>
                )}
              </View>
            )}
            {!isSendBitcoin && (
              <>
                {/* Preparation Panel */}
                {peerIP &&
                  ((isPreParamsReady && !mpcDone && (
                    <View style={styles.informationCard}>
                      <Text style={styles.statusText}>
                        ☑️ Device Preparation Done
                      </Text>
                    </View>
                  )) ||
                    (!isPreParamsReady && (
                      <View style={styles.informationCard}>
                        <Text style={styles.informationText}>
                          Bold Wallet implements{' '}
                          <Text
                            style={styles.termsLink}
                            onPress={() =>
                              Linking.openURL(
                                'https://www.binance.com/en/square/post/17681517589057',
                              )
                            }>
                            Multi Party Computation with Threshold Signatures
                            Scheme
                          </Text>{' '}
                          to secure your wallet 🛡. Security Parameters
                          generation on both devices is needed 📱📱 . This may
                          take seconds up to a minute given your device
                          performance.
                        </Text>
                        <TouchableOpacity
                          style={styles.checkboxContainer}
                          disabled={isPreparing}
                          onPress={() => togglePrepared()}>
                          <View
                            style={[
                              styles.checkbox,
                              isPrepared && styles.checked,
                            ]}
                          />
                          <Text style={styles.checkboxLabel}>
                            Stay in the app during this process ⚠️
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          disabled={!isPrepared || isPreparing}
                          style={
                            isPreparing
                              ? styles.hidden
                              : isPrepared
                              ? styles.clickPrepare
                              : styles.clickPrepareOff
                          }
                          onPress={preparams}>
                          <Text style={styles.clickButtonText}>
                            Prepare Device
                          </Text>
                        </TouchableOpacity>
                        {/* Show Countdown Timer During Pairing */}
                        {isPreparing && (
                          <Modal transparent={true} visible={isPreparing}>
                            <View style={styles.modalOverlay}>
                              <View style={styles.modalContent}>
                                <Text style={styles.modalText}>
                                  Preparing Please Wait...
                                </Text>
                                <ActivityIndicator
                                  size="small"
                                  color={theme.colors.primary}
                                />
                                <Text style={styles.countdownText}>
                                  Time Elapsed: {prepCounter} seconds
                                </Text>
                              </View>
                            </View>
                          </Modal>
                        )}
                      </View>
                    )))}
                {/* Device Ready Text and MPC Keygen Panel */}
                {isPreParamsReady && !mpcDone && (
                  <>
                    <View style={styles.informationCard}>
                      <Text style={styles.informationText}>
                        📱 Final Step 📱{'\n\n'}Make sure both devices are
                        ready.
                      </Text>
                      <TouchableOpacity
                        style={styles.checkboxContainer}
                        onPress={() => toggleKeygenReady()}>
                        <View
                          style={[
                            styles.checkbox,
                            isKeygenReady && styles.checked,
                          ]}
                        />
                        <Text style={styles.checkboxLabel}>
                          Stay in the app during this process ⚠️
                        </Text>
                      </TouchableOpacity>

                      {doingMPC && (
                        <Modal transparent={true} visible={doingMPC}>
                          <View style={styles.modalOverlay}>
                            <View style={styles.modalContent}>
                              <Text style={styles.modalText}>
                                Keygen Please Wait...
                              </Text>
                              <ActivityIndicator
                                size="small"
                                color={theme.colors.primary}
                              />
                              <Text style={styles.countdownText}>
                                Time Elapsed: {prepCounter} seconds
                              </Text>
                            </View>
                          </View>
                        </Modal>
                      )}

                      <TouchableOpacity
                        style={
                          isKeygenReady
                            ? styles.clickButton
                            : styles.clickButtonOff
                        }
                        disabled={!isKeygenReady}
                        onPress={mpcTssSetup}>
                        <Text style={styles.clickButtonText}>
                          Create Wallet
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                {/* Device Keyshare Info and Backup */}
                {mpcDone && (
                  <>
                    <View style={styles.informationCard}>
                      <Text style={styles.statusText}>
                        ☑️ Device Keyshare Generated.{'\n\n'}
                        Backing up your keyshares is essential for wallet
                        recovery. After generating keyshares on both devices,
                        store each one in separate, secure locations (e.g.,
                        iCloud, Google Drive, or email). This ensures no one can
                        access both keyshares at once. Remember, you’ll need
                        both to recover your wallet.
                      </Text>
                      {/* Password Input */}
                      <TextInput
                        style={styles.input}
                        placeholder="Enter Password"
                        placeholderTextColor="#888"
                        secureTextEntry
                        returnKeyType="next"
                        onSubmitEditing={() =>
                          confirmPasswordRef.current?.focus()
                        }
                        submitBehavior="submit"
                        value={password}
                        onChangeText={setPassword}
                      />
                      <TextInput
                        ref={confirmPasswordRef}
                        style={styles.input}
                        placeholder="Confirm Password"
                        placeholderTextColor="#888"
                        secureTextEntry
                        returnKeyType="done"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        onSubmitEditing={backupShare}
                      />
                      <TouchableOpacity
                        disabled={!isPrepared || isPreparing}
                        style={styles.backupButton}
                        onPress={backupShare}>
                        <Text style={styles.backupButtonText}>
                          Backup {shareName} 📤
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.statusText}>
                        🗝 Your keyshare backups are encrypted with a password
                        you create. Never forget it—recovery without it is
                        impossible.
                      </Text>
                    </View>
                  </>
                )}
                {/* Keyshare Next Wallet */}
                {mpcDone && (
                  <>
                    <View style={styles.informationCard}>
                      <Text style={styles.checklistTitle}>
                        Please Check Before Proceeding:
                      </Text>
                      {[
                        {
                          key: 'deviceOne',
                          label: `${localDevice} keyshare backup done`,
                        },
                        {
                          key: 'deviceTwo',
                          label: `${peerDevice} keyshare backup done`,
                        },
                      ].map(item => (
                        <TouchableOpacity
                          key={item.key}
                          style={styles.checkboxContainer}
                          onPress={() =>
                            toggleBackedup(
                              item.key as keyof typeof backupChecks,
                            )
                          }>
                          <View
                            style={[
                              styles.checkbox,
                              backupChecks[
                                item.key as keyof typeof backupChecks
                              ] && styles.checked,
                            ]}
                          />
                          <Text style={styles.checkboxLabel}>{item.label}</Text>
                        </TouchableOpacity>
                      ))}

                      <TouchableOpacity
                        style={
                          allBackupChecked
                            ? styles.proceedButtonOn
                            : styles.proceedButtonOff
                        }
                        onPress={() => {
                          navigation.dispatch(
                            CommonActions.reset({
                              index: 0,
                              routes: [{name: 'Bold Home'}],
                            }),
                          );
                        }}
                        disabled={!allBackupChecked}>
                        <Text style={styles.pairButtonText}>
                          Proceed To Wallet
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </>
            )}
            {peerIP && isSendBitcoin && (
              <>
                <View style={styles.informationCard}>
                  <Text style={styles.title}>📱 Dual Signing 📱</Text>
                  <Text style={styles.header}>
                    Make sure both devices are ready.
                  </Text>
                  <View style={styles.summaryRow}>
                    <Text style={styles.label}>To Address:</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text
                      style={styles.value}
                      numberOfLines={1}
                      ellipsizeMode="middle">
                      {route.params.toAddress}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.label}>BTC Amount:</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.value}>
                      {sat2btcStr(route.params.satoshiAmount)} BTC ($
                      {formatUSD(route.params.usdAmount)})
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.label}>Network Fees:</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.value}>
                      {sat2btcStr(route.params.satoshiFees)} BTC ($
                      {formatUSD(route.params.usdFees)})
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.checkboxContainer}
                    onPress={() => toggleKeysignReady()}>
                    <View
                      style={[
                        styles.checkbox,
                        isKeysignReady && styles.checked,
                      ]}
                    />
                    <Text style={styles.checkboxLabel}>
                      Stay in the app during this process ⚠️
                    </Text>
                  </TouchableOpacity>
                  {doingMPC && (
                    <Modal transparent={true} visible={doingMPC}>
                      <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                          <Text style={styles.modalText}>
                            🗝 Co-Signing Please Wait...
                          </Text>
                          <ActivityIndicator
                            size="small"
                            color={theme.colors.primary}
                          />
                          <Text style={styles.countdownText}>
                            Time Elapsed: {prepCounter} seconds
                          </Text>
                        </View>
                      </View>
                    </Modal>
                  )}
                  <TouchableOpacity
                    style={
                      isKeysignReady
                        ? styles.clickButton
                        : styles.clickButtonOff
                    }
                    disabled={!isKeysignReady}
                    onPress={runKeysign}>
                    <Text style={styles.clickButtonText}>
                      🗝 Co-Sign Transaction
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default MobilesPairing;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.primary,
  },
  flexContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  innerContainer: {
    alignItems: 'center',
    padding: 20,
  },
  termsLink: {
    color: theme.colors.accent,
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginTop: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  address: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: 'center',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: 'left',
    flex: 1,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  securityText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.colors.secondary,
    textAlign: 'center',
    marginBottom: 30,
  },
  checklistContainer: {
    alignSelf: 'stretch',
    marginBottom: 20,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.background,
    borderRadius: 10,
    elevation: 2,
    padding: 15,
  },
  checklistPairing: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: theme.colors.text,
  },
  checklistTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  checked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  checkboxLabel: {
    fontSize: 16,
    color: theme.colors.text,
    flex: 1,
  },
  deviceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 30,
  },
  deviceWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 10,
    position: 'relative',
  },
  deviceIcon: {
    width: 40,
    height: 40,
    tintColor: theme.colors.secondary,
  },
  deviceActive: {
    tintColor: theme.colors.primary,
  },
  deviceInactive: {
    tintColor: theme.colors.accent,
  },
  deviceName: {
    position: 'absolute',
    bottom: -30,
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.text,
    textAlign: 'center',
    width: 200,
  },
  statusLine: {
    width: 100,
    height: 4,
    backgroundColor: theme.colors.accent,
    marginHorizontal: 10,
    borderRadius: 2,
    overflow: 'hidden',
  },
  connectionLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.primary,
  },
  statusText: {
    fontSize: 15,
    color: theme.colors.text,
    textAlign: 'justify',
    fontWeight: 'bold',
  },
  ipText: {
    fontSize: 14,
    color: theme.colors.secondary,
    marginBottom: 5,
    textAlign: 'center',
  },
  countdownText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginVertical: 8,
    textAlign: 'center',
  },
  loader: {
    marginTop: 15,
  },
  pairButtonOn: {
    marginTop: 20,
    marginBottom: 10,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.text,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pairButtonOff: {
    opacity: 0.5,
    marginTop: 20,
    marginBottom: 10,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proceedButtonOn: {
    marginTop: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.text,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  proceedButtonOff: {
    opacity: 0.5,
    marginTop: 20,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairButtonText: {
    color: theme.colors.background,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
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
  informationCard: {
    backgroundColor: theme.colors.background,
    borderRadius: 10,
    padding: 20,
    marginVertical: 10,
    elevation: 2,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    width: '100%',
    alignItems: 'center',
  },
  informationText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: 'center',
  },
  informationLeftText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: 'left',
  },
  backupButton: {
    marginTop: 10,
    marginBottom: 10,
    backgroundColor: theme.colors.subPrimary,
    width: 200,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupButtonText: {
    color: theme.colors.background,
    fontSize: 15,
    fontWeight: 'bold',
  },
  hidden: {
    display: 'none',
  },
  clickButton: {
    marginTop: 20,
    marginBottom: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clickButtonOff: {
    opacity: 0.5,
    marginTop: 20,
    marginBottom: 20,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clickPrepare: {
    marginTop: 20,
    marginBottom: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clickPrepareOff: {
    opacity: 0.5,
    marginTop: 20,
    marginBottom: 20,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clickButtonText: {
    color: theme.colors.background,
    fontWeight: 'bold',
    fontSize: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.secondary,
    borderRadius: 8,
    padding: 6,
    width: 200,
    height: 35,
    fontSize: 16,
    backgroundColor: '#FFF',
    marginBottom: 5,
    marginTop: 10,
    textAlign: 'center',
  },
});
