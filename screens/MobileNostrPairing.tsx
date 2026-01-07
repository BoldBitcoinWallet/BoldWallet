/* eslint-disable react-native/no-inline-styles */
import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Image,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  NativeEventEmitter,
  EmitterSubscription,
  Animated,
  Keyboard,
} from 'react-native';
import Share from 'react-native-share';
import {NativeModules} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import QRScanner from '../components/QRScanner';
import * as Progress from 'react-native-progress';
import {CommonActions, RouteProp, useRoute} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Big from 'big.js';
import {
  dbg,
  HapticFeedback,
  getNostrRelays,
  getKeyshareLabel,
  hexToString,
} from '../utils';
import {useTheme} from '../theme';
import LocalCache from '../services/LocalCache';
import {WalletService} from '../services/WalletService';
import RNFS from 'react-native-fs';

const {BBMTLibNativeModule} = NativeModules;

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

const MobileNostrPairing = ({navigation}: any) => {
  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const isSendBitcoin = route.params?.mode === 'send_btc';
  const isSignPSBT = route.params?.mode === 'sign_psbt';
  const setupMode = route.params?.mode;
  // In send mode, determine isTrio from keyshare (3 devices = trio, 2 devices = duo)
  // In keygen mode, use setupMode
  const [isTrio, setIsTrio] = useState<boolean>(setupMode === 'trio');
  const {theme} = useTheme();
  const ppmFile = `${RNFS.DocumentDirectoryPath}/ppm.json`;

  // Nostr Identity
  const [localNsec, setLocalNsec] = useState<string>('');
  const [localNpub, setLocalNpub] = useState<string>('');
  const [deviceName, setDeviceName] = useState<string>('');

  // Relays - Load from cache or use defaults
  const [relaysInput, setRelaysInput] = useState<string>('');
  const [relays, setRelays] = useState<string[]>([]);

  // Partial nonce (random UUID/number generated on each device)
  const [partialNonce, setPartialNonce] = useState<string>('');

  // Peer Connections (for duo: 1 peer, for trio: 2 peers)
  const [peerConnectionDetails1, setPeerConnectionDetails1] =
    useState<string>('');
  const [peerNpub1, setPeerNpub1] = useState<string>('');
  const [peerDeviceName1, setPeerDeviceName1] = useState<string>('');
  const [peerNonce1, setPeerNonce1] = useState<string>('');
  const [peerConnectionDetails2, setPeerConnectionDetails2] =
    useState<string>('');
  const [peerNpub2, setPeerNpub2] = useState<string>('');
  const [peerDeviceName2, setPeerDeviceName2] = useState<string>('');
  const [peerNonce2, setPeerNonce2] = useState<string>('');
  const [peerInputError1, setPeerInputError1] = useState<string>('');
  const [peerInputError2, setPeerInputError2] = useState<string>('');
  const [peerInputValidating1, setPeerInputValidating1] =
    useState<boolean>(false);
  const [peerInputValidating2, setPeerInputValidating2] =
    useState<boolean>(false);

  // Session (generated deterministically)
  const [sessionID, setSessionID] = useState<string>('');
  const [sessionKey, setSessionKey] = useState<string>('');
  const [chaincode, setChaincode] = useState<string>('');

  // Progress
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [isKeygenReady, setIsKeygenReady] = useState(false); // Manual toggle for "other devices ready"
  const [isKeysignReady, setIsKeysignReady] = useState(false); // Manual toggle for PSBT/send signing readiness
  const [canStartKeygen, setCanStartKeygen] = useState(false); // Auto-calculated: all conditions met
  const [mpcDone, setMpcDone] = useState(false);
  const [psbtDetails, setPsbtDetails] = useState<{
    inputs: Array<{txid: string; vout: number; amount: number}>;
    outputs: Array<{address: string; amount: number}>;
    fee: number;
    totalInput: number;
    totalOutput: number;
    derivePaths?: string[];
  } | null>(null);
  const [fromAddress, setFromAddress] = useState<string>(''); // Derived address for send transaction
  const [currentDerivationPath, setCurrentDerivationPath] = useState<string>(''); // Derivation path for display
  const [currentNetwork, setCurrentNetwork] = useState<string>('mainnet'); // Network for display
  const [isPreParamsReady, setIsPreParamsReady] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isPrepared, setIsPrepared] = useState(false);
  const [prepCounter, setPrepCounter] = useState(0);
  const progressAnimation = useRef(new Animated.Value(0)).current;
  const progressAnimationLoop = useRef<Animated.CompositeAnimation | null>(
    null,
  );

  // Backup state
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [backupChecks, setBackupChecks] = useState({
    deviceOne: false,
    deviceTwo: false,
    deviceThree: false,
  });

  // Keyshare mapping (based on sorted npubs)
  const [keyshareMapping, setKeyshareMapping] = useState<{
    keyshare1?: {npub: string; deviceName: string; isLocal: boolean};
    keyshare2?: {npub: string; deviceName: string; isLocal: boolean};
    keyshare3?: {npub: string; deviceName: string; isLocal: boolean};
  }>({});

  // Send mode: device selection (for trio mode)
  const [selectedPeerNpub, setSelectedPeerNpub] = useState<string>('');
  const [sendModeDevices, setSendModeDevices] = useState<
    Array<{
      keyshareLabel: string;
      npub: string;
      isLocal: boolean;
    }>
  >([]);

  // QR Scanner / QR Share
  const [isQRScannerVisible, setIsQRScannerVisible] = useState(false);
  const [scanningForPeer, setScanningForPeer] = useState<1 | 2>(1);
  const scanningForPeerRef = useRef<1 | 2>(1);
  const [isQRModalVisible, setIsQRModalVisible] = useState(false);
  const [showRelayConfig, setShowRelayConfig] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const connectionQrRef = useRef<any>(null);

  // Connection details for sharing (hex encoded)
  const connectionDetails = React.useMemo(() => {
    if (!localNpub || !deviceName || !partialNonce) {
      return '';
    }
    const plaintext = `${localNpub}:${deviceName}:${partialNonce}`;
    // Convert to hex encoding
    let hex = '';
    for (let i = 0; i < plaintext.length; i++) {
      const charCode = plaintext.charCodeAt(i);
      hex += charCode.toString(16).padStart(2, '0');
    }
    return hex;
  }, [localNpub, deviceName, partialNonce]);

  // Load default relays on mount (from cache if available, otherwise fetch dynamically)
  useEffect(() => {
    const loadRelays = async () => {
      try {
        // Use getNostrRelays which handles cache and fetching
        const fetchedRelays = await getNostrRelays(false);
        const relaysCSV = fetchedRelays.join(',');
        // Convert CSV to newline-separated for multiline display
        const relaysForDisplay = relaysCSV.split(',').join('\n');
        setRelaysInput(relaysForDisplay);
        setRelays(fetchedRelays);
      } catch (error) {
        dbg('Error loading relays:', error);
        // Fallback to defaults on error
        const defaults = [
          'wss://bbw-nostr.xyz',
          'wss://nostr.hifish.org',
          'wss://nostr.xxi.quest',
        ];
        const defaultsCSV = defaults.join(',');
        const defaultsForDisplay = defaultsCSV.split(',').join('\n');
        setRelaysInput(defaultsForDisplay);
        setRelays(defaults);
      }
    };
    loadRelays();
  }, []);

  // Update relays when input changes (support both comma and newline separation)
  useEffect(() => {
    const parsed = relaysInput
      .split(/[,\n]/)
      .map(r => r.trim())
      .filter(Boolean);
    setRelays(parsed);
  }, [relaysInput]);

  // Clear all cache when entering wallet setup mode (not signing mode)
  useEffect(() => {
    const clearCacheForSetup = async () => {
      // Only clear cache if we're in setup mode (duo/trio), not signing mode
      if (setupMode === 'duo' || setupMode === 'trio') {
        try {
          dbg('=== MobileNostrPairing: Clearing all cache for wallet setup');
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

          dbg('=== MobileNostrPairing: Cache clearing completed');
        } catch (error) {
          dbg('Error clearing cache in MobileNostrPairing:', error);
        }
      }
    };
    clearCacheForSetup();
  }, [setupMode]);

  // Initialize device name and generate keypair on mount (only for keygen mode)
  useEffect(() => {
    const initialize = async () => {
      try {
        const name = await DeviceInfo.getDeviceName();
        setDeviceName(name);
        // Generate random partial nonce (UUID or random number)
        // Using a combination of timestamp and random for uniqueness
        const randomNonce = await BBMTLibNativeModule.sha256(
          `${Date.now()}-${Math.random()}`,
        );
        setPartialNonce(randomNonce);
        dbg('Generated partialNonce:', randomNonce);
        // Only generate new keypair if not in send/sign mode (send/sign mode loads from keyshare)
        if (!isSendBitcoin && !isSignPSBT) {
          await generateLocalKeypair();
        }
      } catch (error) {
        dbg('Error initializing:', error);
        Alert.alert('Error', 'Failed to initialize device');
      }
    };
    initialize();
  }, [isSendBitcoin, isSignPSBT]);

  // Generate session params when peer connections are ready
  useEffect(() => {
    if (localNpub && deviceName && partialNonce) {
      if (isSendBitcoin || isSignPSBT) {
        // For send BTC / sign PSBT, we need balance - will be generated when starting
        return;
      }
      // For keygen, generate when we have peer(s) with nonces
      if (isTrio) {
        if (
          peerNpub1 &&
          peerDeviceName1 &&
          peerNonce1 &&
          peerNpub2 &&
          peerDeviceName2 &&
          peerNonce2
        ) {
          generateKeygenSessionParams();
        }
      } else {
        if (peerNpub1 && peerDeviceName1 && peerNonce1) {
          generateKeygenSessionParams();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    localNpub,
    deviceName,
    partialNonce,
    peerNpub1,
    peerDeviceName1,
    peerNonce1,
    peerNpub2,
    peerDeviceName2,
    peerNonce2,
    isTrio,
    isSendBitcoin,
    isSignPSBT,
  ]);

  // Parse PSBT details when PSBT is available
  useEffect(() => {
    const parsePSBT = async () => {
      if (isSignPSBT && route.params?.psbtBase64) {
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
  }, [isSignPSBT, route.params?.psbtBase64]);

  // Check if all conditions are met to enable start keygen button
  // (requires preparams ready AND manual confirmation that other devices are ready)
  useEffect(() => {
    const ready =
      localNpub &&
      deviceName &&
      relays.length > 0 &&
      sessionID &&
      sessionKey &&
      chaincode &&
      isPreParamsReady &&
      isKeygenReady && // Manual confirmation that other devices are ready
      ((isTrio &&
        peerNpub1 &&
        peerDeviceName1 &&
        peerNpub2 &&
        peerDeviceName2) ||
        (!isTrio && peerNpub1 && peerDeviceName1));
    setCanStartKeygen(!!ready);
  }, [
    localNpub,
    deviceName,
    relays,
    sessionID,
    sessionKey,
    chaincode,
    isPreParamsReady,
    isKeygenReady, // Include manual toggle
    peerNpub1,
    peerDeviceName1,
    peerNpub2,
    peerDeviceName2,
    isTrio,
  ]);

  // Toggle function for manual "other devices ready" confirmation
  const toggleKeygenReady = () => {
    setIsKeygenReady(!isKeygenReady);
  };

  const toggleKeysignReady = () => {
    HapticFeedback.medium();
    setIsKeysignReady(!isKeysignReady);
  };

  // Listen to native module events for progress tracking
  useEffect(() => {
    const eventEmitter = new NativeEventEmitter(BBMTLibNativeModule);
    const keygenSteps = isTrio ? 25 : 18;
    const keysignSteps = 36;
    let utxoRange = 0;
    let utxoIndex = 0;
    let utxoCount = 0;
    const processHook = (message: string) => {
      try {
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
            dbg('keygen_hook_info:', msg.info);
            const statusDot =
              msg.step % 3 === 0 ? '.' : msg.step % 3 === 1 ? '..' : '...';
            setStatus('Processing cryptographic operations' + statusDot);
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
          dbg('btc_send_hook_info:', msg.info);
          const statusDot =
            msg.step % 3 === 0 ? '.' : msg.step % 3 === 1 ? '..' : '...';
          setStatus('Processing cryptographic operations' + statusDot);
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
          setProgress(progressValue);
          dbg('keysign_hook_info:', msg.info);
          const statusDot =
            msg.step % 3 === 0 ? '.' : msg.step % 3 === 1 ? '..' : '...';
          setStatus('Processing cryptographic operations' + statusDot);
          if (msg.done) {
            setProgress(100);
            setMpcDone(true);
          }
        }
      } catch {
        // If parsing fails, it might be a log message, just log it
        dbg('TSS log:', message);
      }
    };

    const subscription: EmitterSubscription = eventEmitter.addListener(
      Platform.OS === 'android' ? 'BBMT_DROID' : 'BBMT_APPLE',
      (event: any) => {
        if (event.tag === 'TssHook') {
          processHook(event.message);
        } else if (event.tag === 'GoLog') {
          dbg('TSS:', event.message);
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [isTrio]);

  // Load keyshare and derive device info in send mode
  useEffect(() => {
    if (!isSendBitcoin && !isSignPSBT) return;

    const loadKeyshareData = async () => {
      try {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (!keyshareJSON) {
          dbg('No keyshare found in send mode');
          setSendModeDevices([]);
          return;
        }

        const keyshare = JSON.parse(keyshareJSON);
        if (!keyshare.keygen_committee_keys || !keyshare.local_party_key) {
          dbg('Keyshare missing required fields');
          setSendModeDevices([]);
          return;
        }

        // Determine if trio mode based on number of devices in keyshare
        const numDevices = keyshare.keygen_committee_keys?.length || 0;
        const isTrioMode = numDevices === 3;
        setIsTrio(isTrioMode);
        dbg(
          'Send mode - detected',
          isTrioMode ? 'trio' : 'duo',
          'mode from keyshare (',
          numDevices,
          'devices)',
        );

        // Get local npub from keyshare
        const localNpubFromKeyshare = keyshare.nostr_npub || '';

        // Get local nsec from keyshare
        // The nsec might be stored as hex-encoded bytes OR already in bech32 format
        const nsecFromKeyshare = keyshare.nsec || '';

        if (nsecFromKeyshare) {
          // Check if it's already in bech32 format
          if (nsecFromKeyshare.startsWith('nsec1')) {
            // Already in correct format
            setLocalNsec(nsecFromKeyshare);
            dbg(
              'Nsec from keyshare (already bech32):',
              nsecFromKeyshare.substring(0, 20) + '...',
            );
          } else {
            // Try to decode from hex
            try {
              const decodedNsec = hexToString(nsecFromKeyshare);
              dbg(
                'Decoded nsec from hex:',
                decodedNsec.substring(0, 20) + '...',
              );

              // Verify it's a valid nsec format
              if (decodedNsec.startsWith('nsec1')) {
                setLocalNsec(decodedNsec);
                dbg('Nsec set successfully');
              } else {
                dbg(
                  'Warning: Decoded nsec does not start with nsec1:',
                  decodedNsec.substring(0, 50),
                );
              }
            } catch (error) {
              dbg('Error decoding nsec from hex:', error);
            }
          }
        } else {
          dbg('Warning: No nsec found in keyshare');
        }

        // Set local npub if available
        if (localNpubFromKeyshare) {
          setLocalNpub(localNpubFromKeyshare);
        }

        // Sort keygen_committee_keys to match the order used for keyshare labels
        const sortedKeys = [...keyshare.keygen_committee_keys].sort();

        // Build device list IMMEDIATELY with available data
        const devices: Array<{
          keyshareLabel: string;
          npub: string;
          isLocal: boolean;
        }> = [];

        for (let i = 0; i < sortedKeys.length; i++) {
          const hexKey = sortedKeys[i];
          const isLocal = hexKey === keyshare.local_party_key;
          const keyshareLabel = `KeyShare${i + 1}`;

          let npub = '';
          if (isLocal) {
            // Use local npub if available, otherwise use shortened hex
            npub =
              localNpubFromKeyshare ||
              hexKey.substring(0, 12) +
                '...' +
                hexKey.substring(hexKey.length - 8);
          } else {
            // For other devices, use shortened hex as placeholder, will update async
            npub =
              hexKey.substring(0, 12) +
              '...' +
              hexKey.substring(hexKey.length - 8);
          }

          devices.push({
            keyshareLabel,
            npub,
            isLocal,
          });
        }

        // Set devices immediately so UI can render
        setSendModeDevices(devices);
        dbg('Send mode devices loaded (initial):', devices);

        // Now update npubs for other devices asynchronously
        const updatedDevices = [...devices];
        for (let i = 0; i < sortedKeys.length; i++) {
          const hexKey = sortedKeys[i];
          const isLocal = hexKey === keyshare.local_party_key;

          if (!isLocal) {
            try {
              // Validate hex key format before calling hexToNpub
              const hexPattern = /^[0-9a-fA-F]+$/;
              if (!hexPattern.test(hexKey)) {
                dbg(
                  'Invalid hex key format, skipping npub conversion:',
                  hexKey.substring(0, 20) + '...',
                );
                continue;
              }

              const result = await BBMTLibNativeModule.hexToNpub(hexKey);
              if (
                result &&
                typeof result === 'string' &&
                result.startsWith('npub1')
              ) {
                const oldNpub = updatedDevices[i].npub;
                updatedDevices[i].npub = result;
                dbg(
                  'Updated npub for device:',
                  result.substring(0, 20) + '...',
                );
                // Update state with new npub
                setSendModeDevices([...updatedDevices]);

                // If this device was selected (by placeholder), update selectedPeerNpub to full npub
                // Use a callback to access current selectedPeerNpub state
                setSelectedPeerNpub(current => {
                  if (
                    current === oldNpub ||
                    (oldNpub && result.startsWith(oldNpub.substring(0, 20)))
                  ) {
                    dbg(
                      'Updated selectedPeerNpub to full npub:',
                      result.substring(0, 20) + '...',
                    );
                    return result;
                  }
                  return current;
                });
              }
            } catch (error) {
              dbg('Error converting hex to npub:', error);
              // Keep the shortened hex as fallback
            }
          }
        }
      } catch (error: any) {
        dbg('Error loading keyshare data:', error);
        setSendModeDevices([]);
      }
    };

    loadKeyshareData();
  }, [isSendBitcoin, isSignPSBT]);

  // Auto-select peer in duo mode, or first peer in trio mode (deterministic)
  // Only auto-selects if no selection exists - never overrides user's manual selection
  useEffect(() => {
    if ((isSendBitcoin || isSignPSBT) && sendModeDevices.length > 0) {
      const otherDevices = sendModeDevices.filter(d => !d.isLocal);

      // Only auto-select if no peer is currently selected
      if (!selectedPeerNpub) {
        if (isTrio && otherDevices.length >= 2) {
          // In trio mode, deterministically select the first peer (sorted by npub)
          // This ensures both devices select the same peer by default
          // User can still manually change the selection
          const sortedOtherDevices = [...otherDevices].sort((a, b) => {
            // Sort by npub (handle both full and shortened npubs)
            const npubA = a.npub || '';
            const npubB = b.npub || '';
            return npubA.localeCompare(npubB);
          });
          const firstPeer = sortedOtherDevices[0];
          if (firstPeer && firstPeer.npub) {
            setSelectedPeerNpub(firstPeer.npub);
            dbg(
              'Auto-selected first peer in trio mode (deterministic, user can change):',
              firstPeer.npub.substring(0, 20) + '...',
            );
          }
        } else if (!isTrio && otherDevices.length >= 1) {
          // In duo mode, auto-select the only other device
          const otherDevice = otherDevices[0];
          if (otherDevice && otherDevice.npub) {
            setSelectedPeerNpub(otherDevice.npub);
            dbg(
              'Auto-selected peer in duo mode:',
              otherDevice.npub.substring(0, 20) + '...',
            );
          }
        }
      }
    }
  }, [isSendBitcoin, isSignPSBT, isTrio, sendModeDevices, selectedPeerNpub]);

  // Initialize network immediately when component loads (for send Bitcoin mode)
  useEffect(() => {
    const initializeNetwork = async () => {
      if (!isSendBitcoin || !route.params) {
        // For non-send modes, use cached network
        const cachedNetwork =
          (await LocalCache.getItem('network')) || 'mainnet';
        setCurrentNetwork(cachedNetwork);
        return;
      }

      dbg('=== MobileNostrPairing: Received route params ===', {
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
      const netForDisplay = netForNative === 'testnet3' ? 'testnet' : netForNative;

      setCurrentNetwork(netForDisplay);
      
      // Also set derivation path immediately if available from route params
      if (route.params.derivationPath && route.params.derivationPath.trim() !== '') {
        setCurrentDerivationPath(route.params.derivationPath.trim());
        dbg('MobileNostrPairing: Initialized derivation path from route params:', route.params.derivationPath);
      }
      
      dbg('MobileNostrPairing: Initialized network for display:', netForDisplay, '(native format:', netForNative, ')');
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
        if (!route.params.addressType || route.params.addressType.trim() === '') {
          dbg('ERROR: Address type missing from route params in send mode');
          setFromAddress('');
          return;
        }
        if (!route.params.derivationPath || route.params.derivationPath.trim() === '') {
          dbg('ERROR: Derivation path missing from route params in send mode');
          setFromAddress('');
          return;
        }

        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (!keyshareJSON) return;

        const keyshare = JSON.parse(keyshareJSON);
        
        // ALWAYS use route params - no fallbacks
        const netForNative = route.params.network.trim();
        const addressTypeToUse = route.params.addressType.trim();
        const path = route.params.derivationPath.trim();
        
        // Normalize for display only: 'testnet3' -> 'testnet'
        const netForDisplay = netForNative === 'testnet3' ? 'testnet' : netForNative;

        dbg('=== MobileNostrPairing: Using route params ONLY (no fallbacks) ===', {
          network: netForNative,
          addressType: addressTypeToUse,
          derivationPath: path,
        });

        // Derive the public key and address
        const publicKey = await BBMTLibNativeModule.derivePubkey(
          keyshare.pub_key,
          keyshare.chain_code_hex,
          path,
        );

        // Use original network format for native module (requires 'testnet3' not 'testnet')
        const derivedAddress = await BBMTLibNativeModule.btcAddress(
          publicKey,
          netForNative,
          addressTypeToUse,
        );

        setFromAddress(derivedAddress);
        setCurrentDerivationPath(path);
        setCurrentNetwork(netForDisplay);
        dbg('=== MobileNostrPairing: Computed from address ===', {
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

  const generateLocalKeypair = async () => {
    try {
      const keypairJSON = await BBMTLibNativeModule.nostrKeypair();
      const keypair = JSON.parse(keypairJSON);
      setLocalNsec(keypair.nsec);
      setLocalNpub(keypair.npub);
      dbg(
        'Generated Nostr keypair - nsec:',
        keypair.nsec?.substring(0, 10) + '...',
      );
      dbg('Generated Nostr keypair - npub:', keypair.npub);
      dbg(
        'Generated Nostr keypair - npub format check:',
        keypair.npub?.startsWith('npub1')
          ? 'bech32 (correct)'
          : 'NOT bech32 (incorrect - should start with npub1)',
      );
    } catch (error: any) {
      dbg('Error generating keypair:', error);
      Alert.alert('Error', 'Failed to generate Nostr keypair');
    }
  };

  // Helper function to shorten npub for display
  const shortenNpub = (
    npub: string,
    startLen: number = 8,
    endLen: number = 4,
  ): string => {
    if (!npub || npub.length <= startLen + endLen) {
      return npub;
    }
    return `${npub.substring(0, startLen)}...${npub.substring(
      npub.length - endLen,
    )}`;
  };

  // Helper function to format connection details for display
  const formatConnectionDisplay = (
    npub: string,
    deviceNameValue: string,
  ): string => {
    if (!npub || !deviceNameValue) {
      return '';
    }
    return `${deviceNameValue}@${shortenNpub(npub)}`;
  };

  const parseConnectionDetails = async (
    input: string,
  ): Promise<{
    npub: string;
    deviceName: string;
    partialNonce: string;
  } | null> => {
    const trimmed = input.trim();
    dbg('parseConnectionDetails: input =', trimmed.substring(0, 50) + '...');

    if (!trimmed) {
      dbg('parseConnectionDetails: empty input');
      return null;
    }

    // Try to decode as hex first
    let decoded = '';
    try {
      // Check if it looks like hex (even length, only hex chars)
      const hexPattern = /^[0-9a-fA-F]+$/;
      if (hexPattern.test(trimmed) && trimmed.length % 2 === 0) {
        // Decode hex to string
        for (let i = 0; i < trimmed.length; i += 2) {
          const hexByte = trimmed.substr(i, 2);
          const charCode = parseInt(hexByte, 16);
          decoded += String.fromCharCode(charCode);
        }
        dbg(
          'parseConnectionDetails: decoded hex to:',
          decoded.substring(0, 50) + '...',
        );
      } else {
        // Not hex, try as plaintext (backward compatibility)
        decoded = trimmed;
        dbg('parseConnectionDetails: treating as plaintext');
      }
    } catch (error) {
      dbg('parseConnectionDetails: error decoding hex:', error);
      return null;
    }

    const parts = decoded.split(':');
    dbg('parseConnectionDetails: split parts count =', parts.length);

    if (parts.length !== 3) {
      dbg(
        'parseConnectionDetails: invalid format - expected 3 parts (npub:deviceName:partialNonce), got',
        parts.length,
      );
      return null;
    }

    let [npub, peerDeviceName, peerPartialNonce] = parts;
    let trimmedNpub = npub.trim();
    const trimmedDeviceName = peerDeviceName.trim();
    const trimmedNonce = peerPartialNonce.trim();

    dbg('parseConnectionDetails: npub =', trimmedNpub.substring(0, 20) + '...');
    dbg('parseConnectionDetails: deviceName =', trimmedDeviceName);
    dbg('parseConnectionDetails: partialNonce =', trimmedNonce);

    // Check if it's a hex string (64 hex characters) and try to convert to npub
    if (!trimmedNpub.startsWith('npub1')) {
      // Check if it's a hex string
      const hexPattern = /^[0-9a-fA-F]{64}$/;
      if (hexPattern.test(trimmedNpub)) {
        dbg(
          'parseConnectionDetails: detected hex string, attempting to convert to npub',
        );
        try {
          // Try to convert hex to npub using native module
          // First, we need to check if there's a conversion function
          // For now, we'll show a helpful error message
          dbg(
            'parseConnectionDetails: hex string detected but conversion not available',
          );
          return null; // Will show error message below
        } catch (error) {
          dbg('parseConnectionDetails: error converting hex to npub:', error);
          return null;
        }
      } else {
        dbg(
          'parseConnectionDetails: invalid npub - does not start with npub1 and is not valid hex',
        );
        return null;
      }
    }

    if (trimmedNpub.length < 10) {
      dbg('parseConnectionDetails: invalid npub - too short');
      return null;
    }

    if (trimmedDeviceName.length === 0) {
      dbg('parseConnectionDetails: invalid device name - empty');
      return null;
    }

    if (trimmedNonce.length === 0) {
      dbg('parseConnectionDetails: invalid partialNonce - empty');
      return null;
    }

    dbg(
      'parseConnectionDetails: valid! npub =',
      trimmedNpub.substring(0, 20) + '...',
      'deviceName =',
      trimmedDeviceName,
      'partialNonce =',
      trimmedNonce,
    );
    return {
      npub: trimmedNpub,
      deviceName: trimmedDeviceName,
      partialNonce: trimmedNonce,
    };
  };

  const handlePeerConnectionInput = async (input: string, peerNum: 1 | 2) => {
    dbg(`handlePeerConnectionInput: peerNum=${peerNum}, input="${input}"`);

    const setValidating =
      peerNum === 1 ? setPeerInputValidating1 : setPeerInputValidating2;
    const setError = peerNum === 1 ? setPeerInputError1 : setPeerInputError2;

    // Clear previous error
    setError('');

    // If input is empty, clear everything
    if (!input.trim()) {
      dbg(
        `handlePeerConnectionInput: peerNum=${peerNum}, clearing (empty input)`,
      );
      if (peerNum === 1) {
        setPeerNpub1('');
        setPeerDeviceName1('');
        setPeerNonce1('');
        setPeerConnectionDetails1('');
      } else {
        setPeerNpub2('');
        setPeerDeviceName2('');
        setPeerNonce2('');
        setPeerConnectionDetails2('');
      }
      return;
    }

    // Set validating state
    setValidating(true);

    // Small delay to show validation state
    await new Promise(resolve => setTimeout(resolve, 300));

    const parsed = await parseConnectionDetails(input);

    if (parsed) {
      dbg(
        `handlePeerConnectionInput: peerNum=${peerNum}, VALID - npub=${parsed.npub.substring(
          0,
          20,
        )}..., deviceName=${parsed.deviceName}`,
      );

      // Check for duplicate npubs
      const isDuplicateLocal = parsed.npub === localNpub;
      const isDuplicatePeer1 = peerNum !== 1 && parsed.npub === peerNpub1;
      const isDuplicatePeer2 = peerNum !== 2 && parsed.npub === peerNpub2;

      if (isDuplicateLocal || isDuplicatePeer1 || isDuplicatePeer2) {
        let duplicateMsg = 'This device is already connected.';
        if (isDuplicateLocal) {
          duplicateMsg = 'Cannot connect to your own device.';
        }
        dbg(
          `handlePeerConnectionInput: peerNum=${peerNum}, DUPLICATE - ${duplicateMsg}`,
        );
        setError(duplicateMsg);
        setValidating(false);
        // Clear the input text
        if (peerNum === 1) {
          setPeerConnectionDetails1('');
          setPeerNonce1('');
        } else {
          setPeerConnectionDetails2('');
          setPeerNonce2('');
        }
        return;
      }

      if (peerNum === 1) {
        setPeerNpub1(parsed.npub);
        setPeerDeviceName1(parsed.deviceName);
        setPeerNonce1(parsed.partialNonce);
        setPeerConnectionDetails1(input.trim());
        setPeerInputError1('');
      } else {
        setPeerNpub2(parsed.npub);
        setPeerDeviceName2(parsed.deviceName);
        setPeerNonce2(parsed.partialNonce);
        setPeerConnectionDetails2(input.trim());
        setPeerInputError2('');
      }

      HapticFeedback.light();
    } else {
      dbg(`handlePeerConnectionInput: peerNum=${peerNum}, INVALID`);

      // Check if it's a hex string
      const hexPattern = /^[0-9a-fA-F]{64}$/;
      const parts = input.trim().split(':');
      const firstPart = parts[0]?.trim() || '';

      let errorMsg = '';
      if (hexPattern.test(firstPart)) {
        errorMsg =
          'Hex string detected. Please use npub format (npub1...). The connection details should show the npub, not a hex string.';
      } else if (!input.includes(':')) {
        errorMsg = 'Missing colon separator. Format: npub1...:DeviceName';
      } else if (!firstPart.startsWith('npub1')) {
        errorMsg =
          'Invalid format. Expected: npub1...:DeviceName (npub must start with "npub1")';
      } else {
        errorMsg = 'Invalid format. Expected: npub1...:DeviceName';
      }

      dbg(`handlePeerConnectionInput: peerNum=${peerNum}, error="${errorMsg}"`);
      setError(errorMsg);

      // Clear the input text and peer data
      if (peerNum === 1) {
        setPeerNpub1('');
        setPeerDeviceName1('');
        setPeerNonce1('');
        setPeerConnectionDetails1('');
      } else {
        setPeerNpub2('');
        setPeerDeviceName2('');
        setPeerNonce2('');
        setPeerConnectionDetails2('');
      }
    }

    setValidating(false);
  };

  const generateKeygenSessionParams = async () => {
    try {
      // Collect all npubs and device names
      // IMPORTANT: Trim whitespace and ensure consistent format
      const allNpubs: string[] = [];
      const allDeviceNames: string[] = [];

      // Add local npub (trimmed)
      if (localNpub && localNpub.trim()) {
        allNpubs.push(localNpub.trim());
      }
      if (deviceName && deviceName.trim()) {
        allDeviceNames.push(deviceName.trim());
      }

      // Add peer 1 (trimmed)
      if (peerNpub1 && peerNpub1.trim()) {
        allNpubs.push(peerNpub1.trim());
      }
      if (peerDeviceName1 && peerDeviceName1.trim()) {
        allDeviceNames.push(peerDeviceName1.trim());
      }

      // Add peer 2 for trio (trimmed)
      if (isTrio && peerNpub2 && peerNpub2.trim()) {
        allNpubs.push(peerNpub2.trim());
      }
      if (isTrio && peerDeviceName2 && peerDeviceName2.trim()) {
        allDeviceNames.push(peerDeviceName2.trim());
      }

      // Validate we have the correct number of npubs
      const expectedNpubs = isTrio ? 3 : 2;
      if (allNpubs.length !== expectedNpubs) {
        dbg(
          `ERROR: Expected ${expectedNpubs} npubs for ${
            isTrio ? 'trio' : 'duo'
          } mode, but got ${allNpubs.length}`,
        );
        dbg(
          'allNpubs:',
          allNpubs.map(n => n.substring(0, 20) + '...'),
        );
        dbg(
          'localNpub:',
          localNpub ? localNpub.substring(0, 20) + '...' : 'MISSING',
        );
        dbg(
          'peerNpub1:',
          peerNpub1 ? peerNpub1.substring(0, 20) + '...' : 'MISSING',
        );
        if (isTrio) {
          dbg(
            'peerNpub2:',
            peerNpub2 ? peerNpub2.substring(0, 20) + '...' : 'MISSING',
          );
          dbg(
            'peerDeviceName2:',
            peerDeviceName2 ? peerDeviceName2 : 'MISSING',
          );
        }
        dbg('isTrio:', isTrio);
        return; // Don't generate session params if we don't have all npubs
      }

      // Additional validation for trio mode: ensure all 3 npubs are unique
      if (isTrio && allNpubs.length === 3) {
        const uniqueNpubs = new Set(allNpubs);
        if (uniqueNpubs.size !== 3) {
          dbg('ERROR: Duplicate npubs detected in trio mode!');
          dbg('allNpubs:', allNpubs);
          return;
        }
      }

      // Sort alphabetically - CRITICAL: must be same order on all devices
      const npubsSorted = [...allNpubs].sort().join(',');
      const deviceNamesSorted = [...allDeviceNames].sort().join(',');

      // Collect all partial nonces (local + peers)
      const allPartialNonces: string[] = [];
      if (partialNonce) {
        allPartialNonces.push(partialNonce);
      }
      if (peerNonce1) {
        allPartialNonces.push(peerNonce1);
      }
      if (isTrio && peerNonce2) {
        allPartialNonces.push(peerNonce2);
      }

      // Sort nonces and join as CSV
      const fullNonce = [...allPartialNonces].sort().join(',');

      // Log the exact inputs for session ID calculation (for debugging)
      dbg('=== SESSION ID CALCULATION ===');
      dbg('Mode:', isTrio ? 'TRIO' : 'DUO');
      dbg(
        'All npubs (before sort):',
        allNpubs.map(n => n.substring(0, 30) + '...'),
      );
      dbg(
        'All npubs (sorted):',
        npubsSorted.split(',').map(n => n.substring(0, 30) + '...'),
      );
      dbg('npubsSorted (full):', npubsSorted);
      dbg('All device names (before sort):', allDeviceNames);
      dbg('deviceNamesSorted:', deviceNamesSorted);
      dbg('All partial nonces (before sort):', allPartialNonces);
      dbg('fullNonce (sorted, CSV):', fullNonce);
      dbg(
        'Session ID input string:',
        `${npubsSorted},${deviceNamesSorted},${fullNonce}`,
      );

      // Generate session ID
      const sessionIDHash = await BBMTLibNativeModule.sha256(
        `${npubsSorted},${deviceNamesSorted},${fullNonce}`,
      );
      setSessionID(sessionIDHash);

      // Generate session key
      const sessionKeyHash = await BBMTLibNativeModule.sha256(
        `${npubsSorted},${sessionIDHash}`,
      );
      setSessionKey(sessionKeyHash);

      // Generate chaincode
      const chaincodeHash = await BBMTLibNativeModule.sha256(
        `${sessionIDHash},${sessionKeyHash}`,
      );
      setChaincode(chaincodeHash);

      dbg('Generated session params:', {
        sessionID: sessionIDHash.substring(0, 16) + '...',
        sessionKey: sessionKeyHash.substring(0, 16) + '...',
        chaincode: chaincodeHash.substring(0, 16) + '...',
        fullNonce: fullNonce,
        npubsCount: allNpubs.length,
      });
      dbg('=== END SESSION ID CALCULATION ===');
    } catch (error: any) {
      dbg('Error generating session params:', error);
      Alert.alert('Error', 'Failed to generate session parameters');
    }
  };

  const startKeygen = async () => {
    if (!canStartKeygen) return;

    setIsPairing(true);
    setProgress(0);
    setStatus('Starting key generation...');

    try {
      // Prepare parties npubs CSV (sorted)
      // IMPORTANT: Must use the same npubs and same sorting as session ID generation
      const allNpubs: string[] = [];
      if (localNpub && localNpub.trim()) {
        allNpubs.push(localNpub.trim());
      }
      if (peerNpub1 && peerNpub1.trim()) {
        allNpubs.push(peerNpub1.trim());
      }
      if (isTrio && peerNpub2 && peerNpub2.trim()) {
        allNpubs.push(peerNpub2.trim());
      }

      // Validate we have the correct number
      const expectedNpubs = isTrio ? 3 : 2;
      if (allNpubs.length !== expectedNpubs) {
        throw new Error(
          `Expected ${expectedNpubs} npubs for ${
            isTrio ? 'trio' : 'duo'
          } mode, but got ${allNpubs.length}`,
        );
      }

      // Sort alphabetically (same as session ID generation)
      const partiesNpubsCSV = allNpubs.sort().join(',');

      dbg('=== START KEYGEN ===');
      dbg('Mode:', isTrio ? 'TRIO' : 'DUO');
      dbg(
        'localNpub:',
        localNpub ? localNpub.substring(0, 30) + '...' : 'MISSING',
      );
      dbg(
        'partiesNpubsCSV (sorted, all npubs):',
        partiesNpubsCSV.split(',').map(n => n.substring(0, 30) + '...'),
      );

      // Calculate expected peers (all npubs except local)
      const expectedPeers = allNpubs.filter(n => {
        const trimmedN = n.trim();
        const trimmedLocal = localNpub?.trim() || '';
        return trimmedN !== trimmedLocal;
      });
      dbg(
        'Expected peers (excluding self):',
        expectedPeers.map(n => n.substring(0, 30) + '...'),
      );
      dbg(
        'Expected peer count:',
        expectedPeers.length,
        isTrio ? '(should be 2 for trio)' : '(should be 1 for duo)',
      );

      dbg('sessionID:', sessionID.substring(0, 16) + '...');
      dbg('sessionKey:', sessionKey.substring(0, 16) + '...');

      if (isTrio && expectedPeers.length !== 2) {
        dbg(
          '⚠️ WARNING: In trio mode, expected 2 peers but got',
          expectedPeers.length,
        );
        dbg(
          'This device will wait for',
          expectedPeers.length,
          'peers. Make sure all 3 devices have all npubs connected!',
        );
      }

      // Prepare relays CSV
      const relaysCSV = relays.join(',');

      // Save relays to cache
      await LocalCache.setItem('nostr_relays', relaysCSV);

      // Log detailed info for debugging trio mode
      dbg('Starting Nostr keygen with:', {
        relays: relaysCSV,
        parties: partiesNpubsCSV,
        sessionID: sessionID,
        ppmFile: ppmFile,
        localNsec: localNsec ? localNsec.substring(0, 20) + '...' : 'MISSING',
        partiesNpubsCSV: partiesNpubsCSV,
        sessionKey: sessionKey.substring(0, 16) + '...',
        chaincode: chaincode.substring(0, 16) + '...',
      });

      // Log which npubs will be sent to Go backend
      const allPartiesList = partiesNpubsCSV.split(',');
      dbg('=== GO BACKEND INPUT ===');
      dbg('partiesNpubsCSV (full):', partiesNpubsCSV);
      dbg(
        'All parties count:',
        allPartiesList.length,
        isTrio ? '(should be 3 for trio)' : '(should be 2 for duo)',
      );
      dbg(
        'All parties list:',
        allPartiesList.map((n, i) => `${i + 1}. ${n.substring(0, 30)}...`),
      );
      dbg(
        'localNpub (will be excluded by Go backend):',
        localNpub ? localNpub.substring(0, 30) + '...' : 'MISSING',
      );
      dbg(
        'Expected PeersNpub (after Go excludes localNpub):',
        expectedPeers.map((n, i) => `${i + 1}. ${n.substring(0, 30)}...`),
      );
      dbg(
        'Go backend will wait for',
        expectedPeers.length,
        'peers to publish "ready" events',
      );
      dbg('=== END GO BACKEND INPUT ===');

      // Call native module
      let keyshareJSON = await BBMTLibNativeModule.nostrMpcTssSetup(
        relaysCSV,
        localNsec,
        partiesNpubsCSV,
        sessionID,
        sessionKey,
        chaincode,
        ppmFile,
      );

      // Validate keyshare and map keyshare positions
      let keyshare: any;
      try {
        keyshare = JSON.parse(keyshareJSON);
        if (!keyshare.pub_key) {
          throw new Error('Invalid keyshare: missing pub_key');
        }
        dbg('Keygen successful, party:', keyshare.local_party_key);
      } catch (error) {
        dbg('Error parsing keyshare:', error);
        throw new Error('Invalid keyshare received');
      }

      // Map keyshare positions based on sorted npubs for UI display
      const sortedNpubs = allNpubs.sort();
      const mapping: {
        keyshare1?: {npub: string; deviceName: string; isLocal: boolean};
        keyshare2?: {npub: string; deviceName: string; isLocal: boolean};
        keyshare3?: {npub: string; deviceName: string; isLocal: boolean};
      } = {};

      // Map npubs to keyshare positions using keygen_committee_keys order
      // We need to match npubs to their corresponding hex keys in keygen_committee_keys
      // For now, we'll use the sorted npubs order which should match the sorted keygen_committee_keys
      sortedNpubs.forEach((npub, index) => {
        const isLocal = npub === localNpub;
        let mappedDeviceName = '';

        if (isLocal) {
          mappedDeviceName = deviceName || 'This device';
        } else if (npub === peerNpub1) {
          mappedDeviceName = peerDeviceName1 || 'Peer 1';
        } else if (npub === peerNpub2) {
          mappedDeviceName = peerDeviceName2 || 'Peer 2';
        } else {
          mappedDeviceName = `Device ${index + 1}`;
        }

        const keyshareKey = `keyshare${index + 1}` as
          | 'keyshare1'
          | 'keyshare2'
          | 'keyshare3';
        mapping[keyshareKey] = {
          npub,
          deviceName: mappedDeviceName,
          isLocal,
        };
      });

      setKeyshareMapping(mapping);
      dbg('Keyshare mapping:', mapping);

      // Save keyshare (keyshare_position will be calculated on-the-fly when needed)
      await EncryptedStorage.setItem('keyshare', keyshareJSON);
      // New wallet setups are always non-legacy, so no need to reset flag
      setMpcDone(true);
      setStatus('Key generation complete!');
      // Don't navigate away, let the backup UI handle it
    } catch (error: any) {
      dbg('Keygen error:', error);
      Alert.alert('Error', error?.message || 'Key generation failed');
      setStatus('Key generation failed');
      // Navigate to index 0 (reload same page) on keygen failure
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{name: 'Nostr Connect', params: route.params}],
        }),
      );
    } finally {
      setIsPairing(false);
    }
  };

  const startSendBTC = async () => {
    if (!route.params) {
      Alert.alert('Error', 'Missing transaction parameters');
      return;
    }

    setIsPairing(true);
    setProgress(0);
    setStatus('Starting transaction signing...');

    // Store original network/API to restore after transaction
    let originalNetwork = '';
    let originalApiUrl = '';

    try {
      // Read ALL parameters from route params ONLY (no fallbacks)
      if (!route.params?.network || route.params.network.trim() === '') {
        throw new Error('Network is required in route params');
      }
      if (!route.params?.addressType || route.params.addressType.trim() === '') {
        throw new Error('Address type is required in route params');
      }
      if (!route.params?.derivationPath || route.params.derivationPath.trim() === '') {
        throw new Error('Derivation path is required in route params');
      }
      if (!route.params?.toAddress || route.params.toAddress.trim() === '') {
        throw new Error('Destination address is required in route params');
      }
      if (!route.params?.satoshiAmount || route.params.satoshiAmount.trim() === '') {
        throw new Error('Amount is required in route params');
      }
      if (!route.params?.satoshiFees || route.params.satoshiFees.trim() === '') {
        throw new Error('Fees are required in route params');
      }

      // Extract all params from route
      const net = route.params.network.trim();
      const addressTypeToUse = route.params.addressType.trim();
      const path = route.params.derivationPath.trim();
      const toAddress = route.params.toAddress.trim();
      const satoshiAmount = route.params.satoshiAmount.trim();
      const satoshiFees = route.params.satoshiFees.trim();

      dbg('MobileNostrPairing: Using route params ONLY:', {
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
        originalApiUrl = originalNetwork === 'testnet3' || originalNetwork === 'testnet'
          ? 'https://mempool.space/testnet/api'
          : 'https://mempool.space/api';
      }

      // Set network and API in BBMTLib for this transaction
      let apiUrl = await LocalCache.getItem(`api_${net}`);
      if (!apiUrl) {
        apiUrl = net === 'testnet3' || net === 'testnet'
          ? 'https://mempool.space/testnet/api'
          : 'https://mempool.space/api';
      }
      await BBMTLibNativeModule.setBtcNetwork(net);
      await BBMTLibNativeModule.setAPI(net, apiUrl);
      dbg('MobileNostrPairing: Set network and API in BBMTLib:', net, apiUrl);

      // Get keyshare and nsec
      const keyshareJSON = await EncryptedStorage.getItem('keyshare');
      if (!keyshareJSON) {
        throw new Error('Keyshare not found');
      }
      const keyshare = JSON.parse(keyshareJSON);

      let nsecToUse = localNsec;
      if (!nsecToUse || !nsecToUse.startsWith('nsec1')) {
        const nsecFromKeyshare = keyshare.nsec || '';
        if (nsecFromKeyshare) {
          if (nsecFromKeyshare.startsWith('nsec1')) {
            nsecToUse = nsecFromKeyshare;
          } else {
            nsecToUse = hexToString(nsecFromKeyshare);
          }
          if (nsecToUse.startsWith('nsec1')) {
            setLocalNsec(nsecToUse);
          } else {
            throw new Error('Invalid nsec format in keyshare');
          }
        } else {
          throw new Error('nsec not found in keyshare');
        }
      }

      // Derive from address using route params
      const publicKey = await BBMTLibNativeModule.derivePubkey(
        keyshare.pub_key,
        keyshare.chain_code_hex,
        path,
      );
      const senderAddress = await BBMTLibNativeModule.btcAddress(
        publicKey,
        net,
        addressTypeToUse,
      );

      // Get balance for sessionFlag calculation
      const balance = await WalletService.getInstance().getWalletBalance(
        senderAddress,
        0,
        0,
        false,
      );
      const balanceSats = Big(balance.btc).times(1e8).toFixed(0);

      // Get all npubs from keyshare for sessionFlag calculation
      const allNpubsFromKeyshare: string[] = [];
      const sortedKeys = [...keyshare.keygen_committee_keys].sort();
      for (const key of sortedKeys) {
        try {
          if (key && typeof key === 'string' && key.startsWith('npub1')) {
            allNpubsFromKeyshare.push(key);
            continue;
          }
          const hexPattern = /^[0-9a-fA-F]+$/;
          if (!hexPattern.test(key)) {
            continue;
          }
          const npub = await BBMTLibNativeModule.hexToNpub(key);
          if (npub && typeof npub === 'string' && npub.startsWith('npub1')) {
            allNpubsFromKeyshare.push(npub);
          }
        } catch (error) {
          dbg('Error converting hex to npub:', error);
        }
      }

      const npubsSorted = [...allNpubsFromKeyshare].sort().join(',');
      if (npubsSorted.length === 0 || allNpubsFromKeyshare.length < 2) {
        throw new Error(
          `Failed to get all npubs from keyshare. Got ${allNpubsFromKeyshare.length} npubs.`,
        );
      }

      // Prepare parties npubs CSV for the actual signing (only participating devices)
      // IMPORTANT: Use the full npubs from allNpubsFromKeyshare (already converted from hex)
      // This ensures we use the same npubs that were used for session ID calculation
      // Find local npub in allNpubsFromKeyshare to ensure consistency
      const localNpubFromKeyshare =
        allNpubsFromKeyshare.find(n => {
          // Match by checking if localNpub (from state) matches or starts with this npub
          return (
            n === localNpub ||
            (localNpub && n.startsWith(localNpub.substring(0, 20)))
          );
        }) || localNpub; // Fallback to state if not found

      const allNpubs = [localNpubFromKeyshare];
      if (isTrio) {
        // For trio, use selected peer - find it by matching device in sendModeDevices
        if (selectedPeerNpub) {
          // Find the selected device in sendModeDevices to get its keyshareLabel
          const selectedDevice = sendModeDevices.find(
            d =>
              d.npub === selectedPeerNpub ||
              (selectedPeerNpub.startsWith('npub1') &&
                d.npub &&
                d.npub.startsWith(selectedPeerNpub.substring(0, 20))) ||
              (d.npub && selectedPeerNpub.startsWith(d.npub.substring(0, 20))),
          );

          if (selectedDevice) {
            // Find the corresponding hex key in keyshare by keyshareLabel
            // Use the same sortedKeys from above (already sorted)
            const selectedIndex =
              parseInt(
                selectedDevice.keyshareLabel.replace('KeyShare', ''),
                10,
              ) - 1;

            if (selectedIndex >= 0 && selectedIndex < sortedKeys.length) {
              const selectedHexKey = sortedKeys[selectedIndex];

              // Find the full npub in allNpubsFromKeyshare that corresponds to this hex key
              // We need to convert the hex key to npub and find it, or match by index
              // Since allNpubsFromKeyshare is built from sortedKeys in the same order, we can use index
              if (selectedIndex < allNpubsFromKeyshare.length) {
                const fullPeerNpub = allNpubsFromKeyshare[selectedIndex];
                // Verify it's not the local device
                if (fullPeerNpub !== localNpubFromKeyshare) {
                  allNpubs.push(fullPeerNpub);
                  dbg(
                    'Found full peer npub for trio by index:',
                    fullPeerNpub.substring(0, 20) + '...',
                  );
                } else {
                  throw new Error('Selected device is the local device');
                }
              } else {
                // Fallback: try to convert hex key to npub
                try {
                  const hexPattern = /^[0-9a-fA-F]+$/;
                  if (hexPattern.test(selectedHexKey)) {
                    const convertedNpub = await BBMTLibNativeModule.hexToNpub(
                      selectedHexKey,
                    );
                    if (
                      convertedNpub &&
                      convertedNpub.startsWith('npub1') &&
                      convertedNpub !== localNpubFromKeyshare
                    ) {
                      allNpubs.push(convertedNpub);
                      dbg(
                        'Found full peer npub for trio by conversion:',
                        convertedNpub.substring(0, 20) + '...',
                      );
                    } else {
                      throw new Error(
                        'Failed to convert selected hex key to npub',
                      );
                    }
                  } else {
                    throw new Error('Selected hex key is not valid hex');
                  }
                } catch (error) {
                  throw new Error(
                    `Failed to find full npub for selected peer: ${error}`,
                  );
                }
              }
            } else {
              throw new Error(
                `Invalid keyshare label: ${selectedDevice.keyshareLabel}`,
              );
            }
          } else {
            // Fallback: try direct matching in allNpubsFromKeyshare
            let fullPeerNpub = allNpubsFromKeyshare.find(
              n =>
                n === selectedPeerNpub ||
                (selectedPeerNpub.startsWith('npub1') &&
                  n.startsWith(selectedPeerNpub.substring(0, 20))),
            );

            if (fullPeerNpub && fullPeerNpub !== localNpubFromKeyshare) {
              allNpubs.push(fullPeerNpub);
              dbg(
                'Found full peer npub for trio by direct match:',
                fullPeerNpub.substring(0, 20) + '...',
              );
            } else {
              throw new Error(
                `Failed to find full npub for selected peer: ${selectedPeerNpub.substring(
                  0,
                  30,
                )}. Please ensure the device is fully loaded.`,
              );
            }
          }
        } else {
          throw new Error('Please select a peer device for trio mode');
        }
      } else {
        // For duo, use the other device from allNpubsFromKeyshare (excluding local)
        const otherNpubs = allNpubsFromKeyshare.filter(
          n => n !== localNpubFromKeyshare,
        );
        if (otherNpubs.length > 0) {
          // In duo mode, there should be exactly one other npub
          allNpubs.push(otherNpubs[0]);
          dbg(
            'Using other npub for duo:',
            otherNpubs[0].substring(0, 20) + '...',
          );
        } else {
          throw new Error('Other device npub not found in keyshare');
        }
      }
      const partiesNpubsCSV = allNpubs.sort().join(',');

      // Prepare relays CSV
      const relaysCSV = relays.join(',');

      // Call MPC send BTC
      const txId = await BBMTLibNativeModule.nostrMpcSendBTC(
        relaysCSV,
        nsecToUse,
        partiesNpubsCSV,
        npubsSorted,
        balanceSats,
        keyshareJSON,
        path,
        publicKey,
        senderAddress,
        toAddress,
        satoshiAmount,
        satoshiFees,
      );

      // Validate txId
      const validTxID = /^[a-fA-F0-9]{64}$/.test(txId);
      if (!validTxID) {
        throw new Error(txId || 'Invalid transaction ID');
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

      // Navigate to home (same as MobilesPairing.tsx)
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{name: 'Home', params: {txId}}],
        }),
      );

      setMpcDone(true);
    } catch (error: any) {
      dbg('Send BTC error:', error);
      Alert.alert('Error', error?.message || 'Transaction signing failed');
      setStatus('Transaction signing failed');
    } finally {
      // CRITICAL: Restore original network after transaction completes (success or failure)
      // This ensures the device's active network remains unchanged
      if (originalNetwork && originalApiUrl) {
        try {
          await BBMTLibNativeModule.setBtcNetwork(originalNetwork);
          await BBMTLibNativeModule.setAPI(originalNetwork, originalApiUrl);
          // Restore WalletService internal state
          const walletService = WalletService.getInstance();
          (walletService as any).currentNetwork = originalNetwork;
          (walletService as any).currentApiUrl = originalApiUrl;
          dbg('MobileNostrPairing: Restored original network:', originalNetwork, 'API:', originalApiUrl);
        } catch (restoreError) {
          dbg('MobileNostrPairing: Error restoring original network:', restoreError);
        }
      }
      setIsPairing(false);
    }
  };

  const startSignPSBT = async () => {
    if (!route.params?.psbtBase64) {
      Alert.alert('Error', 'Missing PSBT data');
      return;
    }

    if (!isKeysignReady) {
      Alert.alert(
        'Not Ready',
        'Please confirm that you are ready to sign the PSBT',
      );
      return;
    }

    setIsPairing(true);
    setProgress(0);
    setStatus('Starting PSBT signing...');

    try {
      const keyshareJSON = await EncryptedStorage.getItem('keyshare');
      if (!keyshareJSON) {
        throw new Error('Keyshare not found');
      }

      const keyshare = JSON.parse(keyshareJSON);

      // Get nsec from keyshare
      let nsecToUse = localNsec;
      if (!nsecToUse || !nsecToUse.startsWith('nsec1')) {
        const nsecFromKeyshare = keyshare.nsec || '';
        if (nsecFromKeyshare) {
          try {
            let decodedNsec = '';
            if (nsecFromKeyshare.startsWith('nsec1')) {
              decodedNsec = nsecFromKeyshare;
            } else {
              decodedNsec = hexToString(nsecFromKeyshare);
            }

            if (decodedNsec.startsWith('nsec1')) {
              nsecToUse = decodedNsec;
              setLocalNsec(decodedNsec);
            } else {
              throw new Error('Invalid nsec format in keyshare');
            }
          } catch (error) {
            throw new Error(`Failed to load nsec from keyshare: ${error}`);
          }
        } else {
          throw new Error('nsec not found in keyshare');
        }
      }

      if (!nsecToUse || !nsecToUse.startsWith('nsec1')) {
        throw new Error('Invalid nsec: must be in bech32 format (nsec1...)');
      }

      // Get all npubs from keyshare for session ID
      const allNpubsFromKeyshare: string[] = [];
      const sortedKeys = [...keyshare.keygen_committee_keys].sort();
      for (const key of sortedKeys) {
        try {
          if (key && typeof key === 'string' && key.startsWith('npub1')) {
            allNpubsFromKeyshare.push(key);
            continue;
          }
          const hexPattern = /^[0-9a-fA-F]+$/;
          if (!hexPattern.test(key)) {
            continue;
          }
          const npub = await BBMTLibNativeModule.hexToNpub(key);
          if (npub && typeof npub === 'string' && npub.startsWith('npub1')) {
            allNpubsFromKeyshare.push(npub);
          }
        } catch (error) {
          dbg('Error converting hex to npub:', error);
        }
      }

      const npubsSorted = [...allNpubsFromKeyshare].sort().join(',');

      if (npubsSorted.length === 0 || allNpubsFromKeyshare.length < 2) {
        throw new Error('Failed to get all npubs from keyshare');
      }

      // Find local npub
      const localNpubFromKeyshare =
        allNpubsFromKeyshare.find(
          n =>
            n === localNpub ||
            (localNpub && n.startsWith(localNpub.substring(0, 20))),
        ) || localNpub;

      // Build parties CSV
      const allNpubs = [localNpubFromKeyshare];
      if (isTrio) {
        if (selectedPeerNpub) {
          const selectedDevice = sendModeDevices.find(
            d =>
              d.npub === selectedPeerNpub ||
              (selectedPeerNpub.startsWith('npub1') &&
                d.npub &&
                d.npub.startsWith(selectedPeerNpub.substring(0, 20))),
          );
          if (selectedDevice) {
            const selectedIndex =
              parseInt(
                selectedDevice.keyshareLabel.replace('KeyShare', ''),
                10,
              ) - 1;
            if (
              selectedIndex >= 0 &&
              selectedIndex < allNpubsFromKeyshare.length
            ) {
              const fullPeerNpub = allNpubsFromKeyshare[selectedIndex];
              if (fullPeerNpub !== localNpubFromKeyshare) {
                allNpubs.push(fullPeerNpub);
              } else {
                throw new Error('Selected device is the local device');
              }
            }
          } else {
            const fullPeerNpub = allNpubsFromKeyshare.find(
              n =>
                n === selectedPeerNpub ||
                (selectedPeerNpub.startsWith('npub1') &&
                  n.startsWith(selectedPeerNpub.substring(0, 20))),
            );
            if (fullPeerNpub && fullPeerNpub !== localNpubFromKeyshare) {
              allNpubs.push(fullPeerNpub);
            } else {
              throw new Error('Failed to find full npub for selected peer');
            }
          }
        } else {
          throw new Error('Please select a peer device for trio mode');
        }
      } else {
        const otherNpubs = allNpubsFromKeyshare.filter(
          n => n !== localNpubFromKeyshare,
        );
        if (otherNpubs.length > 0) {
          allNpubs.push(otherNpubs[0]);
        } else {
          throw new Error('Other device npub not found in keyshare');
        }
      }
      const partiesNpubsCSV = allNpubs.sort().join(',');

      const relaysCSV = relays.join(',');
      dbg('Starting Nostr PSBT signing with:', {
        relays: relaysCSV,
        parties: partiesNpubsCSV.substring(0, 50) + '...',
        npubsSorted: npubsSorted.substring(0, 30) + '...',
        psbtLength: route.params.psbtBase64?.length,
      });

      // Call native module for PSBT signing
      const signedPsbt = await BBMTLibNativeModule.nostrMpcSignPSBT(
        relaysCSV,
        nsecToUse,
        partiesNpubsCSV,
        npubsSorted,
        keyshareJSON,
        route.params.psbtBase64,
      );

      // Validate result
      if (
        !signedPsbt ||
        signedPsbt.includes('error') ||
        signedPsbt.includes('failed')
      ) {
        throw new Error(signedPsbt || 'PSBT signing failed');
      }

      dbg('PSBT signed successfully, length:', signedPsbt.length);

      // Check user's wallet mode preference before navigating
      let targetRoute = 'Home';
      try {
        const walletMode =
          (await EncryptedStorage.getItem('wallet_mode')) || 'full';
        targetRoute = walletMode === 'psbt' ? 'PSBT' : 'Home';
        dbg(
          'PSBT signing complete: Navigating to',
          targetRoute,
          'based on wallet_mode:',
          walletMode,
        );
      } catch (error) {
        dbg('Error loading wallet_mode after PSBT signing:', error);
        // Default to 'Home' if there's an error
      }

      // Navigate to the appropriate screen based on user preference
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{name: targetRoute, params: {signedPsbt}}],
        }),
      );

      setMpcDone(true);
    } catch (error: any) {
      dbg('Sign PSBT error:', error);
      Alert.alert('Error', error?.message || 'PSBT signing failed');
      setStatus('PSBT signing failed');
    } finally {
      setIsPairing(false);
    }
  };

  // Backup functions
  const allBackupChecked = isTrio
    ? backupChecks.deviceOne &&
      backupChecks.deviceTwo &&
      backupChecks.deviceThree
    : backupChecks.deviceOne && backupChecks.deviceTwo;

  const toggleBackedup = (key: keyof typeof backupChecks) => {
    setBackupChecks(prev => ({...prev, [key]: !prev[key]}));
  };

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

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    validatePassword(text);
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

  const clearBackupModal = () => {
    setPassword('');
    setConfirmPassword('');
    setPasswordVisible(false);
    setConfirmPasswordVisible(false);
    setPasswordStrength(0);
    setPasswordErrors([]);
    setIsBackupModalVisible(false);
  };

  async function backupShare() {
    if (!validatePassword(password)) {
      dbg('❌ [BACKUP] Password validation failed');
      const missingRequirements = passwordErrors.join('\n• ');
      Alert.alert(
        'Password Requirements Not Met',
        `Your password must meet all of the following requirements:\n\n• ${missingRequirements}\n\nPlease update your password and try again.`,
      );
      return;
    }

    if (password !== confirmPassword) {
      dbg('❌ [BACKUP] Password mismatch');
      Alert.alert(
        'Passwords Do Not Match',
        'The password and confirmation password must be identical. Please check both fields and try again.',
      );
      return;
    }

    try {
      HapticFeedback.medium();

      const storedKeyshare = await EncryptedStorage.getItem('keyshare');
      if (storedKeyshare) {
        const json = JSON.parse(storedKeyshare);
        const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
          storedKeyshare,
          await BBMTLibNativeModule.sha256(password),
        );

        // Create filename based on pub_key hash and keyshare number
        if (!json.pub_key) {
          Alert.alert('Error', 'Keyshare missing pub_key.');
          return;
        }

        // Get SHA256 hash of pub_key and take first 4 characters
        const pubKeyHash = await BBMTLibNativeModule.sha256(json.pub_key);
        const hashPrefix = pubKeyHash.substring(0, 4).toLowerCase();

        // Extract keyshare number from label (KeyShare1 -> 1, KeyShare2 -> 2, etc.)
        const keyshareLabel = getKeyshareLabel(json);
        let keyshareNumber = '1'; // default
        if (keyshareLabel) {
          const match = keyshareLabel.match(/KeyShare(\d+)/);
          if (match) {
            keyshareNumber = match[1];
          }
        } else if (json.keygen_committee_keys && json.local_party_key) {
          // Fallback: compute from position in sorted keygen_committee_keys
          const sortedKeys = [...json.keygen_committee_keys].sort();
          const index = sortedKeys.indexOf(json.local_party_key);
          if (index >= 0) {
            keyshareNumber = String(index + 1);
          }
        }

        const friendlyFilename = `${hashPrefix}K${keyshareNumber}.share`;

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

        // Cleanup temp file (best-effort)
        try {
          await RNFS.unlink(filePath);
        } catch {
          // ignore cleanup errors
        }
        clearBackupModal();
      } else {
        Alert.alert('Error', 'Invalid keyshare.');
      }
    } catch (error) {
      dbg('Error encrypting or sharing keyshare:', error);
      Alert.alert('Error', 'Failed to encrypt or share the keyshare.');
    }
  }

  const copyConnectionDetails = () => {
    Clipboard.setString(connectionDetails);
    HapticFeedback.medium();
    Alert.alert(
      'Copied',
      '- Pairing data copied.\n- Paste them to other device(s)',
    );
  };

  const shareConnectionDetails = async () => {
    HapticFeedback.medium();

    if (!connectionDetails) {
      Alert.alert('Error', 'Connection details are not ready yet');
      return;
    }

    if (!connectionQrRef.current) {
      Alert.alert('Error', 'QR Code is not ready yet');
      return;
    }

    try {
      // Generate base64 from QR component (similar to WalletHome ReceiveModal)
      const base64Data: string = await new Promise((resolve, reject) => {
        connectionQrRef.current.toDataURL((data: string) => {
          if (data) {
            resolve(data);
          } else {
            reject(new Error('No base64 data returned from QR code'));
          }
        });
      });

      const filePath = `${RNFS.TemporaryDirectoryPath}/boldwallet-connection-details.jpg`;
      const fileExists = await RNFS.exists(filePath);
      if (fileExists) {
        await RNFS.unlink(filePath);
      }

      await RNFS.writeFile(filePath, base64Data, 'base64');

      await Share.open({
        title: 'Bold Wallet Connection Details',
        message: connectionDetails,
        url: `file://${filePath}`,
        subject: 'Bold Wallet Connection Details',
        isNewTask: true,
        failOnCancel: false,
      });

      // Best-effort cleanup
      await RNFS.unlink(filePath).catch(() => {});

      setIsQRModalVisible(false);
    } catch (error: any) {
      dbg('Error sharing connection details (QR + text):', error);
      Alert.alert('Error', 'Failed to share connection QR code');
    }
  };

  const showQRModal = () => {
    HapticFeedback.medium();
    setIsQRModalVisible(true);
  };

  const handleQRScan = (data: string, peerNum?: 1 | 2) => {
    HapticFeedback.medium();
    setIsQRScannerVisible(false);
    // Use provided peerNum, or fallback to scanningForPeerRef (more reliable than state)
    const targetPeer = peerNum || scanningForPeerRef.current;
    dbg(
      `handleQRScan: data="${data.substring(
        0,
        30,
      )}...", peerNum=${targetPeer}, scanningForPeerRef=${
        scanningForPeerRef.current
      }`,
    );
    handlePeerConnectionInput(data, targetPeer);
  };

  const handlePaste = async (peerNum: 1 | 2) => {
    try {
      const text = await Clipboard.getString();
      dbg(`handlePaste: peerNum=${peerNum}, pasted text="${text}"`);
      HapticFeedback.medium();

      // Update the input field immediately so user can see what was pasted
      if (peerNum === 1) {
        setPeerConnectionDetails1(text);
      } else {
        setPeerConnectionDetails2(text);
      }

      // Then validate the input
      await handlePeerConnectionInput(text, peerNum);
    } catch (error) {
      dbg('Error pasting:', error);
      Alert.alert('Error', 'Failed to paste from clipboard');
    }
  };

  const clearPeerConnection = (peerNum: 1 | 2) => {
    HapticFeedback.medium();
    if (peerNum === 1) {
      setPeerNpub1('');
      setPeerDeviceName1('');
      setPeerNonce1('');
      setPeerConnectionDetails1('');
      setPeerInputError1('');
    } else {
      setPeerNpub2('');
      setPeerDeviceName2('');
      setPeerNonce2('');
      setPeerConnectionDetails2('');
      setPeerInputError2('');
    }
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

  const prepareDevice = async () => {
    setIsPreparing(true);
    setIsPreParamsReady(false);
    setPrepCounter(0);

    const timeoutMinutes = 20;

    if (!__DEV__) {
      await deletePreparams();
    } else {
      dbg('preparams dev: Not deleting ppmFile');
    }

    try {
      await BBMTLibNativeModule.preparams(ppmFile, String(timeoutMinutes));
      setIsPreParamsReady(true);
      HapticFeedback.medium();
      dbg('Device prepared successfully');
    } catch (error: any) {
      setIsPreParamsReady(false);
      dbg('Error preparing device:', error);
      Alert.alert('Error', error?.toString() || 'Failed to prepare device');
    } finally {
      setIsPreparing(false);
      setPrepCounter(0);
    }
  };

  // Increment prep counter when preparing
  useEffect(() => {
    if (isPreparing) {
      const interval = setInterval(() => {
        setPrepCounter(prevCounter => prevCounter + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isPreparing]);

  // Track elapsed time during keygen and signing
  useEffect(() => {
    if (isPairing) {
      setPrepCounter(0);
      const interval = setInterval(() => {
        setPrepCounter(prevCounter => prevCounter + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isPairing]);

  // Animation for horizontal progress bar
  useEffect(() => {
    if (isPreparing) {
      // Stop any existing animation first
      if (progressAnimationLoop.current) {
        progressAnimationLoop.current.stop();
        progressAnimationLoop.current = null;
      }

      // Small delay to ensure modal is mounted before starting animation
      const timeoutId = setTimeout(() => {
        // Reset value before starting new animation (only when modal is mounted)
        progressAnimation.setValue(0);

        // Start new animation loop
        progressAnimationLoop.current = Animated.loop(
          Animated.sequence([
            Animated.timing(progressAnimation, {
              toValue: 1,
              duration: 2000,
              useNativeDriver: false,
            }),
            Animated.timing(progressAnimation, {
              toValue: 0,
              duration: 2000,
              useNativeDriver: false,
            }),
          ]),
        );
        progressAnimationLoop.current.start();
      }, 150);

      return () => {
        clearTimeout(timeoutId);
        if (progressAnimationLoop.current) {
          progressAnimationLoop.current.stop();
          progressAnimationLoop.current = null;
        }
        // Stop any running animation without setting value
        progressAnimation.stopAnimation();
      };
    } else {
      // Stop animation without setting value to avoid warning
      if (progressAnimationLoop.current) {
        progressAnimationLoop.current.stop();
        progressAnimationLoop.current = null;
      }
      // Stop any running animation
      progressAnimation.stopAnimation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreparing]);

  // Styles
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: 20,
    },
    section: {
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
      marginBottom: 12,
    },
    card: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 12,
      padding: 4,
      borderWidth: 1,
      borderColor: theme.colors.border + '40',
    },
    cardSelected: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderWidth: 2,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.accent + '20',
    },
    deviceInfoRowWithCheckbox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
      paddingVertical: 8,
    },
    peerCheckbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
    },
    peerCheckboxChecked: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    peerCheckmark: {
      color: theme.colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    input: {
      borderWidth: 1.5,
      borderColor: theme.colors.border + '40',
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: theme.colors.text,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? 'rgba(0,0,0,0.02)'
          : theme.colors.cardBackground,
    },
    inputFocused: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? 'rgba(0,0,0,0.03)'
          : theme.colors.cardBackground,
    },
    inputWithIcons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    inputFlex: {
      flex: 1,
    },
    inputCentered: {
      textAlignVertical: 'center',
    },
    inputTextDisplay: {
      paddingVertical: 14,
      lineHeight: 20,
    },
    iconButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '20'
          : theme.colors.accent + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconButtonCentered: {
      alignSelf: 'center',
    },
    deviceInfoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      paddingVertical: 4,
    },
    deviceInfoSingleLine: {
      fontSize: 14,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      color: theme.colors.text,
      flex: 1,
      textAlign: 'center',
      overflow: 'hidden',
    },
    deviceInfoContent: {
      flex: 1,
    },
    hintBox: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.accent + '20',
      borderRadius: 8,
      padding: 6,
      borderLeftWidth: 3,
      borderLeftColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    hintText: {
      fontSize: 13,
      color: theme.colors.text,
      lineHeight: 18,
    },
    sendModeDeviceItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: theme.colors.border + '30',
    },
    sendModeDeviceItemSelected: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderWidth: 1.5,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '08'
          : theme.colors.accent + '20',
    },
    sendModeDeviceIcon: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      marginRight: 10,
    },
    sendModeDeviceContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sendModeDeviceLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    sendModeDeviceNpub: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginLeft: 8,
    },
    sendModeDeviceBadge: {
      fontSize: 11,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      marginTop: 2,
      fontWeight: '500',
    },
    sendModeCheckbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    sendModeCheckboxChecked: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    sendModeCheckmark: {
      color: theme.colors.background,
      fontSize: 14,
      fontWeight: '700',
    },
    buttonHalf: {
      flex: 0.48,
    },
    buttonCompact: {
      flex: 1,
      backgroundColor: 'transparent',
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
    },
    buttonTextCompact: {
      fontSize: 14,
      fontWeight: '600',
    },
    iconImageCompact: {
      width: 18,
      height: 18,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    iconImage: {
      width: 24,
      height: 24,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    iconPrepare: {
      width: 24,
      height: 24,
      tintColor: theme.colors.textOnPrimary,
    },
    iconShare: {
      width: 24,
      height: 24,
      tintColor: theme.colors.textOnPrimary,
    },
    checkIconLeft: {
      width: 20,
      height: 20,
      tintColor: '#4CAF50',
      marginRight: 8,
    },
    qrContainer: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? 'white'
          : theme.colors.cardBackground,
      padding: 16,
      borderRadius: 12,
      alignItems: 'center',
      marginBottom: 16,
    },
    connectionDetailsText: {
      fontSize: 12,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      color: theme.colors.textSecondary,
      marginBottom: 12,
      textAlign: 'center',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 12,
    },
    button: {
      flex: 1,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    buttonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderColor: theme.colors.border,
    },
    buttonText: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    buttonTextSecondary: {
      color: theme.colors.secondary,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    statusIndicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      marginRight: 8,
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
          : theme.colors.accent + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    finalizingModalIcon: {
      width: 24,
      height: 24,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
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
    statusCheck: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    statusText: {
      fontSize: 14,
      color: theme.colors.text,
      fontWeight: '500',
    },
    statusTextSecondary: {
      color: theme.colors.textSecondary,
    },
    progressContainer: {
      marginTop: 20,
      alignItems: 'center',
    },
    progressText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginTop: 8,
    },
    scannerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    qrFrame: {
      width: 250,
      height: 250,
      borderWidth: 2,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderRadius: 12,
    },
    closeScannerButton: {
      position: 'absolute',
      bottom: 40,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
    },
    closeScannerButtonText: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    cameraNotFound: {
      color: theme.colors.text,
      fontSize: 16,
    },
    sessionInfo: {
      marginTop: 12,
      padding: 12,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? 'rgba(0,0,0,0.02)'
          : theme.colors.cardBackground,
      borderRadius: 8,
    },
    sessionInfoText: {
      fontSize: 11,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.75)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    qrModalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      width: '85%',
      maxWidth: 400,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
      overflow: 'hidden',
    },
    qrModalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border + '40',
    },
    qrModalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
    },
    qrModalDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 12,
      lineHeight: 20,
    },
    qrModalCloseButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.colors.subPrimary + '10',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border + '10',
    },
    qrModalCloseText: {
      fontSize: 18,
      color: theme.colors.text,
      fontWeight: '600',
    },
    qrModalBody: {
      padding: 24,
      alignItems: 'center',
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    headerContent: {
      flex: 1,
      alignItems: 'center',
    },
    sectionSubtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginTop: 4,
    },
    helpButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '20'
          : theme.colors.accent + '20',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    helpIcon: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    stepIndicatorContainer: {
      marginBottom: 8,
      paddingVertical: 8,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    stepCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.colors.border + '40',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: theme.colors.border,
    },
    stepCircleCompleted: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    stepNumber: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.textSecondary,
    },
    stepNumberCompleted: {
      color: theme.colors.background,
    },
    stepLine: {
      flex: 1,
      height: 2,
      backgroundColor: theme.colors.border + '40',
      marginHorizontal: 8,
    },
    stepLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginTop: 4,
    },
    stepLabel: {
      fontSize: 11,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      flex: 1,
    },
    collapsibleHeader: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border + '40',
    },
    collapsibleHeaderText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textSecondary,
    },
    collapsibleContent: {
      marginTop: 8,
      padding: 16,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border + '40',
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    primaryActionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      gap: 6,
    },
    emptyStateContainer: {
      alignItems: 'center',
      paddingVertical: 20,
      marginBottom: 16,
    },
    emptyStateIcon: {
      width: 48,
      height: 48,
      marginBottom: 12,
      opacity: 0.5,
    },
    emptyStateText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 20,
      lineHeight: 18,
    },
    readyCard: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.accent + '20',
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderWidth: 2,
    },
    helpModalBody: {
      maxHeight: 400,
      padding: 24,
    },
    helpSection: {
      marginBottom: 24,
    },
    helpTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.text,
      marginBottom: 8,
    },
    helpText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
    },
    inputError: {
      borderColor: theme.colors.danger || '#FF3B30',
      backgroundColor: (theme.colors.danger || '#FF3B30') + '10',
    },
    inputSuccess: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.accent + '20',
    },
    inputValidating: {
      borderColor: theme.colors.textSecondary,
      backgroundColor: theme.colors.textSecondary + '05',
    },
    errorIndicator: {
      marginTop: 8,
      padding: 8,
      backgroundColor: (theme.colors.danger || '#FF3B30') + '10',
      borderRadius: 6,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger || '#FF3B30',
    },
    errorText: {
      fontSize: 12,
      color: theme.colors.danger || '#FF3B30',
      fontWeight: '500',
    },
    validatingIndicator: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    validatingText: {
      fontSize: 18,
      color: theme.colors.textSecondary,
      fontWeight: '600',
    },
    checkboxContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 16,
      paddingVertical: 8,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.colors.border,
      backgroundColor: 'transparent',
      marginRight: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    checkboxCheckmark: {
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: '700',
    },
    checkboxLabel: {
      fontSize: 14,
      color: theme.colors.text,
      flex: 1,
    },
    preparingModalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      padding: 24,
      width: '90%',
      maxWidth: 400,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 8},
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 8,
    },
    preparingModalIconContainer: {
      marginBottom: 16,
      alignItems: 'center',
    },
    preparingModalIconBackground: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '20'
          : theme.colors.accent + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    preparingModalIcon: {
      width: 32,
      height: 32,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    preparingModalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    preparingModalSubtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 24,
    },
    preparingProgressContainer: {
      width: '100%',
      alignItems: 'center',
      marginBottom: 16,
    },
    preparingProgressTrack: {
      width: 200,
      height: 6,
      backgroundColor: theme.colors.border + '40',
      borderRadius: 3,
      overflow: 'hidden',
    },
    preparingProgressBar: {
      height: '100%',
      borderRadius: 3,
    },
    preparingStatusContainer: {
      width: '100%',
      marginTop: 8,
    },
    preparingStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      justifyContent: 'center',
    },
    preparingStatusIndicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      marginRight: 8,
    },
    preparingStatusText: {
      fontSize: 14,
      color: theme.colors.text,
      fontWeight: '500',
    },
    preparingCountdownText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    informationCard: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      padding: 20,
      marginBottom: 16,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 3,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    backupButton: {
      marginTop: 12,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary
          : theme.colors.accent,
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
      fontSize: 16,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      lineHeight: 22,
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
      // tintColor will be set conditionally in the component
    },
    enhancedCheckbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
      marginRight: 12,
    },
    enhancedCheckboxChecked: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    checkmark: {
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: 'bold',
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
          : theme.colors.accent + '20',
    },
    checkboxTextContainer: {
      flex: 1,
      padding: 8,
    },
    enhancedCheckboxLabel: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
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
          : theme.colors.accent,
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
      marginBottom: 12,
      lineHeight: 20,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    participantsList: {
      marginTop: 8,
      marginBottom: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: theme.colors.cardBackground + '80',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border + '30',
    },
    participantsListTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 8,
    },
    participantItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 8,
    },
    bulletPoint: {
      fontSize: 16,
      color: theme.colors.primary,
      marginRight: 8,
      marginTop: 2,
      fontWeight: 'bold',
    },
    participantText: {
      flex: 1,
      fontSize: 13,
      color: theme.colors.text,
      lineHeight: 18,
    },
    participantLabel: {
      fontWeight: '600',
      color: theme.colors.text,
    },
    localDeviceBadge: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.colors.primary,
      fontStyle: 'italic',
    },
    participantNpub: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginTop: 2,
    },
    participantDevicesInfo: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border + '40',
    },
    participantDevicesInfoTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 10,
    },
    participantDeviceItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
      paddingVertical: 6,
      paddingHorizontal: 8,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border + '30',
    },
    participantDeviceLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    participantDeviceIcon: {
      width: 18,
      height: 18,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      marginRight: 10,
    },
    participantDeviceLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.text,
    },
    participantDeviceNpub: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      textAlign: 'right',
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
    proceedButtonOn: {
      marginTop: 16,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
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
    proceedButtonOff: {
      marginTop: 16,
      backgroundColor: theme.colors.textSecondary,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      alignSelf: 'center',
      opacity: 0.6,
    },
    pairButtonText: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      fontSize: 16,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    buttonIcon: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
    },
    modalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 20,
      padding: 24,
      width: '90%',
      maxWidth: 400,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalIcon: {
      width: 32,
      height: 32,
      marginRight: 12,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    modalDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      lineHeight: 20,
    },
    passwordContainer: {
      marginBottom: 16,
    },
    passwordLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 8,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    passwordInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: 12,
    },
    passwordInput: {
      flex: 1,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    eyeButton: {
      padding: 8,
    },
    eyeIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.text,
    },
    strengthContainer: {
      marginTop: 8,
    },
    strengthBar: {
      height: 4,
      backgroundColor: theme.colors.border,
      borderRadius: 2,
      overflow: 'hidden',
      marginBottom: 4,
    },
    strengthFill: {
      height: '100%',
      borderRadius: 2,
    },
    strengthText: {
      fontSize: 12,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    requirementsContainer: {
      marginTop: 8,
      paddingLeft: 4,
    },
    requirementText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginBottom: 4,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    errorInput: {
      borderColor: theme.colors.danger || '#FF3B30',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
      gap: 12,
    },
    modalButton: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      backgroundColor: theme.colors.border,
    },
    confirmButton: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    disabledButton: {
      opacity: 0.5,
    },
    cancelLinkContainer: {
      marginTop: 8,
      marginBottom: 4,
      alignItems: 'center',
    },
    cancelLinkText: {
      color: theme.colors.textSecondary,
      fontWeight: '600',
      textDecorationLine: 'underline',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      fontSize: 14,
      marginTop: 12,
    },
    retryButton: {
      backgroundColor: theme.colors.secondary,
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
      minHeight: 36,
    },
    retryLink: {
      color: theme.colors.background,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      fontSize: 14,
      marginLeft: 6,
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
      minHeight: 36,
    },
    cancelLink: {
      color: theme.colors.secondary,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'center',
      fontSize: 14,
    },
    transactionItem: {
      borderBottomWidth: 0,
      paddingVertical: 4,
      marginBottom: 4,
    },
    transactionLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 2,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 16,
    },
    transactionItemLabel: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    transactionItemValue: {
      fontSize: 14,
      fontWeight: '600',
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
      fontSize: 14,
      color: theme.colors.text,
      textAlign: 'left',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      lineHeight: 14,
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
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'left',
      lineHeight: 14,
    },
    fiatValue: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      textAlign: 'right',
      lineHeight: 14,
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          {/* Hide all previous sections when mpcDone is true */}
          {!mpcDone &&
            (() => {
              // Check if Final Step should be shown
              const showFinalStep =
                !isSendBitcoin &&
                !isSignPSBT &&
                isPreParamsReady &&
                localNpub &&
                deviceName &&
                ((isTrio &&
                  peerNpub1 &&
                  peerDeviceName1 &&
                  peerNpub2 &&
                  peerDeviceName2) ||
                  (!isTrio && peerNpub1 && peerDeviceName1));

              return (
                <>
                  {/* Header */}
                  <View style={styles.section}>
                    <View style={styles.headerRow}>
                      {/* Help button on the left */}
                      <TouchableOpacity
                        style={styles.helpButton}
                        onPress={() => {
                          HapticFeedback.light();
                          setShowHelpModal(true);
                        }}
                        activeOpacity={0.7}>
                        <Image
                          source={require('../assets/about-icon.png')}
                          style={styles.helpIcon}
                          resizeMode="contain"
                        />
                      </TouchableOpacity>

                      {/* Title in the center */}
                      <View style={styles.headerContent}>
                        {isSendBitcoin || isSignPSBT ? (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>
                            <Image
                              source={require('../assets/cosign-icon.png')}
                              style={{
                                width: 20,
                                height: 20,
                                marginRight: 8,
                                tintColor:
                                  theme.colors.background === '#ffffff'
                                    ? theme.colors.primary
                                    : theme.colors.accent,
                              }}
                              resizeMode="contain"
                            />
                            <Text
                              style={{
                                fontSize: 15,
                                fontWeight: '700',
                                color: theme.colors.text,
                                textAlign: 'center',
                                fontFamily:
                                  Platform.OS === 'ios' ? 'System' : 'Roboto',
                              }}>
                              {isSignPSBT
                                ? 'PSBT Co-Signing'
                                : 'Transaction Co-Signing'}
                            </Text>
                          </View>
                        ) : (
                          <Text
                            style={[styles.sectionTitle, {marginBottom: 0}]}>
                            Setup Wallet
                          </Text>
                        )}
                      </View>

                      {/* Abort Setup button on the right */}
                      {!mpcDone && !isPairing ? (
                        <TouchableOpacity
                          style={[styles.cancelSetupButton, {marginLeft: 12}]}
                          onPress={() => {
                            HapticFeedback.light();
                            if (isSendBitcoin || isSignPSBT) {
                              navigation.goBack();
                            } else {
                              navigation.dispatch(
                                CommonActions.reset({
                                  index: 0,
                                  routes: [{name: 'Welcome'}],
                                }),
                              );
                            }
                          }}
                          activeOpacity={0.7}>
                          <Text style={styles.cancelLink}>
                            {isSendBitcoin || isSignPSBT ? 'Cancel' : 'Abort'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{width: 36}} />
                      )}
                    </View>
                  </View>

                  {/* Relay Configuration - Show in send Bitcoin/PSBT mode, right after title */}
                  {(isSendBitcoin || isSignPSBT) && !showFinalStep && (
                    <View style={styles.section}>
                      <TouchableOpacity
                        style={styles.collapsibleHeader}
                        onPress={() => {
                          HapticFeedback.light();
                          setShowRelayConfig(!showRelayConfig);
                        }}
                        activeOpacity={0.7}>
                        <Text style={styles.collapsibleHeaderText}>
                          {showRelayConfig ? '▼' : '▶'} Advanced: Nostr Relays
                          Settings
                        </Text>
                      </TouchableOpacity>
                      {showRelayConfig && (
                        <View style={styles.collapsibleContent}>
                          <Text
                            style={{
                              fontSize: 12,
                              color: theme.colors.textSecondary,
                              marginBottom: 8,
                            }}>
                            Configure Nostr relays (defaults work for most
                            users). Enter relay URLs, one per line or
                            comma-separated (wss://...).
                          </Text>
                          <TextInput
                            style={[
                              styles.input,
                              {
                                minHeight: 120,
                                textAlignVertical: 'top',
                                paddingTop: 12,
                              },
                            ]}
                            value={relaysInput}
                            onChangeText={setRelaysInput}
                            placeholder={
                              'wss://relay1.com\nwss://relay2.com\nwss://relay3.com'
                            }
                            placeholderTextColor={
                              theme.colors.textSecondary + '80'
                            }
                            autoCapitalize="none"
                            autoCorrect={false}
                            multiline
                            numberOfLines={6}
                          />
                        </View>
                      )}
                    </View>
                  )}

                  {/* PSBT Info Section */}
                  {isSignPSBT && route.params?.psbtBase64 && (
                    <View style={styles.section}>
                      <View
                        style={{
                          backgroundColor: theme.colors.cardBackground,
                          borderRadius: 12,
                          padding: 12,
                          borderWidth: 1,
                          borderColor: theme.colors.border + '40',
                        }}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '700',
                            color: theme.colors.text,
                            marginBottom: 8,
                            textAlign: 'center',
                          }}>
                          PSBT Ready to Sign
                        </Text>
                        {psbtDetails ? (
                          <>
                            <View
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 6,
                              }}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.textSecondary,
                                }}>
                                Inputs:
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.text,
                                  fontWeight: '600',
                                }}>
                                {psbtDetails.inputs.length}
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 6,
                              }}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.textSecondary,
                                }}>
                                Outputs:
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.text,
                                  fontWeight: '600',
                                }}>
                                {psbtDetails.outputs.length}
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 6,
                              }}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.textSecondary,
                                }}>
                                Total Input:
                              </Text>
                              <Text
                                style={{
                                  fontSize: 13,
                                  color: theme.colors.text,
                                  fontWeight: '600',
                                }}>
                                {sat2btcStr(String(psbtDetails.totalInput))} BTC
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 6,
                              }}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.textSecondary,
                                }}>
                                Total Output:
                              </Text>
                              <Text
                                style={{
                                  fontSize: 13,
                                  color: theme.colors.text,
                                  fontWeight: '600',
                                }}>
                                {sat2btcStr(String(psbtDetails.totalOutput))}{' '}
                                BTC
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginBottom: 0,
                              }}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.textSecondary,
                                }}>
                                Fee:
                              </Text>
                              <Text
                                style={{
                                  fontSize: 13,
                                  color: theme.colors.text,
                                  fontWeight: '600',
                                }}>
                                {sat2btcStr(String(psbtDetails.fee))} BTC
                              </Text>
                            </View>
                            {psbtDetails.derivePaths &&
                              psbtDetails.derivePaths.length > 1 && (
                                <View
                                  style={{
                                    marginTop: 4,
                                    paddingTop: 4,
                                    borderTopWidth: 1,
                                    borderTopColor: theme.colors.border,
                                  }}>
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      color: theme.colors.textSecondary,
                                    }}>
                                    {psbtDetails.derivePaths.length} different
                                    paths
                                  </Text>
                                </View>
                              )}
                          </>
                        ) : (
                          <Text
                            style={{
                              fontSize: 12,
                              color: theme.colors.text,
                              textAlign: 'center',
                            }}>
                            {route.params.psbtBase64
                              ? `PSBT (${Math.round(
                                  (route.params.psbtBase64.length || 0) / 1024,
                                )} KB) - Parsing...`
                              : 'No PSBT data'}
                          </Text>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Send Mode: Device Selection - Show current device and allow selecting one other */}
                  {(isSendBitcoin || isSignPSBT) && (
                    <View style={styles.section}>
                      <View
                        style={{
                          backgroundColor: theme.colors.cardBackground,
                          borderRadius: 12,
                          padding: 12,
                          borderWidth: 1.5,
                          borderColor: theme.colors.border,
                        }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: '700',
                            color: theme.colors.text,
                            marginBottom: 8,
                          }}>
                          This Device
                        </Text>
                      {sendModeDevices.length === 0 ? (
                        <Text style={{color: theme.colors.text, opacity: 0.6}}>
                          Loading...
                        </Text>
                      ) : (
                        (() => {
                          // Separate local and other devices
                          const localDevice = sendModeDevices.find(
                            d => d.isLocal,
                          );
                          const otherDevices = sendModeDevices
                            .filter(d => !d.isLocal)
                            .sort((a, b) => a.npub.localeCompare(b.npub));

                          return (
                            <>
                              {/* Current Device */}
                              {localDevice && (
                                <View
                                  key={localDevice.keyshareLabel}
                                  style={[
                                    styles.sendModeDeviceItem,
                                    {marginBottom: 12},
                                  ]}>
                                  <Image
                                    source={require('../assets/phone-icon.png')}
                                    style={styles.sendModeDeviceIcon}
                                    resizeMode="contain"
                                  />
                                  <View style={styles.sendModeDeviceContent}>
                                    <View style={{flex: 1}}>
                                      <Text
                                        style={styles.sendModeDeviceLabel}
                                        numberOfLines={1}
                                        ellipsizeMode="tail">
                                        {localDevice.keyshareLabel}
                                      </Text>
                                      <Text style={styles.sendModeDeviceBadge}>
                                        This device
                                      </Text>
                                    </View>
                                    <Text
                                      style={styles.sendModeDeviceNpub}
                                      numberOfLines={1}
                                      ellipsizeMode="middle">
                                      {shortenNpub(localDevice.npub, 8, 6)}
                                    </Text>
                                  </View>
                                </View>
                              )}

                              {/* Select One Other Device */}
                              {otherDevices.length > 0 && (
                                <>
                                  <View>
                                    <Text
                                      style={{
                                        fontSize: 13,
                                        fontWeight: '700',
                                        color: theme.colors.text,
                                        marginBottom: 8,
                                      }}>
                                      {isTrio
                                        ? 'Select one device to co-sign:'
                                        : 'Co-signing device:'}
                                    </Text>
                                  {otherDevices.map(dev => {
                                    // In duo mode, use View (not selectable)
                                    // In trio mode, use TouchableOpacity (selectable)
                                    if (!isTrio) {
                                      return (
                                        <View
                                          key={dev.keyshareLabel}
                                          style={styles.sendModeDeviceItem}>
                                          <Image
                                            source={require('../assets/phone-icon.png')}
                                            style={styles.sendModeDeviceIcon}
                                            resizeMode="contain"
                                          />
                                          <View
                                            style={
                                              styles.sendModeDeviceContent
                                            }>
                                            <Text
                                              style={styles.sendModeDeviceLabel}
                                              numberOfLines={1}
                                              ellipsizeMode="tail">
                                              {dev.keyshareLabel}
                                            </Text>
                                            <Text
                                              style={styles.sendModeDeviceNpub}
                                              numberOfLines={1}
                                              ellipsizeMode="middle">
                                              {shortenNpub(dev.npub, 8, 6)}
                                            </Text>
                                          </View>
                                          {selectedPeerNpub === dev.npub && (
                                            <View
                                              style={[
                                                styles.sendModeCheckbox,
                                                styles.sendModeCheckboxChecked,
                                              ]}>
                                              <Text
                                                style={
                                                  styles.sendModeCheckmark
                                                }>
                                                ✓
                                              </Text>
                                            </View>
                                          )}
                                        </View>
                                      );
                                    }

                                    // Trio mode: selectable
                                    return (
                                      <TouchableOpacity
                                        key={dev.keyshareLabel}
                                        style={[
                                          styles.sendModeDeviceItem,
                                          selectedPeerNpub === dev.npub &&
                                            styles.sendModeDeviceItemSelected,
                                        ]}
                                        onPress={() => {
                                          HapticFeedback.medium();
                                          // In trio, allow user to select any device
                                          // If clicking the same device, deselect (allow empty selection)
                                          // If clicking different device, select that one
                                          setSelectedPeerNpub(
                                            selectedPeerNpub === dev.npub
                                              ? ''
                                              : dev.npub,
                                          );
                                          dbg(
                                            'User selected peer in trio mode:',
                                            dev.npub === selectedPeerNpub
                                              ? 'deselected'
                                              : dev.npub.substring(0, 20) +
                                                  '...',
                                          );
                                        }}
                                        activeOpacity={0.7}>
                                        <Image
                                          source={require('../assets/phone-icon.png')}
                                          style={styles.sendModeDeviceIcon}
                                          resizeMode="contain"
                                        />
                                        <View
                                          style={styles.sendModeDeviceContent}>
                                          <Text
                                            style={styles.sendModeDeviceLabel}
                                            numberOfLines={1}
                                            ellipsizeMode="tail">
                                            {dev.keyshareLabel}
                                          </Text>
                                          <Text
                                            style={styles.sendModeDeviceNpub}
                                            numberOfLines={1}
                                            ellipsizeMode="middle">
                                            {shortenNpub(dev.npub, 8, 6)}
                                          </Text>
                                        </View>
                                        <View
                                          style={[
                                            styles.sendModeCheckbox,
                                            selectedPeerNpub === dev.npub &&
                                              styles.sendModeCheckboxChecked,
                                          ]}>
                                          {selectedPeerNpub === dev.npub && (
                                            <Text
                                              style={styles.sendModeCheckmark}>
                                              ✓
                                            </Text>
                                          )}
                                        </View>
                                      </TouchableOpacity>
                                    );
                                  })}
                                  </View>
                                </>
                              )}
                            </>
                          );
                        })()
                      )}
                      </View>
                    </View>
                  )}

                  {/* Step Indicator */}
                  {!isSendBitcoin && !isSignPSBT && (
                    <View style={styles.stepIndicatorContainer}>
                      <View style={styles.stepRow}>
                        <View
                          style={[
                            styles.stepCircle,
                            localNpub && styles.stepCircleCompleted,
                          ]}>
                          <Text
                            style={[
                              styles.stepNumber,
                              localNpub && styles.stepNumberCompleted,
                            ]}>
                            {localNpub ? '✓' : '1'}
                          </Text>
                        </View>
                        <View style={styles.stepLine} />
                        <View
                          style={[
                            styles.stepCircle,
                            peerNpub1 &&
                              peerDeviceName1 &&
                              styles.stepCircleCompleted,
                          ]}>
                          <Text
                            style={[
                              styles.stepNumber,
                              peerNpub1 &&
                                peerDeviceName1 &&
                                styles.stepNumberCompleted,
                            ]}>
                            {peerNpub1 && peerDeviceName1 ? '✓' : '2'}
                          </Text>
                        </View>
                        {isTrio && (
                          <>
                            <View style={styles.stepLine} />
                            <View
                              style={[
                                styles.stepCircle,
                                peerNpub2 &&
                                  peerDeviceName2 &&
                                  styles.stepCircleCompleted,
                              ]}>
                              <Text
                                style={[
                                  styles.stepNumber,
                                  peerNpub2 &&
                                    peerDeviceName2 &&
                                    styles.stepNumberCompleted,
                                ]}>
                                {peerNpub2 && peerDeviceName2 ? '✓' : '3'}
                              </Text>
                            </View>
                          </>
                        )}
                        <View style={styles.stepLine} />
                        <View
                          style={[
                            styles.stepCircle,
                            isPreParamsReady && styles.stepCircleCompleted,
                          ]}>
                          <Text
                            style={[
                              styles.stepNumber,
                              isPreParamsReady && styles.stepNumberCompleted,
                            ]}>
                            {isPreParamsReady ? '✓' : isTrio ? '4' : '3'}
                          </Text>
                        </View>
                        <View style={styles.stepLine} />
                        <View
                          style={[
                            styles.stepCircle,
                            canStartKeygen && styles.stepCircleCompleted,
                          ]}>
                          <Text
                            style={[
                              styles.stepNumber,
                              canStartKeygen && styles.stepNumberCompleted,
                            ]}>
                            {canStartKeygen ? '✓' : isTrio ? '5' : '4'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.stepLabels}>
                        <Text style={styles.stepLabel}>Your Device</Text>
                        <Text style={styles.stepLabel}>2nd Peer</Text>
                        {isTrio && (
                          <Text style={styles.stepLabel}>3rd Peer</Text>
                        )}
                        <Text style={styles.stepLabel}>Prepared</Text>
                        <Text style={styles.stepLabel}>Ready</Text>
                      </View>
                    </View>
                  )}

                  {/* Local Device Card - Hide when Final Step is shown or in send/sign mode */}
                  {localNpub &&
                    deviceName &&
                    partialNonce &&
                    !isSendBitcoin &&
                    !isSignPSBT && (
                      <View style={styles.section}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '600',
                            color: theme.colors.text,
                            marginBottom: 12,
                          }}>
                          This Device
                        </Text>
                        <View
                          style={[
                            styles.hintBox,
                            {
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.deviceInfoSingleLine,
                              {flex: 1, marginRight: 8},
                            ]}
                            numberOfLines={1}
                            ellipsizeMode="middle"
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.8}>
                            {deviceName}@{shortenNpub(localNpub, 8, 6)}
                          </Text>
                          <View style={{flexDirection: 'row', gap: 8}}>
                            <TouchableOpacity
                              onPress={copyConnectionDetails}
                              activeOpacity={0.7}
                              style={{
                                padding: 8,
                                backgroundColor:
                                  theme.colors.background === '#ffffff'
                                    ? theme.colors.primary + '10'
                                    : theme.colors.accent + '20',
                                borderRadius: 8,
                              }}>
                              <Image
                                source={require('../assets/copy-icon.png')}
                                style={{
                                  width: 20,
                                  height: 20,
                                  tintColor: theme.colors.secondary,
                                }}
                                resizeMode="contain"
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={showQRModal}
                              activeOpacity={0.7}
                              style={{
                                padding: 8,
                                backgroundColor:
                                  theme.colors.background === '#ffffff'
                                    ? theme.colors.primary + '10'
                                    : theme.colors.accent + '20',
                                borderRadius: 8,
                              }}>
                              <Image
                                source={require('../assets/qrc-icon.png')}
                                style={{
                                  width: 20,
                                  height: 20,
                                  tintColor: theme.colors.secondary,
                                }}
                                resizeMode="contain"
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    )}

                  {/* Peer Connection 1 - Hide when Final Step is shown or in send/sign mode */}
                  {!showFinalStep && !isSendBitcoin && !isSignPSBT && (
                    <View style={styles.section}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '600',
                          color: theme.colors.text,
                          marginBottom: 12,
                        }}>
                        {isTrio
                          ? 'Step 2: Second Device'
                          : 'Step 2: Other Device'}
                      </Text>
                      <View>
                        <View style={styles.inputWithIcons}>
                          {peerNpub1 && (
                            <Image
                              source={require('../assets/check-icon.png')}
                              style={styles.checkIconLeft}
                              resizeMode="contain"
                            />
                          )}
                          {peerNpub1 && peerDeviceName1 ? (
                            <Text
                              style={[
                                styles.input,
                                styles.inputFlex,
                                styles.inputCentered,
                                styles.inputSuccess,
                                styles.inputTextDisplay,
                              ]}
                              numberOfLines={1}
                              ellipsizeMode="middle"
                              adjustsFontSizeToFit={true}
                              minimumFontScale={0.7}>
                              {formatConnectionDisplay(
                                peerNpub1,
                                peerDeviceName1,
                              )}
                            </Text>
                          ) : (
                            <TextInput
                              style={[
                                styles.input,
                                styles.inputFlex,
                                styles.inputCentered,
                                peerInputError1 && styles.inputError,
                                peerInputValidating1 && styles.inputValidating,
                              ]}
                              value={peerConnectionDetails1}
                              onChangeText={text => {
                                setPeerConnectionDetails1(text);
                                handlePeerConnectionInput(text, 1);
                              }}
                              placeholder="Paste or scan connection details"
                              placeholderTextColor={
                                theme.colors.textSecondary + '80'
                              }
                              autoCapitalize="none"
                              autoCorrect={false}
                            />
                          )}
                          {peerInputValidating1 && (
                            <View style={styles.validatingIndicator}>
                              <Text style={styles.validatingText}>...</Text>
                            </View>
                          )}
                          {peerNpub1 && !peerInputValidating1 && (
                            <TouchableOpacity
                              style={[
                                styles.iconButton,
                                styles.iconButtonCentered,
                              ]}
                              onPress={() => clearPeerConnection(1)}
                              activeOpacity={0.7}>
                              <Image
                                source={require('../assets/delete-icon.png')}
                                style={styles.iconImage}
                                resizeMode="contain"
                              />
                            </TouchableOpacity>
                          )}
                          {!peerNpub1 && !peerInputValidating1 && (
                            <>
                              <TouchableOpacity
                                style={[
                                  styles.iconButton,
                                  styles.iconButtonCentered,
                                ]}
                                onPress={() => handlePaste(1)}
                                activeOpacity={0.7}>
                                <Image
                                  source={require('../assets/paste-icon.png')}
                                  style={styles.iconImage}
                                  resizeMode="contain"
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.iconButton,
                                  styles.iconButtonCentered,
                                ]}
                                onPress={() => {
                                  HapticFeedback.light();
                                  const peerNum: 1 | 2 = 1;
                                  setScanningForPeer(peerNum);
                                  scanningForPeerRef.current = peerNum; // Update ref immediately
                                  setIsQRScannerVisible(true);
                                }}
                                activeOpacity={0.7}>
                                <Image
                                  source={require('../assets/scan-icon.png')}
                                  style={styles.iconImage}
                                  resizeMode="contain"
                                />
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                        {peerInputError1 && (
                          <View style={styles.errorIndicator}>
                            <Text style={styles.errorText}>
                              ⚠ {peerInputError1}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Peer Connection 2 (Trio only) - Hide when Final Step is shown or in send/sign mode */}
                  {isTrio &&
                    !showFinalStep &&
                    !isSendBitcoin &&
                    !isSignPSBT && (
                      <View style={styles.section}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '600',
                            color: theme.colors.text,
                            marginBottom: 12,
                          }}>
                          Step 3: Third Device
                        </Text>
                        <View>
                          <View style={styles.inputWithIcons}>
                            {peerNpub2 && (
                              <Image
                                source={require('../assets/check-icon.png')}
                                style={styles.checkIconLeft}
                                resizeMode="contain"
                              />
                            )}
                            {peerNpub2 && peerDeviceName2 ? (
                              <Text
                                style={[
                                  styles.input,
                                  styles.inputFlex,
                                  styles.inputCentered,
                                  styles.inputSuccess,
                                  styles.inputTextDisplay,
                                ]}
                                numberOfLines={1}
                                ellipsizeMode="middle"
                                adjustsFontSizeToFit={true}
                                minimumFontScale={0.7}>
                                {formatConnectionDisplay(
                                  peerNpub2,
                                  peerDeviceName2,
                                )}
                              </Text>
                            ) : (
                              <TextInput
                                style={[
                                  styles.input,
                                  styles.inputFlex,
                                  styles.inputCentered,
                                  peerInputError2 && styles.inputError,
                                  peerInputValidating2 &&
                                    styles.inputValidating,
                                ]}
                                value={peerConnectionDetails2}
                                onChangeText={text => {
                                  setPeerConnectionDetails2(text);
                                  handlePeerConnectionInput(text, 2);
                                }}
                                placeholder="Paste or scan connection details"
                                placeholderTextColor={
                                  theme.colors.textSecondary + '80'
                                }
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                            )}
                            {peerInputValidating2 && (
                              <View style={styles.validatingIndicator}>
                                <Text style={styles.validatingText}>...</Text>
                              </View>
                            )}
                            {peerNpub2 && !peerInputValidating2 && (
                              <TouchableOpacity
                                style={[
                                  styles.iconButton,
                                  styles.iconButtonCentered,
                                ]}
                                onPress={() => clearPeerConnection(2)}
                                activeOpacity={0.7}>
                                <Image
                                  source={require('../assets/delete-icon.png')}
                                  style={styles.iconImage}
                                  resizeMode="contain"
                                />
                              </TouchableOpacity>
                            )}
                            {!peerNpub2 && !peerInputValidating2 && (
                              <>
                                <TouchableOpacity
                                  style={[
                                    styles.iconButton,
                                    styles.iconButtonCentered,
                                  ]}
                                  onPress={() => handlePaste(2)}
                                  activeOpacity={0.7}>
                                  <Image
                                    source={require('../assets/paste-icon.png')}
                                    style={styles.iconImage}
                                    resizeMode="contain"
                                  />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.iconButton,
                                    styles.iconButtonCentered,
                                  ]}
                                  onPress={() => {
                                    HapticFeedback.light();
                                    const peerNum: 1 | 2 = 2;
                                    setScanningForPeer(peerNum);
                                    scanningForPeerRef.current = peerNum; // Update ref immediately
                                    setIsQRScannerVisible(true);
                                  }}
                                  activeOpacity={0.7}>
                                  <Image
                                    source={require('../assets/scan-icon.png')}
                                    style={styles.iconImage}
                                    resizeMode="contain"
                                  />
                                </TouchableOpacity>
                              </>
                            )}
                          </View>
                          {peerInputError2 && (
                            <View style={styles.errorIndicator}>
                              <Text style={styles.errorText}>
                                ⚠ {peerInputError2}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                    )}

                  {/* Prepare Device Section - Hide in send/sign mode */}
                  {!isSendBitcoin &&
                    !isSignPSBT &&
                    !isPreParamsReady &&
                    localNpub &&
                    deviceName &&
                    ((isTrio &&
                      peerNpub1 &&
                      peerDeviceName1 &&
                      peerNpub2 &&
                      peerDeviceName2) ||
                      (!isTrio && peerNpub1 && peerDeviceName1)) && (
                      <View style={styles.section}>
                        <View style={styles.card}>
                          <TouchableOpacity
                            style={[
                              styles.button,
                              (isPreparing || !isPrepared) &&
                                styles.buttonDisabled,
                            ]}
                            onPress={prepareDevice}
                            disabled={isPreparing || !isPrepared}
                            activeOpacity={0.8}>
                            <Image
                              source={require('../assets/prepare-icon.png')}
                              style={styles.iconPrepare}
                              resizeMode="contain"
                            />
                            <Text style={styles.buttonText}>
                              {isPreparing ? 'Preparing...' : 'Prepare Device'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.checkboxContainer}
                            disabled={isPreparing}
                            onPress={() => {
                              HapticFeedback.light();
                              setIsPrepared(!isPrepared);
                            }}>
                            <View
                              style={[
                                styles.checkbox,
                                isPrepared && styles.checkboxChecked,
                              ]}>
                              {isPrepared && (
                                <Text style={styles.checkboxCheckmark}>✓</Text>
                              )}
                            </View>
                            <Text style={styles.checkboxLabel}>
                              Keep app open during setup
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                  {/* Preparing Modal */}
                  {isPreparing && (
                    <Modal transparent={true} visible={isPreparing}>
                      <View style={styles.modalOverlay}>
                        <View style={styles.preparingModalContent}>
                          {/* Icon Container */}
                          <View style={styles.preparingModalIconContainer}>
                            <View style={styles.preparingModalIconBackground}>
                              <Image
                                source={require('../assets/prepare-icon.png')}
                                style={styles.preparingModalIcon}
                                resizeMode="contain"
                              />
                            </View>
                          </View>

                          {/* Header Text */}
                          <Text style={styles.preparingModalTitle}>
                            Preparing Device
                          </Text>

                          {/* Subtext */}
                          <Text style={styles.preparingModalSubtitle}>
                            Could take a while, given device specs. Do not leave
                            the app during setup.
                          </Text>

                          {/* Loading Indicator */}
                          <View style={styles.preparingProgressContainer}>
                            <View style={styles.preparingProgressTrack}>
                              <Animated.View
                                style={[
                                  styles.preparingProgressBar,
                                  {
                                    backgroundColor:
                                      theme.colors.background === '#ffffff'
                                        ? theme.colors.primary
                                        : theme.colors.accent,
                                    width: progressAnimation.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: ['0%', '100%'],
                                    }),
                                  },
                                ]}
                              />
                            </View>
                          </View>

                          {/* Status and Countdown */}
                          <View style={styles.preparingStatusContainer}>
                            <View style={styles.preparingStatusRow}>
                              <View style={styles.preparingStatusIndicator} />
                              <Text style={styles.preparingStatusText}>
                                Computing cryptographic params
                              </Text>
                            </View>
                            <Text style={styles.preparingCountdownText}>
                              Time elapsed: {prepCounter} seconds
                            </Text>
                          </View>
                        </View>
                      </View>
                    </Modal>
                  )}

                  {/* Help Modal */}
                  <Modal
                    visible={showHelpModal}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={() => setShowHelpModal(false)}>
                    <View style={styles.modalOverlay}>
                      <View style={styles.qrModalContent}>
                        <View style={styles.qrModalHeader}>
                          <Text style={styles.qrModalTitle}>How It Works</Text>
                          <TouchableOpacity
                            style={styles.qrModalCloseButton}
                            onPress={() => {
                              HapticFeedback.medium();
                              setShowHelpModal(false);
                            }}
                            activeOpacity={0.7}>
                            <Text style={styles.qrModalCloseText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <ScrollView
                          style={styles.helpModalBody}
                          showsVerticalScrollIndicator={false}>
                          <View style={styles.helpSection}>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginBottom: 4,
                              }}>
                              <Image
                                source={require('../assets/phone-icon.png')}
                                style={{
                                  width: 18,
                                  height: 18,
                                  marginRight: 8,
                                  tintColor:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary
                                      : theme.colors.accent,
                                }}
                                resizeMode="contain"
                              />
                              <Text style={styles.helpTitle}>
                                Step 1: This Device
                              </Text>
                            </View>
                            <Text style={styles.helpText}>
                              This device generates a unique ID. Share this with
                              other devices by showing the QR code or copying
                              the connection details.
                            </Text>
                          </View>
                          <View style={styles.helpSection}>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginBottom: 4,
                              }}>
                              <Image
                                source={require('../assets/share-icon.png')}
                                style={{
                                  width: 18,
                                  height: 18,
                                  marginRight: 8,
                                  tintColor:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary
                                      : theme.colors.accent,
                                }}
                                resizeMode="contain"
                              />
                              <Text style={styles.helpTitle}>
                                Step 2: Connect Peers
                              </Text>
                            </View>
                            <Text style={styles.helpText}>
                              On each peer device, scan your QR code or paste
                              your connection details. Then share their
                              connection details back to you.
                            </Text>
                          </View>
                          <View style={styles.helpSection}>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginBottom: 4,
                              }}>
                              <Image
                                source={require('../assets/check-icon.png')}
                                style={{
                                  width: 18,
                                  height: 18,
                                  marginRight: 8,
                                  tintColor:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary
                                      : theme.colors.accent,
                                }}
                                resizeMode="contain"
                              />
                              <Text style={styles.helpTitle}>
                                Step 3: Start
                              </Text>
                            </View>
                            <Text style={styles.helpText}>
                              Once all devices are prepared, tap proceed to Key
                              Generation to begin the secure wallet setup
                              process.
                            </Text>
                          </View>
                          <View style={styles.helpSection}>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginBottom: 4,
                              }}>
                              <Image
                                source={require('../assets/about-icon.png')}
                                style={{
                                  width: 18,
                                  height: 18,
                                  marginRight: 8,
                                  tintColor:
                                    theme.colors.background === '#ffffff'
                                      ? theme.colors.primary
                                      : theme.colors.accent,
                                }}
                                resizeMode="contain"
                              />
                              <Text style={styles.helpTitle}>Tips</Text>
                            </View>
                            <Text style={styles.helpText}>
                              • QR scanning is the easiest method{'\n'}• Make
                              sure all devices are online{'\n'}• The process
                              takes 1-2 minutes
                              {'\n'}• Keep devices close together
                            </Text>
                          </View>
                        </ScrollView>
                      </View>
                    </View>
                  </Modal>

                  {/* Final Step - Check other devices are prepared */}
                  {!isSendBitcoin &&
                    !isSignPSBT &&
                    isPreParamsReady &&
                    !mpcDone &&
                    localNpub &&
                    deviceName &&
                    ((isTrio &&
                      peerNpub1 &&
                      peerDeviceName1 &&
                      peerNpub2 &&
                      peerDeviceName2) ||
                      (!isTrio && peerNpub1 && peerDeviceName1)) && (
                      <View style={styles.section}>
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
                              <Text style={styles.finalStepTitle}>
                                Final Step
                              </Text>
                              <Text style={styles.finalStepDescription}>
                                Make sure{' '}
                                {isTrio ? 'all devices' : 'both devices'}{' '}
                                preparation step is complete.
                              </Text>
                            </View>
                          </View>

                          {/* Participants Device Information */}
                          {Object.keys(keyshareMapping).length > 0 && (
                            <View style={styles.participantsList}>
                              <Text style={styles.participantsListTitle}>
                                Participants:
                              </Text>
                              {keyshareMapping.keyshare1 && (
                                <View style={styles.participantItem}>
                                  <Text style={styles.bulletPoint}>•</Text>
                                  <Text style={styles.participantText}>
                                    <Text style={styles.participantLabel}>
                                      KeyShare1
                                    </Text>
                                    {keyshareMapping.keyshare1.isLocal && (
                                      <Text style={styles.localDeviceBadge}>
                                        {' '}
                                        (This device)
                                      </Text>
                                    )}
                                    {'\n'}
                                    <Text style={styles.participantNpub}>
                                      {shortenNpub(
                                        keyshareMapping.keyshare1.npub,
                                        8,
                                        6,
                                      )}
                                    </Text>
                                  </Text>
                                </View>
                              )}
                              {keyshareMapping.keyshare2 && (
                                <View style={styles.participantItem}>
                                  <Text style={styles.bulletPoint}>•</Text>
                                  <Text style={styles.participantText}>
                                    <Text style={styles.participantLabel}>
                                      KeyShare2
                                    </Text>
                                    {keyshareMapping.keyshare2.isLocal && (
                                      <Text style={styles.localDeviceBadge}>
                                        {' '}
                                        (This device)
                                      </Text>
                                    )}
                                    {'\n'}
                                    <Text style={styles.participantNpub}>
                                      {shortenNpub(
                                        keyshareMapping.keyshare2.npub,
                                        8,
                                        6,
                                      )}
                                    </Text>
                                  </Text>
                                </View>
                              )}
                              {keyshareMapping.keyshare3 && (
                                <View style={styles.participantItem}>
                                  <Text style={styles.bulletPoint}>•</Text>
                                  <Text style={styles.participantText}>
                                    <Text style={styles.participantLabel}>
                                      KeyShare3
                                    </Text>
                                    {keyshareMapping.keyshare3.isLocal && (
                                      <Text style={styles.localDeviceBadge}>
                                        {' '}
                                        (This device)
                                      </Text>
                                    )}
                                    {'\n'}
                                    <Text style={styles.participantNpub}>
                                      {shortenNpub(
                                        keyshareMapping.keyshare3.npub,
                                        8,
                                        6,
                                      )}
                                    </Text>
                                  </Text>
                                </View>
                              )}
                            </View>
                          )}

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
                                All devices are ready
                              </Text>
                            </View>
                          </TouchableOpacity>

                          {/* Participant Devices Info */}
                          <View style={styles.participantDevicesInfo}>
                            <Text style={styles.participantDevicesInfoTitle}>
                              Participants:
                            </Text>
                            {(() => {
                              // Collect all participants
                              const participants: Array<{
                                npub: string;
                                deviceName: string;
                              }> = [];

                              if (localNpub && deviceName) {
                                participants.push({
                                  npub: localNpub,
                                  deviceName: deviceName,
                                });
                              }
                              if (peerNpub1 && peerDeviceName1) {
                                participants.push({
                                  npub: peerNpub1,
                                  deviceName: peerDeviceName1,
                                });
                              }
                              if (isTrio && peerNpub2 && peerDeviceName2) {
                                participants.push({
                                  npub: peerNpub2,
                                  deviceName: peerDeviceName2,
                                });
                              }

                              // Sort by npub
                              participants.sort((a, b) =>
                                a.npub.localeCompare(b.npub),
                              );

                              return participants.map((participant, index) => (
                                <View
                                  key={index}
                                  style={styles.participantDeviceItem}>
                                  <View style={styles.participantDeviceLeft}>
                                    <Image
                                      source={require('../assets/phone-icon.png')}
                                      style={styles.participantDeviceIcon}
                                      resizeMode="contain"
                                    />
                                    <Text style={styles.participantDeviceLabel}>
                                      {participant.deviceName}
                                    </Text>
                                  </View>
                                  <Text style={styles.participantDeviceNpub}>
                                    {shortenNpub(participant.npub, 8, 6)}
                                  </Text>
                                </View>
                              ));
                            })()}
                          </View>
                        </View>
                      </View>
                    )}

                  {/* Readiness Checkbox for PSBT Signing */}
                  {isSignPSBT && !isPairing && !mpcDone && (
                    <View style={styles.section}>
                      <TouchableOpacity
                        style={styles.checkboxContainer}
                        onPress={toggleKeysignReady}
                        activeOpacity={0.7}>
                        <View
                          style={[
                            styles.checkbox,
                            isKeysignReady && styles.checkboxChecked,
                          ]}>
                          {isKeysignReady && (
                            <Text style={styles.checkboxCheckmark}>✓</Text>
                          )}
                        </View>
                        <Text style={styles.checkboxLabel}>
                          Keep this app open during signing ⚠️
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Transaction Summary - Show in send mode before button */}
                  {isSendBitcoin && !isPairing && !mpcDone && route.params && (
                    <View style={styles.section}>
                      <View
                        style={{
                          backgroundColor: theme.colors.cardBackground,
                          borderRadius: 12,
                          padding: 12,
                          borderWidth: 1.5,
                          borderColor: theme.colors.border,
                        }}>
                        {/* Network Badge */}
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            marginBottom: 6,
                            paddingVertical: 2,
                          }}>
                          <View
                            style={{
                              backgroundColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary + '20'
                                  : theme.colors.accent + '20',
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 4,
                            }}>
                            <Text
                              style={{
                                fontSize: 10,
                                fontWeight: '700',
                                color: theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.text, // Use text color for better visibility in dark mode
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                                marginTop: 4,
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
                          <View style={[styles.transactionItem, {paddingVertical: 2, marginBottom: 3}]}>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 2,
                              }}>
                              <Text style={[styles.transactionLabel, {fontSize: 12, lineHeight: 14}]}>From Address</Text>
                              {currentDerivationPath && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontStyle: 'italic',
                                    color: theme.colors.textSecondary,
                                    marginLeft: 6,
                                    fontFamily:
                                      Platform.OS === 'ios'
                                        ? 'Menlo'
                                        : 'monospace',
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
                        <View style={[styles.transactionItem, {paddingVertical: 2, marginBottom: 3}]}>
                          <Text style={[styles.transactionLabel, {fontSize: 12, lineHeight: 14}]}>To Address</Text>
                          <View style={styles.addressContainer}>
                            <Text
                              style={styles.addressValue}
                              numberOfLines={1}
                              ellipsizeMode="middle">
                              {route.params?.toAddress || ''}
                            </Text>
                          </View>
                        </View>

                        <View style={[styles.transactionItem, {paddingVertical: 2, marginBottom: 3}]}>
                          <Text style={[styles.transactionLabel, {fontSize: 12, lineHeight: 14}]}>
                            Transaction Amount
                          </Text>
                          <View style={styles.amountContainer}>
                            <Text style={[styles.amountValue, {fontSize: 13}]}>
                              {sat2btcStr(route.params?.satoshiAmount)} BTC
                            </Text>
                            <Text style={[styles.fiatValue, {fontSize: 12}]}>
                              {route.params?.selectedCurrency || ''}{' '}
                              {formatFiat(route.params?.fiatAmount)}
                            </Text>
                          </View>
                        </View>

                        <View style={[styles.transactionItem, {paddingVertical: 2, marginBottom: 0}]}>
                          <Text style={[styles.transactionLabel, {fontSize: 12, lineHeight: 14}]}>
                            Transaction Fee
                          </Text>
                          <View style={styles.amountContainer}>
                            <Text style={[styles.amountValue, {fontSize: 13}]}>
                              {sat2btcStr(route.params?.satoshiFees)} BTC
                            </Text>
                            <Text style={[styles.fiatValue, {fontSize: 12}]}>
                              {route.params?.selectedCurrency || ''}{' '}
                              {formatFiat(route.params?.fiatFees)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Start Button */}
                  {!isPairing && !mpcDone && (
                    <View style={styles.section}>
                      <TouchableOpacity
                        style={[
                          styles.button,
                          (isSendBitcoin || isSignPSBT
                            ? !localNpub ||
                              sendModeDevices.length === 0 ||
                              (isTrio && !selectedPeerNpub) ||
                              (isSignPSBT && !isKeysignReady)
                            : !canStartKeygen) && styles.buttonDisabled,
                        ]}
                        onPress={
                          isSignPSBT
                            ? startSignPSBT
                            : isSendBitcoin
                            ? startSendBTC
                            : startKeygen
                        }
                        disabled={
                          isSendBitcoin || isSignPSBT
                            ? !localNpub ||
                              sendModeDevices.length === 0 ||
                              (isTrio && !selectedPeerNpub) ||
                              (isSignPSBT && !isKeysignReady)
                            : !canStartKeygen
                        }
                        activeOpacity={0.8}>
                        <View style={styles.buttonContent}>
                          {(isSendBitcoin ||
                            isSignPSBT ||
                            !(isSendBitcoin || isSignPSBT)) && (
                            <Image
                              source={
                                isSendBitcoin || isSignPSBT
                                  ? require('../assets/cosign-icon.png')
                                  : require('../assets/key-icon.png')
                              }
                              style={styles.buttonIcon}
                              resizeMode="contain"
                            />
                          )}
                          <Text style={styles.buttonText}>
                            {isSendBitcoin || isSignPSBT
                              ? (() => {
                                  // Determine if local device is KeyShare1
                                  const localDevice = sendModeDevices.find(
                                    d => d.isLocal,
                                  );
                                  const isKeyShare1 =
                                    localDevice?.keyshareLabel === 'KeyShare1';
                                  return isKeyShare1
                                    ? isSignPSBT
                                      ? 'Start PSBT Signing'
                                      : 'Start Co-Signing'
                                    : isSignPSBT
                                    ? 'Join PSBT Signing'
                                    : 'Join Co-Signing';
                                })()
                              : (() => {
                                  // For keygen, determine if local npub is first in sorted order
                                  const allNpubs = [localNpub];
                                  if (peerNpub1) allNpubs.push(peerNpub1);
                                  if (isTrio && peerNpub2)
                                    allNpubs.push(peerNpub2);
                                  const sortedNpubs = allNpubs.sort();
                                  const isKeyShare1 =
                                    sortedNpubs[0] === localNpub;
                                  return isKeyShare1
                                    ? 'Start Key Generation'
                                    : 'Join Key Generation';
                                })()}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              );
            })()}

          {/* Keygen Modal - Similar to MobilesPairing */}
          {isPairing && !isSendBitcoin && !isSignPSBT && (
            <Modal transparent={true} visible={isPairing} animationType="fade">
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
                  <Text style={styles.modalTitle}>Finalizing Your Wallet</Text>

                  {/* Subtext */}
                  <Text style={styles.modalSubtitle}>
                    Securing your wallet with advanced cryptography. Please stay
                    in the app...
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
                        {status || 'Processing cryptographic operations'}
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

          {/* Co-Signing Modal - Similar to MobilesPairing send_btc and sign_psbt */}
          {isPairing && (isSendBitcoin || isSignPSBT) && (
            <Modal transparent={true} visible={isPairing} animationType="fade">
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  {/* Icon Container */}
                  <View style={styles.modalIconContainer}>
                    <View style={styles.modalIconBackground}>
                      <Image
                        source={require('../assets/cosign-icon.png')}
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
                    Securing your transaction with multi-party cryptography.
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
                        {status || 'Processing multi-party signature'}
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

          {/* Success and Backup UI - Only show for keygen, not for send BTC or sign PSBT */}
          {mpcDone && !isSendBitcoin && !isSignPSBT && (
            <>
              {/* Keyshare Created Success */}
              <View style={styles.section}>
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
                    Create secure backups of your keyshares. Store each device's
                    backup in different locations to prevent single points of
                    failure.
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
                        Backup{' '}
                        {keyshareMapping.keyshare1?.isLocal
                          ? 'KeyShare1'
                          : keyshareMapping.keyshare2?.isLocal
                          ? 'KeyShare2'
                          : keyshareMapping.keyshare3?.isLocal
                          ? 'KeyShare3'
                          : 'Keyshare'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Backup Confirmation */}
              <View style={styles.section}>
                <View style={styles.informationCard}>
                  <View style={styles.backupConfirmationHeader}>
                    <View style={styles.backupConfirmationIcon}>
                      <Text style={styles.backupConfirmationIconText}>✓</Text>
                    </View>
                    <Text style={styles.backupConfirmationTitle}>
                      Confirm Backups
                    </Text>
                  </View>
                  <Text style={styles.backupConfirmationDescription}>
                    Verify that {isTrio ? 'all devices' : 'both devices'} have
                    successfully backed up their keyshares.
                  </Text>

                  <View style={styles.backupConfirmationContainer}>
                    {(() => {
                      // Build device list based on keyshare mapping (sorted order)
                      const devices = [];
                      if (keyshareMapping.keyshare1) {
                        devices.push({
                          key: 'deviceOne',
                          label: `KeyShare1 (${keyshareMapping.keyshare1.deviceName}) backed up`,
                          device: keyshareMapping.keyshare1.deviceName,
                          keyshareLabel: 'KeyShare1',
                        });
                      }
                      if (keyshareMapping.keyshare2) {
                        devices.push({
                          key: 'deviceTwo',
                          label: `KeyShare2 (${keyshareMapping.keyshare2.deviceName}) backed up`,
                          device: keyshareMapping.keyshare2.deviceName,
                          keyshareLabel: 'KeyShare2',
                        });
                      }
                      if (keyshareMapping.keyshare3) {
                        devices.push({
                          key: 'deviceThree',
                          label: `KeyShare3 (${keyshareMapping.keyshare3.deviceName}) backed up`,
                          device: keyshareMapping.keyshare3.deviceName,
                          keyshareLabel: 'KeyShare3',
                        });
                      }
                      return devices;
                    })().map(item => (
                      <TouchableOpacity
                        key={item.key}
                        style={[
                          styles.enhancedBackupCheckbox,
                          backupChecks[item.key as keyof typeof backupChecks] &&
                            styles.enhancedBackupCheckboxChecked,
                        ]}
                        onPress={() => {
                          HapticFeedback.medium();
                          toggleBackedup(item.key as keyof typeof backupChecks);
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
                            {item.keyshareLabel} ({item.device}) secured
                          </Text>
                        </View>
                        <Image
                          source={require('../assets/check-icon.png')}
                          style={[
                            styles.backupCheckIcon,
                            backupChecks[
                              item.key as keyof typeof backupChecks
                            ] && {tintColor: theme.colors.secondary},
                            !backupChecks[
                              item.key as keyof typeof backupChecks
                            ] && {tintColor: theme.colors.textSecondary + '40'},
                          ]}
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
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* QR Scanner Modal */}
      <QRScanner
        visible={isQRScannerVisible}
        onClose={() => setIsQRScannerVisible(false)}
        onScan={(data: string) => handleQRScan(data, scanningForPeer)}
        mode="single"
        title="Scan Connection QR"
        subtitle="Point camera at the connection QR from the other device"
      />

      {/* QR Code Modal */}
      <Modal
        visible={isQRModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsQRModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.qrModalContent}>
            <View style={styles.qrModalHeader}>
              <Text style={styles.qrModalTitle}>Connection Details</Text>
              <TouchableOpacity
                style={styles.qrModalCloseButton}
                onPress={() => {
                  HapticFeedback.medium();
                  setIsQRModalVisible(false);
                }}
                activeOpacity={0.7}>
                <Text style={styles.qrModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.qrModalBody}>
              <View style={styles.qrContainer}>
                <QRCode
                  value={connectionDetails}
                  size={250}
                  getRef={ref => {
                    connectionQrRef.current = ref;
                  }}
                />
              </View>
              <Text style={styles.connectionDetailsText}>
                {shortenNpub(connectionDetails)}
              </Text>
              <TouchableOpacity
                style={{
                  backgroundColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.primary
                      : theme.colors.accent,
                  borderRadius: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                }}
                onPress={shareConnectionDetails}
                activeOpacity={0.8}>
                <Image
                  source={require('../assets/share-icon.png')}
                  style={styles.iconShare}
                  resizeMode="contain"
                />
                <Text
                  style={{
                    color:
                      theme.colors.background === '#ffffff'
                        ? theme.colors.white
                        : theme.colors.text,
                    fontWeight: '600',
                    fontSize: 16,
                  }}>
                  Share
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
                <Text style={styles.passwordLabel}>Set a Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Enter a strong password"
                    placeholderTextColor={theme.colors.textSecondary + '80'}
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
                    placeholderTextColor={theme.colors.textSecondary + '80'}
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

export default MobileNostrPairing;
