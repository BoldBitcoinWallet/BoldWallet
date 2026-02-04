/* eslint-disable react-native/no-inline-styles */
import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Image,
  Modal,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Linking,
  NativeEventEmitter,
  EmitterSubscription,
  BackHandler,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import Animated, {
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  useAnimatedStyle,
  interpolate,
  cancelAnimation,
  Easing as ReanimatedEasing,
} from 'react-native-reanimated';
import {NativeModules} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import NetInfo from '@react-native-community/netinfo';
import RNFS from 'react-native-fs';
import EncryptedStorage from 'react-native-encrypted-storage';
import * as Progress from 'react-native-progress';
import {
  CommonActions,
  RouteProp,
  StackActions,
  useFocusEffect,
  useIsFocused,
  useRoute,
} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Big from 'big.js';
import {dbg, getPinnedRemoteIPs, HapticFeedback, hexToString, getResetToMainTabsWallet} from '../utils';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {waitMS, WalletService} from '../services/WalletService';
import LocalCache from '../services/LocalCache';
import BackupKeyshareModal from '../components/BackupKeyshareModal';
const {BBMTLibNativeModule} = NativeModules;
// Helper component for connection line animation
const ConnectionLineAnimatedView: React.FC<{
  style: any;
  connectionAnimation: ReturnType<typeof useSharedValue<number>>;
}> = ({style, connectionAnimation}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const width = interpolate(connectionAnimation.value, [0, 1], [0, 100]);
    return {
      width: `${width}%`,
    };
  });
  return <Animated.View style={[style, animatedStyle]} />;
};

// Helper component for progress bar animation
const ProgressBarAnimatedView: React.FC<{
  style: any;
  progressAnimation: ReturnType<typeof useSharedValue<number>>;
  backgroundColor: string;
}> = ({style, progressAnimation, backgroundColor}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const width = interpolate(progressAnimation.value, [0, 1], [0, 200]);
    return {
      width,
      alignSelf: 'center' as const,
    };
  });
  return <Animated.View style={[style, {backgroundColor}, animatedStyle]} />;
};

const MobilesPairing = ({navigation}: any) => {
  const timeout = 20;
  const discoveryPort = 55055;
  const ppmFile = `${RNFS.DocumentDirectoryPath}/ppm.json`;
  const [status, setStatus] = useState('');
  const [localIP, setLocalIP] = useState<string | null>(null);
  const [localID, setLocalID] = useState<string | null>(null);
  const [localDevice, setLocalDevice] = useState<string | null>(null);
  const [peerIP, setPeerIP] = useState<string | null>(null);
  const [peerIP2, setPeerIP2] = useState<string | null>(null);
  const [remoteID, setRemoteID] = useState<String | null>(null);
  const [remoteID2, setRemoteID2] = useState<String | null>(null);
  const [peerDevice, setPeerDevice] = useState<string | null>(null);
  const [peerDevice2, setPeerDevice2] = useState<string | null>(null);
  const [peerParty, setPeerParty] = useState<string | null>(null);
  const [peerParty2, setPeerParty2] = useState<string | null>(null);
  const [localParty, setLocalParty] = useState<string>('');
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
  const [masterHost, setMasterHost] = useState<string | null>(null);
  const [prepCounter, setPrepCounter] = useState(0);
  const [keypair, setKeypair] = useState('');
  const [peerPubkey, setPeerPubkey] = useState('');
  const [fromAddress, setFromAddress] = useState<string>(''); // Derived address for send transaction
  const [currentDerivationPath, setCurrentDerivationPath] =
    useState<string>(''); // Derivation path for display
  const [currentNetwork, setCurrentNetwork] = useState<string>('mainnet'); // Network for display
  const [peerPubkey2, setPeerPubkey2] = useState('');
  const [shareName, setShareName] = useState('');
  const [_keyshare, setKeyshare] = useState('');
  // VPN detection state
  const [isVPNConnected, setIsVPNConnected] = useState(false);
  const [psbtDetails, setPsbtDetails] = useState<{
    inputs: Array<{txid: string; vout: number; amount: number}>;
    outputs: Array<{address: string; amount: number}>;
    fee: number;
    totalInput: number;
    totalOutput: number;
    derivePaths?: string[];
  } | null>(null);
  const {theme} = useTheme();
  const {activeNetwork, showMempoolPlayground, showUtxosTab, showPsbtTab, showWalletTab} = useUser();
  const showPlay = activeNetwork === 'mainnet' && showMempoolPlayground;
  // Animation ref for horizontal progress bar
  const progressAnimation = useSharedValue(0);
  type RouteParams = {
    mode?: string; // 'duo' | 'trio' | 'send_btc' | 'sign_psbt'
    addressType?: string;
    toAddress?: string;
    satoshiAmount?: string;
    fiatAmount?: string;
    satoshiFees?: string;
    fiatFees?: string;
    selectedCurrency?: string;
    spendingHash?: string;
    psbtBase64?: string; // For PSBT signing mode
    derivationPath?: string; // Derivation path from QR code (ensures same source address)
    network?: string; // Network from QR code (ensures same network)
  };
  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);
  const isSendBitcoin = route.params?.mode === 'send_btc';
  const isSignPSBT = route.params?.mode === 'sign_psbt';
  const setupMode = route.params?.mode;
  const isTrio = setupMode === 'trio';
  const title =
    isSendBitcoin || isSignPSBT
      ? isSignPSBT
        ? 'PSBT Co-Signing'
        : 'Co-Signing Your Transaction'
      : 'Securely Pairing Your Devices';
  const [checks, setChecks] = useState({
    sameNetwork: false,
    twoDevices: false,
    noVPN: false,
  });
  const [backupChecks, setBackupChecks] = useState({
    deviceOne: false,
    deviceTwo: false,
    deviceThree: false,
  });
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
  const allChecked = Object.values(checks).every(Boolean);
  const allBackupChecked = isTrio
    ? backupChecks.deviceOne &&
      backupChecks.deviceTwo &&
      backupChecks.deviceThree
    : backupChecks.deviceOne && backupChecks.deviceTwo;
  const connectionAnimation = useSharedValue(0);
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
  // Clear all cache when entering wallet setup mode (not signing mode)
  useEffect(() => {
    const clearCacheForSetup = async () => {
      // Only clear cache if we're in setup mode (duo/trio), not signing mode
      if (setupMode === 'duo' || setupMode === 'trio') {
        try {
          dbg('=== MobilesPairing: Clearing all cache for wallet setup');
          // Clear LocalCache
          await LocalCache.clear();
          dbg('LocalCache cleared successfully');
          // Clear stale EncryptedStorage items (but keep keyshare if it exists for signing)
          // We clear btcPub as it will be regenerated with the new keyshare
          await EncryptedStorage.removeItem('btcPub');
          dbg('Cleared stale btcPub from EncryptedStorage');
          // Clear WalletService cache
          try {
            await LocalCache.removeItem('walletCache');
            dbg('WalletService cache cleared');
          } catch (error) {
            dbg('Error clearing WalletService cache:', error);
          }
          dbg('=== MobilesPairing: Cache clearing completed');
        } catch (error) {
          dbg('Error clearing cache in MobilesPairing:', error);
        }
      }
    };
    clearCacheForSetup();
  }, [setupMode]);
  // Initialize network and derivation path immediately when component loads (for send Bitcoin mode)
  useEffect(() => {
    const initializeNetwork = async () => {
      if (!isSendBitcoin || !route.params) {
        // For non-send modes, use cached network
        const cachedNetwork =
          (await LocalCache.getItem('network')) || 'mainnet';
        setCurrentNetwork(cachedNetwork);
        return;
      }
      dbg('=== MobilesPairing: Received route params ===', {
        network: route.params?.network,
        derivationPath: route.params?.derivationPath,
        addressType: route.params?.addressType,
        toAddress: route.params?.toAddress,
        satoshiAmount: route.params?.satoshiAmount,
        allParams: route.params,
      });
      // CRITICAL: In send mode, ALL parameters MUST come from route params (no fallbacks)
      if (!route.params.network || route.params.network.trim() === '') {
        dbg('ERROR: Network missing from route params in send mode');
        return;
      }
      // ALWAYS use route params - no fallbacks
      const netForNative = route.params.network.trim();
      const netForDisplay =
        netForNative === 'testnet3' ? 'testnet' : netForNative;
      setCurrentNetwork(netForDisplay);
      // Also set derivation path immediately if available from route params
      if (
        route.params.derivationPath &&
        route.params.derivationPath.trim() !== ''
      ) {
        setCurrentDerivationPath(route.params.derivationPath.trim());
        dbg(
          'MobilesPairing: Initialized derivation path from route params:',
          route.params.derivationPath,
        );
      }
      dbg(
        'MobilesPairing: Initialized network for display:',
        netForDisplay,
        '(native format:',
        netForNative,
        ')',
      );
    };
    initializeNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSendBitcoin, route.params?.network, route.params?.derivationPath]);
  // Compute from address for send transactions
  useEffect(() => {
    const computeFromAddress = async () => {
      if (!isSendBitcoin || !route.params) return;
      try {
        // CRITICAL: In send mode, ALL parameters MUST come from route params (no fallbacks)
        // This ensures consistency between devices and prevents mismatches
        if (!route.params.network || route.params.network.trim() === '') {
          dbg('ERROR: Network missing from route params in send mode');
          setFromAddress('');
          return;
        }
        if (
          !route.params.addressType ||
          route.params.addressType.trim() === ''
        ) {
          dbg('ERROR: Address type missing from route params in send mode');
          setFromAddress('');
          return;
        }
        if (
          !route.params.derivationPath ||
          route.params.derivationPath.trim() === ''
        ) {
          dbg('ERROR: Derivation path missing from route params in send mode');
          setFromAddress('');
          return;
        }
        const jks = await EncryptedStorage.getItem('keyshare');
        if (!jks) return;
        const ks = JSON.parse(jks);
        // ALWAYS use route params - no fallbacks
        const netForNative = route.params.network.trim();
        const addressTypeToUse = route.params.addressType.trim();
        const path = route.params.derivationPath.trim();
        // Normalize for display only: 'testnet3' -> 'testnet'
        const netForDisplay =
          netForNative === 'testnet3' ? 'testnet' : netForNative;
        dbg('=== MobilesPairing: Using route params ONLY (no fallbacks) ===', {
          network: netForNative,
          addressType: addressTypeToUse,
          derivationPath: path,
        });
        // Derive the public key and address
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        // Use original network format for native module (requires 'testnet3' not 'testnet')
        const derivedAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          netForNative,
          addressTypeToUse,
        );
        setFromAddress(derivedAddress);
        setCurrentDerivationPath(path);
        setCurrentNetwork(netForDisplay);
        dbg('=== MobilesPairing: Computed from address ===', {
          derivationPath: path,
          addressType: addressTypeToUse,
          fromAddress: derivedAddress,
          network: netForNative,
          networkForDisplay: netForDisplay,
        });
      } catch (error) {
        dbg('Error computing from address:', error);
        setFromAddress('');
      }
    };
    computeFromAddress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isSendBitcoin,
    route.params?.derivationPath,
    route.params?.mode,
    route.params?.network,
    route.params?.addressType,
  ]);
  const stringToHex = (str: string) => {
    return Array.from(str)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
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
  const formatFiat = (price?: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(price));
  const sat2btcStr = (sats?: string | number) =>
    Big(sats || 0)
      .div(1e8)
      .toFixed(8);
  // Parse PSBT details when PSBT is available
  useEffect(() => {
    const parsePSBT = async () => {
      if (isSignPSBT && route.params.psbtBase64) {
        try {
          dbg('Parsing PSBT details for summary...');
          const detailsJson = await BBMTLibNativeModule.parsePSBTDetails(
            route.params.psbtBase64,
          );
          if (
            detailsJson.startsWith('error') ||
            detailsJson.includes('failed')
          ) {
            dbg('Failed to parse PSBT details:', detailsJson);
            setPsbtDetails(null);
            return;
          }
          const details = JSON.parse(detailsJson);
          setPsbtDetails({
            inputs: details.inputs || [],
            outputs: details.outputs || [],
            fee: details.fee || 0,
            totalInput: details.totalInput || 0,
            totalOutput: details.totalOutput || 0,
            derivePaths: details.derivePaths || [],
          });
          dbg('PSBT details parsed:', {
            inputs: details.inputs?.length || 0,
            outputs: details.outputs?.length || 0,
            fee: details.fee,
          });
        } catch (error) {
          dbg('Error parsing PSBT details:', error);
          setPsbtDetails(null);
        }
      } else {
        setPsbtDetails(null);
      }
    };
    parsePSBT();
  }, [isSignPSBT, route.params.psbtBase64]);
  const preparams = async () => {
    setIsPreparing(true);
    setIsPreParamsReady(false);
    setPrepCounter(0);
    const timeoutMinutes = 2;
    if (!__DEV__) {
      await deletePreparams();
    } else {
      dbg('preparams dev: Not deleting ppmFile');
    }
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
        } else if (isSignPSBT) {
          dbg('initSession: Preparing for PSBT signing');
          const jks = await EncryptedStorage.getItem('keyshare');
          const ks = JSON.parse(jks || '{}');
          // For PSBT, use PSBT hash instead of amount/fees
          const psbtHash = await BBMTLibNativeModule.sha256(
            route.params.psbtBase64 || '',
          );
          _data += ':' + psbtHash;
          _data += ':' + ks.local_party_key;
          dbg('initSession: Added PSBT data to session data');
        }
        dbg('initSession: Publishing data', {
          masterHost,
          data: _data,
          peerPubkey,
          discoveryPort,
          timeout,
        });
        const enckeyCSV = isTrio
          ? [peerPubkey, peerPubkey2].filter(Boolean).join(',')
          : peerPubkey;
        const published = await BBMTLibNativeModule.publishData(
          String(discoveryPort),
          String(timeout),
          enckeyCSV,
          _data,
          isTrio ? 'trio' : 'duo',
        );
        if (published) {
          dbg('initSession: Data published successfully', {published});
          // For trio the publisher returns two queries joined by '|', each containing data=<checksum>&pubkey=<key>
          // For duo it returns a single query. Validate checksum only in duo to avoid false negatives across devices.
          if (!isTrio) {
            const firstQuery = (published.split('|')[0] || published) as string;
            const dataParam = (
              firstQuery.split('&').find(p => p.startsWith('data=')) || 'data='
            ).slice(5);
            const peerChecksum = dataParam;
            const localPayload = `${kp.publicKey}/${route.params?.satoshiAmount}`;
            const localChecksum = await BBMTLibNativeModule.sha256(
              localPayload,
            );
            dbg('initSession: Validating checksums', {
              localPayload,
              localChecksum,
              peerChecksum,
            });
            if (peerChecksum !== localChecksum) {
              dbg('initSession: Checksum validation failed');
              throw 'Make sure you\'re sending the "Same Bitcoin" amount from Both Devices';
            }
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
        const peerURL = `http://${masterHost}:${discoveryPort}/`;
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
    // Use cryptographically secure random generation
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    let result = '';
    const characters = '0123456789abcdef';
    for (let i = 0; i < length; i++) {
      // Map random bytes to hex characters (0-15)
      result += characters.charAt(array[i] % 16);
    }
    return result;
  };
  const mpcTssSetup = async () => {
    try {
      setDoingMPC(true);
      setMpcDone(false);
      setPrepCounter(0);
      setProgress(0);
      setStatus('Processing cryptographic operations');
      dbg('mpcTssSetup...');
      const data = await initSession();
      dbg('got session data', data);
      if (isMaster) {
        await BBMTLibNativeModule.stopRelay('stop');
        const relay = await BBMTLibNativeModule.runRelay(String(discoveryPort));
        dbg('relay start:', relay, localDevice);
      }
      await waitMS(2000);
      const server = `http://${masterHost}:${discoveryPort}`;
      const partyID = isTrio
        ? localParty || (isMaster ? 'KeyShare1' : 'KeyShare2')
        : isMaster
        ? 'KeyShare1'
        : 'KeyShare2';
      const peerID = isMaster ? 'KeyShare2' : 'KeyShare1';
      const partiesCSV = isTrio
        ? 'KeyShare1,KeyShare2,KeyShare3'
        : `${partyID},${peerID}`;
      const sessionID = await BBMTLibNativeModule.sha256(`${data}/${server}`);
      const kp = JSON.parse(keypair);
      const encKey = isTrio ? '' : peerPubkey;
      const decKey = isTrio ? '' : kp.privateKey;
      let sessionKey = '';
      if (isTrio) {
        try {
          const seeds = [sessionID, masterHost];
          sessionKey = await BBMTLibNativeModule.sha256(seeds.join(','));
        } catch {}
      }
      setShareName(partyID);
      dbg('starting keygen with', {
        server,
        partyID,
        ppmFile,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        data,
      });
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
          // New wallet setups are always non-legacy, so no need to reset flag
          setMpcDone(true);
          deletePreparams();
        })
        .catch((error: any) => {
          dbg('keygen error', error);
          if (__DEV__) {
            Alert.alert('Error', error?.message || error);
          }
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
    setProgress(0);
    setStatus('Processing cryptographic operations');
    // CRITICAL: Store original network/API before transaction (declared outside try for finally block)
    // We'll use QR code network temporarily for signing, but restore original after
    let originalNetwork = '';
    let originalApiUrl = '';
    try {
      dbg('session init...');
      const data = await initSession();
      dbg('session init done');
      dbg('spending hash:', route.params.spendingHash);
      if (isMaster) {
        await BBMTLibNativeModule.stopRelay('stop');
        await waitMS(500);
        const relay = await BBMTLibNativeModule.runRelay(String(discoveryPort));
        dbg('relay start:', relay, localDevice);
      } else {
        await waitMS(500); // Give master device time to start relay
      }
      const server = `http://${isMaster ? localIP : peerIP}:${discoveryPort}`;
      const jks = await EncryptedStorage.getItem('keyshare');
      // Declare variables for send BTC mode (will be set in else block below)
      let net = '';
      let addressTypeToUse = '';
      let path = '';
      let toAddress = '';
      let satoshiAmount = '';
      let satoshiFees = '';
      // For PSBT signing, network comes from app state, not route params
      if (isSignPSBT) {
        // Get network from LocalCache (app's current network state)
        net = (await LocalCache.getItem('network')) || 'mainnet';
        dbg(
          'MobilesPairing: PSBT signing - using network from app state:',
          net,
        );
        // Set network and API in BBMTLib for this transaction
        let apiUrl = await LocalCache.getItem(`api_${net}`);
        if (!apiUrl) {
          apiUrl =
            net === 'testnet3' || net === 'testnet'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api';
        }
        await BBMTLibNativeModule.setBtcNetwork(net);
        await BBMTLibNativeModule.setAPI(net, apiUrl);
        dbg('MobilesPairing: Set network and API in BBMTLib:', net, apiUrl);
      } else {
        // For send BTC, read ALL parameters from route params ONLY (no fallbacks)
        if (!route.params?.network || route.params.network.trim() === '') {
          throw new Error('Network is required in route params');
        }
        if (
          !route.params?.addressType ||
          route.params.addressType.trim() === ''
        ) {
          throw new Error('Address type is required in route params');
        }
        if (
          !route.params?.derivationPath ||
          route.params.derivationPath.trim() === ''
        ) {
          throw new Error('Derivation path is required in route params');
        }
        if (!route.params?.toAddress || route.params.toAddress.trim() === '') {
          throw new Error('Destination address is required in route params');
        }
        if (
          !route.params?.satoshiAmount ||
          route.params.satoshiAmount.trim() === ''
        ) {
          throw new Error('Amount is required in route params');
        }
        if (
          !route.params?.satoshiFees ||
          route.params.satoshiFees.trim() === ''
        ) {
          throw new Error('Fees are required in route params');
        }
        // Extract all params from route
        // CRITICAL: Normalize network to native format ('testnet3' not 'testnet') for BBMTLib
        const networkFromParams = route.params.network.trim();
        net = networkFromParams === 'testnet' ? 'testnet3' : networkFromParams;
        addressTypeToUse = route.params.addressType.trim();
        path = route.params.derivationPath.trim();
        toAddress = route.params.toAddress.trim();
        satoshiAmount = route.params.satoshiAmount.trim();
        satoshiFees = route.params.satoshiFees.trim();
        dbg('MobilesPairing: Using route params ONLY:', {
          networkFromParams,
          network: net,
          addressType: addressTypeToUse,
          derivationPath: path,
          toAddress,
          satoshiAmount,
          satoshiFees,
        });
        // Store original network/API
        originalNetwork = (await LocalCache.getItem('network')) || 'mainnet';
        const cachedApi = await LocalCache.getItem(`api_${originalNetwork}`);
        originalApiUrl = cachedApi || '';
        if (!originalApiUrl) {
          originalApiUrl =
            originalNetwork === 'testnet3' || originalNetwork === 'testnet'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api';
        }
        // Set network and API in BBMTLib for this transaction
        let apiUrl = await LocalCache.getItem(`api_${net}`);
        if (!apiUrl) {
          apiUrl =
            net === 'testnet3' || net === 'testnet'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api';
        }
        await BBMTLibNativeModule.setBtcNetwork(net);
        await BBMTLibNativeModule.setAPI(net, apiUrl);
        // CRITICAL: Update LocalCache 'api' key so any balance/UTXO fetches use correct API
        // This ensures operations use the network from route params, not device's current network
        await LocalCache.setItem('api', apiUrl);
        dbg('MobilesPairing: Set network and API in BBMTLib:', net, apiUrl);
      }
      // Store original network/API (for both PSBT and send BTC modes)
      if (isSignPSBT) {
        originalNetwork = (await LocalCache.getItem('network')) || 'mainnet';
        const cachedApi = await LocalCache.getItem(`api_${originalNetwork}`);
        originalApiUrl = cachedApi || '';
        if (!originalApiUrl) {
          originalApiUrl =
            originalNetwork === 'testnet3' || originalNetwork === 'testnet'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api';
        }
      }
      const ks = JSON.parse(jks || '{}');
      const partyID = ks.local_party_key;
      const allParties = [partyID];
      if (peerParty) {
        allParties.push(peerParty);
      }
      if (peerParty2) {
        allParties.push(peerParty2);
      }
      const partiesCSV = allParties.sort().join(',');
      const sessionID = await BBMTLibNativeModule.sha256(`${data}/${server}`);
      const kp = JSON.parse(keypair);
      const encKey = peerPubkey;
      const decKey = kp.privateKey;
      const sessionKey = '';
      const decoded = data.split(':');
      dbg('public-decoded', decoded);
      if (isSignPSBT) {
        // PSBT mode: decoded[1] = psbtHash, decoded[2] = peerShare
        const psbtHash = `${decoded[1]}`;
        const peerShare = `${decoded[2]}`;
        const localPsbtHash = await BBMTLibNativeModule.sha256(
          route.params.psbtBase64 || '',
        );
        dbg('starting PSBT signing...', {
          peerShare,
          peerParty,
          partyID,
          psbtHash,
          localPsbtHash,
        });
        if (peerParty === partyID) {
          throw 'Please Use "Two Different KeyShares" per Device';
        }
        if (psbtHash !== localPsbtHash) {
          throw 'Make sure you\'re signing the "Same PSBT" from Both Devices';
        }
        // Call PSBT signing - derivation paths and public keys are extracted from PSBT
        await BBMTLibNativeModule.mpcSignPSBT(
          server,
          partyID,
          partiesCSV,
          sessionID,
          sessionKey,
          encKey,
          decKey,
          jks,
          route.params.psbtBase64 || '',
        )
          .then(async (signedPsbt: any) => {
            if (
              !signedPsbt ||
              signedPsbt.includes('error') ||
              signedPsbt.includes('failed')
            ) {
              Alert.alert(
                'Operation Error',
                `Could not sign PSBT.\n${String(signedPsbt)}`,
              );
              dbg(partyID, 'PSBT signing error', String(signedPsbt));
            } else {
              dbg(partyID, 'PSBT signed successfully');
            }
            dbg('PSBT signing complete: Navigating to Wallet tab with signedPsbt');
            navigation.dispatch(
              CommonActions.reset(getResetToMainTabsWallet({signedPsbt}, { showPlay, showUtxos: showUtxosTab, showPsbt: showPsbtTab, showWallet: showWalletTab })),
            );
            setMpcDone(true);
          })
          .catch((e: any) => {
            Alert.alert(
              'Operation Error',
              `Could not sign PSBT.\n${e?.message}`,
            );
            dbg(partyID, 'PSBT signing error', e);
          })
          .finally(async () => {
            if (isMaster) {
              await waitMS(2000);
              stopRelay();
            }
            setDoingMPC(false);
          });
        return; // Exit early for PSBT
      } else {
        // Send BTC mode - derive from address using route params
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        const senderAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          net,
          addressTypeToUse,
        );
        if (peerParty === partyID) {
          throw 'Please Use "Two Different KeyShares" per Device';
        }
        if (satoshiAmount !== route.params.satoshiAmount) {
          throw 'Make sure you\'re sending the "Same Bitcoin" amount from Both Devices';
        }
        // Call MPC send BTC
        await BBMTLibNativeModule.mpcSendBTC(
          server,
          partyID,
          partiesCSV,
          sessionID,
          sessionKey,
          encKey,
          decKey,
          jks,
          path,
          btcPub,
          senderAddress,
          toAddress,
          satoshiAmount,
          satoshiFees,
        )
          .then(async (txId: any) => {
            dbg(partyID, 'txID', txId);
            const validTxID = /^[a-fA-F0-9]{64}$/.test(txId);
            if (!validTxID) {
              throw txId;
            }
            // Save pending transaction
            const pendingTxs = JSON.parse(
              (await LocalCache.getItem(`${senderAddress}-pendingTxs`)) || '{}',
            );
            pendingTxs[txId] = {
              txid: txId,
              from: senderAddress,
              to: toAddress,
              amount: satoshiAmount,
              satoshiAmount: satoshiAmount,
              satoshiFees: satoshiFees,
              sentAt: Date.now(),
              status: {
                confirmed: false,
                block_height: null,
              },
            };
            await LocalCache.setItem(
              `${senderAddress}-pendingTxs`,
              JSON.stringify(pendingTxs),
            );
            navigation.dispatch(
              CommonActions.reset(getResetToMainTabsWallet({txId}, { showPlay, showUtxos: showUtxosTab, showPsbt: showPsbtTab, showWallet: showWalletTab })),
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
            // CRITICAL: Restore original network after transaction completes (success or failure)
            // This ensures the device's active network remains unchanged
            if (originalNetwork && originalApiUrl) {
              try {
                await BBMTLibNativeModule.setBtcNetwork(originalNetwork);
                await BBMTLibNativeModule.setAPI(
                  originalNetwork,
                  originalApiUrl,
                );
                // Restore LocalCache 'api' key to original network's API
                await LocalCache.setItem('api', originalApiUrl);
                // Restore WalletService internal state
                const walletServiceRestore = WalletService.getInstance();
                (walletServiceRestore as any).currentNetwork = originalNetwork;
                (walletServiceRestore as any).currentApiUrl = originalApiUrl;
                dbg(
                  'MobilesPairing: Restored original network:',
                  originalNetwork,
                  'API:',
                  originalApiUrl,
                );
              } catch (restoreError) {
                dbg(
                  'MobilesPairing: Error restoring original network:',
                  restoreError,
                );
              }
            }
            if (isMaster) {
              await waitMS(2000);
              stopRelay();
            }
            setDoingMPC(false);
          });
      }
    } catch (error: any) {
      Alert.alert('Operation Error', error?.message || error);
      dbg(localDevice, 'keysign error', error);
      // CRITICAL: Restore original network even on error
      if (originalNetwork && originalApiUrl) {
        try {
          await BBMTLibNativeModule.setBtcNetwork(originalNetwork);
          await BBMTLibNativeModule.setAPI(originalNetwork, originalApiUrl);
          // Restore LocalCache 'api' key to original network's API
          await LocalCache.setItem('api', originalApiUrl);
          // Restore WalletService internal state
          const walletServiceError = WalletService.getInstance();
          (walletServiceError as any).currentNetwork = originalNetwork;
          (walletServiceError as any).currentApiUrl = originalApiUrl;
          dbg(
            'MobilesPairing: Restored original network (on error):',
            originalNetwork,
            'API:',
            originalApiUrl,
          );
        } catch (restoreError) {
          dbg(
            'MobilesPairing: Error restoring original network (on error):',
            restoreError,
          );
        }
      }
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
  useEffect(() => {
    let subscription: EmitterSubscription | undefined;
    const logEmitter = new NativeEventEmitter(BBMTLibNativeModule);
    let utxoRange = 0;
    let utxoIndex = 0;
    let utxoCount = 0;
    const keysignSteps = 36;
    const keygenSteps = isTrio ? 29 : 18;
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
        const progressValue =
          utxoCount > 0
            ? Math.round(prgUTXO + (utxoRange * msg.step) / keysignSteps)
            : Math.round((100 * msg.step) / keysignSteps);
        dbg(
          'progress - keysign: ',
          progressValue,
          'prgUTXO',
          prgUTXO,
          'step',
          msg.step,
          'range',
          utxoRange,
          'time',
          new Date(msg.time),
        );

        if (progressValue > 0) {
          setProgress(progressValue);
        }
        if (progressValue > 100) {
          setProgress(100);
        }
        dbg('keysign_hook_info:', msg.info);
        if (msg.done) {
          utxoIndex = 0;
          utxoCount = 0;
          utxoRange = 0;
          setProgress(100);
          setMpcDone(true);
        }
      }
      const statusDot =
        msg.step % 3 === 0 ? '.' : msg.step % 3 === 1 ? '..' : '...';
      setStatus('Processing cryptographic operations' + statusDot);
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
  }, [isTrio]);
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
      progressAnimation.value = 0;
      progressAnimation.value = withRepeat(
        withSequence(
          withTiming(1, {
            duration: 2000,
            easing: ReanimatedEasing.inOut(ReanimatedEasing.ease),
          }),
          withTiming(0, {
            duration: 2000,
            easing: ReanimatedEasing.inOut(ReanimatedEasing.ease),
          }),
        ),
        -1, // infinite repeat
      );
    } else {
      cancelAnimation(progressAnimation);
      progressAnimation.value = 0;
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
      connectionAnimation.value = withRepeat(
        withTiming(1, {
          duration: 2000,
          easing: ReanimatedEasing.linear,
        }),
        -1, // infinite repeat
      );
    } else {
      cancelAnimation(connectionAnimation);
      connectionAnimation.value = withTiming(1, {
        duration: 300,
        easing: ReanimatedEasing.linear,
      });
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
      const pinnedIPs = getPinnedRemoteIPs();
      dbg('checking lanIP given pinnedRemotes', pinnedIPs);
      const ip = await BBMTLibNativeModule.getLanIp(pinnedIPs[0] || '');
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
        let raws = (result || '').split('|').filter(Boolean);
        // In trio, ensure both peers are present; sometimes one arrives first on iOS
        if (isTrio && raws.length < 2) {
          const extraWaitUntil = Date.now() + 3000; // wait up to 3s more
          while (Date.now() < extraWaitUntil && raws.length < 2) {
            await waitMS(300);
            const updated = await LocalCache.getItem('peerFound');
            raws = (updated || result || '').split('|').filter(Boolean);
          }
        }
        const rawPrimary = raws[0] || '';
        const primary = rawPrimary.split(',');
        const peerInfo1 = (primary[0] || '').split('@');
        const _peerIP = (peerInfo1[0] || '').split(':')[0];
        setPeerIP(_peerIP || null);
        const _peerDevicePartyID = hexToString(peerInfo1[1] || '').split('@');
        const _peerDevice = _peerDevicePartyID[0] || '';
        const _peerParty = _peerDevicePartyID[1] || '';
        const remoteIDComputed = (
          await BBMTLibNativeModule.sha256(`${_peerDevice}${_peerIP}`)
        )
          .substring(0, 4)
          .toUpperCase();
        setRemoteID(remoteIDComputed);
        setPeerDevice(_peerDevice || null);
        setPeerParty(_peerParty || null);
        if (localShare && _peerParty && localShare === _peerParty) {
          throw 'Please Use Two Different KeyShares per Device';
        }
        const _peerPubkey = peerInfo1[2] || '';
        setPeerPubkey(_peerPubkey);
        const localInfo = (primary[1] || '').split('@');
        const _localIP = (localInfo[0] || '').split(':')[0];
        setLocalIP(_localIP || null);
        const localIDComputed = (
          await BBMTLibNativeModule.sha256(`${deviceName}${_localIP}`)
        )
          .substring(0, 4)
          .toUpperCase();
        setLocalID(localIDComputed);
        let device2Local: string | null = null;
        let remoteID2Computed: string | null = null;
        if (isTrio && raws.length > 1) {
          const rawSecondary = raws[1] || '';
          const secondary = rawSecondary.split(',');
          const peerInfo2 = (secondary[0] || '').split('@');
          const _peerIP2 = (peerInfo2[0] || '').split(':')[0];
          setPeerIP2(_peerIP2 || null);
          const _peerDevicePartyID2 = hexToString(peerInfo2[1] || '').split(
            '@',
          );
          const peerPubkey2Local = peerInfo2[2] || '';
          device2Local = _peerDevicePartyID2[0] || '';
          const peerParty2Raw = _peerDevicePartyID2[1] || '';
          setPeerPubkey2(peerPubkey2Local);
          remoteID2Computed = (
            await BBMTLibNativeModule.sha256(`${device2Local}${_peerIP2}`)
          )
            .substring(0, 4)
            .toUpperCase();
          setRemoteID2(remoteID2Computed);
          setPeerDevice2(device2Local || null);
          setPeerParty2(peerParty2Raw || null);
        } else {
          setPeerIP2(null);
          setRemoteID2(null);
          setPeerDevice2(null);
          setPeerParty2(null);
        }
        // Extract second peer IP for trio mode (same pattern as _peerIP)
        let _peerIP2ForRank = '';
        if (isTrio && raws.length > 1) {
          const rawSecondary = raws[1] || '';
          const secondary = rawSecondary.split(',');
          const peerInfo2ForRank = (secondary[0] || '').split('@');
          _peerIP2ForRank = (peerInfo2ForRank[0] || '').split(':')[0];
          setPeerIP2(_peerIP2ForRank || null);
        }
        const thisIDs = (_localIP || '').split(':')[0];
        const nextIDs = (_peerIP || '').split(':')[0];
        const next2IDs = (_peerIP2ForRank || '').split(':')[0];
        const thisID = Number(thisIDs.split('.')[3] || '0');
        const peerID = Number(nextIDs.split('.')[3] || '0');
        const peer2ID = Number(next2IDs.split('.')[3] || '0');
        dbg('==================== ALL IDs ==================== \n', {
          thisID,
          peerID,
          peer2ID,
        });
        dbg('==================== ALL IPs ==================== \n', {
          _localIP,
          _peerIP,
          _peerIP2ForRank,
        });
        // Default: preserve current state to avoid flicker. Duo computes immediately; trio waits for both peers.
        let master = isMaster;
        if (!isTrio) {
          master = thisID > peerID;
        }
        // Trio: determine roles KeyShare1/2/3 based on descending IP last octet
        if (isTrio && _peerIP2ForRank) {
          const ids: Array<{label: 'local' | 'peer1' | 'peer2'; val: number}> =
            [
              {label: 'local', val: thisID},
              {label: 'peer1', val: peerID},
              {
                label: 'peer2',
                val: Number(_peerIP2ForRank.split('.')[3] || '0'),
              },
            ];
          ids.sort((a, b) => b.val - a.val);
          const rankToParty = ['KeyShare1', 'KeyShare2', 'KeyShare3'];
          const labelToParty: {[k: string]: string} = {};
          ids.forEach((item, idx) => {
            labelToParty[item.label] = rankToParty[idx];
          });
          setLocalParty(labelToParty.local);
          setPeerParty(labelToParty.peer1);
          setPeerParty2(labelToParty.peer2);
          master = labelToParty.local === 'KeyShare1';
        }
        master = thisID > peerID && thisID > peer2ID;
        dbg('==================== ALL Masters ==================== \n', {
          master,
        });
        // Determine master host (highest last octet) and persist for later flows
        const candidateIPs = [_localIP, _peerIP, _peerIP2ForRank || peerIP2]
          .filter(Boolean)
          .map(x => String(x));
        let resolvedMasterHost: string | null = null;
        if (candidateIPs.length > 0) {
          resolvedMasterHost = candidateIPs.reduce((max, cur) => {
            const lastMax = Number(
              (max.split(':')[0] || '').split('.')[3] || '0',
            );
            const lastCur = Number(
              (cur.split(':')[0] || '').split('.')[3] || '0',
            );
            return lastCur > lastMax ? cur : max;
          });
        }
        setMasterHost(resolvedMasterHost);
        dbg('Master Selection', {master, masterHost: resolvedMasterHost});
        setIsMaster(master);
        setStatus('Devices Discovery Completed');
        dbg('Pairing Summary', {
          isTrio,
          isMaster: master,
          roles: {localParty, peerParty, peerParty2},
          devices: {
            local: {device: deviceName, ip: _localIP, id: localIDComputed},
            peer1: {device: _peerDevice, ip: _peerIP, id: remoteIDComputed},
            peer2: isTrio
              ? {
                  device: device2Local,
                  ip: _peerIP2ForRank || peerIP2,
                  id: remoteID2Computed || remoteID2,
                }
              : undefined,
          },
          masterHost: resolvedMasterHost,
        });
        await Promise.allSettled(promises).then(() =>
          LocalCache.removeItem('peerFound'),
        );
      } else {
        setStatus('Pairing timed out. Please try again.');
        if (isFocusedRef.current) {
          Alert.alert('Pairing Timeout', 'No peer device was detected.');
          navigation.dispatch(
            StackActions.replace('Devices Pairing', route.params),
          );
        }
      }
    } catch (error) {
      dbg('Pairing Error:', error);
      setStatus('An error occurred during pairing.');
      setPeerIP(null);
      setPeerIP2(null);
      setLocalIP(null);
      if (isFocusedRef.current) {
        Alert.alert('Error', error?.toString() || 'Unknown error occurred');
      }
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
      const result = await BBMTLibNativeModule.listenForPeers(
        deviceName,
        kp.publicKey,
        String(discoveryPort),
        String(timeout),
        isTrio ? 'trio' : 'duo',
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
    const pinnedIPs = getPinnedRemoteIPs();
    dbg('ips', {
      pinnedIPs,
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
        const pinnedCandidatesCSV = pinnedIPs
          .filter(p => isSameSubnet(ip, p))
          .join(',');
        const result = await BBMTLibNativeModule.discoverPeers(
          deviceName,
          pubkey,
          ip,
          pinnedCandidatesCSV,
          String(discoveryPort),
          String(discoveryTimeout + backOff),
          isTrio ? 'trio' : 'duo',
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
  // VPN detection
  useEffect(() => {
    const checkVPNStatus = async () => {
      try {
        const netInfo = await NetInfo.fetch();
        // Check for VPN on both platforms
        let isVPN = false;
        if (netInfo.type === 'vpn') {
          isVPN = true;
        } else if (Platform.OS === 'android' && netInfo.details) {
          // Android: Check details.isVPN if available
          const details = netInfo.details as any;
          isVPN = details.isVPN === true || false;
        } else if (
          Platform.OS === 'ios' &&
          netInfo.type === 'other' &&
          netInfo.details
        ) {
          // iOS: Check details.isVPN if available
          const details = netInfo.details as any;
          isVPN = details.isVPN === true || false;
        }
        setIsVPNConnected(isVPN);
        dbg('VPN Status:', {
          isVPN,
          type: netInfo.type,
          details: netInfo.details,
        });
      } catch (error) {
        dbg('Error checking VPN status:', error);
        setIsVPNConnected(false);
      }
    };
    // Check VPN status on mount
    checkVPNStatus();
    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener(state => {
      let isVPN = false;
      if (state.type === 'vpn') {
        isVPN = true;
      } else if (Platform.OS === 'android' && state.details) {
        const details = state.details as any;
        isVPN = details.isVPN === true || false;
      } else if (
        Platform.OS === 'ios' &&
        state.type === 'other' &&
        state.details
      ) {
        const details = state.details as any;
        isVPN = details.isVPN === true || false;
      }
      setIsVPNConnected(isVPN);
      dbg('VPN Status Changed:', {
        isVPN,
        type: state.type,
        details: state.details,
      });
    });
    return () => {
      unsubscribe();
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      dbg('MobilesPairing screen focused');
      // Re-check VPN status when screen is focused
      NetInfo.fetch().then(state => {
        let isVPN = false;
        if (state.type === 'vpn') {
          isVPN = true;
        } else if (Platform.OS === 'android' && state.details) {
          const details = state.details as any;
          isVPN = details.isVPN === true || false;
        } else if (
          Platform.OS === 'ios' &&
          state.type === 'other' &&
          state.details
        ) {
          const details = state.details as any;
          isVPN = details.isVPN === true || false;
        }
        setIsVPNConnected(isVPN);
      });
      return () => {
        dbg('MobilesPairing screen blurred');
      };
    }, []),
  );
  // Disable back button and swipe-back during "Starting peer discovery" (isPairing)
  useEffect(() => {
    navigation.setOptions({
      headerLeft: isPairing ? () => null : undefined,
      gestureEnabled: !isPairing,
    });
  }, [navigation, isPairing]);
  // Block Android hardware back button during peer discovery
  useEffect(() => {
    if (!isPairing || Platform.OS !== 'android') return undefined;
    const onBack = () => true; // prevent default (stay on screen)
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, [isPairing]);
  const styles = StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.background,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
      minHeight: 36, // Ensure consistent height
    },
    retryLink: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
      marginLeft: 6,
    },
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      marginTop: 16,
    },
    buttonFlex: {
      flex: 1,
      marginHorizontal: 6,
    },
    cancelSetupButton: {
      backgroundColor: theme.colors.background,
      borderColor: theme.colors.secondary,
      borderWidth: 1,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      minHeight: 36, // Ensure consistent height with retry button
    },
    cancelLink: {
      color: theme.colors.secondary,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
    },
    termsLink: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent
          : theme.colors.bitcoinOrange,
      textDecorationLine: 'underline',
      textAlign: 'left',
    },
    abortLink: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      textDecorationLine: 'underline',
      textAlign: 'center',
      marginTop: 12,
    },
    exitButton: {
      marginTop: 12,
      marginBottom: 4,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.shadowColor + '0A' // ~4% opacity
          : theme.colors.blackOverlay05,
      borderWidth: Platform.OS === 'android' ? 0.5 : 1, // Thinner border on Android to prevent distortion
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.border + '60'
          : theme.colors.border + '80',
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 36,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: Platform.OS === 'android' ? 0 : 1, // Remove elevation on Android to prevent border distortion
    },
    exitButtonText: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
    },
    header: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
      marginTop: 4,
      marginBottom: 8,
      textAlign: 'center',
      lineHeight: 20,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    label: {
      fontSize: theme.fontSizes?.xl || 17,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'left',
    },
    address: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      textAlign: 'left',
      flex: 1,
    },
    value: {
      fontSize: theme.fontSizes?.xl || 17,
      color: theme.colors.text,
      textAlign: 'left',
    },
    title: {
      fontSize: theme.fontSizes?.['3xl'] || 24,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
      textAlign: 'center',
      lineHeight: 28,
    },
    pairingHint: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
      marginTop: 10,
      minHeight: 36, // Ensure minimum 2-line height (18 * 2)
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    requirementsIconText: {
      color: theme.colors.background,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    requirementsTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    requirementsDescription: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.bitcoinOrange + '20',
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    checkmark: {
      color: theme.colors.background,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
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
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
    },
    networkHint: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      marginTop: 2,
      fontStyle: 'italic',
    },
    proximityHint: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
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
    threeDevicesContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    thirdPhone: {
      marginLeft: 0,
      opacity: 0.5,
      zIndex: 0,
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
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    finalStepTextContainer: {
      flex: 1,
    },
    finalStepTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 4,
    },
    finalStepDescription: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
    },
    warningHint: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      marginTop: 2,
      fontStyle: 'italic',
    },
    warningIcon: {
      fontSize: theme.fontSizes?.xl || 18,
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    backupConfirmationTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    backupConfirmationDescription: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
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
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 2,
    },
    backupCheckboxHint: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      fontStyle: 'italic',
    },
    backupCheckIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.secondary,
    },
    securityText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 10,
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
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 12,
      color: theme.colors.text,
      textAlign: 'left',
      lineHeight: 20,
    },
    checklistTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'left',
      marginBottom: 16,
      lineHeight: 26,
    },
    checkboxContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 2,
      marginVertical: 0,
    },
    keepOpenDuringSetupContainer: {
      paddingHorizontal: 8,
      marginVertical: 2,
      marginHorizontal: 4,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: 'transparent',
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    checkboxLabel: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      flex: 1,
      textAlign: 'left',
      lineHeight: 18,
    },
    deviceContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      marginBottom: 20,
      marginTop: 10,
      paddingHorizontal: 8,
    },
    deviceWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      minWidth: 80,
    },
    deviceWrapperTrio: {
      minWidth: 70,
    },
    deviceIcon: {
      width: 32,
      height: 32,
      tintColor: theme.colors.textSecondary,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    deviceActive: {
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '95'
          : theme.colors.bitcoinOrange + '95',
    },
    deviceSelfActive: {
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    deviceInactive: {
      tintColor: theme.colors.textSecondary,
    },
    deviceSelf: {
      width: 32,
      height: 32,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '80'
          : theme.colors.bitcoinOrange + '80',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    deviceName: {
      position: 'absolute',
      bottom: -20,
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      width: 120,
      lineHeight: 18,
      height: 20,
    },
    deviceNameTrio: {
      maxWidth: 100,
      fontSize: theme.fontSizes?.xs || 11,
      lineHeight: 14,
    },
    deviceID: {
      position: 'absolute',
      top: -20,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      textAlign: 'center',
      width: 120,
      lineHeight: 14,
      height: 20,
    },
    deviceIDTrio: {
      maxWidth: 75,
      fontSize: theme.fontSizes?.sm || 12,
      lineHeight: 14,
      width: 75,
    },
    statusLine: {
      width: 60,
      height: 4,
      backgroundColor: theme.colors.border,
      marginHorizontal: 4,
      borderRadius: 2,
      overflow: 'hidden',
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    statusLineTrio: {
      width: 40,
      marginHorizontal: 2,
    },
    connectionLine: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderRadius: 2,
    },
    statusText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      lineHeight: 26,
    },
    ipText: {
      fontSize: theme.fontSizes?.base || 13,
      color: theme.colors.textSecondary,
      marginBottom: 4,
      textAlign: 'left',
    },
    countdownText: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.secondary,
      textAlign: 'center',
    },
    loader: {
      marginTop: 10,
    },
    pairButtonOn: {
      marginTop: 12,
      marginBottom: 8,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
      lineHeight: 24,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.modalBackdrop,
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
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
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
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      lineHeight: 30,
    },
    modalDescription: {
      fontSize: theme.fontSizes?.lg || 16,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      textAlign: 'center',
      lineHeight: 24,
    },
    passwordContainer: {
      width: '100%',
      marginBottom: 16,
    },
    passwordLabel: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
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
      fontSize: theme.fontSizes?.lg || 16,
      color: theme.colors.text,
      minHeight: 48,
      textAlign: 'left',
    },
    eyeButton: {
      padding: 12,
    },
    eyeIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.text,
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
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      minWidth: 40,
      textAlign: 'right',
    },
    requirementsContainer: {
      marginTop: 8,
    },
    requirementText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.warningAccent,
      marginBottom: 2,
      textAlign: 'left',
      lineHeight: 16,
    },
    errorInput: {
      borderColor: theme.colors.danger,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: theme.fontSizes?.sm || 12,
      marginTop: 4,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    buttonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
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
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
    },
    disabledButton: {
      backgroundColor: theme.colors.disabled,
    },
    informationCard: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.cardBackground,
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
      fontSize: theme.fontSizes?.lg || 16,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 16,
      lineHeight: 24,
    },
    hidden: {
      display: 'none',
    },
    clickPrepare: {
      marginTop: 12,
      marginBottom: 12,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
      lineHeight: 22,
    },
    modalText: {
      fontSize: theme.fontSizes?.xl || 18,
      marginBottom: 12,
      textAlign: 'center',
      color: theme.colors.text,
      lineHeight: 24,
    },
    backupButton: {
      marginTop: 12,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary
          : theme.colors.bitcoinOrange,
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
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.background
          : theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
      lineHeight: 22,
    },
    clickButton: {
      marginTop: 8,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
      marginBottom: 16,
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 16,
    },
    progressText: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '20'
          : theme.colors.bitcoinOrange + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    finalizingModalIcon: {
      width: 24,
      height: 24,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      marginRight: 8,
    },
    finalizingStatusText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      flex: 1,
    },
    finalizingCountdownText: {
      fontSize: theme.fontSizes?.base || 13,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    transactionDetails: {
      padding: 6,
      paddingTop: 0,
      width: '100%',
    },
    transactionItem: {
      borderBottomWidth: 0,
      paddingVertical: 4,
      marginBottom: 4,
    },
    transactionLabel: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 2,
      textAlign: 'left',
      lineHeight: 16,
    },
    transactionItemLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    transactionItemValue: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'right',
    },
    addressContainer: {
      backgroundColor: theme.colors.background,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    addressValue: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      textAlign: 'left',
      lineHeight: 14,
    },
    derivePathInfo: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    derivePathLabel: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    derivePathValue: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.monospaceMedium,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    amountContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    amountValue: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'left',
      lineHeight: 14,
    },
    fiatValue: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
      textAlign: 'right',
      lineHeight: 14,
    },
    input: {
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 8,
      padding: 8,
      width: 140,
      height: 36,
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.text,
      marginBottom: 4,
      marginTop: 8,
      textAlign: 'left',
      backgroundColor: theme.colors.background,
    },
    vpnWarningBanner: {
      backgroundColor: theme.colors.danger,
      marginBottom: 16,
      marginHorizontal: 16,
      borderRadius: 12,
      padding: 16,
      borderWidth: 2,
      borderColor: theme.colors.danger,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    },
    vpnWarningContent: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    vpnWarningIcon: {
      width: 24,
      height: 24,
      marginRight: 12,
      tintColor: theme.colors.white,
    },
    vpnWarningTextContainer: {
      flex: 1,
    },
    vpnWarningTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: '#FFFFFF',
      marginBottom: 6,
    },
    vpnWarningMessage: {
      fontSize: theme.fontSizes?.base || 14,
      color: '#FFFFFF',
      lineHeight: 20,
    },
  });
  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flexContainer}
        behavior={'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          overScrollMode="never"
          showsVerticalScrollIndicator={false}>
          <View style={styles.innerContainer}>
            {/* VPN Warning Banner */}
            {isVPNConnected && (
              <View style={styles.vpnWarningBanner}>
                <View style={styles.vpnWarningContent}>
                  <Image
                    source={require('../assets/warning-icon.png')}
                    style={styles.vpnWarningIcon}
                    resizeMode="contain"
                  />
                  <View style={styles.vpnWarningTextContainer}>
                    <Text style={styles.vpnWarningTitle}>VPN Detected</Text>
                    <Text style={styles.vpnWarningMessage}>
                      Please turn off your VPN to ensure a secure local network
                      connection for device pairing.
                    </Text>
                  </View>
                </View>
              </View>
            )}
            {/* Title and Exit Pairing Link - Show during pairing in local mode */}
            {!isSendBitcoin && !isSignPSBT && isPairing && !peerIP && (
              <View style={styles.informationCard}>
                <Text
                  style={[
                    styles.securityText,
                    {
                      fontSize: theme.fontSizes?.xl || 18,
                      fontFamily: theme.fontFamilies?.bold,
                    },
                  ]}>
                  {title}
                </Text>
                <AppPressable
                  onPress={() => {
                    HapticFeedback.medium();
                    navigation.dispatch(
                      CommonActions.reset({
                        index: 0,
                        routes: [{name: 'Welcome'}],
                      }),
                    );
                  }}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                  style={styles.exitButton}>
                  <Text style={styles.exitButtonText}>Exit Pairing</Text>
                </AppPressable>
              </View>
            )}
            {/* Checklist Section */}
            {!isPairing && !peerIP && (
              <View style={styles.informationCard}>
                <Text
                  style={[
                    styles.securityText,
                    {
                      fontSize: theme.fontSizes?.xl || 18,
                      fontFamily: theme.fontFamilies?.bold,
                    },
                  ]}>
                  {title}
                </Text>
                {!isSendBitcoin && !isSignPSBT && (
                  <>
                    <AppPressable
                      onPress={() => {
                        HapticFeedback.medium();
                        navigation.dispatch(
                          CommonActions.reset({
                            index: 0,
                            routes: [{name: 'Welcome'}],
                          }),
                        );
                      }}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                      style={styles.exitButton}>
                      <Text style={styles.exitButtonText}>Exit Pairing</Text>
                    </AppPressable>
                  </>
                )}
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
                    {isTrio
                      ? 'Three devices are required.'
                      : 'Two devices are required.'}
                  </Text>
                  {[
                    {
                      key: 'twoDevices',
                      label: isTrio
                        ? 'All devices are nearby'
                        : 'Both devices are nearby',
                      icon: 'pair',
                    },
                    {
                      key: 'sameNetwork',
                      label: isTrio
                        ? 'All on same network'
                        : 'Both on same network',
                      icon: 'wifi',
                    },
                    {
                      key: 'noVPN',
                      label: 'No VPN apps active',
                      icon: 'vpn',
                      hint: 'VPN may break local pairing',
                    },
                  ].map(item => (
                    <AppPressable
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
                          {item.key === 'noVPN' && item.hint && (
                            <Text style={styles.networkHint}>
                              ({item.hint})
                            </Text>
                          )}
                        </View>
                        {item.icon === 'pair' ? (
                          isTrio ? (
                            <View style={styles.threeDevicesContainer}>
                              <Image
                                source={require('../assets/phone-icon.png')}
                                style={styles.checkboxIconImage}
                                resizeMode="contain"
                              />
                              <Image
                                source={require('../assets/phone-icon.png')}
                                style={styles.checkboxIconImage}
                                resizeMode="contain"
                              />
                              <Image
                                source={require('../assets/phone-icon.png')}
                                style={styles.checkboxIconImage}
                                resizeMode="contain"
                              />
                            </View>
                          ) : (
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
                          )
                        ) : item.icon === 'wifi' ? (
                          <Image
                            source={require('../assets/wifi-icon.png')}
                            style={styles.checkboxIconImage}
                            resizeMode="contain"
                          />
                        ) : item.icon === 'vpn' ? (
                          <Image
                            source={require('../assets/vpn-icon.png')}
                            style={styles.checkboxIconImage}
                            resizeMode="contain"
                          />
                        ) : null}
                      </View>
                    </AppPressable>
                  ))}
                </View>
                <Text style={styles.pairingHint}>
                  ⚠️ Tip: for ultimate privacy and reliability, put one device
                  in Hotspot mode, and connect the{' '}
                  {isTrio ? 'other devices' : 'other device'} to it.
                </Text>
                {/* Pairing Button */}
                {!isPairing && !peerIP && (
                  <AppPressable
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
                        source={require('../assets/pairing-icon.png')}
                        style={{
                          width: 22,
                          height: 22,
                          marginRight: 8,
                          tintColor: theme.colors.white,
                        }}
                        resizeMode="contain"
                      />
                      <Text style={styles.pairButtonText}>Pair Devices</Text>
                    </View>
                  </AppPressable>
                )}
              </View>
            )}
            {/* Pairing Visual */}
            {!mpcDone && (isPairing || peerIP) && (
              <View style={styles.informationCard}>
                <View style={styles.deviceContainer}>
                  <View
                    style={[
                      styles.deviceWrapper,
                      isTrio && styles.deviceWrapperTrio,
                    ]}>
                    {localID && (
                      <Text
                        style={[styles.deviceID, isTrio && styles.deviceIDTrio]}
                        numberOfLines={1}
                        ellipsizeMode="tail">
                        🏷{localID}
                      </Text>
                    )}
                    <Image
                      source={require('../assets/phone-icon.png')}
                      style={[
                        styles.deviceSelf,
                        localIP
                          ? styles.deviceSelfActive
                          : styles.deviceInactive,
                      ]}
                    />
                    {localDevice && (
                      <Text
                        style={[
                          styles.deviceName,
                          isTrio && styles.deviceNameTrio,
                        ]}
                        ellipsizeMode="tail">
                        {localDevice}
                      </Text>
                    )}
                  </View>
                  <View
                    style={[
                      styles.statusLine,
                      isTrio && styles.statusLineTrio,
                    ]}>
                    <ConnectionLineAnimatedView
                      style={styles.connectionLine}
                      connectionAnimation={connectionAnimation}
                    />
                  </View>
                  {isTrio && (
                    <>
                      <View
                        style={[
                          styles.deviceWrapper,
                          isTrio && styles.deviceWrapperTrio,
                        ]}>
                        {remoteID2 && (
                          <Text
                            style={[
                              styles.deviceID,
                              isTrio && styles.deviceIDTrio,
                            ]}
                            numberOfLines={1}
                            ellipsizeMode="tail">
                            🏷{remoteID2}
                          </Text>
                        )}
                        <Image
                          source={require('../assets/phone-icon.png')}
                          style={[
                            styles.deviceIcon,
                            peerIP2
                              ? styles.deviceActive
                              : styles.deviceInactive,
                          ]}
                        />
                        {peerIP2 && (
                          <Text
                            style={[
                              styles.deviceName,
                              isTrio && styles.deviceNameTrio,
                            ]}
                            numberOfLines={2}
                            ellipsizeMode="tail">
                            {peerDevice2 || 'Other Device'}
                          </Text>
                        )}
                      </View>
                      <View
                        style={[
                          styles.statusLine,
                          isTrio && styles.statusLineTrio,
                        ]}>
                        <ConnectionLineAnimatedView
                          style={styles.connectionLine}
                          connectionAnimation={connectionAnimation}
                        />
                      </View>
                    </>
                  )}
                  <View
                    style={[
                      styles.deviceWrapper,
                      isTrio && styles.deviceWrapperTrio,
                    ]}>
                    {remoteID && (
                      <Text
                        style={[styles.deviceID, isTrio && styles.deviceIDTrio]}
                        numberOfLines={1}
                        ellipsizeMode="tail">
                        🏷{remoteID}
                      </Text>
                    )}
                    <Image
                      source={require('../assets/phone-icon.png')}
                      style={[
                        styles.deviceIcon,
                        peerIP ? styles.deviceActive : styles.deviceInactive,
                      ]}
                    />
                    {peerIP && (
                      <Text
                        style={[
                          styles.deviceName,
                          isTrio && styles.deviceNameTrio,
                        ]}
                        numberOfLines={2}
                        ellipsizeMode="tail">
                        {peerDevice ||
                          (isTrio ? 'Other Device' : 'Peer Device')}
                      </Text>
                    )}
                  </View>
                </View>
                {/* Security Code Matching Hint */}
                {peerIP && (
                  <Text
                    style={styles.pairingHint}
                    numberOfLines={2}
                    adjustsFontSizeToFit={true}
                    minimumFontScale={0.8}>
                    ⚠️ Make sure every device security code 🏷 **** matches on
                    all other devices screens.
                  </Text>
                )}
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
                  <View style={styles.buttonRow}>
                    {/* Retry button (left) */}
                    <AppPressable
                      style={[styles.retryButton, styles.buttonFlex]}
                      onPress={() => {
                        HapticFeedback.light();
                        navigation.dispatch(
                          StackActions.replace('Devices Pairing', route.params),
                        );
                      }}>
                      <Image
                        source={require('../assets/refresh-icon.png')}
                        style={{
                          width: 18,
                          height: 18,
                          tintColor:
                            theme.colors.background === '#ffffff'
                              ? theme.colors.white
                              : theme.colors.text,
                        }}
                        resizeMode="contain"
                      />
                      <Text style={styles.retryLink}>Retry</Text>
                    </AppPressable>
                    {/* Cancel button for setup modes (duo/trio) - right */}
                    {!isSendBitcoin && !isSignPSBT && (
                      <AppPressable
                        style={[styles.cancelSetupButton, styles.buttonFlex]}
                        onPress={() => {
                          HapticFeedback.light();
                          navigation.dispatch(
                            CommonActions.reset({
                              index: 0,
                              routes: [{name: 'Welcome'}],
                            }),
                          );
                        }}>
                        <Text style={styles.cancelLink}>Cancel</Text>
                      </AppPressable>
                    )}
                  </View>
                )}
              </View>
            )}
            {!isSendBitcoin && !isSignPSBT && (
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
                            tintColor:
                              theme.colors.background === '#ffffff'
                                ? theme.colors.primary
                                : theme.colors.bitcoinOrange,
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
                          <View style={{flex: 1}}>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginBottom: 8,
                              }}>
                              <Image
                                source={require('../assets/security-icon.png')}
                                style={{
                                  width: 24,
                                  height: 24,
                                  marginRight: 8,
                                  tintColor:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary
                                      : theme.colors.bitcoinOrange,
                                }}
                                resizeMode="contain"
                              />
                              <Text
                                style={{
                                  fontSize: theme.fontSizes?.xl || 18,
                                  fontFamily: theme.fontFamilies.bold,
                                  color: theme.colors.text,
                                  marginRight: 8,
                                }}>
                                Superior Security
                              </Text>
                              <View
                                style={{
                                  backgroundColor:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary + '20'
                                      : theme.colors.bitcoinOrange + '20',
                                  paddingHorizontal: 8,
                                  paddingVertical: 2,
                                  borderRadius: 8,
                                }}>
                                <Text
                                  style={{
                                    fontSize: theme.fontSizes?.xs || 9,
                                    fontFamily: theme.fontFamilies.bold,
                                    color:
                                      theme.colors.background === '#ffffff'
                                        ? theme.colors.primary
                                        : theme.colors.bitcoinOrange,
                                    letterSpacing: 1,
                                  }}>
                                  ENTERPRISE-GRADE
                                </Text>
                              </View>
                            </View>
                            <Text
                              style={{
                                fontSize: theme.fontSizes?.base || 13,
                                fontFamily: theme.fontFamilies.regular,
                                color: theme.colors.textSecondary,
                                lineHeight: 18,
                              }}>
                              <Text
                                style={{
                                  fontSize: theme.fontSizes?.base || 13,
                                  fontFamily: theme.fontFamilies.bold,
                                  color:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary
                                      : theme.colors.bitcoinOrange,
                                  fontStyle: 'italic',
                                }}>
                                Institutional-grade security in the palm of your
                                hands.
                              </Text>{' '}
                              MPC•TSS cryptography ensures your keys are
                              distributed across devices—no single device can
                              compromise your wallet.{' '}
                              <Text
                                style={{
                                  fontSize: theme.fontSizes?.base || 13,
                                  fontFamily: theme.fontFamilies.medium,
                                  color:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.accent
                                      : theme.colors.bitcoinOrange,
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
                        <AppPressable
                          style={[
                            styles.checkboxContainer,
                            styles.keepOpenDuringSetupContainer,
                            isPrepared && styles.enhancedCheckboxContainerChecked,
                          ]}
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
                        </AppPressable>
                        <AppPressable
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
                                tintColor: theme.colors.white,
                              }}
                              resizeMode="contain"
                            />
                            <Text style={styles.clickButtonText}>
                              Prepare Device
                            </Text>
                          </View>
                        </AppPressable>
                        {/* Show Countdown Timer During Pairing */}
                        {isPreparing && (
                          <Modal
                            transparent={true}
                            visible={isPreparing}
                            onRequestClose={() => {} /* non-dismissible: block Android back */}>
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
                                      <ProgressBarAnimatedView
                                        style={styles.horizontalProgressBar}
                                        progressAnimation={progressAnimation}
                                        backgroundColor={
                                          theme.colors.background === '#ffffff'
                                            ? theme.colors.primary
                                            : theme.colors.bitcoinOrange
                                        }
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
                          <View
                            style={
                              isTrio
                                ? styles.threeDevicesContainer
                                : styles.twoPhonesContainer
                            }>
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
                            {isTrio && (
                              <Image
                                source={require('../assets/phone-icon.png')}
                                style={[
                                  styles.finalStepPhoneIcon,
                                  styles.thirdPhone,
                                ]}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                        </View>
                        <View style={styles.finalStepTextContainer}>
                          <Text style={styles.finalStepTitle}>Final Step</Text>
                          <Text style={styles.finalStepDescription}>
                            Make sure {isTrio ? 'all devices' : 'both devices'}{' '}
                            preparation step is complete.
                          </Text>
                        </View>
                      </View>
                      <AppPressable
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
                            All devices are ready
                          </Text>
                          <Text style={styles.warningHint}>
                            Do not leave the app during setup.
                          </Text>
                        </View>
                        <Text style={styles.warningIcon}>⚠️</Text>
                      </AppPressable>
                      {doingMPC && (
                        <Modal
                          transparent={true}
                          visible={doingMPC}
                          animationType="fade"
                          onRequestClose={() => {} /* non-dismissible: block Android back */}>
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
                                  color={
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary
                                      : theme.colors.accent
                                  }
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
                                    {status}
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
                      <AppPressable
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
                              tintColor: theme.colors.white,
                            }}
                            resizeMode="contain"
                          />
                          <Text style={styles.clickButtonText}>
                            {isMaster ? 'Start' : 'Join'} Setup
                          </Text>
                        </View>
                      </AppPressable>
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
                            tintColor:
                              theme.colors.background === '#ffffff'
                                ? theme.colors.secondary
                                : theme.colors.bitcoinOrange,
                          }}
                          resizeMode="contain"
                        />
                        <Text
                          style={[
                            styles.statusText,
                            {
                              fontFamily: theme.fontFamilies.bold,
                              fontSize: theme.fontSizes?.['2xl'] || 20,
                            },
                          ]}>
                          Keyshare Created!
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.statusText,
                          {
                            fontFamily: theme.fontFamilies.regular,
                            fontSize: theme.fontSizes?.md || 15,
                            color: theme.colors.textSecondary,
                          },
                        ]}>
                        Create secure backups of your keyshares. Store each
                        device's backup in different locations to prevent single
                        points of failure.
                      </Text>
                      <AppPressable
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
                      </AppPressable>
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
                        Verify that {isTrio ? 'all devices' : 'both devices'}{' '}
                        have successfully backed up their keyshares.
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
                          ...(isTrio
                            ? [
                                {
                                  key: 'deviceThree',
                                  label: `${peerDevice2} backed up`,
                                  device: peerDevice2,
                                },
                              ]
                            : []),
                        ].map(item => (
                          <AppPressable
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
                          </AppPressable>
                        ))}
                      </View>
                      <AppPressable
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
                              routes: [{name: 'User Preferences'}],
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
                              tintColor: theme.colors.white,
                            }}
                            resizeMode="contain"
                          />
                          <Text style={styles.pairButtonText}>Continue</Text>
                        </View>
                      </AppPressable>
                    </View>
                  </>
                )}
              </>
            )}
            {peerIP && (isSendBitcoin || isSignPSBT) && (
              <>
                <View style={styles.informationCard}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 8,
                    }}>
                    <Image
                      source={require('../assets/cosign-icon.png')}
                      style={{
                        width: 28,
                        height: 28,
                        marginRight: 8,
                        tintColor:
                          theme.colors.background === '#ffffff'
                            ? theme.colors.primary
                            : theme.colors.bitcoinOrange,
                        marginBottom: 8,
                      }}
                      resizeMode="contain"
                    />
                    <Text
                      style={[
                        styles.title,
                        {fontSize: theme.fontSizes?.md || 15},
                      ]}>
                      {isSignPSBT ? 'PSBT Co-Signing' : 'Co-Signing'}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.header,
                      {fontSize: theme.fontSizes?.base || 13, marginBottom: 8},
                    ]}>
                    {isTrio
                      ? 'All devices must be ready.'
                      : 'Both devices must be ready.'}
                  </Text>
                  {isSendBitcoin && (
                    <View
                      style={[
                        styles.transactionDetails,
                        {
                          backgroundColor: theme.colors.cardBackground,
                          borderRadius: 12,
                          padding: 12,
                          borderWidth: 1.5,
                          borderColor: theme.colors.border,
                        },
                      ]}>
                      {/* Network Badge */}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginBottom: 6,
                          paddingVertical: 2,
                          marginTop: 8,
                        }}>
                        <View
                          style={{
                            backgroundColor:
                              theme.colors.background === '#ffffff'
                                ? theme.colors.primary + '20'
                                : theme.colors.bitcoinOrange + '20',
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 4,
                          }}>
                          <Text
                            style={{
                              fontSize: theme.fontSizes?.xs || 10,
                              fontFamily: theme.fontFamilies.bold,
                              color:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.bitcoinOrange,
                              textTransform: 'uppercase',
                              letterSpacing: 0.5,
                            }}>
                            {(() => {
                              const net =
                                route.params?.network || currentNetwork;
                              const normalizedNet =
                                net === 'testnet3' ? 'testnet' : net;
                              return normalizedNet === 'testnet'
                                ? 'Testnet'
                                : 'Mainnet';
                            })()}
                          </Text>
                        </View>
                      </View>
                      {fromAddress && (
                        <View
                          style={[
                            styles.transactionItem,
                            {paddingVertical: 2, marginBottom: 3},
                          ]}>
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 2,
                            }}>
                            <Text
                              style={[
                                styles.transactionLabel,
                                {
                                  fontSize: theme.fontSizes?.sm || 12,
                                  lineHeight: 14,
                                },
                              ]}>
                              From Address
                            </Text>
                            {currentDerivationPath && (
                              <Text
                                style={{
                                  fontSize: theme.fontSizes?.xs || 10,
                                  fontFamily: theme.fontFamilies?.monospace,
                                  fontStyle: 'italic',
                                  color: theme.colors.textSecondary,
                                  marginLeft: 6,
                                  textAlign: 'right',
                                  flex: 1,
                                  flexShrink: 1,
                                }}>
                                {currentDerivationPath}
                              </Text>
                            )}
                          </View>
                          <View style={styles.addressContainer}>
                            <Text
                              style={styles.addressValue}
                              numberOfLines={1}
                              ellipsizeMode="middle">
                              {fromAddress}
                            </Text>
                          </View>
                        </View>
                      )}
                      <View
                        style={[
                          styles.transactionItem,
                          {paddingVertical: 2, marginBottom: 3},
                        ]}>
                        <Text
                          style={[
                            styles.transactionLabel,
                            {
                              fontSize: theme.fontSizes?.sm || 12,
                              lineHeight: 14,
                            },
                          ]}>
                          To Address
                        </Text>
                        <View style={styles.addressContainer}>
                          <Text
                            style={styles.addressValue}
                            numberOfLines={1}
                            ellipsizeMode="middle">
                            {route.params.toAddress}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.transactionItem,
                          {paddingVertical: 2, marginBottom: 3},
                        ]}>
                        <Text
                          style={[
                            styles.transactionLabel,
                            {
                              fontSize: theme.fontSizes?.sm || 12,
                              lineHeight: 14,
                            },
                          ]}>
                          Transaction Amount
                        </Text>
                        <View style={styles.amountContainer}>
                          <Text
                            style={[
                              styles.amountValue,
                              {fontSize: theme.fontSizes?.base || 13},
                            ]}>
                            {sat2btcStr(route.params.satoshiAmount)} BTC
                          </Text>
                          <Text
                            style={[
                              styles.fiatValue,
                              {fontSize: theme.fontSizes?.sm || 12},
                            ]}>
                            {route.params.selectedCurrency}{' '}
                            {formatFiat(route.params.fiatAmount)}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.transactionItem,
                          {paddingVertical: 2, marginBottom: 0},
                        ]}>
                        <Text
                          style={[
                            styles.transactionLabel,
                            {
                              fontSize: theme.fontSizes?.sm || 12,
                              lineHeight: 14,
                            },
                          ]}>
                          Transaction Fee
                        </Text>
                        <View style={styles.amountContainer}>
                          <Text
                            style={[
                              styles.amountValue,
                              {fontSize: theme.fontSizes?.base || 13},
                            ]}>
                            {sat2btcStr(route.params.satoshiFees)} BTC
                          </Text>
                          <Text
                            style={[
                              styles.fiatValue,
                              {fontSize: theme.fontSizes?.sm || 12},
                            ]}>
                            {route.params.selectedCurrency}{' '}
                            {formatFiat(route.params.fiatFees)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                  {isSignPSBT && (
                    <View style={styles.transactionDetails}>
                      <Text
                        style={[
                          styles.transactionLabel,
                          {
                            fontSize: theme.fontSizes?.base || 14,
                            marginBottom: 8,
                          },
                        ]}>
                        PSBT Ready to Sign
                      </Text>
                      {psbtDetails ? (
                        <>
                          <View
                            style={[
                              styles.transactionItem,
                              {
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 4,
                                paddingVertical: 2,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.transactionItemLabel,
                                {fontSize: theme.fontSizes?.sm || 12},
                              ]}>
                              Inputs:
                            </Text>
                            <Text
                              style={[
                                styles.transactionItemValue,
                                {fontSize: theme.fontSizes?.sm || 12},
                              ]}>
                              {psbtDetails.inputs.length}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.transactionItem,
                              {
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 4,
                                paddingVertical: 2,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.transactionItemLabel,
                                {fontSize: theme.fontSizes?.sm || 12},
                              ]}>
                              Outputs:
                            </Text>
                            <Text
                              style={[
                                styles.transactionItemValue,
                                {fontSize: theme.fontSizes?.sm || 12},
                              ]}>
                              {psbtDetails.outputs.length}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.transactionItem,
                              {
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 4,
                                paddingVertical: 2,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.transactionItemLabel,
                                {fontSize: theme.fontSizes?.sm || 12},
                              ]}>
                              Total Input:
                            </Text>
                            <Text
                              style={[
                                styles.transactionItemValue,
                                {
                                  fontSize: theme.fontSizes?.base || 13,
                                  fontFamily: theme.fontFamilies.bold,
                                },
                              ]}>
                              {sat2btcStr(psbtDetails.totalInput)} BTC
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.transactionItem,
                              {
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 4,
                                paddingVertical: 2,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.transactionItemLabel,
                                {fontSize: theme.fontSizes?.sm || 12},
                              ]}>
                              Total Output:
                            </Text>
                            <Text
                              style={[
                                styles.transactionItemValue,
                                {
                                  fontSize: theme.fontSizes?.base || 13,
                                  fontFamily: theme.fontFamilies.bold,
                                },
                              ]}>
                              {sat2btcStr(psbtDetails.totalOutput)} BTC
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.transactionItem,
                              {
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 0,
                                paddingVertical: 2,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.transactionItemLabel,
                                {fontSize: theme.fontSizes?.sm || 12},
                              ]}>
                              Fee:
                            </Text>
                            <Text
                              style={[
                                styles.transactionItemValue,
                                {
                                  fontSize: theme.fontSizes?.base || 13,
                                  fontFamily: theme.fontFamilies.bold,
                                },
                              ]}>
                              {sat2btcStr(psbtDetails.fee)} BTC
                            </Text>
                          </View>
                          {psbtDetails.derivePaths &&
                            psbtDetails.derivePaths.length > 1 && (
                              <View
                                style={[
                                  styles.transactionItem,
                                  {
                                    marginTop: 4,
                                    paddingTop: 4,
                                    borderTopWidth: 1,
                                    borderTopColor: theme.colors.border,
                                    paddingVertical: 2,
                                  },
                                ]}>
                                <Text
                                  style={[
                                    styles.transactionItemValue,
                                    {fontSize: theme.fontSizes?.xs || 10},
                                  ]}>
                                  {psbtDetails.derivePaths.length} different
                                  paths
                                </Text>
                              </View>
                            )}
                        </>
                      ) : (
                        <Text
                          style={[
                            styles.addressValue,
                            {
                              marginTop: 4,
                              marginBottom: 4,
                              fontSize: theme.fontSizes?.sm || 12,
                            },
                          ]}>
                          {route.params.psbtBase64
                            ? `PSBT (${Math.round(
                                (route.params.psbtBase64.length || 0) / 1024,
                              )} KB) - Parsing...`
                            : 'No PSBT data'}
                        </Text>
                      )}
                    </View>
                  )}
                  <AppPressable
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
                  </AppPressable>
                  {doingMPC && (
                    <Modal
                      transparent={true}
                      visible={doingMPC}
                      animationType="fade"
                      onRequestClose={() => {} /* non-dismissible: block Android back */}>
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
                            {isSignPSBT
                              ? 'PSBT Co-Signing'
                              : 'Co-Signing Your Transaction'}
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
                              color={
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.accent
                              }
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
                                {status}
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
                  <AppPressable
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
                        source={require('../assets/cosign-icon.png')}
                        style={{
                          width: 20,
                          height: 20,
                          marginRight: 8,
                          tintColor: theme.colors.white,
                        }}
                        resizeMode="contain"
                      />
                      <Text style={styles.clickButtonText}>
                        {isSignPSBT
                          ? `${isMaster ? 'Start' : 'Join'} PSBT Signing`
                          : `${isMaster ? 'Start' : 'Join'} Co-Signing`}
                      </Text>
                    </View>
                  </AppPressable>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Backup Modal */}
      <BackupKeyshareModal
        visible={isBackupModalVisible}
        onClose={() => setIsBackupModalVisible(false)}
      />
    </SafeAreaView>
  );
};
export default MobilesPairing;
