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
import BarcodeZxingScan from 'rn-barcode-zxing-scan';
import {Camera, useCameraDevice} from 'react-native-vision-camera';
import * as Progress from 'react-native-progress';
import {CommonActions, RouteProp, useRoute} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Big from 'big.js';
import {dbg, HapticFeedback, getNostrRelays} from '../utils';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import LocalCache from '../services/LocalCache';
import {WalletService} from '../services/WalletService';
import RNFS from 'react-native-fs';

const {BBMTLibNativeModule} = NativeModules;

// QR Scanner Component (moved outside to avoid re-render issues)
const QRScannerComponent = ({
  cameraDevice,
  onScan,
  onClose,
  theme,
}: {
  cameraDevice: any;
  onScan: (data: string) => void;
  onClose: () => void;
  theme: any;
}) => {
  const scannerStyles = StyleSheet.create({
    scannerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    qrFrame: {
      width: 250,
      height: 250,
      borderWidth: 2,
      borderColor: theme.colors.primary,
      borderRadius: 12,
    },
    closeScannerButton: {
      position: 'absolute',
      bottom: 40,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
    },
    closeScannerButtonText: {
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: '600',
    },
    cameraNotFound: {
      color: theme.colors.text,
      fontSize: 16,
    },
  });

  if (!cameraDevice) {
    return (
      <View style={scannerStyles.scannerContainer}>
        <Text style={scannerStyles.cameraNotFound}>Camera Not Found</Text>
        <TouchableOpacity
          style={scannerStyles.closeScannerButton}
          onPress={onClose}>
          <Text style={scannerStyles.closeScannerButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const codeScanner = {
    codeTypes: ['qr' as const],
    onCodeScanned: (codes: any[]) => {
      if (codes.length > 0) {
        onScan(codes[0].value);
      }
    },
  };

  return (
    <View style={scannerStyles.scannerContainer}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={cameraDevice}
        isActive={true}
        torch="off"
        codeScanner={codeScanner}
      />
      <View style={scannerStyles.qrFrame} />
      <TouchableOpacity
        style={scannerStyles.closeScannerButton}
        onPress={onClose}
        activeOpacity={0.7}>
        <Text style={scannerStyles.closeScannerButtonText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
};

type RouteParams = {
  mode?: string; // 'duo' | 'trio' | 'send_btc'
  addressType?: string;
  toAddress?: string;
  satoshiAmount?: string;
  fiatAmount?: string;
  satoshiFees?: string;
  fiatFees?: string;
  selectedCurrency?: string;
  spendingHash?: string;
};

const MobileNostrPairing = ({navigation}: any) => {
  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const isSendBitcoin = route.params?.mode === 'send_btc';
  const setupMode = route.params?.mode;
  // In send mode, determine isTrio from keyshare (3 devices = trio, 2 devices = duo)
  // In keygen mode, use setupMode
  const [isTrio, setIsTrio] = useState<boolean>(setupMode === 'trio');
  const {theme} = useTheme();
  const {activeAddress} = useUser();
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
  const [canStartKeygen, setCanStartKeygen] = useState(false); // Auto-calculated: all conditions met
  const [mpcDone, setMpcDone] = useState(false);
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

  // QR Scanner
  const [isQRScannerVisible, setIsQRScannerVisible] = useState(false);
  const [scanningForPeer, setScanningForPeer] = useState<1 | 2>(1);
  const scanningForPeerRef = useRef<1 | 2>(1);
  const [isQRModalVisible, setIsQRModalVisible] = useState(false);
  const [showRelayConfig, setShowRelayConfig] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Only use camera hooks on iOS - Android uses BarcodeZxingScan
  let device: any = null;
  if (Platform.OS === 'ios') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    device = useCameraDevice('back');
  }

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
        // Only generate new keypair if not in send mode (send mode loads from keyshare)
        if (!isSendBitcoin) {
          await generateLocalKeypair();
        }
      } catch (error) {
        dbg('Error initializing:', error);
        Alert.alert('Error', 'Failed to initialize device');
      }
    };
    initialize();
  }, [isSendBitcoin]);

  // Generate session params when peer connections are ready
  useEffect(() => {
    if (localNpub && deviceName && partialNonce) {
      if (isSendBitcoin) {
        // For send BTC, we need balance - will be generated when starting
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
  ]);

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

  // Listen to native module events for progress tracking
  useEffect(() => {
    const eventEmitter = new NativeEventEmitter(BBMTLibNativeModule);
    const keygenSteps = isTrio ? 29 : 18;
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
            setStatus(msg.info || '');
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
          setStatus(msg.info || '');
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
          setStatus(msg.info || '');
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
    if (!isSendBitcoin) return;

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
              // Hex decode function for React Native
              const hexToString = (hex: string): string => {
                let result = '';
                for (let i = 0; i < hex.length; i += 2) {
                  result += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
                }
                return result;
              };

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
  }, [isSendBitcoin]);

  // Auto-select peer in duo mode, or first peer in trio mode (deterministic)
  // Only auto-selects if no selection exists - never overrides user's manual selection
  useEffect(() => {
    if (isSendBitcoin && sendModeDevices.length > 0) {
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
  }, [isSendBitcoin, isTrio, sendModeDevices, selectedPeerNpub]);

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
      // Get rounded time (60 second window for keygen)
      const now = Date.now();
      const rounded = Math.floor(now / 90000);
      // roundedTime is only used in debug logs, no need to store in state

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
      dbg('rounded (time window):', rounded);
      dbg(
        'Session ID input string:',
        `${npubsSorted},${deviceNamesSorted},${rounded}:${fullNonce}`,
      );

      // Generate session ID
      const sessionIDHash = await BBMTLibNativeModule.sha256(
        `${npubsSorted},${deviceNamesSorted},${rounded}:${fullNonce}`,
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
        roundedTime: rounded,
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
          routes: [{name: 'Nostr Pairing', params: route.params}],
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

    try {
      // Get wallet balance in satoshis
      const keyshareJSON = await EncryptedStorage.getItem('keyshare');
      if (!keyshareJSON) {
        throw new Error('Keyshare not found');
      }

      const keyshare = JSON.parse(keyshareJSON);

      // Get nsec from keyshare (use local variable, not state)
      let nsecToUse = localNsec;
      if (!nsecToUse || !nsecToUse.startsWith('nsec1')) {
        const nsecFromKeyshare = keyshare.nsec || '';
        if (nsecFromKeyshare) {
          try {
            let decodedNsec = '';

            // Check if it's already in bech32 format
            if (nsecFromKeyshare.startsWith('nsec1')) {
              decodedNsec = nsecFromKeyshare;
            } else {
              // Hex decode function for React Native
              const hexToString = (hex: string): string => {
                let result = '';
                for (let i = 0; i < hex.length; i += 2) {
                  result += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
                }
                return result;
              };

              decodedNsec = hexToString(nsecFromKeyshare);
            }

            if (decodedNsec.startsWith('nsec1')) {
              nsecToUse = decodedNsec;
              setLocalNsec(decodedNsec); // Update state for UI
              dbg(
                'Loaded nsec from keyshare in startSendBTC:',
                decodedNsec.substring(0, 20) + '...',
              );
            } else {
              throw new Error(
                `Invalid nsec format in keyshare: ${decodedNsec.substring(
                  0,
                  50,
                )}`,
              );
            }
          } catch (error) {
            dbg('Error loading nsec from keyshare in startSendBTC:', error);
            throw new Error(`Failed to load nsec from keyshare: ${error}`);
          }
        } else {
          throw new Error('nsec not found in keyshare');
        }
      }

      // Verify nsec is valid
      if (!nsecToUse || !nsecToUse.startsWith('nsec1')) {
        throw new Error(
          'Invalid nsec: nsec must be in bech32 format (nsec1...)',
        );
      }

      if (!activeAddress) {
        throw new Error('Active address not found');
      }

      const balance = await WalletService.getInstance().getWalletBalance(
        activeAddress,
        0,
        0,
        false,
      );
      const balanceSats = Big(balance.btc).times(1e8).toString();

      // IMPORTANT: For session ID, we need ALL npubs from the keyshare (all participants)
      // Get all hex keys from keygen_committee_keys and convert them ALL to npubs
      const allNpubsFromKeyshare: string[] = [];

      // Get all keys from keygen_committee_keys and convert them ALL to npubs
      const sortedKeys = [...keyshare.keygen_committee_keys].sort();
      for (const key of sortedKeys) {
        try {
          // Check if it's already an npub (shouldn't happen, but handle it)
          if (key && typeof key === 'string' && key.startsWith('npub1')) {
            allNpubsFromKeyshare.push(key);
            dbg('Key already npub format:', key.substring(0, 20) + '...');
            continue;
          }

          // Validate hex key format
          const hexPattern = /^[0-9a-fA-F]+$/;
          if (!hexPattern.test(key)) {
            dbg(
              'Invalid key format (not hex, not npub), skipping:',
              key.substring(0, 20) + '...',
            );
            continue;
          }

          // Convert hex to npub (convert ALL keys, including local)
          const npub = await BBMTLibNativeModule.hexToNpub(key);
          if (npub && typeof npub === 'string' && npub.startsWith('npub1')) {
            allNpubsFromKeyshare.push(npub);
            dbg(
              'Converted hex to npub for session ID:',
              npub.substring(0, 20) + '...',
            );
          } else {
            dbg('Failed to convert hex to npub, result:', npub);
          }
        } catch (error) {
          dbg('Error converting hex to npub for session ID:', error);
        }
      }

      // Sort all npubs - this must match on all devices
      const npubsSorted = [...allNpubsFromKeyshare].sort().join(',');

      if (npubsSorted.length === 0 || allNpubsFromKeyshare.length < 2) {
        throw new Error(
          `Failed to get all npubs from keyshare. Got ${allNpubsFromKeyshare.length} npubs. Please ensure all devices are loaded.`,
        );
      }

      dbg(
        'All npubs for session ID:',
        allNpubsFromKeyshare.map(n => n.substring(0, 20) + '...'),
      );

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

      dbg(
        'partiesNpubsCSV for signing (full npubs, length=',
        partiesNpubsCSV.length,
        '):',
        partiesNpubsCSV.substring(0, 100) + '...',
      );
      const satoshiAmount = route.params.satoshiAmount || '0';
      const satoshiFees = route.params.satoshiFees || '0';

      // Generate session ID (includes all transaction details that must match)
      // Format: sha256(npubsSorted,balance,amount,rounded)
      const rounded = Math.floor(Date.now() / 90000);

      dbg(
        'session id params:',
        `${npubsSorted},${balanceSats},${satoshiAmount},${rounded}`,
      );
      dbg(
        'session_params',
        JSON.stringify(
          {npubsSorted, balanceSats, satoshiAmount, rounded},
          null,
          4,
        ),
      );

      const sessionIDHash = await BBMTLibNativeModule.sha256(
        `${npubsSorted},${balanceSats},${satoshiAmount},${rounded},${route.params.spendingHash}`,
      );
      setSessionID(sessionIDHash);

      // Generate session key (deterministic, no time dependency)
      // Format: sha256(npubsSorted,sessionID) - same pattern as keygen
      const sessionKeyHash = await BBMTLibNativeModule.sha256(
        `${npubsSorted},${sessionIDHash}`,
      );
      setSessionKey(sessionKeyHash);

      dbg('Generated send BTC session params:', {
        sessionID: sessionIDHash.substring(0, 16) + '...',
        sessionKey: sessionKeyHash.substring(0, 16) + '...',
        npubsSorted: npubsSorted.substring(0, 30) + '...',
        balance: balanceSats,
        amount: satoshiAmount,
        fees: satoshiFees,
        spendingHash: route.params.spendingHash,
      });

      // Prepare relays CSV
      const relaysCSV = relays.join(',');

      const derivePath = "m/44'/0'/0'/0/0";

      // Derive the public key from the root key using the derivation path
      // This is critical - we need the DERIVED public key, not the root!
      const publicKey = await BBMTLibNativeModule.derivePubkey(
        keyshare.pub_key,
        keyshare.chain_code_hex,
        derivePath,
      );

      dbg(
        'Derived public key for path:',
        derivePath,
        'pubKey:',
        publicKey.substring(0, 20) + '...',
      );

      dbg('Starting Nostr send BTC with:', {
        relays: relaysCSV,
        parties: partiesNpubsCSV,
        sessionID: sessionIDHash.substring(0, 16) + '...',
        sessionKey: sessionKeyHash.substring(0, 16) + '...',
        amount: route.params?.satoshiAmount,
        localNsec: nsecToUse ? nsecToUse.substring(0, 20) + '...' : 'MISSING',
        derivePath: derivePath,
        derivedPublicKey: publicKey.substring(0, 20) + '...',
      });

      dbg(
        'Calling nostrMpcSendBTC with nsec:',
        nsecToUse.substring(0, 20) + '...',
      );

      // Call native module - use local variables, not state
      const txId = await BBMTLibNativeModule.nostrMpcSendBTC(
        relaysCSV,
        nsecToUse,
        partiesNpubsCSV,
        sessionIDHash,
        sessionKeyHash,
        keyshareJSON,
        derivePath,
        publicKey,
        activeAddress,
        route.params.toAddress || '',
        route.params.satoshiAmount || '0',
        route.params.satoshiFees || '0',
      );

      // Validate txId
      const validTxID = /^[a-fA-F0-9]{64}$/.test(txId);
      if (!validTxID) {
        throw new Error(txId || 'Invalid transaction ID');
      }

      // Save pending transaction
      const pendingTxs = JSON.parse(
        (await LocalCache.getItem(`${activeAddress}-pendingTxs`)) || '{}',
      );
      pendingTxs[txId] = {
        txid: txId,
        from: activeAddress,
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
        `${activeAddress}-pendingTxs`,
        JSON.stringify(pendingTxs),
      );

      // Navigate to home (same as MobilesPairing.tsx)
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{name: 'Home'}],
        }),
      );

      setMpcDone(true);
    } catch (error: any) {
      dbg('Send BTC error:', error);
      Alert.alert('Error', error?.message || 'Transaction signing failed');
      setStatus('Transaction signing failed');
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

  const sat2btcStr = (sats?: string) =>
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
      HapticFeedback.medium();

      const storedKeyshare = await EncryptedStorage.getItem('keyshare');
      if (storedKeyshare) {
        const json = JSON.parse(storedKeyshare);
        const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
          storedKeyshare,
          await BBMTLibNativeModule.sha256(password),
        );

        // Create friendly filename with date and time
        const now = new Date();
        const month = now.toLocaleDateString('en-US', {month: 'short'});
        const day = now.getDate().toString().padStart(2, '0');
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const share = json.local_party_key || json.nostr_npub || 'keyshare';
        const friendlyFilename = `${share}.${month}${day}.${year}.${hours}${minutes}.share`;

        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${friendlyFilename}`;

        await RNFS.writeFile(filePath, encryptedKeyshare, 'base64');

        await Share.open({
          title: 'Backup Your Keyshare',
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

  const copyConnectionDetails = () => {
    Clipboard.setString(connectionDetails);
    HapticFeedback.medium();
    Alert.alert('Copied', '- Connection details copied to clipboard.\n- Paste them to your other device(s)');
  };

  const shareConnectionDetails = async () => {
    try {
      HapticFeedback.medium();
      const result = await Share.open({
        message: connectionDetails,
        title: 'Share Connection Details',
      });
      dbg('Share result:', result);
      // Close modal if share was successful
      if (result) {
        setIsQRModalVisible(false);
      }
    } catch (error: any) {
      dbg('Error sharing connection details:', error);
      // Fallback to clipboard if share fails
      Clipboard.setString(connectionDetails);
      Alert.alert('Copied', 'Connection details copied to clipboard');
      setIsQRModalVisible(false);
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
      borderColor: theme.colors.primary,
      borderWidth: 2,
      backgroundColor: theme.colors.primary + '10',
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
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
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
      backgroundColor: 'rgba(0,0,0,0.02)',
    },
    inputFocused: {
      borderColor: theme.colors.primary,
      backgroundColor: 'rgba(0,0,0,0.03)',
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
      backgroundColor: theme.colors.primary + '20',
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
      backgroundColor: theme.colors.primary + '10',
      borderRadius: 8,
      padding: 12,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.primary,
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
      borderColor: theme.colors.primary,
      borderWidth: 1.5,
      backgroundColor: theme.colors.primary + '08',
    },
    sendModeDeviceIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.primary,
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
      color: theme.colors.primary,
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
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
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
      tintColor: theme.colors.primary,
    },
    iconImage: {
      width: 24,
      height: 24,
      tintColor: theme.colors.primary,
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
      backgroundColor: 'white',
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
      backgroundColor: theme.colors.primary,
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
      color: theme.colors.background,
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
      backgroundColor: theme.colors.primary,
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
      backgroundColor: theme.colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    finalizingModalIcon: {
      width: 24,
      height: 24,
      tintColor: theme.colors.primary,
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
      tintColor: theme.colors.primary,
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
      borderColor: theme.colors.primary,
      borderRadius: 12,
    },
    closeScannerButton: {
      position: 'absolute',
      bottom: 40,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
    },
    closeScannerButtonText: {
      color: theme.colors.background,
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
      backgroundColor: 'rgba(0,0,0,0.02)',
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
      alignItems: 'flex-start',
    },
    headerContent: {
      flex: 1,
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
      backgroundColor: theme.colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
    },
    helpIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.primary,
    },
    stepIndicatorContainer: {
      marginBottom: 8,
      paddingVertical: 16,
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
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
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
      backgroundColor: theme.colors.primary,
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
      backgroundColor: theme.colors.primary + '10',
      borderColor: theme.colors.primary,
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
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary + '10',
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
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
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
      backgroundColor: theme.colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    preparingModalIcon: {
      width: 32,
      height: 32,
      tintColor: theme.colors.primary,
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
      backgroundColor: theme.colors.primary,
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
      borderColor: theme.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
      marginRight: 12,
    },
    enhancedCheckboxChecked: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
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
      backgroundColor: theme.colors.primary + '10',
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
      tintColor: theme.colors.primary,
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
      backgroundColor: theme.colors.primary,
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
      color: theme.colors.textOnPrimary,
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
      tintColor: theme.colors.background,
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
      tintColor: theme.colors.primary,
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
      tintColor: theme.colors.textSecondary,
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
      backgroundColor: theme.colors.primary,
    },
    disabledButton: {
      opacity: 0.5,
    },
    cancelLinkContainer: {
      alignItems: 'center',
      marginTop: 12,
      paddingVertical: 8,
    },
    cancelLinkText: {
      fontSize: 15,
      color: theme.colors.textSecondary,
      fontWeight: '500',
      textDecorationLine: 'underline',
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
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
                      <View style={styles.headerContent}>
                        <Text style={styles.sectionTitle}>
                          {isSendBitcoin ? (
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
                                  width: 20,
                                  height: 20,
                                  marginRight: 8,
                                  tintColor: theme.colors.primary,
                                  marginBottom: 8,
                                }}
                                resizeMode="contain"
                              />
                              <Text
                                style={{
                                  fontSize: 16,
                                  fontWeight: '700',
                                  color: theme.colors.text,
                                  marginBottom: 8,
                                  textAlign: 'center',
                                  fontFamily:
                                    Platform.OS === 'ios' ? 'System' : 'Roboto',
                                }}>
                                Transaction Co-Signing
                              </Text>
                            </View>
                          ) : (
                            'Setup Wallet'
                          )}
                        </Text>
                        <Text style={styles.sectionSubtitle}>
                          {isSendBitcoin
                            ? 'Select one device to co-sign with (2 devices total)'
                            : 'Connect with other devices to create wallet'}
                        </Text>
                      </View>
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
                    </View>

                    {/* Cancel/Abort Link - Soft and centered */}
                    {!mpcDone && !isPairing && (
                      <TouchableOpacity
                        style={styles.cancelLinkContainer}
                        onPress={() => {
                          HapticFeedback.light();
                          if (isSendBitcoin) {
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
                        <Text style={styles.cancelLinkText}>
                          {isSendBitcoin ? 'Cancel Signing' : 'Cancel Pairing'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Send Mode: Device Selection - Show current device and allow selecting one other */}
                  {isSendBitcoin && (
                    <View style={styles.section}>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: '700',
                          color: theme.colors.text,
                          marginBottom: 8,
                        }}>
                        Your Device
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
                                    {marginBottom: 24},
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
                                        Your device
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
                                  <Text
                                    style={{
                                      fontSize: 16,
                                      fontWeight: '700',
                                      color: theme.colors.text,
                                      marginBottom: 12,
                                      marginTop: 8,
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
                                </>
                              )}
                            </>
                          );
                        })()
                      )}
                    </View>
                  )}

                  {/* Step Indicator */}
                  {!isSendBitcoin && (
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
                        <Text style={styles.stepLabel}>Second Peer</Text>
                        {isTrio && (
                          <Text style={styles.stepLabel}>Third Peer</Text>
                        )}
                        <Text style={styles.stepLabel}>Prepared</Text>
                        <Text style={styles.stepLabel}>Ready</Text>
                      </View>
                    </View>
                  )}

                  {/* Relay Configuration - Collapsible - Hide when Final Step is shown */}
                  {!showFinalStep && (
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

                  {/* Local Device Card - Hide when Final Step is shown or in send mode */}
                  {localNpub && deviceName && partialNonce && !showFinalStep && !isSendBitcoin && (
                    <View style={styles.section}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '600',
                          color: theme.colors.text,
                          marginBottom: 12,
                        }}>
                        Your Device
                      </Text>
                      <View style={styles.card}>
                        <View style={styles.hintBox}>
                          <Text style={styles.hintText}>
                            📱 On other device(s), paste or scan this
                            connection
                          </Text>
                        </View>
                        <View style={styles.deviceInfoRow}>
                          <Text
                            style={styles.deviceInfoSingleLine}
                            numberOfLines={1}
                            ellipsizeMode="middle"
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.8}>
                            {deviceName}@{shortenNpub(localNpub, 8, 6)}
                          </Text>
                        </View>
                        <View style={styles.buttonRow}>
                          <TouchableOpacity
                            style={[
                              styles.buttonCompact,
                              styles.buttonSecondary,
                            ]}
                            onPress={copyConnectionDetails}
                            activeOpacity={0.8}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.iconImageCompact}
                              resizeMode="contain"
                            />
                            <Text
                              style={[
                                styles.buttonTextCompact,
                                styles.buttonTextSecondary,
                              ]}>
                              Copy
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.buttonCompact,
                              styles.buttonSecondary,
                            ]}
                            onPress={showQRModal}
                            activeOpacity={0.8}>
                            <Image
                              source={require('../assets/qrc-icon.png')}
                              style={styles.iconImageCompact}
                              resizeMode="contain"
                            />
                            <Text
                              style={[
                                styles.buttonTextCompact,
                                styles.buttonTextSecondary,
                              ]}>
                              QR
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Peer Connection 1 - Hide when Final Step is shown or in send mode */}
                  {!showFinalStep && !isSendBitcoin && (
                    <View style={styles.section}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '600',
                          color: theme.colors.text,
                          marginBottom: 12,
                        }}>
                        {isTrio
                          ? 'Step 2: Second Peer Device'
                          : 'Step 2: Other Peer Device'}
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
                                  if (Platform.OS === 'android') {
                                    BarcodeZxingScan.showQrReader(
                                      (error: any, data: any) => {
                                        if (!error && data) {
                                          handleQRScan(data, peerNum);
                                        }
                                      },
                                    );
                                  } else {
                                    setIsQRScannerVisible(true);
                                  }
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

                  {/* Peer Connection 2 (Trio only) - Hide when Final Step is shown or in send mode */}
                  {isTrio && !showFinalStep && !isSendBitcoin && (
                    <View style={styles.section}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '600',
                          color: theme.colors.text,
                          marginBottom: 12,
                        }}>
                        Step 3: Third Peer Device
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
                                peerInputValidating2 && styles.inputValidating,
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
                                  if (Platform.OS === 'android') {
                                    BarcodeZxingScan.showQrReader(
                                      (error: any, data: any) => {
                                        if (!error && data) {
                                          handleQRScan(data, peerNum);
                                        }
                                      },
                                    );
                                  } else {
                                    setIsQRScannerVisible(true);
                                  }
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

                  {/* Prepare Device Section - Hide in send mode */}
                  {!isSendBitcoin &&
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
                                    backgroundColor: theme.colors.primary,
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
                            <Text style={styles.helpTitle}>
                              📱 Step 1: Your Device
                            </Text>
                            <Text style={styles.helpText}>
                              Your device generates a unique ID. Share this with
                              other devices by showing the QR code or copying
                              the connection details.
                            </Text>
                          </View>
                          <View style={styles.helpSection}>
                            <Text style={styles.helpTitle}>
                              🔗 Step 2: Connect Peers
                            </Text>
                            <Text style={styles.helpText}>
                              On each peer device, scan your QR code or paste
                              your connection details. Then share their
                              connection details back to you.
                            </Text>
                          </View>
                          <View style={styles.helpSection}>
                            <Text style={styles.helpTitle}>
                              ✅ Step 3: Start
                            </Text>
                            <Text style={styles.helpText}>
                              Once all devices are connected, tap "Start Key
                              Generation" to begin the secure wallet setup
                              process.
                            </Text>
                          </View>
                          <View style={styles.helpSection}>
                            <Text style={styles.helpTitle}>💡 Tips</Text>
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
                                {isTrio
                                  ? 'The other devices are ready'
                                  : 'The other device is ready'}
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

                  {/* Transaction Summary - Show in send mode before button */}
                  {isSendBitcoin && !isPairing && !mpcDone && route.params && (
                    <View style={styles.section}>
                      <View
                        style={{
                          padding: 8,
                          paddingTop: 0,
                          width: '100%',
                        }}>
                        <View
                          style={{
                            borderBottomWidth: 0,
                            paddingVertical: 6,
                            marginBottom: 6,
                          }}>
                          <Text
                            style={{
                              fontSize: 16,
                              fontWeight: '600',
                              color: theme.colors.text,
                              marginTop: 1,
                              marginBottom: 2,
                              fontFamily:
                                Platform.OS === 'ios' ? 'System' : 'Roboto',
                              textAlign: 'left',
                              lineHeight: 18,
                            }}>
                            To Address
                          </Text>
                          <View
                            style={{
                              backgroundColor: theme.colors.background,
                              paddingVertical: 6,
                              paddingHorizontal: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                            }}>
                            <Text
                              style={{
                                fontSize: 16,
                                color: theme.colors.text,
                                textAlign: 'left',
                                fontFamily:
                                  Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                                lineHeight: 16,
                              }}
                              numberOfLines={1}
                              ellipsizeMode="middle">
                              {route.params?.toAddress || ''}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={{
                            borderBottomWidth: 0,
                            paddingVertical: 6,
                            marginBottom: 6,
                          }}>
                          <Text
                            style={{
                              fontSize: 16,
                              fontWeight: '600',
                              color: theme.colors.text,
                              marginTop: 1,
                              marginBottom: 2,
                              fontFamily:
                                Platform.OS === 'ios' ? 'System' : 'Roboto',
                              textAlign: 'left',
                              lineHeight: 18,
                            }}>
                            Transaction Amount
                          </Text>
                          <View
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              backgroundColor: theme.colors.background,
                              paddingVertical: 6,
                              paddingHorizontal: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                            }}>
                            <Text
                              style={{
                                fontSize: 17,
                                fontWeight: '600',
                                color: theme.colors.text,
                                fontFamily:
                                  Platform.OS === 'ios' ? 'System' : 'Roboto',
                                textAlign: 'left',
                                lineHeight: 16,
                              }}>
                              {sat2btcStr(route.params?.satoshiAmount)} BTC
                            </Text>
                            <Text
                              style={{
                                fontSize: 16,
                                color: theme.colors.textSecondary,
                                fontFamily:
                                  Platform.OS === 'ios' ? 'System' : 'Roboto',
                                textAlign: 'right',
                                lineHeight: 16,
                              }}>
                              {route.params?.selectedCurrency || ''}{' '}
                              {formatFiat(route.params?.fiatAmount)}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={{
                            borderBottomWidth: 0,
                            paddingVertical: 6,
                            marginBottom: 6,
                          }}>
                          <Text
                            style={{
                              fontSize: 16,
                              fontWeight: '600',
                              color: theme.colors.text,
                              marginTop: 1,
                              marginBottom: 2,
                              fontFamily:
                                Platform.OS === 'ios' ? 'System' : 'Roboto',
                              textAlign: 'left',
                              lineHeight: 18,
                            }}>
                            Transaction Fee
                          </Text>
                          <View
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              backgroundColor: theme.colors.background,
                              paddingVertical: 6,
                              paddingHorizontal: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                            }}>
                            <Text
                              style={{
                                fontSize: 17,
                                fontWeight: '600',
                                color: theme.colors.text,
                                fontFamily:
                                  Platform.OS === 'ios' ? 'System' : 'Roboto',
                                textAlign: 'left',
                                lineHeight: 16,
                              }}>
                              {sat2btcStr(route.params?.satoshiFees)} BTC
                            </Text>
                            <Text
                              style={{
                                fontSize: 16,
                                color: theme.colors.textSecondary,
                                fontFamily:
                                  Platform.OS === 'ios' ? 'System' : 'Roboto',
                                textAlign: 'right',
                                lineHeight: 16,
                              }}>
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
                          (isSendBitcoin
                            ? !localNpub ||
                              sendModeDevices.length === 0 ||
                              (isTrio && !selectedPeerNpub)
                            : !canStartKeygen) && styles.buttonDisabled,
                        ]}
                        onPress={isSendBitcoin ? startSendBTC : startKeygen}
                        disabled={
                          isSendBitcoin
                            ? !localNpub ||
                              sendModeDevices.length === 0 ||
                              (isTrio && !selectedPeerNpub)
                            : !canStartKeygen
                        }
                        activeOpacity={0.8}>
                        <View style={styles.buttonContent}>
                          {(isSendBitcoin || !isSendBitcoin) && (
                            <Image
                              source={
                                isSendBitcoin
                                  ? require('../assets/cosign-icon.png')
                                  : require('../assets/key-icon.png')
                              }
                              style={styles.buttonIcon}
                              resizeMode="contain"
                            />
                          )}
                          <Text style={styles.buttonText}>
                            {isSendBitcoin
                              ? (() => {
                                  // Determine if local device is KeyShare1
                                  const localDevice = sendModeDevices.find(
                                    d => d.isLocal,
                                  );
                                  const isKeyShare1 =
                                    localDevice?.keyshareLabel === 'KeyShare1';
                                  return isKeyShare1
                                    ? 'Start Co-Signing'
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
          {isPairing && !isSendBitcoin && (
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

          {/* Co-Signing Modal - Similar to MobilesPairing send_btc */}
          {isPairing && isSendBitcoin && (
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
                    Co-Signing Your Transaction
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

          {/* Success and Backup UI - Only show for keygen, not for send BTC */}
          {mpcDone && !isSendBitcoin && (
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

          {/* Success Message for Send BTC */}
          {mpcDone && isSendBitcoin && (
            <View style={styles.section}>
              <View style={styles.card}>
                <View style={styles.statusIndicator}>
                  <Image
                    source={require('../assets/success-icon.png')}
                    style={styles.statusCheck}
                    resizeMode="contain"
                  />
                  <Text style={styles.statusText}>
                    Transaction sent successfully!
                  </Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* QR Scanner Modal */}
      {Platform.OS === 'ios' && isQRScannerVisible && (
        <Modal
          visible={isQRScannerVisible}
          transparent={false}
          animationType="slide"
          onRequestClose={() => setIsQRScannerVisible(false)}>
          <QRScannerComponent
            cameraDevice={device}
            onScan={(data: string) => handleQRScan(data, scanningForPeer)}
            onClose={() => setIsQRScannerVisible(false)}
            theme={theme}
          />
        </Modal>
      )}

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
                <QRCode value={connectionDetails} size={250} />
              </View>
              <Text style={styles.connectionDetailsText}>
                {shortenNpub(connectionDetails)}
              </Text>
              <TouchableOpacity
                style={{
                  backgroundColor: theme.colors.primary,
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
                    color: theme.colors.textOnPrimary,
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

export default MobileNostrPairing;
