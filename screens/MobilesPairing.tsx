/* eslint-disable react-native/no-inline-styles */
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Image,
  TouchableOpacity,
  Animated,
  Easing,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
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
import {SafeAreaView} from 'react-native-safe-area-context';
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
  const ppmFile = `${RNFS.DocumentDirectoryPath}/ppm.json`;

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

  // Animation ref for horizontal progress bar
  const progressAnimation = useRef(new Animated.Value(0)).current;

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
    : 'Securely Pairing Your Devices';

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

  const deletePreparams = async () => {
    try {
      dbg(`deleting ppmFile: ${ppmFile}`);
      await RNFS.unlink(ppmFile);
      dbg('ppmFile deleted');
    } catch (err: any) {
      dbg('error deleting ppmFile', err);
    }
  };

  // Password validation functions (match WalletSettings rules)
  const validatePassword = (pass: string) => {
    const errors: string[] = [];
    const rules = {
      length: pass.length >= 12,
      uppercase: /[A-Z]/.test(pass),
      lowercase: /[a-z]/.test(pass),
      number: /\d/.test(pass),
      symbol: /[!@#$%^&*(),.?":{}|<>]/.test(pass),
    };

    if (!rules.length) {
      errors.push('At least 12 characters');
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
    await deletePreparams();
    BBMTLibNativeModule.preparams(ppmFile, String(timeoutMinutes))
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
    } catch (error: any) {
      dbg('initSession: Error occurred', {error});
      throw 'Error initializing session: \n' + error;
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

      setShareName(partyID);
      setProgress(0);
      BBMTLibNativeModule.mpcTssSetup(
        server,
        partyID,
        ppmFile,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        data,
      )
        .then(async (result: any) => {
          dbg('keygen result', result.substring(0, 40).concat('...'));
          setKeyshare(result);


          // validate keyshare
          try {
            const ks = JSON.parse(result);
            if (!ks.pub_key) {
              throw 'Error: pub_key or chain_code_hex not found in keyshare';
            }
            dbg('Party loaded', ks.local_party_key);
          } catch (error) {
            dbg('Error parsing keyshare:', error);
            throw 'Error: Invalid keyshare';
          }

          await EncryptedStorage.setItem('keyshare', result);
          setMpcDone(true);
          deletePreparams();
        })
        .catch((error: any) => {
          dbg('keygen error', error);
        })
        .finally(async () => {
          if (isMaster) {
            await waitMS(2000);
            BBMTLibNativeModule.stopRelay(localDevice);
            dbg('relay stop:', localDevice);
          }
          setDoingMPC(false);
        });
    } catch {
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
        dbg('got exception', e);
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
            (await LocalCache.getItem(`${btcAddress}-pendingTxs`)) || '{}',
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
          await LocalCache.setItem(
            `${btcAddress}-pendingTxs`,
            JSON.stringify(pendingTxs),
          );
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{name: 'Home'}],
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
    } catch (error: any) {
      Alert.alert('Operation Error', error?.message || error);
      dbg(localDevice, 'keysign error', error);
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
    } catch {
      dbg(localDevice, 'error stoping relay');
    }
  }

  async function backupShare() {
    if (!validatePassword(password)) {
      dbg('❌ [BACKUP] Password validation failed');
      Alert.alert(
        'Weak Password',
        'Please use a stronger password that meets all requirements.',
      );
      return;
    }

    if (password !== confirmPassword) {
      dbg('❌ [BACKUP] Password mismatch');
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    try {
      HapticFeedback.light();

      const storedKeyshare = await EncryptedStorage.getItem('keyshare');
      if (storedKeyshare) {
        const json = JSON.parse(storedKeyshare);
        const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
          storedKeyshare,
          await BBMTLibNativeModule.sha256(password),
        );

        // Create friendly filename with date and time (match WalletSettings)
        const now = new Date();
        const month = now.toLocaleDateString('en-US', {month: 'short'});
        const day = now.getDate().toString().padStart(2, '0');
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const share = json.local_party_key;
        const friendlyFilename = `${share}.${month}${day}.${year}.${hours}${minutes}.share`;

        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${friendlyFilename}`;

        await RNFS.writeFile(filePath, encryptedKeyshare, 'base64');

        await Share.open({
          title: 'Backup Your Keyshare',
          isNewTask: true,
          message:
            'Save this encrypted file securely. It is required for wallet recovery.',
          url: `file://${filePath}`,
          type: 'application/octet-stream',
          filename: friendlyFilename,
          failOnCancel: false,
        });

        try {
          await RNFS.unlink(filePath);
        } catch {}
        clearBackupModal();
      } else {
        Alert.alert('Error', 'Invalid keyshare.');
      }
    } catch (error) {
      dbg('Error encrypting or sharing keyshare:', error);
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

  // Animation for horizontal progress bar
  useEffect(() => {
    if (isPreparing) {
      const startAnimation = () => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(progressAnimation, {
              toValue: 1,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false,
            }),
            Animated.timing(progressAnimation, {
              toValue: 0,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false,
            }),
          ]),
        ).start();
      };
      startAnimation();
    } else {
      progressAnimation.setValue(0);
    }
  }, [isPreparing, progressAnimation]);

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
      dbg('Pairing Error:', error);
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
      } catch {
        // Ignore fetch errors during retry
      }
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
      paddingBottom: 12,
    },
    innerContainer: {
      alignItems: 'stretch',
      padding: 12,
    },
    retryButton: {
      marginTop: 24,
      alignSelf: 'center',
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    retryLink: {
      color: theme.colors.background,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      fontSize: 14,
      marginLeft: 6,
    },
    termsLink: {
      color: theme.colors.accent,
      fontWeight: '600',
      textDecorationLine: 'underline',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    header: {
      fontSize: 22,
      fontWeight: '700',
      color: theme.colors.text,
      marginTop: 12,
      marginBottom: 12,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 28,
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
      fontSize: 30,
      fontWeight: '700',
      color: theme.colors.text,
      marginBottom: 16,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 36,
    },
    pairingHint: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.textSecondary,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 18,
      paddingHorizontal: 8,
    },
    enhancedRequirementsContainer: {
      marginVertical: 8,
      padding: 12,
      backgroundColor: theme.colors.background,
      borderRadius: 12,
    },
    requirementsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    requirementsIcon: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    requirementsIconText: {
      color: theme.colors.background,
      fontSize: 14,
      fontWeight: 'bold',
    },
    requirementsTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    requirementsDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 20,
      marginBottom: 16,
      marginTop: 4,
    },
    enhancedCheckboxContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      marginVertical: 2,
      marginHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 8,
      backgroundColor: 'transparent',
    },
    enhancedCheckboxContainerChecked: {
      backgroundColor: theme.colors.primary + '10',
    },
    enhancedCheckbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    enhancedCheckboxChecked: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    checkmark: {
      color: theme.colors.background,
      fontSize: 12,
      fontWeight: 'bold',
    },
    checkboxContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    checkboxTextContainer: {
      flex: 1,
    },
    enhancedCheckboxLabel: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    networkHint: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginTop: 2,
      fontStyle: 'italic',
    },
    proximityHint: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginTop: 2,
      fontStyle: 'italic',
    },
    checkboxIconImage: {
      width: 20,
      height: 20,
      marginLeft: 8,
      tintColor: theme.colors.textSecondary,
    },
    twoPhonesContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
    },
    firstPhone: {
      marginLeft: 0,
      marginRight: -4,
      zIndex: 2,
    },
    secondPhone: {
      marginLeft: 0,
      opacity: 0.7,
      zIndex: 1,
    },
    finalStepHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      padding: 12,
      backgroundColor: theme.colors.background,
      borderRadius: 12,
    },
    finalStepIconContainer: {
      marginRight: 12,
    },
    finalStepPhoneIcon: {
      width: 24,
      height: 24,
      tintColor: theme.colors.primary,
    },
    finalStepTextContainer: {
      flex: 1,
    },
    finalStepTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginBottom: 4,
    },
    finalStepDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 20,
    },
    warningHint: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginTop: 2,
      fontStyle: 'italic',
    },
    warningIcon: {
      fontSize: 18,
      marginLeft: 8,
    },
    backupConfirmationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    backupConfirmationIcon: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    backupConfirmationIconText: {
      color: theme.colors.background,
      fontSize: 14,
      fontWeight: 'bold',
    },
    backupConfirmationTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    backupConfirmationDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 20,
      marginBottom: 10,
    },
    backupConfirmationContainer: {
      marginBottom: 4,
    },
    enhancedBackupCheckbox: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginVertical: 3,
      borderRadius: 12,
      backgroundColor: 'transparent',
    },
    enhancedBackupCheckboxChecked: {
      backgroundColor: theme.colors.secondary + '15',
    },
    backupCheckboxContent: {
      flex: 1,
      marginLeft: 12,
    },
    backupCheckboxLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginBottom: 2,
    },
    backupCheckboxHint: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      fontStyle: 'italic',
    },
    backupCheckIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.secondary,
    },
    securityText: {
      fontWeight: '700',
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 10,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    checklistContainer: {
      alignSelf: 'stretch',
      marginBottom: 12,
      paddingHorizontal: 8,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 12,
      elevation: 2,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 4,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    checklistPairing: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 12,
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 20,
    },
    checklistTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginBottom: 16,
      lineHeight: 26,
    },
    checkboxContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 3,
      marginVertical: 1,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
      backgroundColor: theme.colors.background,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    checked: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    checkboxLabel: {
      fontSize: 16,
      color: theme.colors.text,
      flex: 1,
      fontWeight: '500',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 22,
    },
    deviceContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      marginBottom: 16,
      paddingVertical: 12,
    },
    deviceWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 8,
      position: 'relative',
    },
    deviceIcon: {
      width: 40,
      height: 40,
      tintColor: theme.colors.textSecondary,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    deviceActive: {
      tintColor: theme.colors.primary,
    },
    deviceInactive: {
      tintColor: theme.colors.textSecondary,
    },
    deviceName: {
      position: 'absolute',
      bottom: -40,
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.text,
      textAlign: 'center',
      width: 120,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 18,
    },
    statusLine: {
      width: 80,
      height: 4,
      backgroundColor: theme.colors.border,
      marginHorizontal: 8,
      borderRadius: 2,
      overflow: 'hidden',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    connectionLine: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor: theme.colors.primary,
      borderRadius: 2,
    },
    statusText: {
      fontSize: 16,
      color: theme.colors.text,
      textAlign: 'center',
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 26,
    },
    ipText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginBottom: 4,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    countdownText: {
      fontSize: 14,
      color: theme.colors.secondary,
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
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
      width: '100%',
      alignSelf: 'center',
    },
    pairButtonOff: {
      opacity: 0.6,
      marginTop: 12,
      marginBottom: 8,
      backgroundColor: theme.colors.textSecondary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
    },
    proceedButtonOn: {
      marginTop: 12,
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
      width: '100%',
      alignSelf: 'center',
    },
    proceedButtonOff: {
      opacity: 0.6,
      marginTop: 12,
      backgroundColor: theme.colors.textSecondary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
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
      lineHeight: 24,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
    },
    modalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      padding: 16,
      width: '90%',
      maxWidth: 400,
      alignItems: 'center',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 8},
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 8,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    modalIcon: {
      width: 24,
      height: 24,
      marginRight: 8,
      tintColor: theme.colors.primary,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      lineHeight: 30,
    },
    modalDescription: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      textAlign: 'center',
      lineHeight: 24,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    passwordContainer: {
      width: '100%',
      marginBottom: 16,
    },
    passwordLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 8,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    passwordInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 12,
      backgroundColor: theme.colors.background,
      minHeight: 48,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.05,
      shadowRadius: 4,
      elevation: 1,
    },
    passwordInput: {
      flex: 1,
      padding: 12,
      fontSize: 16,
      color: theme.colors.text,
      minHeight: 48,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
    },
    eyeButton: {
      padding: 12,
    },
    eyeIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.textSecondary,
    },
    strengthContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 8,
    },
    strengthBar: {
      flex: 1,
      height: 6,
      backgroundColor: theme.colors.border,
      borderRadius: 3,
      marginRight: 8,
      overflow: 'hidden',
    },
    strengthFill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: 'transparent',
    },
    strengthText: {
      fontSize: 12,
      fontWeight: '600',
      minWidth: 40,
      textAlign: 'right',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    requirementsContainer: {
      marginTop: 8,
    },
    requirementText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginBottom: 2,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 16,
    },
    errorInput: {
      borderColor: theme.colors.danger,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: 12,
      marginTop: 4,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 16,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 12,
      gap: 8,
    },
    modalButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    cancelButton: {
      backgroundColor: theme.colors.textSecondary,
    },
    confirmButton: {
      backgroundColor: theme.colors.primary,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#ffffff',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      lineHeight: 22,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    buttonIcon: {
      width: 18,
      height: 18,
      marginRight: 6,
      tintColor: theme.colors.white,
    },
    disabledButton: {
      backgroundColor: theme.colors.disabled,
    },
    informationCard: {
      backgroundColor: theme.colors.white,
      borderRadius: 16,
      padding: 20,
      marginVertical: 8,
      elevation: 3,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.1,
      shadowRadius: 8,
      width: '100%',
      alignItems: 'stretch',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    informationText: {
      fontSize: 16,
      color: theme.colors.text,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      marginBottom: 16,
      lineHeight: 24,
    },
    hidden: {
      display: 'none',
    },
    clickPrepare: {
      marginTop: 12,
      marginBottom: 12,
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    },
    clickPrepareOff: {
      opacity: 0.6,
      marginTop: 12,
      marginBottom: 12,
      backgroundColor: theme.colors.textSecondary,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clickButtonText: {
      color: theme.colors.background,
      fontWeight: '600',
      fontSize: 16,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      lineHeight: 22,
    },
    modalText: {
      fontSize: 18,
      marginBottom: 12,
      textAlign: 'center',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 24,
    },
    backupButton: {
      marginTop: 12,
      backgroundColor: theme.colors.subPrimary,
      width: '100%',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    },
    backupButtonText: {
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      lineHeight: 22,
    },
    clickButton: {
      marginTop: 12,
      marginBottom: 12,
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    },
    clickButtonOff: {
      opacity: 0.6,
      marginTop: 16,
      marginBottom: 16,
      backgroundColor: theme.colors.textSecondary,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
    },
    modalSubtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 16,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      lineHeight: 20,
    },
    progressCircle: {
      marginBottom: 16,
    },
    progressTextWrapper: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    progressPercentage: {
      fontSize: 14,
      fontWeight: 'bold',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      marginBottom: 16,
    },
    progressText: {
      fontSize: 18,
      color: theme.colors.text,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      lineHeight: 24,
    },
    modalIconContainer: {
      marginBottom: 10,
      alignItems: 'center',
    },
    modalIconBackground: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: theme.colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    finalizingModalIcon: {
      width: 24,
      height: 24,
      tintColor: theme.colors.primary,
    },
    progressContainer: {
      marginVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    horizontalProgressContainer: {
      width: '100%',
      alignItems: 'center',
    },
    horizontalProgressTrack: {
      width: 200,
      height: 6,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 3,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
    },
    horizontalProgressBar: {
      height: '100%',
      borderRadius: 3,
      width: 0,
      alignSelf: 'center',
    },
    statusContainer: {
      width: '100%',
      marginTop: 8,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    statusIndicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.primary,
      marginRight: 8,
    },
    finalizingStatusText: {
      fontSize: 14,
      color: theme.colors.text,
      fontWeight: '500',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      flex: 1,
    },
    finalizingCountdownText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
    },
    transactionDetails: {
      padding: 12,
      paddingTop: 0,
      width: '100%',
    },
    transactionItem: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      paddingVertical: 8,
    },
    transactionLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.text,
      marginTop: 4,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 20,
    },
    addressContainer: {
      backgroundColor: theme.colors.background,
      padding: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    addressValue: {
      fontSize: 14,
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      lineHeight: 18,
    },
    amountContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
      padding: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    amountValue: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 18,
    },
    fiatValue: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 16,
    },
    input: {
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 8,
      padding: 8,
      width: 140,
      height: 36,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: 4,
      marginTop: 8,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      backgroundColor: theme.colors.background,
    },
  });

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
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
                <View style={styles.enhancedRequirementsContainer}>
                  <View style={styles.requirementsHeader}>
                    <View style={styles.requirementsIcon}>
                      <Text style={styles.requirementsIconText}>✓</Text>
                    </View>
                    <Text style={styles.requirementsTitle}>
                      Setup Requirements
                    </Text>
                  </View>
                  <Text style={styles.requirementsDescription}>
                    Two mobile devices are required.
                  </Text>

                  {[
                    {
                      key: 'twoDevices',
                      label: 'Both phones are nearby',
                      icon: 'pair',
                    },
                    {
                      key: 'sameNetwork',
                      label: 'Both on same network',
                      icon: 'wifi',
                    },
                  ].map(item => (
                    <TouchableOpacity
                      key={item.key}
                      style={[
                        styles.enhancedCheckboxContainer,
                        checks[item.key as keyof typeof checks] &&
                          styles.enhancedCheckboxContainerChecked,
                      ]}
                      onPress={() => {
                        HapticFeedback.medium();
                        toggleCheck(item.key as keyof typeof checks);
                      }}>
                      <View
                        style={[
                          styles.enhancedCheckbox,
                          checks[item.key as keyof typeof checks] &&
                            styles.enhancedCheckboxChecked,
                        ]}>
                        {checks[item.key as keyof typeof checks] && (
                          <Text style={styles.checkmark}>✓</Text>
                        )}
                      </View>
                      <View style={styles.checkboxContent}>
                        <View style={styles.checkboxTextContainer}>
                          <Text style={styles.enhancedCheckboxLabel}>
                            {item.label}
                          </Text>
                          {item.key === 'sameNetwork' && (
                            <Text style={styles.networkHint}>
                              (WiFi or Hotspot)
                            </Text>
                          )}
                          {item.key === 'twoDevices' && (
                            <Text style={styles.proximityHint}>
                              (Within your reach)
                            </Text>
                          )}
                        </View>
                        {item.icon === 'pair' ? (
                          <View style={styles.twoPhonesContainer}>
                            <Image
                              source={require('../assets/phone-icon.png')}
                              style={[
                                styles.checkboxIconImage,
                                styles.firstPhone,
                              ]}
                              resizeMode="contain"
                            />
                            <Image
                              source={require('../assets/phone-icon.png')}
                              style={[
                                styles.checkboxIconImage,
                                styles.secondPhone,
                              ]}
                              resizeMode="contain"
                            />
                          </View>
                        ) : (
                          <Image
                            source={require('../assets/wifi-icon.png')}
                            style={styles.checkboxIconImage}
                            resizeMode="contain"
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.pairingHint}>
                  ⚠️ Tip: for ultimate privacy and reliability, put one phone in
                  Hotspot mode, and connect the other phone to it.
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
                  <View style={{marginTop: 16}}>
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
                          width: 18,
                          height: 18,
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
                            borderRadius: 12,
                            padding: 16,
                            marginBottom: 18,
                            backgroundColor: theme.colors.background,
                          }}>
                          <View
                            style={{
                              width: 54,
                              height: 54,
                              borderRadius: 27,
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginRight: 16,
                            }}>
                            <Image
                              source={require('../assets/security-icon.png')}
                              style={{width: 32, height: 32}}
                              resizeMode="contain"
                            />
                          </View>
                          <View style={{flex: 1}}>
                            <Text
                              style={{
                                fontSize: 16,
                                fontWeight: '700',
                                color: theme.colors.text,
                                marginBottom: 2,
                              }}>
                              Superior Security
                            </Text>
                            <Text
                              style={{
                                fontSize: 14,
                                color: theme.colors.textSecondary,
                                lineHeight: 20,
                              }}>
                              Bold uses TSS cryptography. A+ Security Grade.{' '}
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
                            <Text style={styles.clickButtonText}>
                              Prepare Device
                            </Text>
                          </View>
                        </TouchableOpacity>
                        {/* Show Countdown Timer During Pairing */}
                        {isPreparing && (
                          <Modal transparent={true} visible={isPreparing}>
                            <View style={styles.modalOverlay}>
                              <View style={styles.modalContent}>
                                {/* Icon Container */}
                                <View style={styles.modalIconContainer}>
                                  <View style={styles.modalIconBackground}>
                                    <Image
                                      source={require('../assets/prepare-icon.png')}
                                      style={styles.finalizingModalIcon}
                                      resizeMode="contain"
                                    />
                                  </View>
                                </View>

                                {/* Header Text */}
                                <Text style={styles.modalTitle}>
                                  Preparing Device
                                </Text>

                                {/* Subtext. suggest better wording. */}
                                <Text style={styles.modalSubtitle}>
                                  Could take a while, given device specs.
                                </Text>

                                {/* Loading Indicator */}
                                <View style={styles.progressContainer}>
                                  <View
                                    style={styles.horizontalProgressContainer}>
                                    <View
                                      style={styles.horizontalProgressTrack}>
                                      <Animated.View
                                        style={[
                                          styles.horizontalProgressBar,
                                          {
                                            backgroundColor:
                                              theme.colors.primary,
                                            width:
                                              progressAnimation.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: [0, 200],
                                              }),
                                            alignSelf: 'center',
                                          },
                                        ]}
                                      />
                                    </View>
                                  </View>
                                </View>

                                {/* Status and Countdown */}
                                <View style={styles.statusContainer}>
                                  <View style={styles.statusRow}>
                                    <View style={styles.statusIndicator} />
                                    <Text style={styles.finalizingStatusText}>
                                      Computing cryptographic params
                                    </Text>
                                  </View>
                                  <Text style={styles.finalizingCountdownText}>
                                    Time elapsed: {prepCounter} seconds
                                  </Text>
                                </View>
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
                      <View style={styles.finalStepHeader}>
                        <View style={styles.finalStepIconContainer}>
                          <View style={styles.twoPhonesContainer}>
                            <Image
                              source={require('../assets/phone-icon.png')}
                              style={[
                                styles.finalStepPhoneIcon,
                                styles.firstPhone,
                              ]}
                              resizeMode="contain"
                            />
                            <Image
                              source={require('../assets/phone-icon.png')}
                              style={[
                                styles.finalStepPhoneIcon,
                                styles.secondPhone,
                              ]}
                              resizeMode="contain"
                            />
                          </View>
                        </View>
                        <View style={styles.finalStepTextContainer}>
                          <Text style={styles.finalStepTitle}>Final Step</Text>
                          <Text style={styles.finalStepDescription}>
                            Make sure both phones preparation step is complete.
                          </Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.enhancedCheckboxContainer,
                          isKeygenReady &&
                            styles.enhancedCheckboxContainerChecked,
                        ]}
                        onPress={() => {
                          HapticFeedback.medium();
                          toggleKeygenReady();
                        }}>
                        <View
                          style={[
                            styles.enhancedCheckbox,
                            isKeygenReady && styles.enhancedCheckboxChecked,
                          ]}>
                          {isKeygenReady && (
                            <Text style={styles.checkmark}>✓</Text>
                          )}
                        </View>
                        <View style={styles.checkboxTextContainer}>
                          <Text style={styles.enhancedCheckboxLabel}>
                            The other device is ready
                          </Text>
                          <Text style={styles.warningHint}>
                            Do not leave the app during setup.
                          </Text>
                        </View>
                        <Text style={styles.warningIcon}>⚠️</Text>
                      </TouchableOpacity>

                      {doingMPC && (
                        <Modal
                          transparent={true}
                          visible={doingMPC}
                          animationType="fade">
                          <View style={styles.modalOverlay}>
                            <View style={styles.modalContent}>
                              {/* Icon Container */}
                              <View style={styles.modalIconContainer}>
                                <View style={styles.modalIconBackground}>
                                  <Image
                                    source={require('../assets/security-icon.png')}
                                    style={styles.finalizingModalIcon}
                                    resizeMode="contain"
                                  />
                                </View>
                              </View>

                              {/* Header Text */}
                              <Text style={styles.modalTitle}>
                                Finalizing Your Wallet
                              </Text>

                              {/* Subtext */}
                              <Text style={styles.modalSubtitle}>
                                Securing your wallet with advanced cryptography.
                                Please stay in the app...
                              </Text>

                              {/* Progress Container */}
                              <View style={styles.progressContainer}>
                                {/* Circular Progress */}
                                <Progress.Circle
                                  size={80}
                                  progress={progress / 100}
                                  thickness={6}
                                  borderWidth={0}
                                  showsText={false}
                                  color={theme.colors.primary}
                                  style={styles.progressCircle}
                                />

                                {/* Progress Percentage */}
                                <View style={styles.progressTextWrapper}>
                                  <Text style={styles.progressPercentage}>
                                    {Math.round(progress)}%
                                  </Text>
                                </View>
                              </View>

                              {/* Status and Countdown */}
                              <View style={styles.statusContainer}>
                                <View style={styles.statusRow}>
                                  <View style={styles.statusIndicator} />
                                  <Text style={styles.finalizingStatusText}>
                                    Processing cryptographic operations
                                  </Text>
                                </View>
                                <Text style={styles.finalizingCountdownText}>
                                  Estimated time remaining: {prepCounter}{' '}
                                  seconds
                                </Text>
                              </View>
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
                        Create secure backups of your keyshares. Store each
                        phone's backup in different locations to prevent single
                        points of failure.
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
                            style={styles.buttonIcon}
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
                      <View style={styles.backupConfirmationHeader}>
                        <View style={styles.backupConfirmationIcon}>
                          <Text style={styles.backupConfirmationIconText}>
                            ✓
                          </Text>
                        </View>
                        <Text style={styles.backupConfirmationTitle}>
                          Confirm Backups
                        </Text>
                      </View>
                      <Text style={styles.backupConfirmationDescription}>
                        Verify that both devices have successfully backed up
                        their keyshares.
                      </Text>

                      <View style={styles.backupConfirmationContainer}>
                        {[
                          {
                            key: 'deviceOne',
                            label: `${localDevice} backed up`,
                            device: localDevice,
                          },
                          {
                            key: 'deviceTwo',
                            label: `${peerDevice} backed up`,
                            device: peerDevice,
                          },
                        ].map(item => (
                          <TouchableOpacity
                            key={item.key}
                            style={[
                              styles.enhancedBackupCheckbox,
                              backupChecks[
                                item.key as keyof typeof backupChecks
                              ] && styles.enhancedBackupCheckboxChecked,
                            ]}
                            onPress={() => {
                              HapticFeedback.medium();
                              toggleBackedup(
                                item.key as keyof typeof backupChecks,
                              );
                            }}>
                            <View
                              style={[
                                styles.enhancedCheckbox,
                                backupChecks[
                                  item.key as keyof typeof backupChecks
                                ] && styles.enhancedCheckboxChecked,
                              ]}>
                              {backupChecks[
                                item.key as keyof typeof backupChecks
                              ] && <Text style={styles.checkmark}>✓</Text>}
                            </View>
                            <View style={styles.backupCheckboxContent}>
                              <Text style={styles.backupCheckboxLabel}>
                                {item.label}
                              </Text>
                              <Text style={styles.backupCheckboxHint}>
                                {item.device} keyshare secured
                              </Text>
                            </View>
                            <Image
                              source={require('../assets/check-icon.png')}
                              style={styles.backupCheckIcon}
                              resizeMode="contain"
                            />
                          </TouchableOpacity>
                        ))}
                      </View>

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
                              routes: [{name: 'Home'}],
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
                          {/* Icon Container */}
                          <View style={styles.modalIconContainer}>
                            <View style={styles.modalIconBackground}>
                              <Image
                                source={require('../assets/key-icon.png')}
                                style={styles.finalizingModalIcon}
                                resizeMode="contain"
                              />
                            </View>
                          </View>

                          {/* Header Text */}
                          <Text style={styles.modalTitle}>
                            Co-Signing Transaction
                          </Text>

                          {/* Subtext */}
                          <Text style={styles.modalSubtitle}>
                            Securing your transaction with multi-party
                            cryptography. Please stay in the app...
                          </Text>

                          {/* Progress Container */}
                          <View style={styles.progressContainer}>
                            {/* Circular Progress */}
                            <Progress.Circle
                              size={80}
                              progress={progress / 100}
                              thickness={6}
                              borderWidth={0}
                              showsText={false}
                              color={theme.colors.primary}
                              style={styles.progressCircle}
                            />

                            {/* Progress Percentage */}
                            <View style={styles.progressTextWrapper}>
                              <Text style={styles.progressPercentage}>
                                {Math.round(progress)}%
                              </Text>
                            </View>
                          </View>

                          {/* Status and Countdown */}
                          <View style={styles.statusContainer}>
                            <View style={styles.statusRow}>
                              <View style={styles.statusIndicator} />
                              <Text style={styles.finalizingStatusText}>
                                Processing multi-party signature
                              </Text>
                            </View>
                            <Text style={styles.finalizingCountdownText}>
                              Estimated time remaining: {prepCounter} seconds
                            </Text>
                          </View>
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
                Create an encrypted backup of your keyshare, protected by a
                strong password.
              </Text>

              <View style={styles.passwordContainer}>
                <Text style={styles.passwordLabel}>Choose Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Enter a strong password"
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
                    placeholder="Confirm your password"
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
                      style={styles.buttonIcon}
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
