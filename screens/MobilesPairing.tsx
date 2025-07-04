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
  NativeEventEmitter,
  EmitterSubscription,
  Keyboard,
} from 'react-native';
import {NativeModules} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import EncryptedStorage from 'react-native-encrypted-storage';
import * as Progress from 'react-native-progress';

import {
  CommonActions,
  RouteProp,
  StackActions,
  useFocusEffect,
  useRoute,
} from '@react-navigation/native';
import Share from 'react-native-share';
import Big from 'big.js';
import {dbg, getPinnedRemoteIP, HapticFeedback} from '../utils';
import {useTheme} from '../theme';
import {waitMS} from '../services/WalletService';
import LocalCache from '../services/LocalCache';

const {BBMTLibNativeModule} = NativeModules;

const MobilesPairing = ({navigation}: any) => {
  const timeout = 20;
  const discoveryPort = 55055;

  const [status, setStatus] = useState('');
  const [localIP, setLocalIP] = useState<string | null>(null);
  const [localID, setLocalID] = useState<string | null>(null);
  const [localDevice, setLocalDevice] = useState<string | null>(null);
  const [peerIP, setPeerIP] = useState<string | null>(null);
  const [remoteID, setRemoteID] = useState<String | null>(null);
  const [peerDevice, setPeerDevice] = useState<string | null>(null);
  const [peerParty, setPeerParty] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [countdown, setCountdown] = useState(timeout);
  const [progress, setProgress] = useState(0);
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
  const [shareName, setShareName] = useState('');

  const [keyshare, setKeyshare] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password validation states
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const {theme} = useTheme();

  type RouteParams = {
    mode?: string;
    addressType?: string;
    toAddress?: string;
    satoshiAmount?: string;
    fiatAmount?: string;
    satoshiFees?: string;
    fiatFees?: string;
    selectedCurrency?: string;
  };

  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const isSendBitcoin = route.params?.mode === 'send_btc';
  const addressType = route.params?.addressType;
  const title = isSendBitcoin
    ? '🗝 Co-Signing Your Transaction'
    : 'Self-Custody Wallet \nSuperior Security & Control \n Threshold Signatures Scheme Grade';

  const [checks, setChecks] = useState({
    sameNetwork: false,
    twoDevices: false,
  });

  const [backupChecks, setBackupChecks] = useState({
    deviceOne: false,
    deviceTwo: false,
  });

  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);

  const allChecked = Object.values(checks).every(Boolean);
  const allBackupChecked = Object.values(backupChecks).every(Boolean);

  const connectionAnimation = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

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

  // Password validation functions
  const validatePassword = (pass: string) => {
    const errors: string[] = [];
    const rules = {
      length: pass.length >= 8,
      uppercase: /[A-Z]/.test(pass),
      lowercase: /[a-z]/.test(pass),
      number: /\d/.test(pass),
      symbol: /[!@#$%^&*(),.?":{}|<>]/.test(pass),
    };

    if (!rules.length) {
      errors.push('At least 8 characters');
    }
    if (!rules.uppercase) {
      errors.push('One uppercase letter');
    }
    if (!rules.lowercase) {
      errors.push('One lowercase letter');
    }
    if (!rules.number) {
      errors.push('One number');
    }
    if (!rules.symbol) {
      errors.push('One special character');
    }
    setPasswordErrors(errors);

    // Calculate strength (0-4)
    const strength = Object.values(rules).filter(Boolean).length;
    setPasswordStrength(strength);

    return errors.length === 0;
  };

  const getPasswordStrengthColor = () => {
    if (passwordStrength <= 1) {
      return theme.colors.danger;
    }
    if (passwordStrength <= 2) {
      return '#FFA500';
    }
    if (passwordStrength <= 3) {
      return '#FFD700';
    }
    return '#4CAF50';
  };

  const getPasswordStrengthText = () => {
    if (passwordStrength <= 1) {
      return 'Very Weak';
    }
    if (passwordStrength <= 2) {
      return 'Weak';
    }
    if (passwordStrength <= 3) {
      return 'Medium';
    }
    return 'Strong';
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (text.length > 0) {
      validatePassword(text);
    } else {
      setPasswordStrength(0);
      setPasswordErrors([]);
    }
  };

  const clearBackupModal = () => {
    setPassword('');
    setConfirmPassword('');
    setPasswordVisible(false);
    setConfirmPasswordVisible(false);
    setPasswordStrength(0);
    setPasswordErrors([]);
    setIsBackupModalVisible(false);
  };

  const formatFiat = (price?: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(price));

  const sat2btcStr = (sats?: string) =>
    Big(sats || 0)
      .div(1e8)
      .toFixed(8);

  const preparams = async () => {
    setIsPreparing(true);
    setIsPreParamsReady(false);
    setPrepCounter(0);
    const timeoutMinutes = 2;
    const path = `${RNFS.DocumentDirectoryPath}/${normalizeAlphaNumUnderscore(
      localDevice!!,
    )}.json`;
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

  async function initSession() {
    try {
      dbg('initSession: Starting session initialization');
      const kp = JSON.parse(keypair);
      dbg('initSession: Parsed keypair', {publicKey: kp.publicKey});

      if (isMaster) {
        dbg('initSession: Running as master device');
        let _data = randomSeed(64);
        dbg('initSession: Generated random seed');

        if (isSendBitcoin) {
          dbg('initSession: Preparing for Bitcoin send');
          const jks = await EncryptedStorage.getItem('keyshare');
          const ks = JSON.parse(jks || '{}');
          _data += ':' + route.params.satoshiAmount;
          _data += ':' + route.params.satoshiFees;
          _data += ':' + ks.local_party_key;
          dbg('initSession: Added Bitcoin transaction data to session data');
        }

        dbg('initSession: Publishing data', {
          data: _data,
          peerPubkey,
          discoveryPort,
          timeout,
        });

        const published = await BBMTLibNativeModule.publishData(
          String(discoveryPort),
          String(timeout),
          peerPubkey,
          _data,
        );

        if (published) {
          dbg('initSession: Data published successfully', {published});
          const peerChecksum = published.replace('data=', '');
          const localPayload = `${kp.publicKey}/${route.params?.satoshiAmount}`;
          const localChecksum = await BBMTLibNativeModule.sha256(localPayload);

          dbg('initSession: Validating checksums', {
            localPayload,
            localChecksum,
            peerChecksum,
          });

          if (peerChecksum !== localChecksum) {
            dbg('initSession: Checksum validation failed');
            throw 'Make sure you\'re sending the "Same Bitcoin" amount from Both Devices';
          }

          dbg('initSession: Session initialization completed successfully');
          return _data;
        } else {
          dbg('initSession: Timeout waiting for peer device');
          throw 'Waited too long for other devices to press (Join Tx Co-Signing)';
        }
      } else {
        dbg('initSession: Running as peer device');
        const payload = `${peerPubkey}/${route.params?.satoshiAmount}`;
        const checksum = await BBMTLibNativeModule.sha256(payload);
        const peerURL = `http://${peerIP}:${discoveryPort}/`;

        dbg('initSession: Fetching data from peer', {
          payload,
          checksum,
          peerURL,
        });

        const rawFetched = await fetchData(peerURL, kp.privateKey, checksum);
        dbg('initSession: Data fetched successfully', {rawFetched});
        return rawFetched;
      }
    } catch (e: any) {
      dbg('initSession: Error occurred', {error: e});
      throw 'Error initializing session: \n' + e;
    }
  }

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

      dbg('mpcTssSetup...');
      const data = await initSession();
      dbg('got session data', data);
      if (isMaster) {
        await BBMTLibNativeModule.stopRelay('stop');
        const relay = await BBMTLibNativeModule.runRelay(String(discoveryPort));
        dbg('relay start:', relay, localDevice);
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
      setProgress(0);
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
          dbg('keygen result', result.substring(0, 40));
          setKeyshare(result);
          await EncryptedStorage.setItem('keyshare', result);
          setMpcDone(true);
          // delete ppm-file
          const ppmFile = `${RNFS.DocumentDirectoryPath}/${normalizeAlphaNumUnderscore(localDevice!!)}.json`;
          RNFS
            .unlink(ppmFile)
            .then(()=> dbg('ppmFile deleted', ppmFile))
            .catch((err: any)=> dbg('error deleting ppmFile', err));
        })
        .catch((e: any) => {
          console.error('keygen error', e);
        })
        .finally(async () => {
          if (isMaster) {
            await waitMS(2000);
            BBMTLibNativeModule.stopRelay(localDevice);
            dbg('relay stop:', localDevice);
          }
          setDoingMPC(false);
        });
    } catch (e) {
      if (isMaster) {
        await waitMS(2000);
        BBMTLibNativeModule.stopRelay(localDevice);
        dbg('relay stop:', localDevice);
      }
      setDoingMPC(false);
    }
  };

  const runKeysign = async () => {
    setDoingMPC(true);
    setMpcDone(false);
    setPrepCounter(0);

    try {
      dbg('session init...');
      const data = await initSession();

      dbg('session init done');
      if (isMaster) {
        await BBMTLibNativeModule.stopRelay('stop');
        await waitMS(2000);
        const relay = await BBMTLibNativeModule.runRelay(String(discoveryPort));
        dbg('relay start:', relay, localDevice);
      } else {
        await waitMS(3000); // Give master device time to start relay
      }

      const server = `http://${isMaster ? localIP : peerIP}:${discoveryPort}`;

      const jks = await EncryptedStorage.getItem('keyshare');
      const net = (await LocalCache.getItem('network')) || 'mainnet';
      const ks = JSON.parse(jks || '{}');
      const path = "m/44'/0'/0'/0/0";
      const btcPub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      const btcAddress = await BBMTLibNativeModule.btcAddress(
        btcPub,
        net,
        addressType,
      );
      const partyID = ks.local_party_key;
      const partiesCSV = ks.keygen_committee_keys.join(',');
      const sessionID = await BBMTLibNativeModule.sha256(`${data}/${server}`);
      const kp = JSON.parse(keypair);
      const encKey = peerPubkey;
      const decKey = kp.privateKey;
      const sessionKey = '';
      const decoded = data.split(':');
      dbg('public-decoded', decoded);
      const satoshiAmount = `${decoded[1]}`;
      const satoshiFees = `${decoded[2]}`;
      const peerShare = `${decoded[3]}`;

      dbg('starting...', {
        peerShare,
        peerParty,
        partyID,
      });

      if (peerParty === partyID) {
        throw 'Please Use "Two Different KeyShares" per Device';
      }

      if (satoshiAmount !== route.params.satoshiAmount) {
        throw 'Make sure you\'re sending the "Same Bitcoin" amount from Both Devices';
      }

      try {
        dbg(
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
      setProgress(0);
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
          dbg(partyID, 'txID', txId);
          const validTxID = /^[a-fA-F0-9]{64}$/.test(txId);
          if (!validTxID) {
            throw txId;
          }
          const pendingTxs = JSON.parse(
            (await LocalCache.getItem('pendingTxs')) || '{}',
          );
          pendingTxs[txId] = {
            txid: txId,
            from: btcAddress,
            to: route.params.toAddress,
            amount: route.params.satoshiAmount,
            satoshiAmount: route.params.satoshiAmount,
            satoshiFees: route.params.satoshiFees,
            sentAt: Date.now(),
            status: {
              confirmed: false,
              block_height: null,
            },
          };
          await LocalCache.setItem('pendingTxs', JSON.stringify(pendingTxs));
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
          dbg(partyID, 'keysign error', e);
        })
        .finally(async () => {
          if (isMaster) {
            await waitMS(2000);
            stopRelay();
          }
          setDoingMPC(false);
        });
    } catch (e: any) {
      Alert.alert('Operation Error', e?.message || e);
      dbg(localDevice, 'keysign error', e);
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
      dbg(localDevice, 'relay stop:');
    } catch (e) {
      dbg(localDevice, 'error stoping relay');
    }
  }

  async function backupShare() {
    if (!validatePassword(password)) {
      Alert.alert(
        'Weak Password',
        'Please use a stronger password that meets all requirements.',
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    try {
      const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
        keyshare,
        await BBMTLibNativeModule.sha256(password),
      );

      // Create friendly filename with date and time
      const now = new Date();
      const month = now.toLocaleDateString('en-US', {month: 'short'});
      const day = now.getDate().toString().padStart(2, '0');
      const year = now.getFullYear();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const friendlyFilename = `${shareName}.${month}${day}.${year}.${hours}${minutes}.share`;

      await Share.open({
        title: 'Backup Your Keyshare',
        isNewTask: true,
        message:
          'Save this encrypted file securely. It is required for wallet recovery.',
        url: `data:text/plain;base64,${encryptedKeyshare}`,
        type: 'text/plain',
        filename: friendlyFilename,
        failOnCancel: false,
      });
      clearBackupModal();
    } catch (error) {
      console.error('Error encrypting or sharing keyshare:', error);
      Alert.alert('Error', 'Failed to encrypt or share the keyshare.');
    }
  }

  useEffect(() => {
    let subscription: EmitterSubscription | undefined;
    const logEmitter = new NativeEventEmitter(BBMTLibNativeModule);
    let utxoRange = 0;
    let utxoIndex = 0;
    let utxoCount = 0;
    const keysignSteps = 36;
    const keygenSteps = 18;
    const processHook = (message: string) => {
      const msg = JSON.parse(message);
      if (msg.type === 'keygen') {
        if (msg.done) {
          dbg('progress - keygen done');
          setProgress(100);
          setMpcDone(true);
          // Don't navigate away, let the backup UI handle it
        } else {
          dbg(
            'progress - keygen: ',
            Math.round((100 * msg.step) / keygenSteps),
            'step',
            msg.step,
            'time',
            new Date(msg.time),
          );
          setProgress(Math.round((100 * msg.step) / keygenSteps));
        }
      } else if (msg.type === 'btc_send') {
        if (msg.done) {
          setProgress(100);
        }
        if (msg.utxo_total > 0) {
          utxoCount = msg.utxo_total;
          utxoIndex = msg.utxo_current;
          utxoRange = 100 / utxoCount;
          dbg('progress send_btc', {
            utxoCount,
            utxoIndex,
            utxoRange,
          });
        }
      } else if (msg.type === 'keysign') {
        const prgUTXO = (utxoIndex - 1) * utxoRange;
        dbg(
          'progress - keysign: ',
          Math.round(prgUTXO + (utxoRange * msg.step) / keysignSteps),
          'prgUTXO',
          prgUTXO,
          'step',
          msg.step,
          'range',
          utxoRange,
          'time',
          new Date(msg.time),
        );
        setProgress(
          Math.round(prgUTXO + (utxoRange * msg.step) / keysignSteps),
        );
      }
    };
    if (Platform.OS === 'android') {
      subscription = logEmitter.addListener('BBMT_DROID', async log => {
        if (log.tag === 'TssHook') {
          processHook(log.message);
        }
      });
    }
    if (Platform.OS === 'ios') {
      subscription = logEmitter.addListener('BBMT_APPLE', async log => {
        if (log.tag === 'TssHook') {
          processHook(log.message);
        }
      });
    }
    return () => {
      subscription?.remove();
    };
  }, []);

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
    const jks = await EncryptedStorage.getItem('keyshare');
    const ks = JSON.parse(jks || '{}');
    const localShare = ks.local_party_key;
    try {
      dbg('checking lanIP given pinnedRemote', getPinnedRemoteIP());
      const ip = await BBMTLibNativeModule.getLanIp(getPinnedRemoteIP());
      dbg('device local lanIP', ip);
      const deviceName = await DeviceInfo.getDeviceName();
      setLocalDevice(deviceName);
      setStatus('Starting peer discovery...');
      await LocalCache.setItem('peerFound', '');
      const promises = [
        listenForPeerPromise(
          kp,
          stringToHex(`${deviceName}@${ks.local_party_key}`),
        ),
      ];
      if (ip) {
        setLocalIP(ip);
        setLocalID(
          (await BBMTLibNativeModule.sha256(`${deviceName}${ip}`))
            .substring(0, 4)
            .toUpperCase(),
        );
        promises.push(
          discoverPeerPromise(
            stringToHex(`${deviceName}@${ks.local_party_key}`),
            kp.publicKey,
            ip,
          ),
        );
      }

      let until = Date.now() + timeout * 1000;
      let result = await Promise.race(promises);
      while (!result && Date.now() < until) {
        dbg('checking peer...');
        result = await LocalCache.getItem('peerFound');
        if (result) {
          dbg('checking peer ok...');
          break;
        } else {
          await waitMS(1000);
        }
      }

      dbg('promise race result:', result);
      if (result) {
        dbg('Got Result', result);
        const raw = result.split(',');
        dbg('raw', {deviceName, raw});

        const peerInfo = raw[0].split('@');
        const _peerIP = peerInfo[0].split(':')[0];
        setPeerIP(_peerIP);
        const _peerDevicePartyID = hexToString(peerInfo[1]).split('@');
        const _peerDevice = _peerDevicePartyID[0];
        const _peerParty = _peerDevicePartyID[1];
        setRemoteID(
          (await BBMTLibNativeModule.sha256(`${_peerDevice}${_peerIP}`))
            .substring(0, 4)
            .toUpperCase(),
        );
        setPeerDevice(_peerDevice);
        setPeerParty(_peerParty);
        if (localShare && _peerParty && localShare === _peerParty) {
          throw 'Please Use Two Different KeyShares per Device';
        }

        const _peerPubkey = peerInfo[2];
        setPeerPubkey(_peerPubkey);

        const localInfo = raw[1].split('@');
        const _localIP = localInfo[0].split(':')[0];
        setLocalIP(_localIP);
        setLocalID(
          (await BBMTLibNativeModule.sha256(`${deviceName}${_localIP}`))
            .substring(0, 4)
            .toUpperCase(),
        );
        const thisIDs = _localIP.split(':')[0];
        const nextIDs = _peerIP.split(':')[0];
        const thisID = Number(thisIDs.split('.')[3]);
        const peerID = Number(nextIDs.split('.')[3]);
        const master = thisID > peerID;
        setIsMaster(master);
        setStatus('Devices Discovery Completed');
        await Promise.allSettled(promises).then(() =>
          LocalCache.removeItem('peerFound'),
        );
      } else {
        setStatus('Pairing timed out. Please try again.');
        Alert.alert('Pairing Timeout', 'No peer device was detected.');
        navigation.dispatch(StackActions.replace('📱📱 Pairing', route.params));
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

  async function fetchData(
    peerURL: string,
    privateKey: string,
    checksum: string,
  ) {
    const until = Date.now() + timeout * 1000;
    while (Date.now() < until) {
      try {
        const rawFetched = await BBMTLibNativeModule.fetchData(
          peerURL,
          privateKey,
          checksum,
        );
        if (rawFetched) {
          dbg('rawFetched:', rawFetched);
          return rawFetched;
        } else {
          dbg('emptydata, retrying...');
          await waitMS(2000);
        }
      } catch (e) {}
    }
    throw 'Waited too long for other devices to press (Start Tx Co-Signing)';
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
      await LocalCache.setItem('peerFound', result);
      return result;
    } catch (error) {
      dbg('ListenForPeer Error:', error);
      return null;
    }
  }

  function isSameSubnet(
    ip1: string,
    ip2: string,
    subnetMask = '255.255.255.0',
  ) {
    const ipToInt = (ip: string) =>
      // eslint-disable-next-line no-bitwise
      ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);

    const maskInt = ipToInt(subnetMask);
    // eslint-disable-next-line no-bitwise
    return (ipToInt(ip1) & maskInt) === (ipToInt(ip2) & maskInt);
  }

  async function discoverPeerPromise(
    deviceName: string,
    pubkey: string,
    ip: string,
  ): Promise<string | null> {
    const until = Date.now() + timeout * 1000;
    const discoveryTimeout = 3;
    let backOff = 1;
    const pinnedIP = getPinnedRemoteIP();
    dbg('ips', {
      pinnedIP,
      ip,
    });
    while (Date.now() < until) {
      try {
        let peerFound = await LocalCache.getItem('peerFound');
        if (peerFound) {
          dbg('discoverPeer already found');
          return peerFound;
        }
        backOff *= 2;
        const result = await BBMTLibNativeModule.discoverPeer(
          deviceName,
          pubkey,
          ip,
          isSameSubnet(ip, pinnedIP) ? pinnedIP : '',
          String(discoveryPort),
          String(discoveryTimeout + backOff),
        );
        if (result) {
          dbg('discoverPeer result', result);
          await LocalCache.setItem('peerFound', result);
          return result;
        }
      } catch (error) {
        dbg('DiscoverPeer Error:', error);
      }
    }
    dbg('discoverPeer ended');
    return '';
  }

  useFocusEffect(
    useCallback(() => {
      dbg('MobilesPairing screen focused');
      return () => {
        dbg('MobilesPairing screen blurred');
      };
    }, []),
  );

  const styles = StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.primary,
    },
    flexContainer: {
      flex: 1,
    },
    scrollContent: {
      paddingBottom: 8,
    },
    innerContainer: {
      alignItems: 'stretch',
      padding: 10,
    },
    retryButton: {
      marginTop: 28,
      alignSelf: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      shadowColor: theme.colors.text,
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
    },
    retryLink: {
      color: theme.colors.background,
      fontWeight: '700',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      fontSize: 17,
      marginLeft: 8,
    },
    termsLink: {
      color: theme.colors.accent,
      fontWeight: '600',
      textDecorationLine: 'underline',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    header: {
      fontSize: 24,
      fontWeight: '700',
      color: theme.colors.text,
      marginTop: 16,
      marginBottom: 16,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    label: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    address: {
      fontSize: 13,
      color: theme.colors.text,
      textAlign: 'left',
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    value: {
      fontSize: 17,
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.colors.text,
      marginBottom: 14,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    pairingHint: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.secondary,
      textAlign: 'center',
      marginBottom: 12,
      marginTop: 12,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    securityText: {
      fontSize: 24,
      fontWeight: '700',
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 16,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    checklistContainer: {
      alignSelf: 'stretch',
      marginBottom: 10,
      paddingHorizontal: 8,
      backgroundColor: theme.colors.white,
      borderRadius: 8,
      elevation: 1,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    checklistPairing: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 10,
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    checklistTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginBottom: 10,
    },
    checkboxContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: theme.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
      backgroundColor: theme.colors.background,
    },
    checked: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    checkboxLabel: {
      fontSize: 17,
      color: theme.colors.text,
      flex: 1,
      fontWeight: '500',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    deviceContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      marginBottom: 16,
    },
    deviceWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 6,
      position: 'relative',
    },
    deviceIcon: {
      width: 32,
      height: 32,
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
      bottom: -32,
      fontSize: 12,
      fontWeight: '500',
      color: theme.colors.text,
      textAlign: 'center',
      width: 120,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    statusLine: {
      width: 60,
      height: 3,
      backgroundColor: theme.colors.accent,
      marginHorizontal: 6,
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
      fontSize: 18,
      color: theme.colors.text,
      textAlign: 'center',
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    ipText: {
      fontSize: 12,
      color: theme.colors.secondary,
      marginBottom: 3,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    countdownText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginVertical: 6,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    loader: {
      marginTop: 10,
    },
    pairButtonOn: {
      marginTop: 12,
      marginBottom: 8,
      backgroundColor: theme.colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: theme.colors.text,
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
      width: '100%',
      alignSelf: 'center',
    },
    pairButtonOff: {
      opacity: 0.5,
      marginTop: 12,
      marginBottom: 8,
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingVertical: 14,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
    },
    proceedButtonOn: {
      marginTop: 12,
      backgroundColor: theme.colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: theme.colors.text,
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
      width: '100%',
      alignSelf: 'center',
    },
    proceedButtonOff: {
      opacity: 0.5,
      marginTop: 12,
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingVertical: 14,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
    },
    pairButtonText: {
      color: theme.colors.background,
      fontSize: 18,
      fontWeight: '700',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
    },
    modalContent: {
      backgroundColor: theme.colors.white,
      borderRadius: 12,
      padding: 18,
      width: '92%',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.12,
      shadowRadius: 2,
      elevation: 3,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    modalIcon: {
      width: 18,
      height: 18,
      marginRight: 6,
      tintColor: theme.colors.primary,
    },
    modalTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    modalDescription: {
      fontSize: 17,
      color: theme.colors.textSecondary,
      marginBottom: 12,
      textAlign: 'center',
      lineHeight: 22,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    passwordContainer: {
      width: '100%',
      marginBottom: 10,
    },
    passwordLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 2,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    passwordInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 5,
      backgroundColor: theme.colors.cardBackground,
      minHeight: 36,
    },
    passwordInput: {
      flex: 1,
      padding: 7,
      fontSize: 14,
      color: theme.colors.text,
      minHeight: 36,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    eyeButton: {
      padding: 7,
    },
    eyeIcon: {
      width: 15,
      height: 15,
      tintColor: theme.colors.textSecondary,
    },
    strengthContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 3,
      marginBottom: 3,
    },
    strengthBar: {
      flex: 1,
      height: 4,
      backgroundColor: theme.colors.border,
      borderRadius: 2,
      marginRight: 6,
      overflow: 'hidden',
    },
    strengthFill: {
      height: '100%',
      borderRadius: 2,
    },
    strengthText: {
      fontSize: 11,
      fontWeight: '600',
      minWidth: 36,
      textAlign: 'right',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    requirementsContainer: {
      marginTop: 2,
    },
    requirementText: {
      fontSize: 11,
      color: theme.colors.textSecondary,
      marginBottom: 1,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    errorInput: {
      borderColor: theme.colors.danger,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: 11,
      marginTop: 2,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 12,
      gap: 6,
    },
    modalButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 5,
      alignItems: 'center',
    },
    cancelButton: {
      backgroundColor: theme.colors.secondary,
    },
    confirmButton: {
      backgroundColor: theme.colors.primary,
    },
    buttonText: {
      fontSize: 18,
      fontWeight: '700',
      color: '#ffffff',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    buttonIcon: {
      width: 15,
      height: 15,
      marginRight: 4,
    },
    disabledButton: {
      backgroundColor: theme.colors.disabled,
    },
    informationCard: {
      backgroundColor: theme.colors.white,
      borderRadius: 8,
      padding: 16,
      marginVertical: 6,
      elevation: 1,
      shadowOpacity: 0.06,
      shadowRadius: 2,
      width: '100%',
      alignItems: 'stretch',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    informationText: {
      fontSize: 17,
      color: theme.colors.text,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginBottom: 10,
    },
    hidden: {
      display: 'none',
    },
    clickPrepare: {
      marginTop: 10,
      marginBottom: 10,
      backgroundColor: theme.colors.primary,
      borderRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clickPrepareOff: {
      opacity: 0.5,
      marginTop: 10,
      marginBottom: 10,
      backgroundColor: theme.colors.accent,
      borderRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clickButtonText: {
      color: theme.colors.background,
      fontWeight: '700',
      fontSize: 16,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    modalText: {
      fontSize: 18,
      marginBottom: 8,
      textAlign: 'center',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    backupButton: {
      marginTop: 8,
      marginBottom: 8,
      backgroundColor: theme.colors.subPrimary,
      width: '100%',
      borderRadius: 8,
      paddingVertical: 14,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
    },
    backupButtonText: {
      color: theme.colors.background,
      fontSize: 18,
      fontWeight: '700',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    clickButton: {
      marginTop: 12,
      marginBottom: 12,
      backgroundColor: theme.colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
    },
    clickButtonOff: {
      opacity: 0.5,
      marginTop: 12,
      marginBottom: 12,
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingVertical: 14,
      paddingHorizontal: 22,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
    },
    modalSubtitle: {
      fontSize: 13,
      color: '#666',
      marginBottom: 10,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    progressCircle: {
      marginBottom: 10,
    },
    progressText: {
      fontSize: 18,
      color: '#333',
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    transactionDetails: {
      padding: 8,
      paddingTop: 0,
      width: '100%',
    },
    transactionItem: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.secondary + '10',
    },
    transactionLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.secondary,
      marginTop: 3,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    addressContainer: {
      backgroundColor: theme.colors.background,
      padding: 5,
      borderRadius: 4,
    },
    addressValue: {
      fontSize: 13,
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    amountContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
      padding: 5,
      borderRadius: 4,
    },
    amountValue: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    fiatValue: {
      fontSize: 11,
      color: theme.colors.secondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.secondary,
      borderRadius: 6,
      padding: 4,
      width: 140,
      height: 28,
      fontSize: 13,
      color: 'black',
      marginBottom: 3,
      marginTop: 6,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
  });

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
                <View
                  style={{
                    backgroundColor: '#fff',
                    padding: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Image
                    style={{width: 100, height: 100}}
                    source={require('../assets/playstore-icon.png')}
                  />
                </View>
                <Text
                  style={[
                    styles.securityText,
                    {fontSize: 18, fontWeight: 'bold'},
                  ]}>
                  {title}
                </Text>
                <Text style={styles.checklistPairing}>Check to Start:</Text>
                {[
                  {
                    key: 'twoDevices',
                    label: 'Both phones are nearby 📱📱',
                  },
                  {
                    key: 'sameNetwork',
                    label: 'Both using same WiFi / hotspot 📶',
                  },
                ].map(item => (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.checkboxContainer}
                    onPress={() => {
                      HapticFeedback.medium();
                      toggleCheck(item.key as keyof typeof checks);
                    }}>
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
                <Text style={styles.pairingHint}>
                  Tip: For best security and reliability, use one phone as a
                  hotspot and connect the other to it.
                </Text>
                {/* Pairing Button */}
                {!isPairing && !peerIP && (
                  <TouchableOpacity
                    style={
                      allChecked ? styles.pairButtonOn : styles.pairButtonOff
                    }
                    onPress={() => {
                      HapticFeedback.medium();
                      initiatePairing();
                    }}
                    disabled={!allChecked}>
                    <View style={styles.buttonContent}>
                      <Image
                        source={require('../assets/pair-icon.png')}
                        style={{
                          width: 22,
                          height: 22,
                          marginRight: 8,
                          tintColor: '#fff',
                        }}
                        resizeMode="contain"
                      />
                      <Text style={styles.pairButtonText}>Pair Devices</Text>
                    </View>
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
                      <Text style={styles.deviceName}>
                        {localDevice}
                        {'\n'}
                        {localID}
                      </Text>
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
                        {'\n'}
                        {remoteID}
                      </Text>
                    )}
                  </View>
                </View>
                {/* Show Countdown Timer During Pairing */}
                {isPairing && !peerIP && (
                  <View style={{marginTop: 20}}>
                    <Text style={styles.statusText}>{status}</Text>
                    <Text style={styles.countdownText}>
                      {countdown}s left to connect
                    </Text>
                  </View>
                )}
                {peerIP && (
                  <>
                    <TouchableOpacity
                      style={styles.retryButton}
                      onPress={() => {
                        HapticFeedback.light();
                        navigation.dispatch(
                          StackActions.replace('📱📱 Pairing', route.params),
                        );
                      }}>
                      <Image
                        source={require('../assets/refresh-icon.png')}
                        style={{
                          width: 22,
                          height: 22,
                          tintColor: theme.colors.background,
                        }}
                        resizeMode="contain"
                      />
                      <Text style={styles.retryLink}>Start Over</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {!isSendBitcoin && (
              <>
                {/* Preparation Panel */}
                {peerIP &&
                  ((isPreParamsReady && !mpcDone && (
                    <View style={styles.informationCard}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <Image
                          source={require('../assets/success-icon.png')}
                          style={{
                            width: 22,
                            height: 22,
                            marginRight: 8,
                            tintColor: theme.colors.primary,
                          }}
                          resizeMode="contain"
                        />
                        <Text style={styles.statusText}>
                          Device Preparation Done
                        </Text>
                      </View>
                    </View>
                  )) ||
                    (!isPreParamsReady && (
                      <View style={styles.informationCard}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.colors.cardBackground,
                            borderRadius: 16,
                            padding: 16,
                            marginBottom: 18,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            shadowColor: theme.colors.text,
                            shadowOpacity: 0.04,
                            shadowRadius: 2,
                            elevation: 1,
                          }}>
                          <View
                            style={{
                              width: 54,
                              height: 54,
                              borderRadius: 27,
                              backgroundColor: theme.colors.primary,
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginRight: 16,
                            }}>
                            <Image
                              source={require('../assets/security-icon.png')}
                              style={{width: 32, height: 32, tintColor: '#fff'}}
                              resizeMode="contain"
                            />
                          </View>
                          <View style={{flex: 1}}>
                            <Text
                              style={{
                                fontSize: 18,
                                fontWeight: '700',
                                color: theme.colors.text,
                                marginBottom: 2,
                              }}>
                              Bold uses Threshold Signatures
                            </Text>
                            <Text
                              style={{
                                fontSize: 14,
                                color: theme.colors.textSecondary,
                                lineHeight: 20,
                              }}>
                              Both phones must generate security parameters.{' '}
                              <Text
                                style={{
                                  color: theme.colors.accent,
                                  textDecorationLine: 'underline',
                                }}
                                onPress={() => {
                                  HapticFeedback.light();
                                  Linking.openURL(
                                    'https://www.binance.com/en/square/post/17681517589057',
                                  );
                                }}>
                                Learn more
                              </Text>
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.informationText}>
                          Bold Wallet may need up to a minute, and that's up to
                          your device cpu performance.
                        </Text>
                        <TouchableOpacity
                          style={styles.checkboxContainer}
                          disabled={isPreparing}
                          onPress={() => {
                            HapticFeedback.medium();
                            togglePrepared();
                          }}>
                          <View
                            style={[
                              styles.checkbox,
                              isPrepared && styles.checked,
                            ]}
                          />
                          <Text style={styles.checkboxLabel}>
                            Keep app open during setup
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
                          onPress={() => {
                            HapticFeedback.medium();
                            preparams();
                          }}>
                          <View style={styles.buttonContent}>
                            <Image
                              source={require('../assets/prepare-icon.png')}
                              style={{
                                width: 20,
                                height: 20,
                                marginRight: 8,
                                tintColor: '#fff',
                              }}
                              resizeMode="contain"
                            />
                            <Text style={styles.clickButtonText}>Prepare</Text>
                          </View>
                        </TouchableOpacity>
                        {/* Show Countdown Timer During Pairing */}
                        {isPreparing && (
                          <Modal transparent={true} visible={isPreparing}>
                            <View style={styles.modalOverlay}>
                              <View style={styles.modalContent}>
                                <Text style={styles.modalText}>
                                  Preparing, please stay in the app...
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
                        📱 Final Step: Both phones must be ready.
                      </Text>
                      <TouchableOpacity
                        style={styles.checkboxContainer}
                        onPress={() => {
                          HapticFeedback.medium();
                          toggleKeygenReady();
                        }}>
                        <View
                          style={[
                            styles.checkbox,
                            isKeygenReady && styles.checked,
                          ]}
                        />
                        <Text style={styles.checkboxLabel}>
                          Keep this app open during setup ⚠️
                        </Text>
                      </TouchableOpacity>

                      {doingMPC && (
                        <Modal
                          transparent={true}
                          visible={doingMPC}
                          animationType="fade">
                          <View style={styles.modalOverlay}>
                            <View style={styles.modalContent}>
                              {/* Header Text */}
                              <Text style={styles.modalTitle}>
                                Finalizing Your Wallet
                              </Text>

                              {/* Subtext */}
                              <Text style={styles.modalSubtitle}>
                                Please stay in the app...
                              </Text>

                              {/* Circular Progress */}
                              <Progress.Circle
                                size={60}
                                progress={progress / 100}
                                thickness={6}
                                color={theme.colors.primary}
                                unfilledColor="#e0e0e0"
                                borderWidth={0}
                                showsText={true}
                                style={styles.progressCircle}
                              />

                              {/* Progress and Countdown */}
                              <Text style={styles.progressText}>
                                ⏲ {prepCounter} sec
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
                        onPress={() => {
                          HapticFeedback.medium();
                          mpcTssSetup();
                        }}>
                        <View style={styles.buttonContent}>
                          <Image
                            source={
                              isMaster
                                ? require('../assets/start-icon.png')
                                : require('../assets/join-icon.png')
                            }
                            style={{
                              width: 20,
                              height: 20,
                              marginRight: 8,
                              tintColor: '#fff',
                            }}
                            resizeMode="contain"
                          />
                          <Text style={styles.clickButtonText}>
                            {isMaster ? 'Start' : 'Join'} Setup
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                {/* Device Keyshare Info and Backup */}
                {mpcDone && (
                  <>
                    <View style={styles.informationCard}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}>
                        <Image
                          source={require('../assets/success-icon.png')}
                          style={{
                            width: 28,
                            height: 28,
                            marginRight: 10,
                            tintColor: theme.colors.secondary,
                          }}
                          resizeMode="contain"
                        />
                        <Text
                          style={[
                            styles.statusText,
                            {fontWeight: 'bold', fontSize: 20},
                          ]}>
                          Keyshare Created!
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.statusText,
                          {
                            fontWeight: '400',
                            fontSize: 15,
                            color: theme.colors.textSecondary,
                          },
                        ]}>
                        Back up your keyshare now. Store each phone's keyshare
                        in a different, secure place (such as separate clouds,
                        drives, or emails). Do not store both keyshares in the
                        same location—if someone gains access to both, your
                        wallet can be compromised. Keeping them separate
                        prevents a single point of failure.
                      </Text>

                      <TouchableOpacity
                        style={styles.backupButton}
                        onPress={() => {
                          HapticFeedback.medium();
                          setIsBackupModalVisible(true);
                        }}>
                        <View style={styles.buttonContent}>
                          <Image
                            source={require('../assets/upload-icon.png')}
                            style={[styles.buttonIcon, {tintColor: '#ffffff'}]}
                            resizeMode="contain"
                          />
                          <Text style={styles.backupButtonText}>
                            Backup {shareName}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                {/* Keyshare Next Wallet */}
                {mpcDone && (
                  <>
                    <View style={styles.informationCard}>
                      <Text style={styles.checklistTitle}>
                        Confirm Backups:
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
                          onPress={() => {
                            HapticFeedback.medium();
                            toggleBackedup(
                              item.key as keyof typeof backupChecks,
                            );
                          }}>
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
                          HapticFeedback.medium();
                          navigation.dispatch(
                            CommonActions.reset({
                              index: 0,
                              routes: [{name: 'Bold Home'}],
                            }),
                          );
                        }}
                        disabled={!allBackupChecked}>
                        <View style={styles.buttonContent}>
                          <Image
                            source={require('../assets/prepare-icon.png')}
                            style={{
                              width: 20,
                              height: 20,
                              marginRight: 8,
                              tintColor: '#fff',
                            }}
                            resizeMode="contain"
                          />
                          <Text style={styles.pairButtonText}>Continue</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </>
            )}
            {peerIP && isSendBitcoin && (
              <>
                <View style={styles.informationCard}>
                  <Text style={styles.title}>📱 Dual Signing</Text>
                  <Text style={styles.header}>Both phones must be ready.</Text>
                  <View style={styles.transactionDetails}>
                    <View style={styles.transactionItem}>
                      <Text style={styles.transactionLabel}>Recipient</Text>
                      <View style={styles.addressContainer}>
                        <Text
                          style={styles.addressValue}
                          numberOfLines={1}
                          ellipsizeMode="middle">
                          {route.params.toAddress}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.transactionItem}>
                      <Text style={styles.transactionLabel}>Amount</Text>
                      <View style={styles.amountContainer}>
                        <Text style={styles.amountValue}>
                          {sat2btcStr(route.params.satoshiAmount)} BTC
                        </Text>
                        <Text style={styles.fiatValue}>
                          {route.params.selectedCurrency}{' '}
                          {formatFiat(route.params.fiatAmount)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.transactionItem}>
                      <Text style={styles.transactionLabel}>Fee</Text>
                      <View style={styles.amountContainer}>
                        <Text style={styles.amountValue}>
                          {sat2btcStr(route.params.satoshiFees)} BTC
                        </Text>
                        <Text style={styles.fiatValue}>
                          {route.params.selectedCurrency}{' '}
                          {formatFiat(route.params.fiatFees)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.checkboxContainer}
                    onPress={() => {
                      HapticFeedback.medium();
                      toggleKeysignReady();
                    }}>
                    <View
                      style={[
                        styles.checkbox,
                        isKeysignReady && styles.checked,
                      ]}
                    />
                    <Text style={styles.checkboxLabel}>
                      Keep this app open during signing ⚠️
                    </Text>
                  </TouchableOpacity>
                  {doingMPC && (
                    <Modal
                      transparent={true}
                      visible={doingMPC}
                      animationType="fade">
                      <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                          {/* Header Text */}
                          <Text style={styles.modalTitle}>
                            🗝 Co-Signing Transaction
                          </Text>

                          {/* Subtext */}
                          <Text style={styles.modalSubtitle}>
                            Please stay in the app...
                          </Text>

                          {/* Circular Progress */}
                          <Progress.Circle
                            size={60}
                            progress={progress / 100} // Assuming progress is 0-100
                            thickness={6}
                            color={theme.colors.primary}
                            unfilledColor="#e0e0e0"
                            borderWidth={0}
                            showsText={true} // We'll show custom text below
                            style={styles.progressCircle}
                          />

                          {/* Progress and Countdown */}
                          <Text style={styles.progressText}>
                            ⏲ {prepCounter} sec
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
                    onPress={() => {
                      HapticFeedback.medium();
                      runKeysign();
                    }}>
                    <View style={styles.buttonContent}>
                      <Image
                        source={
                          isMaster
                            ? require('../assets/start-icon.png')
                            : require('../assets/join-icon.png')
                        }
                        style={{
                          width: 20,
                          height: 20,
                          marginRight: 8,
                          tintColor: '#fff',
                        }}
                        resizeMode="contain"
                      />
                      <Text style={styles.clickButtonText}>
                        🗝 {isMaster ? 'Start' : 'Join'} Co-Signing
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Backup Modal */}
      <Modal
        visible={isBackupModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={clearBackupModal}>
        <KeyboardAvoidingView
          style={{flex: 1}}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => {
              HapticFeedback.light();
              Keyboard.dismiss();
            }}>
            <TouchableOpacity
              style={styles.modalContent}
              activeOpacity={1}
              onPress={() => {
                HapticFeedback.light();
              }}>
              <View style={styles.modalHeader}>
                <Image
                  source={require('../assets/backup-icon.png')}
                  style={styles.modalIcon}
                  resizeMode="contain"
                />
                <Text style={styles.modalTitle}>Backup Keyshare</Text>
              </View>
              <Text style={styles.modalDescription}>
                Save an encrypted backup of your keyshare. Use a strong
                password.
              </Text>

              <View style={styles.passwordContainer}>
                <Text style={styles.passwordLabel}>Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Enter password"
                    placeholderTextColor="#888"
                    secureTextEntry={!passwordVisible}
                    value={password}
                    onChangeText={handlePasswordChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => {
                      HapticFeedback.medium();
                      setPasswordVisible(!passwordVisible);
                    }}>
                    <Image
                      source={
                        passwordVisible
                          ? require('../assets/eye-off-icon.png')
                          : require('../assets/eye-on-icon.png')
                      }
                      style={styles.eyeIcon}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>

                {/* Password Strength Indicator */}
                {password.length > 0 && (
                  <View style={styles.strengthContainer}>
                    <View style={styles.strengthBar}>
                      <View
                        style={[
                          styles.strengthFill,
                          {
                            width: `${(passwordStrength / 4) * 100}%`,
                            backgroundColor: getPasswordStrengthColor(),
                          },
                        ]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.strengthText,
                        {color: getPasswordStrengthColor()},
                      ]}>
                      {getPasswordStrengthText()}
                    </Text>
                  </View>
                )}

                {/* Password Requirements */}
                {passwordErrors.length > 0 && (
                  <View style={styles.requirementsContainer}>
                    {passwordErrors.map((error, index) => (
                      <Text key={index} style={styles.requirementText}>
                        • {error}
                      </Text>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.passwordContainer}>
                <Text style={styles.passwordLabel}>Confirm Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={[
                      styles.passwordInput,
                      confirmPassword.length > 0 &&
                        password !== confirmPassword &&
                        styles.errorInput,
                    ]}
                    placeholder="Re-enter password"
                    placeholderTextColor="#888"
                    secureTextEntry={!confirmPasswordVisible}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => {
                      HapticFeedback.medium();
                      setConfirmPasswordVisible(!confirmPasswordVisible);
                    }}>
                    <Image
                      source={
                        confirmPasswordVisible
                          ? require('../assets/eye-off-icon.png')
                          : require('../assets/eye-on-icon.png')
                      }
                      style={styles.eyeIcon}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <Text style={styles.errorText}>Passwords do not match</Text>
                )}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    HapticFeedback.medium();
                    clearBackupModal();
                  }}>
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.confirmButton,
                    (!password ||
                      !confirmPassword ||
                      password !== confirmPassword ||
                      passwordStrength < 3) &&
                      styles.disabledButton,
                  ]}
                  onPress={() => {
                    HapticFeedback.medium();
                    backupShare();
                  }}
                  disabled={
                    !password ||
                    !confirmPassword ||
                    password !== confirmPassword ||
                    passwordStrength < 3
                  }>
                  <View style={styles.buttonContent}>
                    <Image
                      source={require('../assets/upload-icon.png')}
                      style={[styles.buttonIcon, {tintColor: '#ffffff'}]}
                      resizeMode="contain"
                    />
                    <Text style={styles.buttonText}>Backup</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

export default MobilesPairing;
