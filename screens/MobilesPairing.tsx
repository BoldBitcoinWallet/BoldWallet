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
import {
  dbg,
  getPinnedRemoteIPs,
  hexToString,
  getResetToMainTabsWallet,
  getKeyshareDisplayLabel,
  saveKeyshareMetadata,
  getKeyshareMetadata,
  resolveUseLegacyDerivationPaths,
  detectKeyshareTssBackend,
  shortenAddress,
} from '../utils';
import {resolveStoredMempoolApiBase} from '../services/mempoolApiBase';
import {prepareSendBtcMultiPathInputs} from '../services/sendBtcPrepare';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {waitMS, WalletService} from '../services/WalletService';
import {
  resolveTssBackend,
  resolveTssBackendForKeygen,
  type SetupMode,
  type TssBackend,
} from '../services/tssBackend';
import {TssProvider} from '../services/TssProvider';
import {
  parseEciesKeypairJson,
  resolveLanKeysignTransportKeys,
} from '../services/lanMpcTransport';
import {LAN_KEYGEN_STATUS} from '../services/walletSetupUi';
import {
  buildLanRelayServerUrl,
  coalesceLanHost,
  isLanPeerDiscoveryPayload,
  raceLanPeerDiscovery,
  shouldWritePeerFoundCache,
  normalizeLanHost,
  resolveDuoLanRoles,
  resolveEffectiveLanKeygenContext,
  resolveTrioLanRoles,
  isTrioWalletKeyshare,
  loadPersistedLanRoles,
  persistLanPairingRoles,
  resolveDklsLanSigningPartiesFromKeyshare,
  resolveGg18LanSigningPartiesFromKeyshare,
} from '../services/lanMpcSetup';
import {
  invokeLanWalletKeygen,
  persistLanRolesFromContext,
  resolveWalletSetupBackend,
  runLanWalletKeygen,
  runWalletSetupPrepare,
  type WalletSetupRouteParams,
} from '../services/walletSetupOrchestrator';
import {
  getPrepareModalCopy,
  getWalletSetupKeygenModalCopy,
} from '../services/tssKeygenPrepare';
import {
  resetMpcHookSession,
  type MpcProgressUtxoState,
} from '../services/mpcProgress';
import {
  processMpcHookMessage,
  resolveMpcHookBackend,
} from '../services/mpcProgressUi';
import {useMpcCircleProgress} from '../services/useMpcCircleProgress';
import TssBackendBadge from '../components/TssBackendBadge';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import database from '../services/Database';
import transactionRepository from '../services/repositories/TransactionRepository';
import BackupKeyshareModal from '../components/BackupKeyshareModal';
import SignedTxBroadcastModal from '../components/SignedTxBroadcastModal';
import TransactionFlowDiagram from '../components/TransactionFlowDiagram';
import {useSendTxPreview} from '../hooks/useSendTxPreview';
import PairingSpendStickyFooter, {
  PAIRING_STICKY_FOOTER_SCROLL_PADDING,
} from '../components/PairingSpendStickyFooter';
import {
  mapParsedPsbtDetails,
  psbtCollapsedSummaryLine,
  sendCollapsedRecapLine,
} from '../components/transactionFlowUtils';
import {
  parsePsbtSessionPayload,
  psbtIdentityHash,
} from '../services/psbtIdentity';

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
  /** Peer's `local_party_key` from LAN discovery (npub); not overwritten by IP-based KeyShare roles. */
  const [peerCommitteeKey, setPeerCommitteeKey] = useState<string | null>(null);
  const [, setPeerCommitteeKey2] = useState<string | null>(null);
  const [localParty, setLocalParty] = useState<string>('');
  const [isPairing, setIsPairing] = useState(false);
  const [countdown, setCountdown] = useState(timeout);
  const pairingDeadlineRef = useRef(0);
  const mpcHookProgressRef = useRef(0);
  const mpcUtxoRef = useRef<MpcProgressUtxoState>({
    utxoIndex: 0,
    utxoCount: 0,
    utxoRange: 0,
  });
  const [isPreParamsReady, setIsPreParamsReady] = useState(false);
  const [isKeygenReady, setIsKeygenReady] = useState(false);
  const [isPrepared, setIsPrepared] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [doingMPC, setDoingMPC] = useState(false);
  const [mpcDone, setMpcDone] = useState(false);
  const [isMaster, setIsMaster] = useState(false);
  const [masterHost, setMasterHost] = useState<string | null>(null);
  const [prepCounter, setPrepCounter] = useState(0);
  const [keypair, setKeypair] = useState('');
  const [peerPubkey, setPeerPubkey] = useState('');
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
  const [psbtParseError, setPsbtParseError] = useState<string | null>(null);
  const [psbtRetryToken, setPsbtRetryToken] = useState(0);
  const {theme} = useTheme();
  const {
    activeNetwork,
    showMempoolPlayground,
    showUtxosTab,
    showAddressesTab,
    showPsbtTab,
    showWalletTab,
  } = useUser();
  const showPlay = activeNetwork === 'mainnet' && showMempoolPlayground;
  // Animation ref for horizontal progress bar
  const progressAnimation = useSharedValue(0);
  type RouteParams = {
    mode?: string; // 'duo' | 'trio' | 'send_btc' | 'sign_psbt'
    transport?: WalletSetupRouteParams['transport'];
    backend?: WalletSetupRouteParams['backend'];
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
    utxosJson?: string; // Pre-selected UTXOs from QR (avoids re-fetch on scanner)
    changeAddress?: string; // Pre-computed change address from sender (ensures consistency)
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
  const keygenSetupMode: SetupMode | undefined =
    setupMode === 'duo' || setupMode === 'trio' ? setupMode : undefined;
  const routeKeygenBackend =
    route.params?.backend === 'gg18' || route.params?.backend === 'dkls23'
      ? route.params.backend
      : null;
  const [keygenBackend, setKeygenBackend] = useState<TssBackend | null>(
    routeKeygenBackend,
  );
  const [spendBackend, setSpendBackend] = useState<TssBackend | null>(null);
  const prepareCopy = getPrepareModalCopy(keygenBackend ?? undefined);
  const keygenModalCopy = getWalletSetupKeygenModalCopy();
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
  useEffect(() => {
    if (keygenSetupMode) {
      resolveTssBackendForKeygen(keygenSetupMode).then(setKeygenBackend);
    }
  }, [keygenSetupMode]);

  useEffect(() => {
    if (isSendBitcoin || isSignPSBT) {
      resolveTssBackend().then(setSpendBackend);
    }
  }, [isSendBitcoin, isSignPSBT]);

  const [backupChecks, setBackupChecks] = useState({
    deviceOne: false,
    deviceTwo: false,
    deviceThree: false,
  });
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);

  const [txDetailsExpanded, setTxDetailsExpanded] = useState(false);
  const {
    preview: txPreview,
    loading: txPreviewLoading,
    error: txPreviewError,
  } = useSendTxPreview(isSendBitcoin, route.params);
  const [signedTxRawHex, setSignedTxRawHex] = useState<string | null>(null);
  const mpcAbortRef = useRef(false);
  const activeMpcSessionIdRef = useRef<string | null>(null);
  const doingMpcRef = useRef(false);
  const setMpcModalActive = useCallback((active: boolean) => {
    doingMpcRef.current = active;
    setDoingMPC(active);
  }, []);
  const {displayPercent, setCircleTarget, resetCircle} =
    useMpcCircleProgress(doingMPC);
  const broadcastSuccessPayloadRef = useRef<{
    multiPath: boolean;
    pendingKey: string;
    toAddress: string;
    satoshiAmount: string;
    satoshiFees: string;
    net: string;
    addressTypeToUse: string;
    showPlay: boolean;
    showUtxosTab: boolean;
    showAddressesTab: boolean;
    showPsbtTab: boolean;
    showWalletTab: boolean;
    senderAddress: string;
    originalNetwork?: string;
    originalApiUrl?: string;
    isMaster?: boolean;
    inputs?: Array<{txid: string; vout: number; value: number; scriptpubkey_address: string}>;
    outputs?: Array<{scriptpubkey_address: string; value: number}>;
  } | null>(null);

  const allChecked = Object.values(checks).every(Boolean);

  const abortActiveMpc = () => {
    Alert.alert(
      'Abort signing?',
      'This will stop the current MPC signing flow. You can retry anytime.',
      [
        {text: 'Keep signing', style: 'cancel'},
        {
          text: 'Abort',
          style: 'destructive',
          onPress: async () => {
            mpcAbortRef.current = true;
            setMpcModalActive(false);
            setIsPairing(false);
            setStatus('Aborted');
            const sid = activeMpcSessionIdRef.current;
            if (sid) {
              try {
                await TssProvider.cancelMpcSession(sid);
              } catch (e) {
                dbg('MobilesPairing: cancelMpcSession failed', e);
              }
            }
            try {
              stopRelay();
            } catch {
              // ignore
            }
          },
        },
      ],
    );
  };
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
  // Clear all cache when entering wallet setup mode (not signing mode)
  useEffect(() => {
    const clearCacheForSetup = async () => {
      // Only clear cache if we're in setup mode (duo/trio), not signing mode
      if (setupMode === 'duo' || setupMode === 'trio') {
        try {
          dbg('=== MobilesPairing: Clearing all cache for wallet setup');
          // Clear SQLite wallet data
          database.clearWalletData();
          dbg('SQLite wallet data cleared');
          // Clear stale EncryptedStorage items (but keep keyshare if it exists for signing)
          // We clear btcPub as it will be regenerated with the new keyshare
          await EncryptedStorage.removeItem('btcPub');
          dbg('Cleared stale btcPub from EncryptedStorage');
          // Clear WalletService cache
          try {
            // stale key removed;
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
            setPsbtParseError(detailsJson);
            return;
          }
          const details = JSON.parse(detailsJson);
          setPsbtParseError(null);
          setPsbtDetails(
            mapParsedPsbtDetails(details),
          );
          dbg('PSBT details parsed:', {
            inputs: details.inputs?.length || 0,
            outputs: details.outputs?.length || 0,
            fee: details.fee,
          });
        } catch (error) {
          dbg('Error parsing PSBT details:', error);
          setPsbtDetails(null);
          setPsbtParseError(
            error instanceof Error ? error.message : 'Parse failed',
          );
        }
      } else {
        setPsbtDetails(null);
        setPsbtParseError(null);
      }
    };
    parsePSBT();
  }, [isSignPSBT, route.params.psbtBase64, psbtRetryToken]);
  const preparams = async () => {
    setIsPreparing(true);
    setIsPreParamsReady(false);
    setPrepCounter(0);
    try {
      const backend = await runWalletSetupPrepare({
        ppmFile,
        transport: 'lan',
        setupMode: keygenSetupMode,
        backend: keygenBackend ?? routeKeygenBackend,
        skipDeletePpm: __DEV__,
      });
      setKeygenBackend(backend);
      setIsPreParamsReady(true);
    } catch (error: any) {
      setIsPreParamsReady(false);
      Alert.alert('Error', error?.toString() || 'Unknown error occurred');
    } finally {
      setIsPreparing(false);
      setPrepCounter(0);
    }
  };
  const sessionWaitMessage = (master: boolean, keygen: boolean) => {
    if (keygen) {
      return master
        ? 'Waiting for partner to tap Join Setup (both devices, within ~20s)…'
        : 'Connecting to partner — tap Join Setup on both devices…';
    }
    return master
      ? 'Waiting for partner to start co-signing…'
      : 'Connecting to partner for co-signing…';
  };

  async function initSession() {
    const keygenFlow = !isSendBitcoin && !isSignPSBT;
    try {
      const keypairJson =
        (keypair || '').trim() ||
        appConfigRepository.get('lan_ecies_keypair') ||
        '';
      const peerEnc =
        (peerPubkey || '').trim() ||
        appConfigRepository.get('lan_peer_pubkey') ||
        '';
      dbg('initSession: start', {
        isMaster,
        keygenFlow,
        masterHost,
        hasKeypair: Boolean(keypairJson),
        hasPeerPub: Boolean(peerEnc),
        discoveryPort,
        timeoutSec: timeout,
      });
      if (!keypairJson) {
        throw new Error(
          'LAN keypair missing — complete device pairing, then retry setup.',
        );
      }
      if (!peerEnc && !isTrio) {
        throw new Error(
          'Peer public key missing — complete device pairing, then retry setup.',
        );
      }
      const kp = parseEciesKeypairJson(keypairJson);
      dbg('initSession: Parsed keypair', {publicKey: kp.publicKey});
      setStatus(sessionWaitMessage(isMaster, keygenFlow));
      if (isMaster) {
        dbg('initSession: Running as master device');
        let _data = randomSeed(64);
        dbg('initSession: Generated random seed');
        if (isSendBitcoin) {
          dbg('initSession: Preparing for Bitcoin send');
          const meta = await getKeyshareMetadata();
          _data += ':' + route.params.satoshiAmount;
          _data += ':' + route.params.satoshiFees;
          _data += ':' + (meta?.local_party_key || '');
          dbg('initSession: Added Bitcoin transaction data to session data');
        } else if (isSignPSBT) {
          dbg('initSession: Preparing for PSBT signing');
          const meta = await getKeyshareMetadata();
          // For PSBT, use canonical PSBT identity hash (not raw base64 text)
          const psbtHash = await psbtIdentityHash(
            route.params.psbtBase64 || '',
            BBMTLibNativeModule.sha256,
            BBMTLibNativeModule.parsePSBTDetails,
          );
          _data += ':' + psbtHash;
          _data += ':' + (meta?.local_party_key || '');
          dbg('initSession: Added PSBT data to session data');
        }
        dbg('initSession: Publishing data', {
          masterHost,
          dataLen: _data.length,
          peerEncPrefix: peerEnc.length > 16 ? peerEnc.slice(0, 16) + '…' : peerEnc,
          discoveryPort,
          timeout,
        });
        const enckeyCSV = isTrio
          ? [peerEnc, peerPubkey2].filter(Boolean).join(',')
          : peerEnc;
        const published = await BBMTLibNativeModule.publishData(
          String(discoveryPort),
          String(timeout),
          enckeyCSV,
          _data,
          isTrio ? 'trio' : 'duo',
        );
        if (published) {
          dbg('initSession: Data published successfully', {published});
          // Duo send-BTC only: validate peer echoed the same amount checksum.
          if (!isTrio && isSendBitcoin) {
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
          return (_data || '').trim();
        } else {
          dbg('initSession: Timeout waiting for peer device (publishData)');
          throw keygenFlow
            ? 'Partner did not tap Join Setup in time. Both phones must tap Start/Join Setup within about 20 seconds.'
            : 'Waited too long for the other device to start co-signing.';
        }
      } else {
        dbg('initSession: Running as peer device');
        const masterPubForFetch = isTrio
          ? (
              appConfigRepository.get('lan_master_pubkey') ||
              peerEnc ||
              ''
            ).trim()
          : peerEnc;
        const payload = isSendBitcoin
          ? `${peerEnc}/${route.params?.satoshiAmount}`
          : `${masterPubForFetch || peerEnc}/${kp.publicKey}`;
        const checksum = await BBMTLibNativeModule.sha256(payload);
        const peerURL = `${buildLanRelayServerUrl(
          normalizeLanHost(masterHost) || masterHost || '',
          discoveryPort,
        )}/`;
        dbg('initSession: Fetching data from peer', {
          peerURL,
          checksum: checksum.slice(0, 16).concat('…'),
        });
        const rawFetched = await fetchData(peerURL, kp.privateKey, checksum);
        dbg('initSession: Data fetched successfully', {
          len: rawFetched?.length ?? 0,
        });
        return (rawFetched || '').trim();
      }
    } catch (error: any) {
      dbg('initSession: Error occurred', {error});
      const detail =
        error?.message ?? (typeof error === 'string' ? error : String(error));
      throw `Error initializing session:\n${detail}`;
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
  const formatMpcError = (error: unknown): string => {
    if (error == null) {
      return 'Unknown error';
    }
    if (typeof error === 'string') {
      return error;
    }
    const e = error as {message?: string; code?: string};
    const msg = e.message || String(error);
    return e.code ? `${e.code}: ${msg}` : msg;
  };

  const mpcTssSetup = async () => {
    try {
      let backend = keygenBackend ?? routeKeygenBackend;
      if (!backend && keygenSetupMode) {
        backend = await resolveWalletSetupBackend(
          routeKeygenBackend,
          keygenSetupMode,
        );
        setKeygenBackend(backend);
      }
      setMpcDone(false);
      setPrepCounter(0);
      resetMpcHookSession(mpcHookProgressRef, mpcUtxoRef);
      resetCircle();
      setCircleTarget(0);
      setMpcModalActive(true);
      setStatus(LAN_KEYGEN_STATUS.starting);
      dbg('mpcTssSetup: begin', {
        isMaster,
        masterHost,
        localParty,
        keygenBackend: backend,
        keygenSetupMode,
      });
      const keypairJson =
        (keypair || '').trim() ||
        appConfigRepository.get('lan_ecies_keypair') ||
        '';
      const peerPub =
        (peerPubkey || '').trim() ||
        appConfigRepository.get('lan_peer_pubkey') ||
        '';
      if (!keygenSetupMode) {
        throw new Error('Invalid wallet setup mode');
      }
      const orch = await runLanWalletKeygen({
        setupMode: keygenSetupMode,
        backend,
        isMaster,
        masterHost,
        localParty: localParty || '',
        peerParty,
        peerParty2,
        discoveryPort,
        ppmFile,
        initSession,
        keypairJson,
        peerPubkey: peerPub,
        trioPreflight: isTrio
          ? {
              peerIP,
              peerIP2,
              peerDevice,
              peerDevice2,
              peerPubkey,
              peerPubkey2,
            }
          : undefined,
      });
      setKeygenBackend(orch.backend);
      setShareName(orch.partyID);
      activeMpcSessionIdRef.current = orch.sessionID;
      setStatus(LAN_KEYGEN_STATUS.runningKeygen);
      dbg('starting keygen with', {
        server: orch.server,
        partyID: orch.partyID,
        localParty,
        isMaster,
        ppmFile,
        partiesCSV: orch.partiesCSV,
        sessionID: orch.sessionID,
        sessionKey: orch.transport.sessionKey
          ? orch.transport.sessionKey.slice(0, 16).concat('…')
          : '',
        keygenBackend: orch.backend,
        dataLen: orch.chaincode.length,
      });
      invokeLanWalletKeygen(orch, ppmFile, keygenSetupMode)
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
          await saveKeyshareMetadata(result);
          try {
            const ksParsed = JSON.parse(result);
            const display = getKeyshareDisplayLabel(ksParsed);
            if (display) {
              setShareName(display);
            }
            const useLegacyPath = resolveUseLegacyDerivationPaths({
              created_at: ksParsed.created_at,
              tss_backend: detectKeyshareTssBackend(ksParsed),
              local_party_key: ksParsed.local_party_key ?? '',
              keygen_committee_keys: ksParsed.keygen_committee_keys ?? [],
              pub_key: ksParsed.pub_key ?? '',
              chain_code_hex: ksParsed.chain_code_hex ?? '',
              nostr_npub: ksParsed.nostr_npub ?? null,
            });
            appConfigRepository.set(
              CONFIG_KEYS.LEGACY_WALLET_DO_NOT_REMIND,
              useLegacyPath ? 'no' : 'yes',
            );
          } catch {
            /* keep protocol party id in shareName */
          }
          setMpcDone(true);
          deletePreparams();
        })
        .catch((error: any) => {
          dbg('keygen error', error);
          setMpcDone(false);
          resetMpcHookSession(mpcHookProgressRef, mpcUtxoRef);
          resetCircle();
          setCircleTarget(0);
          Alert.alert('Wallet setup failed', formatMpcError(error));
        })
        .finally(async () => {
          if (isMaster) {
            await waitMS(2000);
            BBMTLibNativeModule.stopRelay(localDevice);
            dbg('relay stop:', localDevice);
          }
          setMpcModalActive(false);
        });
    } catch (error: unknown) {
      setMpcDone(false);
      resetMpcHookSession(mpcHookProgressRef, mpcUtxoRef);
      resetCircle();
      setCircleTarget(0);
      Alert.alert('Wallet setup failed', formatMpcError(error));
      if (isMaster) {
        await waitMS(2000);
        BBMTLibNativeModule.stopRelay(localDevice);
        dbg('relay stop:', localDevice);
      }
      setMpcModalActive(false);
    }
  };
  const runKeysign = async () => {
    let backend = spendBackend;
    if (!backend) {
      backend = await resolveTssBackend();
      setSpendBackend(backend);
    }
    setMpcDone(false);
    setPrepCounter(0);
    resetMpcHookSession(mpcHookProgressRef, mpcUtxoRef);
    activeMpcSessionIdRef.current = null;
    resetCircle();
    setCircleTarget(0);
    setStatus('Starting co-signing…');
    setMpcModalActive(true);
    setCircleTarget(0);
    // CRITICAL: Store original network/API before transaction (declared outside try for finally block)
    // We'll use QR code network temporarily for signing, but restore original after
    let originalNetwork = '';
    let originalApiUrl = '';
    try {
      if (isSignPSBT) {
        const net = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
        const apiUrl = resolveStoredMempoolApiBase(net);
        await BBMTLibNativeModule.setBtcNetwork(net);
        await BBMTLibNativeModule.setAPI(net, apiUrl);
      }
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
      const _ksMeta = await getKeyshareMetadata();
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
        net = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
        dbg(
          'MobilesPairing: PSBT signing - using network from app state:',
          net,
        );
        // Set network and API in BBMTLib for this transaction
        const apiUrl = resolveStoredMempoolApiBase(net);
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
        originalNetwork =
          appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
        originalApiUrl = resolveStoredMempoolApiBase(originalNetwork);
        // Set network and API in BBMTLib for this transaction
        const apiUrl = resolveStoredMempoolApiBase(net);
        await BBMTLibNativeModule.setBtcNetwork(net);
        await BBMTLibNativeModule.setAPI(net, apiUrl);
        // CRITICAL: Update LocalCache 'api' key so any balance/UTXO fetches use correct API
        // This ensures operations use the network from route params, not device's current network
        appConfigRepository.set('api', apiUrl);
        dbg('MobilesPairing: Set network and API in BBMTLib:', net, apiUrl);
      }
      // Store original network/API (for both PSBT and send BTC modes)
      if (isSignPSBT) {
        originalNetwork =
          appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
        originalApiUrl = resolveStoredMempoolApiBase(originalNetwork);
      }
      const walletIsTrio = isTrioWalletKeyshare(_ksMeta);
      const persistedRoles = loadPersistedLanRoles();
      let partyID: string;
      let partiesCSV: string;
      if (backend === 'dkls23') {
        const peerKeyForSign =
          (peerCommitteeKey || '').trim() ||
          (peerParty?.startsWith('npub1') ? peerParty : '') ||
          '';
        ({partyID, partiesCSV} = resolveDklsLanSigningPartiesFromKeyshare(
          _ksMeta,
          peerKeyForSign,
        ));
      } else {
        ({partyID, partiesCSV} = resolveGg18LanSigningPartiesFromKeyshare(
          _ksMeta,
          {
            peerParty,
            peerCommitteeKey,
            persistedPeerParty: persistedRoles.peerParty,
          },
        ));
      }
      dbg('runKeysign: LAN signing parties', {
        backend,
        walletIsTrio,
        partyID,
        partiesCSV,
        keyshareLocalKey: _ksMeta?.local_party_key,
        peerCommitteeKey,
        lanRoles: {localParty, peerParty, peerParty2},
      });
      const sessionID = await BBMTLibNativeModule.sha256(`${data}/${server}`);
      activeMpcSessionIdRef.current = sessionID;
      mpcAbortRef.current = false;
      const keypairJson =
        (keypair || '').trim() ||
        appConfigRepository.get('lan_ecies_keypair') ||
        '';
      const peerPub =
        (peerPubkey || '').trim() ||
        appConfigRepository.get('lan_peer_pubkey') ||
        '';
      const {encKey, decKey, sessionKey} = resolveLanKeysignTransportKeys({
        keypairJson,
        peerPubkey: peerPub,
      });
      dbg('public-decoded', data.split(':'));
      if (isSignPSBT) {
        const {psbtHash, peerShare} = parsePsbtSessionPayload(data);
        const localPsbtHash = await psbtIdentityHash(
          route.params.psbtBase64 || '',
          BBMTLibNativeModule.sha256,
          BBMTLibNativeModule.parsePSBTDetails,
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
        // Call PSBT signing - keyshare read inside native (RNES-compatible storage)
        await TssProvider.mpcSignPSBT(
          server,
          partyID,
          partiesCSV,
          sessionID,
          sessionKey,
          encKey,
          decKey,
          route.params.psbtBase64 || '',
        )
          .then(async (signedPsbt: any) => {
            if (mpcAbortRef.current) {
              setMpcModalActive(false);
              return;
            }
            if (
              !signedPsbt ||
              signedPsbt.includes('error') ||
              signedPsbt.includes('failed')
            ) {
              if (!mpcAbortRef.current) {
                Alert.alert(
                  'Operation Error',
                  `Could not sign PSBT.\n${String(signedPsbt)}`,
                );
              }
              dbg(partyID, 'PSBT signing error', String(signedPsbt));
            } else {
              dbg(partyID, 'PSBT signed successfully');
            }
            dbg(
              'PSBT signing complete: Navigating to Wallet tab with signedPsbt',
            );
            navigation.dispatch(
              CommonActions.reset(
                getResetToMainTabsWallet(
                  {signedPsbt},
                  {
                    showPlay,
                    showUtxos: showUtxosTab,
                    showAddresses: showAddressesTab,
                    showPsbt: showPsbtTab,
                    showWallet: showWalletTab,
                  },
                ),
              ),
            );
            setMpcDone(true);
          })
          .catch((e: any) => {
            if (!mpcAbortRef.current) {
              Alert.alert(
                'Operation Error',
                `Could not sign PSBT.\n${e?.message}`,
              );
            }
            dbg(partyID, 'PSBT signing error', e);
          })
          .finally(async () => {
            if (isMaster) {
              await waitMS(2000);
              stopRelay();
            }
            setMpcModalActive(false);
          });
        return; // Exit early for PSBT
      } else {
        // Send BTC mode — UTXO multi-path only (receive + change)
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          _ksMeta?.pub_key || '',
          _ksMeta?.chain_code_hex || '',
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

        let usedMultiPath = false;
        try {
          const prepared = await prepareSendBtcMultiPathInputs({
            network: net,
            addressType: addressTypeToUse,
            utxosJsonFromRoute: route.params?.utxosJson,
            changeAddressFromRoute: route.params?.changeAddress,
            senderDerivationPath: path,
          });
          const utxosWithPathsJSON = prepared.utxosWithPathsJSON;
          const changeAddress = prepared.changeAddress;
          const utxoListParsed = JSON.parse(utxosWithPathsJSON) as Array<{
            address?: string;
          }>;
          const pendingKeyMultiPath =
            utxoListParsed[0]?.address || senderAddress;
          const rawTxHex =
              await TssProvider.mpcSendBTCWithUTXOs(
                server,
                partyID,
                partiesCSV,
                sessionID,
                sessionKey,
                encKey,
                decKey,
                btcPub,
                toAddress,
                satoshiAmount,
                satoshiFees,
                utxosWithPathsJSON,
                changeAddress,
              );
            dbg(partyID, 'signed tx (multi-path), len=', rawTxHex?.length);
            if (
              !rawTxHex ||
              typeof rawTxHex !== 'string' ||
              rawTxHex.length % 2 !== 0 ||
              !/^[a-fA-F0-9]+$/.test(rawTxHex)
            ) {
              throw rawTxHex || 'Invalid signed transaction';
            }
            usedMultiPath = true;
            const pendingKey = pendingKeyMultiPath;
            const utxoList = JSON.parse(utxosWithPathsJSON) as Array<{txid: string; vout: number; value: number; address?: string}>;
            const inputs = utxoList.map((u: any) => ({
              txid: u.txid,
              vout: u.vout,
              value: u.value,
              scriptpubkey_address: u.address ?? '',
            }));
            const totalInput = utxoList.reduce((s: number, u: any) => s + (u.value || 0), 0);
            const changeAmount = totalInput - Number(satoshiAmount) - Number(satoshiFees);
            const outputs: Array<{scriptpubkey_address: string; value: number}> = [
              {scriptpubkey_address: toAddress, value: Number(satoshiAmount)},
            ];
            if (changeAmount > 0) {
              outputs.push({scriptpubkey_address: changeAddress, value: changeAmount});
            }
            broadcastSuccessPayloadRef.current = {
              multiPath: true,
              pendingKey,
              toAddress,
              satoshiAmount,
              satoshiFees,
              net,
              addressTypeToUse,
              showPlay,
              showUtxosTab,
              showAddressesTab,
              showPsbtTab,
              showWalletTab,
              senderAddress,
              originalNetwork,
              originalApiUrl,
              isMaster,
              inputs,
              outputs,
            };
            if (mpcAbortRef.current) {
              setMpcModalActive(false);
              return;
            }
            setSignedTxRawHex(rawTxHex);
            setMpcModalActive(false);
        } catch (multiPathErr) {
          dbg('MobilesPairing: multi-path send failed:', multiPathErr);
          throw multiPathErr;
        }

        if (!usedMultiPath) {
          throw new Error(
            'Send BTC could not start (multi-path). Pull to refresh on Wallet home and try again.',
          );
        }
      }
    } catch (error: any) {
      if (!mpcAbortRef.current) {
        Alert.alert('Operation Error', error?.message || error);
      }
      dbg(localDevice, 'keysign error', error);
      // CRITICAL: Restore original network even on error
      if (originalNetwork && originalApiUrl) {
        try {
          await BBMTLibNativeModule.setBtcNetwork(originalNetwork);
          await BBMTLibNativeModule.setAPI(originalNetwork, originalApiUrl);
          // Restore LocalCache 'api' key to original network's API
          appConfigRepository.set('api', originalApiUrl);
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
      setMpcModalActive(false);
    }
  };
  const stopRelay = useCallback(() => {
    try {
      BBMTLibNativeModule.stopRelay(localDevice);
      dbg(localDevice, 'relay stop:');
    } catch {
      dbg(localDevice, 'error stoping relay');
    }
  }, [localDevice]);
  useEffect(() => {
    let subscription: EmitterSubscription | undefined;
    const logEmitter = new NativeEventEmitter(BBMTLibNativeModule);
    const processHook = (message: string) => {
      const backend = resolveMpcHookBackend({
        isSpendFlow: isSendBitcoin || isSignPSBT,
        spendBackend,
        keygenBackend,
        mpcActive: doingMpcRef.current,
      });
      if (!backend) {
        return;
      }
      const result = processMpcHookMessage(message, backend, {
        isTrio,
        isSendBitcoin,
        refs: {
          progressRef: mpcHookProgressRef,
          utxoRef: mpcUtxoRef,
          activeSessionRef: activeMpcSessionIdRef,
        },
        onTrace: __DEV__
          ? ({backend: b, msg, mappedPercent}) => {
              dbg('MpcHook trace', {
                backend: b,
                type: msg.type,
                step: msg.step,
                done: msg.done,
                info: msg.info,
                mappedPercent,
              });
            }
          : undefined,
      });
      if (!result) {
        return;
      }
      if (result.utxoState) {
        dbg('progress send_btc', result.utxoState);
      }
      if (result.percent !== null) {
        dbg('progress hook', result.percent, result.statusLabel);
        setCircleTarget(result.percent);
      }
      if (result.statusLabel) {
        setStatus(result.statusLabel);
      }
      if (result.mpcDone) {
        setMpcDone(true);
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
  }, [isTrio, isSendBitcoin, isSignPSBT, keygenBackend, spendBackend, setCircleTarget]);
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
    if (!isPairing) {
      return;
    }
    const updateCountdown = () => {
      const leftMs = pairingDeadlineRef.current - Date.now();
      setCountdown(Math.max(0, Math.ceil(leftMs / 1000)));
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 250);
    return () => clearInterval(interval);
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
    pairingDeadlineRef.current = Date.now() + timeout * 1000;
    setCountdown(timeout);
    setPeerIP(null);
    setPeerIP2(null);
    setPeerDevice(null);
    setPeerDevice2(null);
    setRemoteID(null);
    setRemoteID2(null);
    setPeerParty(null);
    setPeerParty2(null);
    setPeerCommitteeKey(null);
    setPeerCommitteeKey2(null);
    setPeerPubkey('');
    setPeerPubkey2('');
    setMasterHost(null);
    appConfigRepository.remove('lan_peer_pubkey');
    appConfigRepository.remove('lan_ecies_keypair');
    appConfigRepository.remove('peerFound');
    setStatus('Preparing LAN pairing...');
    try {
      // Android: keep gomobile for LAN pairing only; load libbbmtmobile at wallet setup (mpcTssSetup).
      setStatus('Generating device keys...');
      const jkp = await BBMTLibNativeModule.eciesKeypair();
      const kp = parseEciesKeypairJson(jkp);
      setKeypair(jkp);
      setStatus('Syncing local IP...');
      const meta = await getKeyshareMetadata();
      const localShare = meta?.local_party_key || '';
      const pinnedIPs = getPinnedRemoteIPs();
      dbg('checking lanIP given pinnedRemotes', pinnedIPs);
      const ip = await BBMTLibNativeModule.getLanIp(pinnedIPs[0] || '');
      dbg('device local lanIP', ip);
      const deviceName = await DeviceInfo.getDeviceName();
      setLocalDevice(deviceName);
      setStatus(
        ip
          ? 'Starting peer discovery...'
          : 'No LAN IP found — listening for peer only...',
      );
      const until = Date.now() + timeout * 1000;
      pairingDeadlineRef.current = until;
      setCountdown(timeout);
      appConfigRepository.set('peerFound', '');
      const promises = [
        listenForPeerPromise(
          kp,
          stringToHex(`${deviceName}@${localShare}`),
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
            stringToHex(`${deviceName}@${localShare}`),
            kp.publicKey,
            ip,
          ),
        );
      }
      let result: string | null = (await raceLanPeerDiscovery(promises)) ?? null;
      while (!isLanPeerDiscoveryPayload(result) && Date.now() < until) {
        dbg('checking peer...');
        const cached = appConfigRepository.get('peerFound');
        if (cached) {
          result = cached;
          dbg('checking peer ok...');
          if (isLanPeerDiscoveryPayload(result)) {
            break;
          }
        }
        await waitMS(1000);
      }
      dbg('promise race result:', result);
      if (isLanPeerDiscoveryPayload(result)) {
        dbg('Got Result', result);
        let raws = (result || '').split('|').filter(Boolean);
        // In trio, ensure both peers are present; sometimes one arrives first on iOS
        if (isTrio && raws.length < 2) {
          const extraWaitUntil = Date.now() + 3000; // wait up to 3s more
          while (Date.now() < extraWaitUntil && raws.length < 2) {
            await waitMS(300);
            const updated = appConfigRepository.get('peerFound');
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
        setPeerCommitteeKey(_peerParty || null);
        setPeerParty(_peerParty || null);
        if (localShare && _peerParty && localShare === _peerParty) {
          throw 'Please Use Two Different KeyShares per Device';
        }
        const _peerPubkey = peerInfo1[2] || '';
        setPeerPubkey(_peerPubkey);
        if (_peerPubkey) {
          appConfigRepository.set('lan_peer_pubkey', _peerPubkey);
        }
        if (keypair) {
          appConfigRepository.set('lan_ecies_keypair', keypair);
        }
        const localInfo = (primary[1] || '').split('@');
        const _localIPFromPacket = (localInfo[0] || '').split(':')[0].trim();
        const localNorm = coalesceLanHost(_localIPFromPacket, ip);
        const peerNorm = coalesceLanHost(_peerIP);
        if (!localNorm || !peerNorm) {
          throw new Error(
            isTrio
              ? 'Trio LAN setup needs three valid device IPs. Re-run pairing on the same Wi‑Fi.'
              : 'Duo LAN setup needs two valid device IPs. Re-run pairing on the same Wi‑Fi.',
          );
        }
        setLocalIP(localNorm);
        const localIDComputed = (
          await BBMTLibNativeModule.sha256(`${deviceName}${localNorm}`)
        )
          .substring(0, 4)
          .toUpperCase();
        setLocalID(localIDComputed);
        let device2Local: string | null = null;
        let remoteID2Computed: string | null = null;
        let peerPubkey2Stored = '';
        if (isTrio && raws.length > 1) {
          const rawSecondary = raws[1] || '';
          const secondary = rawSecondary.split(',');
          const peerInfo2 = (secondary[0] || '').split('@');
          const _peerIP2 = (peerInfo2[0] || '').split(':')[0];
          setPeerIP2(_peerIP2 || null);
          const _peerDevicePartyID2 = hexToString(peerInfo2[1] || '').split(
            '@',
          );
          peerPubkey2Stored = peerInfo2[2] || '';
          device2Local = _peerDevicePartyID2[0] || '';
          const peerParty2Raw = _peerDevicePartyID2[1] || '';
          setPeerPubkey2(peerPubkey2Stored);
          remoteID2Computed = (
            await BBMTLibNativeModule.sha256(`${device2Local}${_peerIP2}`)
          )
            .substring(0, 4)
            .toUpperCase();
          setRemoteID2(remoteID2Computed);
          setPeerDevice2(device2Local || null);
          setPeerCommitteeKey2(peerParty2Raw || null);
          setPeerParty2(peerParty2Raw || null);
        } else {
          setPeerIP2(null);
          setRemoteID2(null);
          setPeerDevice2(null);
          setPeerCommitteeKey2(null);
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
        let peer2Norm = '';
        if (isTrio) {
          peer2Norm = coalesceLanHost(_peerIP2ForRank, peerIP2) || '';
          if (!peer2Norm) {
            throw new Error(
              'Trio LAN setup needs three valid device IPs. Re-run pairing on the same Wi‑Fi.',
            );
          }
        }
        dbg('==================== ALL IPs (normalized) ====================', {
          localNorm,
          peerNorm,
          peer2Norm,
          localIPFromPacket: _localIPFromPacket,
          getLanIp: ip,
        });
        let master = isMaster;
        let resolvedMasterHost: string | null = null;
        let resolvedLocalParty = '';
        let resolvedPeerParty = '';
        let resolvedPeerParty2 = '';
        if (isTrio) {
          const trio = resolveTrioLanRoles({
            localIP: localNorm,
            peerIP: peerNorm,
            peerIP2: peer2Norm,
          });
          setLocalParty(trio.localParty);
          setPeerParty(trio.peerParty);
          setPeerParty2(trio.peerParty2);
          master = trio.isMaster;
          resolvedMasterHost = trio.masterHost;
          resolvedLocalParty = trio.localParty;
          resolvedPeerParty = trio.peerParty;
          resolvedPeerParty2 = trio.peerParty2;
        } else {
          const duo = resolveDuoLanRoles(localNorm, peerNorm);
          setLocalParty(duo.localParty);
          setPeerParty(duo.peerParty);
          master = duo.isMaster;
          resolvedMasterHost = duo.masterHost;
          resolvedLocalParty = duo.localParty;
          resolvedPeerParty = duo.peerParty;
        }
        setMasterHost(resolvedMasterHost);
        if (keygenSetupMode) {
          persistLanRolesFromContext(
            keygenSetupMode,
            resolveEffectiveLanKeygenContext({
              setupMode: keygenSetupMode,
              state: {
                isMaster: master,
                masterHost: resolvedMasterHost,
                localParty: resolvedLocalParty,
                peerParty: resolvedPeerParty,
                peerParty2: resolvedPeerParty2,
              },
            }),
          );
        }
        if (isTrio) {
          const trioRoles = resolveTrioLanRoles({
            localIP: localNorm,
            peerIP: peerNorm,
            peerIP2: peer2Norm,
          });
          let masterPub = '';
          if (trioRoles.isMaster) {
            try {
              const parsedKeypair = JSON.parse(keypair);
              masterPub = (parsedKeypair?.publicKey || '').trim();
            } catch {
              masterPub = '';
            }
          } else if (trioRoles.ipByRole.KeyShare1 === peerNorm) {
            masterPub = (_peerPubkey || '').trim();
          } else if (trioRoles.ipByRole.KeyShare1 === peer2Norm) {
            masterPub = peerPubkey2Stored.trim();
          } else if (trioRoles.ipByRole.KeyShare1 === localNorm) {
            try {
              const parsedKeypair = JSON.parse(keypair);
              masterPub = (parsedKeypair?.publicKey || '').trim();
            } catch {
              masterPub = '';
            }
          }
          if (masterPub) {
            appConfigRepository.set('lan_master_pubkey', masterPub);
          }
        }
        dbg('Master Selection', {master, masterHost: resolvedMasterHost});
        setIsMaster(master);
        const trioWallet =
          isTrio ||
          isTrioWalletKeyshare(await getKeyshareMetadata().catch(() => null));
        persistLanPairingRoles({
          localParty: resolvedLocalParty || localParty,
          peerParty: resolvedPeerParty || peerParty || '',
          peerParty2: resolvedPeerParty2 || peerParty2 || '',
          masterHost: resolvedMasterHost,
          isMaster: master,
          isTrio: trioWallet,
        });
        setStatus('Devices Discovery Completed');
        dbg('Pairing Summary', {
          isTrio: trioWallet,
          isMaster: master,
          roles: {localParty, peerParty, peerParty2},
          devices: {
            local: {device: deviceName, ip: localNorm, id: localIDComputed},
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
        Promise.allSettled(promises).then(() => {
          appConfigRepository.remove('peerFound');
        });
      } else {
        setPeerIP(null);
        setPeerIP2(null);
        setPeerDevice(null);
        setPeerDevice2(null);
        setRemoteID(null);
        setRemoteID2(null);
        setPeerParty(null);
        setPeerParty2(null);
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
    throw isSendBitcoin || isSignPSBT
      ? 'Waited too long for the other device to start co-signing.'
      : 'Partner did not tap Join Setup in time. Both phones must tap Start/Join Setup within about 20 seconds.';
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
      if (shouldWritePeerFoundCache(result)) {
        appConfigRepository.set('peerFound', result);
      }
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
        const cached = appConfigRepository.get('peerFound');
        if (cached) {
          dbg('discoverPeer already found');
          return cached;
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
          if (shouldWritePeerFoundCache(result)) {
            appConfigRepository.set('peerFound', result);
          }
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
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBack,
    );
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
      marginTop: 6,
      lineHeight: 18,
    },
    deviceContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      marginBottom: 20,
      marginTop: 20,
      paddingHorizontal: 8,
    },
    deviceWrapper: {
      marginHorizontal: 10,
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
      borderRadius: 12,
      padding: 10,
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
    keygenBackendBadgeWrap: {
      alignSelf: 'center',
      marginBottom: 8,
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
      paddingTop: 4,
      paddingHorizontal: 6,
      marginBottom: 16,
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
  const showSpendStickyFooter =
    (isSendBitcoin || isSignPSBT) && !!peerIP && !doingMPC;
  const spendStickySummary =
    isSendBitcoin && route.params
      ? sendCollapsedRecapLine(
          route.params.satoshiAmount ?? 0,
          route.params.toAddress || '',
          shortenAddress,
        )
      : isSignPSBT && psbtDetails
        ? psbtCollapsedSummaryLine(psbtDetails)
        : '';
  const spendStickyLabel = isSignPSBT
    ? `${isMaster ? 'Start' : 'Join'} PSBT Signing`
    : `${isMaster ? 'Start' : 'Join'} Co-Signing`;
  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={[styles.flexContainer, {flex: 1}]}
        behavior={'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            showSpendStickyFooter && {
              paddingBottom: PAIRING_STICKY_FOOTER_SCROLL_PADDING,
            },
          ]}
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
                    {keygenBackend ? (
                      <View style={styles.keygenBackendBadgeWrap}>
                        <TssBackendBadge backend={keygenBackend} />
                      </View>
                    ) : null}
                    <AppPressable
                      onPress={() => {
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
                    ⚠️ All devices' security code 🏷 should match.
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
                          {prepareCopy.successLine}
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
                            isPrepared &&
                              styles.enhancedCheckboxContainerChecked,
                          ]}
                          disabled={isPreparing}
                          onPress={() => {
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
                            onRequestClose={
                              () => {} /* non-dismissible: block Android back */
                            }>
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
                                  {prepareCopy.title}
                                </Text>
                                <Text style={styles.modalSubtitle}>
                                  {prepareCopy.subtitle}
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
                                      {prepareCopy.statusLine}
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
                            Tap {isMaster ? 'Start' : 'Join'} Setup on this
                            phone and {isMaster ? 'Join' : 'Start'} Setup on the
                            other within ~20s. Stay in the app.
                          </Text>
                        </View>
                        <Text style={styles.warningIcon}>⚠️</Text>
                      </AppPressable>
                      {doingMPC && (
                        <Modal
                          transparent={true}
                          visible={doingMPC}
                          animationType="fade"
                          onRequestClose={
                            () => {} /* non-dismissible: block Android back */
                          }>
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
                                {keygenModalCopy.title}
                              </Text>
                              {/* Subtext */}
                              <Text style={styles.modalSubtitle}>
                                {keygenModalCopy.subtitle}
                              </Text>
                              {/* Progress Container */}
                              <View style={styles.progressContainer}>
                                {/* Circular Progress */}
                                <Progress.Circle
                                  size={80}
                                  progress={displayPercent / 100}
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
                                    {displayPercent}%
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
                  <Text
                    style={[
                      {fontSize: theme.fontSizes?.base || 13, marginBottom: 8},
                    ]}>
                    {isTrio
                      ? 'All devices must be ready.'
                      : 'Both devices must be ready.'}
                  </Text>
                  {isSendBitcoin && route.params ? (
                    <TransactionFlowDiagram
                      variant="send"
                      collapsedSummary="full"
                      expanded={txDetailsExpanded}
                      onToggleExpand={() =>
                        setTxDetailsExpanded(prev => !prev)
                      }
                      sendParams={{
                        satoshiAmount: route.params.satoshiAmount ?? 0,
                        satoshiFees: route.params.satoshiFees ?? 0,
                        toAddress: route.params.toAddress || '',
                        network: route.params.network,
                        selectedCurrency: route.params.selectedCurrency,
                        fiatAmount: route.params.fiatAmount,
                        fiatFees: route.params.fiatFees,
                      }}
                      txPreview={txPreview}
                      loading={txPreviewLoading}
                      error={txPreviewError}
                      formatFiat={formatFiat}
                    />
                  ) : null}
                  {isSignPSBT && route.params?.psbtBase64 ? (
                    <TransactionFlowDiagram
                      variant="psbt"
                      collapsedSummary="full"
                      expanded={txDetailsExpanded}
                      onToggleExpand={() =>
                        setTxDetailsExpanded(prev => !prev)
                      }
                      psbtDetails={psbtDetails}
                      psbtBase64={route.params.psbtBase64}
                      parseError={psbtParseError}
                      onRetryParse={() => {
                        setPsbtParseError(null);
                        setPsbtDetails(null);
                        setPsbtRetryToken(t => t + 1);
                      }}
                    />
                  ) : null}
                </View>
              </>
            )}
          </View>
        </ScrollView>
        {showSpendStickyFooter && spendStickySummary ? (
          <PairingSpendStickyFooter
            summaryLine={spendStickySummary}
            network={route.params?.network}
            buttonLabel={spendStickyLabel}
            onPress={() => runKeysign()}
          />
        ) : null}
      </KeyboardAvoidingView>
      {doingMPC && (isSendBitcoin || isSignPSBT) && (
        <Modal
          transparent={true}
          visible={doingMPC}
          animationType="fade"
          onRequestClose={
            () => {} /* non-dismissible: block Android back */
          }>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalIconContainer}>
                <View style={styles.modalIconBackground}>
                  <Image
                    source={require('../assets/key-icon.png')}
                    style={styles.finalizingModalIcon}
                    resizeMode="contain"
                  />
                </View>
              </View>
              <Text style={styles.modalTitle}>
                {isSignPSBT
                  ? 'PSBT Co-Signing'
                  : 'Co-Signing Your Transaction'}
              </Text>
              <Text style={styles.modalSubtitle}>
                Securing your transaction with multi-party cryptography.
                Please stay in the app...
              </Text>
              <View style={styles.progressContainer}>
                <Progress.Circle
                  size={80}
                  progress={displayPercent / 100}
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
                <View style={styles.progressTextWrapper}>
                  <Text style={styles.progressPercentage}>
                    {displayPercent}%
                  </Text>
                </View>
              </View>
              <View style={styles.statusContainer}>
                <View style={styles.statusRow}>
                  <View style={styles.statusIndicator} />
                  <Text style={styles.finalizingStatusText}>{status}</Text>
                </View>
                <Text style={styles.finalizingCountdownText}>
                  Time elapsed: {prepCounter} seconds
                </Text>
              </View>
              {(isSendBitcoin || isSignPSBT) && (
                <View style={styles.modalActions}>
                  <AppPressable
                    style={[
                      styles.modalButton,
                      {backgroundColor: theme.colors.secondary},
                    ]}
                    onPress={abortActiveMpc}>
                    <Text style={styles.buttonText}>Abort</Text>
                  </AppPressable>
                </View>
              )}
            </View>
          </View>
        </Modal>
      )}
      {/* Backup Modal */}
      <BackupKeyshareModal
        visible={isBackupModalVisible}
        onClose={() => setIsBackupModalVisible(false)}
      />
      {/* Signed tx: copy / share / broadcast — on Broadcast success we run post-broadcast logic */}
      <SignedTxBroadcastModal
        visible={!!signedTxRawHex}
        rawTxHex={signedTxRawHex ?? ''}
        onBroadcastSuccess={async (txId: string) => {
          const p = broadcastSuccessPayloadRef.current;
          broadcastSuccessPayloadRef.current = null;
          setSignedTxRawHex(null);
          if (!p) {
            return;
          }
          try {
            const apiTxShape = {
              txid: txId,
              status: {confirmed: false, block_height: null, block_time: null, block_hash: null},
              fee: Number(p.satoshiFees),
              vin: (p.inputs ?? []).map(inp => ({
                prevout: {
                  scriptpubkey_address: inp.scriptpubkey_address,
                  value: inp.value,
                },
              })),
              vout: (p.outputs ?? []).map(o => ({
                scriptpubkey_address: o.scriptpubkey_address,
                value: o.value,
              })),
            };
            transactionRepository.insertBroadcastTransaction(
              txId,
              p.net || 'mainnet',
              apiTxShape,
              p.senderAddress,
            );
            navigation.dispatch(
              CommonActions.reset(
                getResetToMainTabsWallet(
                  {txId},
                  {
                    showPlay: p.showPlay,
                    showUtxos: p.showUtxosTab,
                    showAddresses: p.showAddressesTab,
                    showPsbt: p.showPsbtTab,
                    showWallet: p.showWalletTab,
                  },
                ),
              ),
            );
            setMpcDone(true);
            const postBroadcastCleanup = async () => {
              if (p.multiPath) {
                try {
                  await WalletService.getInstance().incrementChangeIndexAfterSend(
                    p.net,
                    p.addressTypeToUse,
                  );
                } catch (e) {
                  dbg('MobilesPairing: incrementChangeIndexAfterSend failed:', e);
                }
              }
              try {
                await WalletService.getInstance().refreshSpendStateAfterBroadcast(
                  p.net,
                  p.addressTypeToUse,
                );
              } catch (e) {
                dbg('MobilesPairing: refreshSpendStateAfterBroadcast failed:', e);
              }
              if (p.originalNetwork && p.originalApiUrl) {
                try {
                  await BBMTLibNativeModule.setBtcNetwork(p.originalNetwork);
                  await BBMTLibNativeModule.setAPI(
                    p.originalNetwork,
                    p.originalApiUrl,
                  );
                  appConfigRepository.set('api', p.originalApiUrl);
                  const ws = WalletService.getInstance();
                  (ws as any).currentNetwork = p.originalNetwork;
                  (ws as any).currentApiUrl = p.originalApiUrl;
                } catch (e) {
                  dbg(
                    'MobilesPairing: Error restoring network after broadcast:',
                    e,
                  );
                }
              }
              if (p.isMaster) {
                await waitMS(2000);
                stopRelay();
              }
            };
            postBroadcastCleanup().catch(e => {
              dbg('MobilesPairing: post-broadcast cleanup failed:', e);
            });
          } catch (e) {
            dbg('MobilesPairing: post-broadcast cleanup failed:', e);
          }
        }}
        onClose={() => {
          broadcastSuccessPayloadRef.current = null;
          setSignedTxRawHex(null);
          navigation.goBack();
        }}
      />
    </SafeAreaView>
  );
};
export default MobilesPairing;
