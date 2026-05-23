/* eslint-disable react-native/no-inline-styles */
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Image,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  NativeEventEmitter,
  EmitterSubscription,
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
} from 'react-native-reanimated';
import Share from 'react-native-share';
import {NativeModules} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import StaticQRCode from '../components/StaticQRCode';
import Clipboard from '@react-native-clipboard/clipboard';
import QRScanner from '../components/QRScanner';
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
import * as Progress from 'react-native-progress';
import {CommonActions, RouteProp, useRoute} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  dbg,
  getKeyshareMetadata,
  HapticFeedback,
  getNostrRelays,
  getResetToMainTabsWallet,
  resolveUseLegacyDerivationPaths,
  detectKeyshareTssBackend,
  shortenAddress,
} from '../utils';
import {resolveStoredMempoolApiBase} from '../services/mempoolApiBase';
import {prepareSendBtcMultiPathInputs} from '../services/sendBtcPrepare';
import {resolveDklsNostrSigningParties} from '../services/lanMpcSetup';
import {
  resolveTssBackend,
  resolveTssBackendForKeygen,
  type SetupMode,
  type TssBackend,
} from '../services/tssBackend';
import {TssProvider} from '../services/TssProvider';
import {
  assertCanStartNostrMpc,
  nostrMpcCooldownMessageFromError,
} from '../services/mpcCancel';
import {getPrepareModalCopy} from '../services/tssKeygenPrepare';
import {LAN_KEYGEN_STATUS} from '../services/walletSetupUi';
import {
  invokeNostrWalletKeygen,
  KEYGEN_FINALIZING_STORAGE_STATUS,
  persistWalletKeyshare,
  resolveWalletSetupBackend,
  runWalletSetupPrepare,
  type WalletSetupRouteParams,
} from '../services/walletSetupOrchestrator';
import {
  resetMpcHookSession,
  type MpcProgressUtxoState,
} from '../services/mpcProgress';
import {
  mpcSessionShortLabel,
  processMpcHookMessage,
  resolveMpcHookBackend,
  staleTransportHintForKeygen,
  trackMpcHookForTransportLiveness,
} from '../services/mpcProgressUi';
import {MpcModalStatusRow} from '../components/MpcModalStatusRow';
import {MpcProgressModalHeader} from '../components/MpcProgressModalHeader';
import {useMpcCircleProgress} from '../services/useMpcCircleProgress';
import TssBackendBadge from '../components/TssBackendBadge';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import database from '../services/Database';
import transactionRepository from '../services/repositories/TransactionRepository';
import {WalletService} from '../services/WalletService';
import RNFS from 'react-native-fs';
const {BBMTLibNativeModule} = NativeModules;

/** Normalize keygen_committee_keys from native/bridge (array, JSON string, or numeric-key object). */
function normalizeKeygenCommitteeKeys(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter(
      (k): k is string => typeof k === 'string' && k.length > 0,
    );
  }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p)
        ? p.filter((k): k is string => typeof k === 'string' && k.length > 0)
        : [];
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
  }
  return [];
}

async function getKeyshareNostrPrepJSONWithRetry(
  attempts = 3,
  delayMs = 150,
): Promise<string> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await BBMTLibNativeModule.getKeyshareNostrPrepJSON();
    } catch (e) {
      last = e;
      if (i < attempts - 1) {
        await new Promise<void>(r => setTimeout(r, delayMs));
      }
    }
  }
  throw last;
}

/** Fields for Nostr co-signer UI + send/sign session prep (npub CSV, derive, etc.). */
type NostrKeysharePrep = {
  pub_key: string;
  chain_code_hex: string;
  keygen_committee_keys: string[];
  local_party_key: string;
  nostr_npub?: string;
};

/** Safe debug: lengths + presence only (no full pub/hex in logs). */
function dbgNostrKeysharePrep(
  stage: string,
  info: Record<string, string | number | boolean | undefined>,
) {
  dbg(`[NostrKeysharePrep] ${stage}`, info);
}

function alertMessageForNostrSendError(err: unknown): string {
  const code =
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as {code?: unknown}).code === 'string'
      ? (err as {code: string}).code
      : '';
  if (code === 'NO_NSEC') {
    return 'Nostr signing needs an nsec in your stored keyshare. If this wallet was imported without Nostr material, use LAN pairing or restore a full keyshare from backup.';
  }
  if (code === 'NO_KEYSHARE') {
    return 'No keyshare found in secure storage. Unlock the wallet or restore your keyshare.';
  }
  if (code === 'MODULE_GONE') {
    return 'Native module unavailable. Try again or restart the app.';
  }
  const msg =
    err &&
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as {message?: unknown}).message === 'string'
      ? (err as {message: string}).message
      : '';
  const cooldown = nostrMpcCooldownMessageFromError(err);
  if (cooldown) {
    return cooldown;
  }
  return msg || 'Transaction signing failed';
}

/**
 * Prefer native `getKeyshareNostrPrepJSON` (reads full keyshare from RNES).
 * If that fails (NO_KEYSHARE / timing) or returns incomplete fields, merge from
 * `keyshare_meta` (EncryptedStorage) so flows keep working after metadata-focused storage.
 */
async function loadNostrKeysharePrepForSession(): Promise<NostrKeysharePrep> {
  let committee: string[] = [];
  let localParty = '';
  let nostrNpub = '';
  let pubKey = '';
  let chainHex = '';
  let nativePrepSucceeded = false;

  try {
    const prepJson = await getKeyshareNostrPrepJSONWithRetry();
    const k = JSON.parse(prepJson) as Record<string, unknown>;
    committee = normalizeKeygenCommitteeKeys(k.keygen_committee_keys);
    localParty =
      typeof k.local_party_key === 'string' ? k.local_party_key : '';
    nostrNpub = typeof k.nostr_npub === 'string' ? k.nostr_npub : '';
    pubKey = typeof k.pub_key === 'string' ? k.pub_key : '';
    chainHex = typeof k.chain_code_hex === 'string' ? k.chain_code_hex : '';
    nativePrepSucceeded = true;
    dbgNostrKeysharePrep('native_prep_ok', {
      prepJsonLen: prepJson?.length ?? 0,
      committeeLen: committee.length,
      hasLocalParty: localParty ? 1 : 0,
      hasPubKey: pubKey ? 1 : 0,
      hasChainHex: chainHex ? 1 : 0,
      hasNostrNpub: nostrNpub ? 1 : 0,
    });
  } catch (e: any) {
    const code = e?.code != null ? String(e.code) : '';
    const msg =
      typeof e?.message === 'string' ? e.message.slice(0, 160) : String(e);
    dbg(
      'loadNostrKeysharePrepForSession: native prep failed — will merge keyshare_meta',
      {code, message: msg},
    );
  }

  const meta = await getKeyshareMetadata();
  dbgNostrKeysharePrep('after_getKeyshareMetadata', {
    metaIsNull: meta ? 0 : 1,
    metaCommitteeLen: meta?.keygen_committee_keys?.length ?? 0,
    metaHasLocal: meta?.local_party_key ? 1 : 0,
    metaHasPub: meta?.pub_key ? 1 : 0,
    metaHasChain: meta?.chain_code_hex ? 1 : 0,
    metaHasNostrNpub: meta?.nostr_npub ? 1 : 0,
  });

  const beforeMerge = {
    committeeLen: committee.length,
    hasLocalParty: localParty ? 1 : 0,
    hasPub: pubKey ? 1 : 0,
    hasChain: chainHex ? 1 : 0,
  };

  if (committee.length < 2 && meta?.keygen_committee_keys) {
    committee = normalizeKeygenCommitteeKeys(meta.keygen_committee_keys);
  }
  if (!localParty && meta?.local_party_key) {
    localParty = meta.local_party_key;
  }
  if (!nostrNpub && meta?.nostr_npub) {
    nostrNpub = String(meta.nostr_npub);
  }
  if (!pubKey && meta?.pub_key) {
    pubKey = meta.pub_key;
  }
  if (!chainHex && meta?.chain_code_hex) {
    chainHex = meta.chain_code_hex;
  }

  dbgNostrKeysharePrep('after_meta_merge', {
    nativePrepSucceeded: nativePrepSucceeded ? 1 : 0,
    beforeCommitteeLen: beforeMerge.committeeLen,
    mergedCommitteeLen: committee.length,
    hasLocalParty: localParty ? 1 : 0,
    hasPub: pubKey ? 1 : 0,
    hasChain: chainHex ? 1 : 0,
    hasNostrNpub: nostrNpub ? 1 : 0,
  });

  if (!localParty || committee.length < 2) {
    dbgNostrKeysharePrep('throw_MISSING_COMMITTEE_OR_LOCAL', {
      committeeLen: committee.length,
      hasLocalParty: localParty ? 1 : 0,
      nativePrepSucceeded: nativePrepSucceeded ? 1 : 0,
    });
    throw new Error('MISSING_COMMITTEE_OR_LOCAL');
  }
  if (!pubKey || !chainHex) {
    dbgNostrKeysharePrep('throw_MISSING_PUB_OR_CHAIN', {
      hasPub: pubKey ? 1 : 0,
      hasChain: chainHex ? 1 : 0,
      nativePrepSucceeded: nativePrepSucceeded ? 1 : 0,
    });
    throw new Error('MISSING_PUB_OR_CHAIN');
  }

  dbgNostrKeysharePrep('success', {
    committeeLen: committee.length,
    hasNostrNpub: nostrNpub ? 1 : 0,
  });

  return {
    pub_key: pubKey,
    chain_code_hex: chainHex,
    keygen_committee_keys: committee,
    local_party_key: localParty,
    nostr_npub: nostrNpub || undefined,
  };
}

// Helper component for animated progress bar
const ProgressAnimatedView: React.FC<{
  style: any;
  progressAnimation: ReturnType<typeof useSharedValue<number>>;
  backgroundColor: string;
}> = ({style, progressAnimation, backgroundColor}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const width = interpolate(progressAnimation.value, [0, 1], [0, 100]);
    return {
      width: `${width}%`,
    };
  });
  return <Animated.View style={[style, {backgroundColor}, animatedStyle]} />;
};

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
const MobileNostrPairing = ({navigation}: any) => {
  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const isSendBitcoin = route.params?.mode === 'send_btc';
  const isSignPSBT = route.params?.mode === 'sign_psbt';
  const setupMode = route.params?.mode;
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
  const prepareCopy = getPrepareModalCopy(keygenBackend ?? 'dkls23');
  /** Trio = 3-device Nostr keygen setup only. Spend/sign always co-sign with 2 online parties. */
  const [isTrio] = useState<boolean>(setupMode === 'trio');
  /** 2-of-3 wallet: pick which peer to sign with; still a duo signing session. */
  const [threeKeyshareWallet, setThreeKeyshareWallet] = useState(false);
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
  const ppmFile = `${RNFS.DocumentDirectoryPath}/ppm.json`;

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
  const [_progress, setProgress] = useState(0);
  const mpcHookProgressRef = useRef(0);
  const mpcUtxoRef = useRef<MpcProgressUtxoState>({
    utxoIndex: 0,
    utxoCount: 0,
    utxoRange: 0,
  });
  const activeMpcSessionIdRef = useRef<string | null>(null);
  const isPairingRef = useRef(false);
  const keysharePersistedRef = useRef(false);
  const lastMpcPercentBumpAtRef = useRef(Date.now());
  const lastMpcKeygenStepRef = useRef(0);
  const [mpcTransportPulse, setMpcTransportPulse] = useState(false);
  const [staleTransportHint, setStaleTransportHint] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState('');
  const [mpcSessionShort, setMpcSessionShort] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  /** Sync ref before native MPC starts so TssHook events are not dropped (useEffect lags one frame). */
  const setPairingActive = useCallback((active: boolean) => {
    isPairingRef.current = active;
    setIsPairing(active);
  }, []);
  const {displayPercent, setCircleTarget, resetCircle} =
    useMpcCircleProgress(isPairing);
  const [isKeygenReady, setIsKeygenReady] = useState(false); // Manual toggle for "other devices ready"
  const [canStartKeygen, setCanStartKeygen] = useState(false); // Auto-calculated: all conditions met
  const [mpcDone, setMpcDone] = useState(false);
  const [spendSignOutcome, setSpendSignOutcome] = useState<
    null | 'aborted' | 'failed'
  >(null);
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
  const [isPreParamsReady, setIsPreParamsReady] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isPrepared, setIsPrepared] = useState(false);
  const [prepCounter, setPrepCounter] = useState(0);
  const progressAnimation = useSharedValue(0);
  // Backup state
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
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
  const [sendModeDevicesLoadDone, setSendModeDevicesLoadDone] = useState(false);
  const [sendModeDevicesLoadError, setSendModeDevicesLoadError] = useState<
    string | null
  >(null);
  // QR Scanner / QR Share
  const [isQRScannerVisible, setIsQRScannerVisible] = useState(false);
  const [scanningForPeer, setScanningForPeer] = useState<1 | 2>(1);
  const scanningForPeerRef = useRef<1 | 2>(1);
  const [isQRModalVisible, setIsQRModalVisible] = useState(false);
  const [showRelayConfig, setShowRelayConfig] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  const [txDetailsExpanded, setTxDetailsExpanded] = useState(false);
  const {
    preview: txPreview,
    loading: txPreviewLoading,
    error: txPreviewError,
  } = useSendTxPreview(isSendBitcoin, route.params);
  const [signedTxRawHex, setSignedTxRawHex] = useState<string | null>(null);
  const broadcastSuccessPayloadRef = useRef<{
    senderAddress: string;
    toAddress: string;
    satoshiAmount: number;
    satoshiFees: number;
    net: string;
    addressTypeToUse: string;
    showPlay: boolean;
    showUtxosTab: boolean;
    showAddressesTab: boolean;
    showPsbtTab: boolean;
    showWalletTab: boolean;
    originalNetwork?: string;
    originalApiUrl?: string;
    originalWalletServiceNetwork?: string;
    originalWalletServiceApiUrl?: string;
    inputs?: Array<{
      txid: string;
      vout: number;
      value: number;
      scriptpubkey_address: string;
    }>;
    outputs?: Array<{scriptpubkey_address: string; value: number}>;
  } | null>(null);
  const skipRestoreInFinallyRef = useRef(false);
  const nostrAbortRef = useRef(false);

  const abortActiveNostrMpc = React.useCallback(() => {
    Alert.alert(
      'Abort signing?',
      'This will stop the current Nostr MPC signing flow. Wait 15 seconds before starting again.',
      [
        {text: 'Keep signing', style: 'cancel'},
        {
          text: 'Abort',
          style: 'destructive',
          onPress: async () => {
            nostrAbortRef.current = true;
            setPairingActive(false);
            setStatus('Aborted');
            if (isSignPSBT) {
              setSpendSignOutcome('aborted');
            }
            try {
              const cancelResult = await TssProvider.cancelNostrMpc();
              dbg('MobileNostrPairing: cancelNostrMpc', cancelResult.outcome);
            } catch (e) {
              dbg('MobileNostrPairing: cancelNostrMpc failed', e);
            }
          },
        },
      ],
    );
  }, [setPairingActive, isSignPSBT]);

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
    // generateKeygenSessionParams is stable for this flow; full deps would re-trigger keygen setup on unrelated callback identity churn.
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
  }, [isSignPSBT, route.params?.psbtBase64, psbtRetryToken]);
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
    const processHook = (message: string) => {
      const backend = resolveMpcHookBackend({
        isSpendFlow: isSendBitcoin || isSignPSBT,
        spendBackend,
        keygenBackend,
        mpcActive: isPairingRef.current,
      });
      if (!backend) {
        return;
      }
      const progressBefore = mpcHookProgressRef.current;
      const result = processMpcHookMessage(message, backend, {
        isTrio,
        isSendBitcoin,
        isSignPSBT,
        isNostrTransport: true,
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
      const transportTrack = trackMpcHookForTransportLiveness(message, result, {
        progressBefore,
        lastBumpAtMsRef: lastMpcPercentBumpAtRef,
        lastKeygenStepRef: lastMpcKeygenStepRef,
      });
      if (transportTrack.clearStale) {
        setStaleTransportHint(null);
      }
      setMpcTransportPulse(transportTrack.pulse);
      if (result.utxoState) {
        dbg('progress send_btc', result.utxoState);
      }
      if (result.percent !== null) {
        dbg('progress hook', result.percent, result.statusLabel);
        setProgress(result.percent);
        setCircleTarget(result.percent);
      }
      if (result.statusLabel) {
        setStatus(result.statusLabel);
      }
      if (result.sessionShort) {
        setMpcSessionShort(result.sessionShort);
      }
      if (result.mpcDone && !isSendBitcoin && !isSignPSBT) {
        if (keysharePersistedRef.current) {
          setMpcDone(true);
        } else {
          setStatus(KEYGEN_FINALIZING_STORAGE_STATUS);
        }
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
  }, [isTrio, isSendBitcoin, isSignPSBT, keygenBackend, spendBackend, setCircleTarget]);
  // Load minimal keyshare prep fields from native (full MPC blob never in JS); signing uses WithStoredKeyshare
  useEffect(() => {
    if (!isSendBitcoin && !isSignPSBT) return;
    const loadKeyshareData = async () => {
      setSendModeDevicesLoadDone(false);
      setSendModeDevicesLoadError(null);
      try {
        const prep = await loadNostrKeysharePrepForSession();
        const committee = prep.keygen_committee_keys;
        const localParty = prep.local_party_key;
        const localNpubFromKeyshare = prep.nostr_npub || '';
        const numDevices = committee.length;
        setThreeKeyshareWallet(numDevices === 3);
        dbg(
          'Spend/sign mode - committee size',
          numDevices,
          numDevices === 3
            ? '(pick co-signer; 2-party session)'
            : '(duo wallet)',
        );
        // Set local npub if available (from native prep or keyshare_meta)
        if (localNpubFromKeyshare) {
          setLocalNpub(localNpubFromKeyshare);
        }
        // Sort keygen_committee_keys to match the order used for keyshare labels
        const sortedKeys = [...committee].sort();
        // Build device list IMMEDIATELY with available data
        const devices: Array<{
          keyshareLabel: string;
          npub: string;
          isLocal: boolean;
        }> = [];
        for (let i = 0; i < sortedKeys.length; i++) {
          const hexKey = sortedKeys[i];
          const isLocal = hexKey === localParty;
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
          const isLocal = hexKey === localParty;
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
        const code = error instanceof Error ? error.message : '';
        if (code === 'MISSING_COMMITTEE_OR_LOCAL') {
          setSendModeDevicesLoadError(
            'Could not load co-signer list. Ensure keyshare is complete, or open the app once so keyshare metadata syncs.',
          );
        } else if (code === 'MISSING_PUB_OR_CHAIN') {
          setSendModeDevicesLoadError(
            'Could not load wallet public data. Restore from backup or re-import your keyshare.',
          );
        } else {
          setSendModeDevicesLoadError(
            'Could not load keyshare for co-signer list. Check secure storage and try again.',
          );
        }
      } finally {
        setSendModeDevicesLoadDone(true);
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
        if (threeKeyshareWallet && otherDevices.length >= 2) {
          // 2-of-3 wallet: deterministically select the first peer (sorted by npub)
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
              'Auto-selected first peer (2-of-3 wallet, user can change):',
              firstPeer.npub.substring(0, 20) + '...',
            );
          }
        } else if (!threeKeyshareWallet && otherDevices.length >= 1) {
          // Duo wallet: auto-select the only other device
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
  }, [
    isSendBitcoin,
    isSignPSBT,
    threeKeyshareWallet,
    sendModeDevices,
    selectedPeerNpub,
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
    let backend = keygenBackend ?? routeKeygenBackend;
    if (!backend && keygenSetupMode) {
      backend = await resolveWalletSetupBackend(
        routeKeygenBackend,
        keygenSetupMode,
      );
      setKeygenBackend(backend);
    }
    activeMpcSessionIdRef.current = sessionID;
    setMpcSessionShort(mpcSessionShortLabel(sessionID));
    setPairingActive(true);
    keysharePersistedRef.current = false;
    setMpcDone(false);
    resetMpcHookSession(mpcHookProgressRef, mpcUtxoRef);
    resetCircle();
    setProgress(0);
    setStatus(LAN_KEYGEN_STATUS.runningKeygen);
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
      appConfigRepository.set('nostr_relays', relaysCSV);
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
      let keyshareJSON = await invokeNostrWalletKeygen({
        relaysCSV,
        partyNsec: localNsec,
        partiesNpubsCSV,
        sessionID,
        sessionKey,
        chaincode,
        ppmPath: ppmFile,
        setupMode: keygenSetupMode,
        backend,
      });
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
      // Save keyshare (embed nsec if native export omitted it)
      keyshareJSON = await persistWalletKeyshare(keyshareJSON, {
        partyNsec: localNsec,
        nostrNpub: localNpub,
      });
      keysharePersistedRef.current = true;
      try {
        const ksParsed = JSON.parse(keyshareJSON);
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
      } catch (_e) {
        dbg('Error parsing keyshare:', _e ?? 'unknown error');
        appConfigRepository.set(CONFIG_KEYS.LEGACY_WALLET_DO_NOT_REMIND, 'yes');
      }
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
      setPairingActive(false);
    }
  };
  const startSendBTC = async () => {
    if (!route.params) {
      Alert.alert('Error', 'Missing transaction parameters');
      return;
    }
    try {
      assertCanStartNostrMpc();
    } catch (e) {
      Alert.alert('Please wait', alertMessageForNostrSendError(e));
      return;
    }
    let backend = spendBackend;
    if (!backend) {
      backend = await resolveTssBackend();
      setSpendBackend(backend);
    }
    nostrAbortRef.current = false;
    TssProvider.resetMpcCancelState('nostr');
    TssProvider.markMpcInProgress('nostr');
    // Nostr send computes sessionID in native after pre-agreement; do not filter hooks by keygen session.
    activeMpcSessionIdRef.current = null;
    setMpcSessionShort(null);
    setPairingActive(true);
    resetMpcHookSession(mpcHookProgressRef, mpcUtxoRef);
    resetCircle();
    setProgress(0);
    setStatus('Starting transaction signing…');
    // Store original network/API to restore after transaction
    let originalNetwork = '';
    let originalApiUrl = '';
    // Store original WalletService state to restore after balance fetch
    let originalWalletServiceNetwork = '';
    let originalWalletServiceApiUrl = '';
    try {
      // Read ALL parameters from route params ONLY (no fallbacks)
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
      const net =
        networkFromParams === 'testnet' ? 'testnet3' : networkFromParams;
      const addressTypeToUse = route.params.addressType.trim();
      const path = route.params.derivationPath.trim();
      const toAddress = route.params.toAddress.trim();
      const satoshiAmount = route.params.satoshiAmount.trim();
      const satoshiFees = route.params.satoshiFees.trim();
      dbg('MobileNostrPairing: Using route params ONLY:', {
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
      // Use normalized network (native format) for API lookup and BBMTLib
      const apiUrl = resolveStoredMempoolApiBase(net);
      await BBMTLibNativeModule.setBtcNetwork(net);
      await BBMTLibNativeModule.setAPI(net, apiUrl);
      // CRITICAL: Update LocalCache 'api' key so WalletService.getWalletBalance uses correct API
      // This ensures balance fetch uses the network from route params, not device's current network
      appConfigRepository.set('api', apiUrl);
      // CRITICAL: Temporarily update WalletService internal state so getWalletBalance uses correct network
      // This is needed because getWalletBalance uses this.currentNetwork for address validation
      const walletService = WalletService.getInstance();
      originalWalletServiceNetwork =
        (walletService as any).currentNetwork || '';
      originalWalletServiceApiUrl = (walletService as any).currentApiUrl || '';
      (walletService as any).currentNetwork = net;
      (walletService as any).currentApiUrl = apiUrl;
      dbg('MobileNostrPairing: Set network and API in BBMTLib:', net, apiUrl);
      dbg(
        'MobileNostrPairing: Temporarily updated WalletService network state:',
        {
          from: originalWalletServiceNetwork,
          to: net,
          apiUrl,
        },
      );
      let keyshare: any;
      let rawTxHex: string | undefined;
      let broadcastInputs:
        | Array<{
            txid: string;
            vout: number;
            value: number;
            scriptpubkey_address: string;
          }>
        | undefined;
      let broadcastOutputs:
        | Array<{scriptpubkey_address: string; value: number}>
        | undefined;
      keyshare = await loadNostrKeysharePrepForSession();
      // Restore WalletService network state (temporarily adjusted above for API calls).
      (walletService as any).currentNetwork = originalWalletServiceNetwork;
      (walletService as any).currentApiUrl = originalWalletServiceApiUrl;
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
      // Build signing npubs (local + one peer). Nostr send is always a duo session.
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
      if (allNpubsFromKeyshare.length < 2) {
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
      if (threeKeyshareWallet) {
        // 2-of-3 wallet: use selected peer for this duo signing session
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
          throw new Error('Please select a peer device to co-sign with');
        }
      } else {
        // Duo wallet: the only other keyshare is the co-signer
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
      const peerNpubForSign = allNpubs.find(n => n !== localNpubFromKeyshare);
      if (!peerNpubForSign) {
        throw new Error('Co-signing peer npub is missing from this session.');
      }
      const {partiesNpubsCSV, peerNpub: resolvedPeerNpub} =
        resolveDklsNostrSigningParties(
          localNpubFromKeyshare,
          peerNpubForSign,
          keyshare,
        );
      const signingNpubsSorted = partiesNpubsCSV;
      const relaysCSV = relays.join(',');
      dbg('Nostr send BTC — signing npubs:', {
        partiesNpubsCSV: signingNpubsSorted,
        resolvedPeerNpub: resolvedPeerNpub.substring(0, 20) + '...',
      });
      const prepared = await prepareSendBtcMultiPathInputs({
        network: net,
        addressType: addressTypeToUse,
        utxosJsonFromRoute: route.params?.utxosJson,
        changeAddressFromRoute: route.params?.changeAddress,
        senderDerivationPath: path,
      });
      const changeAddress = prepared.changeAddress;
      const utxosWithPathsJSON = prepared.utxosWithPathsJSON;

      /** RN iOS bridge expects NSString for every arg; coerce so Hermes never passes undefined/number. */
      const nostrNativeStr = (v: unknown) =>
        v === null || v === undefined ? '' : String(v);
      const utxoList = JSON.parse(utxosWithPathsJSON) as Array<{
        txid: string;
        vout: number;
        value: number;
        address?: string;
      }>;
      broadcastInputs = utxoList.map((u: any) => ({
        txid: u.txid,
        vout: u.vout,
        value: u.value,
        scriptpubkey_address: u.address ?? '',
      }));
      const totalInput = utxoList.reduce(
        (s: number, u: any) => s + (u.value || 0),
        0,
      );
      const changeAmount =
        totalInput - Number(satoshiAmount) - Number(satoshiFees);
      broadcastOutputs = [
        {scriptpubkey_address: toAddress, value: Number(satoshiAmount)},
      ];
      if (changeAmount > 0) {
        broadcastOutputs.push({
          scriptpubkey_address: changeAddress,
          value: changeAmount,
        });
      }
      rawTxHex = await TssProvider.nostrMpcSendBTC(
        nostrNativeStr(relaysCSV),
        nostrNativeStr(partiesNpubsCSV),
        nostrNativeStr(signingNpubsSorted),
        nostrNativeStr('0'),
        nostrNativeStr(toAddress),
        nostrNativeStr(satoshiAmount),
        nostrNativeStr(satoshiFees),
        nostrNativeStr(utxosWithPathsJSON),
        nostrNativeStr(changeAddress),
      );
      dbg('MobileNostrPairing: Nostr send (UTXO multi-path) succeeded');
      if (
        !rawTxHex ||
        typeof rawTxHex !== 'string' ||
        rawTxHex.length % 2 !== 0 ||
        !/^[a-fA-F0-9]+$/.test(rawTxHex)
      ) {
        throw new Error(rawTxHex || 'Invalid signed transaction');
      }
      broadcastSuccessPayloadRef.current = {
        senderAddress,
        toAddress,
        satoshiAmount: Number(satoshiAmount),
        satoshiFees: Number(satoshiFees),
        net,
        addressTypeToUse,
        showPlay,
        showUtxosTab,
        showAddressesTab,
        showPsbtTab,
        showWalletTab,
        originalNetwork,
        originalApiUrl,
        originalWalletServiceNetwork,
        originalWalletServiceApiUrl,
        ...(broadcastInputs && broadcastOutputs
          ? {inputs: broadcastInputs, outputs: broadcastOutputs}
          : {}),
      };
      skipRestoreInFinallyRef.current = true;
      if (nostrAbortRef.current) {
        setPairingActive(false);
        return;
      }
      setSignedTxRawHex(rawTxHex);
    } catch (error: any) {
      dbg('Send BTC error:', error);
      if (!nostrAbortRef.current) {
        Alert.alert('Error', alertMessageForNostrSendError(error));
      }
      setStatus('Transaction signing failed');
    } finally {
      if (skipRestoreInFinallyRef.current) {
        skipRestoreInFinallyRef.current = false;
        setPairingActive(false);
        return;
      }
      // CRITICAL: Restore original network after transaction completes (success or failure)
      if (originalNetwork && originalApiUrl) {
        try {
          await BBMTLibNativeModule.setBtcNetwork(originalNetwork);
          await BBMTLibNativeModule.setAPI(originalNetwork, originalApiUrl);
          appConfigRepository.set('api', originalApiUrl);
          if (originalWalletServiceNetwork && originalWalletServiceApiUrl) {
            const walletService = WalletService.getInstance();
            (walletService as any).currentNetwork =
              originalWalletServiceNetwork;
            (walletService as any).currentApiUrl = originalWalletServiceApiUrl;
            dbg(
              'MobileNostrPairing: Restored WalletService network in finally block:',
              originalWalletServiceNetwork,
            );
          }
          dbg(
            'MobileNostrPairing: Restored original network:',
            originalNetwork,
            'API:',
            originalApiUrl,
          );
        } catch (restoreError) {
          dbg(
            'MobileNostrPairing: Error restoring original network:',
            restoreError,
          );
        }
      }
      setPairingActive(false);
    }
  };
  const startSignPSBT = async () => {
    if (!route.params?.psbtBase64) {
      Alert.alert('Error', 'Missing PSBT data');
      return;
    }
    try {
      assertCanStartNostrMpc();
    } catch (e) {
      Alert.alert('Please wait', alertMessageForNostrSendError(e));
      return;
    }
    let backend = spendBackend;
    if (!backend) {
      backend = await resolveTssBackend();
      setSpendBackend(backend);
    }
    nostrAbortRef.current = false;
    TssProvider.resetMpcCancelState('nostr');
    TssProvider.markMpcInProgress('nostr');
    setMpcDone(false);
    setSpendSignOutcome(null);
    // Nostr PSBT computes sessionID in native after pre-agreement; do not filter hooks by keygen session.
    activeMpcSessionIdRef.current = null;
    setMpcSessionShort(null);
    setPairingActive(true);
    resetMpcHookSession(mpcHookProgressRef, mpcUtxoRef);
    resetCircle();
    setProgress(0);
    setStatus('Starting PSBT signing…');
    let keyshare: any;
    try {
      keyshare = await loadNostrKeysharePrepForSession();
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
      if (allNpubsFromKeyshare.length < 2) {
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
      if (threeKeyshareWallet) {
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
          throw new Error('Please select a peer device to co-sign with');
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
      const peerNpubForSign = allNpubs.find(n => n !== localNpubFromKeyshare);
      if (!peerNpubForSign) {
        throw new Error('Co-signing peer npub is missing from this session.');
      }
      const {partiesNpubsCSV, peerNpub: resolvedPeerNpub} =
        resolveDklsNostrSigningParties(
          localNpubFromKeyshare,
          peerNpubForSign,
          keyshare,
        );
      const signingNpubsSorted = partiesNpubsCSV;
      const relaysCSV = relays.join(',');
      dbg('Starting Nostr PSBT signing with:', {
        relays: relaysCSV,
        parties: partiesNpubsCSV.substring(0, 50) + '...',
        signingNpubs: signingNpubsSorted.substring(0, 30) + '...',
        resolvedPeerNpub: resolvedPeerNpub.substring(0, 20) + '...',
        psbtLength: route.params.psbtBase64?.length,
      });
      // Call native module for PSBT signing
      await TssProvider.nostrMpcSignPSBT(
        relaysCSV,
        partiesNpubsCSV,
        signingNpubsSorted,
        route.params.psbtBase64,
      )
        .then(async (signedPsbt: any) => {
          if (nostrAbortRef.current) {
            setSpendSignOutcome('aborted');
            setPairingActive(false);
            return;
          }
          if (
            !signedPsbt ||
            signedPsbt.includes('error') ||
            signedPsbt.includes('failed')
          ) {
            setSpendSignOutcome('failed');
            Alert.alert(
              'Operation Error',
              `Could not sign PSBT.\n${String(signedPsbt)}`,
            );
            dbg(localNpub, 'PSBT signing error', String(signedPsbt));
            return;
          }
          dbg(localNpub, 'PSBT signed successfully');
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
        })
        .catch(async (e: any) => {
          if (nostrAbortRef.current) {
            setSpendSignOutcome('aborted');
            setPairingActive(false);
            return;
          }
          setSpendSignOutcome('failed');
          Alert.alert(
            'Operation Error',
            `Could not sign PSBT.\n${e?.message}`,
          );
          dbg(localNpub, 'PSBT signing error', e);
        });
    } catch (error: any) {
      dbg('Sign PSBT error:', error);
      if (nostrAbortRef.current) {
        setSpendSignOutcome('aborted');
      } else {
        setSpendSignOutcome('failed');
        Alert.alert('Error', alertMessageForNostrSendError(error));
      }
      setStatus('PSBT signing failed');
    } finally {
      setPairingActive(false);
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
  const copyConnectionDetails = () => {
    Clipboard.setString(connectionDetails);
    Alert.alert(
      'Copied',
      '- Pairing data copied.\n- Paste them to other device(s)',
    );
  };
  const shareConnectionDetails = async () => {
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
    setIsQRModalVisible(true);
  };
  const handleQRScan = (data: string, peerNum?: 1 | 2) => {
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
  const prepareDevice = async () => {
    setIsPreparing(true);
    setIsPreParamsReady(false);
    setPrepCounter(0);
    try {
      const backend = await runWalletSetupPrepare({
        ppmFile,
        transport: 'nostr',
        setupMode: keygenSetupMode,
        backend: keygenBackend ?? routeKeygenBackend,
        skipDeletePpm: __DEV__,
      });
      setKeygenBackend(backend);
      setIsPreParamsReady(true);
      HapticFeedback.medium();
      dbg('Device prepared successfully');
      setIsPrepared(true);
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
      setStaleTransportHint(null);
      lastMpcPercentBumpAtRef.current = Date.now();
      const interval = setInterval(() => {
        setPrepCounter(prevCounter => prevCounter + 1);
        const hint = staleTransportHintForKeygen({
          isPairing: true,
          isSpendFlow: isSendBitcoin || isSignPSBT,
          displayPercent: mpcHookProgressRef.current,
          lastBumpAtMs: lastMpcPercentBumpAtRef.current,
          lastKeygenStep: lastMpcKeygenStepRef.current,
          nowMs: Date.now(),
          isNostrTransport: true,
        });
        setStaleTransportHint(hint);
        if (hint) {
          setMpcTransportPulse(true);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
    setStaleTransportHint(null);
    setMpcTransportPulse(false);
  }, [isPairing, isSendBitcoin, isSignPSBT]);
  // Animation for horizontal progress bar
  useEffect(() => {
    if (isPreparing) {
      // Small delay to ensure modal is mounted before starting animation
      const timeoutId = setTimeout(() => {
        // Reset value before starting new animation (only when modal is mounted)
        progressAnimation.value = 0;
        // Start new animation loop
        progressAnimation.value = withRepeat(
          withSequence(
            withTiming(1, {duration: 2000}),
            withTiming(0, {duration: 2000}),
          ),
          -1, // infinite repeat
        );
      }, 150);
      return () => {
        clearTimeout(timeoutId);
        cancelAnimation(progressAnimation);
      };
    } else {
      // Stop animation
      cancelAnimation(progressAnimation);
      progressAnimation.value = 0;
    }
    // progressAnimation is a Reanimated shared value (stable); listing it would not help and other deps would restart animation unnecessarily.
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
      marginTop: 8,
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
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
          : theme.colors.bitcoinOrange,
      borderWidth: 2,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.bitcoinOrange + '20',
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
          : theme.colors.bitcoinOrange,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    peerCheckmark: {
      color: theme.colors.white,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    input: {
      borderWidth: 1.5,
      borderColor: theme.colors.border + '40',
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.shadowColor + '05' // ~2% opacity
          : theme.colors.cardBackground,
    },
    inputFocused: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.shadowColor + '08' // ~3% opacity
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
          : theme.colors.bitcoinOrange + '20',
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.monospaceMedium,
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
          : theme.colors.bitcoinOrange + '20',
      borderRadius: 8,
      padding: 6,
      borderLeftWidth: 3,
      borderLeftColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    hintText: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.regular,
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
          : theme.colors.bitcoinOrange,
      borderWidth: 1.5,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '08'
          : theme.colors.bitcoinOrange + '20',
    },
    sendModeDeviceIcon: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      marginRight: 10,
    },
    sendModeDeviceContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sendModeDeviceLabel: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.monospaceBold,
      color: theme.colors.text,
    },
    sendModeDeviceNpub: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary,
      marginLeft: 8,
    },
    sendModeDeviceBadge: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.medium,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      marginTop: 2,
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
          : theme.colors.bitcoinOrange,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    sendModeCheckmark: {
      color: theme.colors.background,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    iconImageCompact: {
      width: 18,
      height: 18,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    iconImage: {
      width: 24,
      height: 24,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      tintColor: theme.colors.received,
      marginRight: 8,
    },
    qrContainer: {
      backgroundColor: 'white',
      padding: 8,
      borderRadius: 8,
      alignItems: 'center',
      marginBottom: 16,
    },
    connectionDetailsText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
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
          : theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
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
          : theme.colors.bitcoinOrange,
      marginRight: 8,
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
    statusCheck: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    statusText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
    },
    statusTextSecondary: {
      color: theme.colors.textSecondary,
    },
    progressContainer: {
      marginTop: 20,
      alignItems: 'center',
    },
    progressText: {
      fontSize: theme.fontSizes?.base || 14,
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
          : theme.colors.bitcoinOrange,
      borderRadius: 12,
    },
    closeScannerButton: {
      position: 'absolute',
      bottom: 40,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
    },
    closeScannerButtonText: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    cameraNotFound: {
      color: theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
    },
    sessionInfo: {
      marginTop: 12,
      padding: 12,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.shadowColor + '05' // ~2% opacity
          : theme.colors.cardBackground,
      borderRadius: 8,
    },
    sessionInfoText: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.colors.modalBackdrop,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qrModalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      width: '85%',
      maxWidth: 400,
      shadowColor: theme.colors.shadowColor,
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
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    qrModalDescription: {
      fontSize: theme.fontSizes?.base || 14,
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
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
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
      fontSize: theme.fontSizes?.base || 14,
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
          : theme.colors.bitcoinOrange + '20',
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
          : theme.colors.bitcoinOrange,
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
          : theme.colors.bitcoinOrange,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    stepNumber: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
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
      fontSize: theme.fontSizes?.xs || 11,
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
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
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
          : theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.base || 13,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 20,
      lineHeight: 18,
    },
    readyCard: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.bitcoinOrange + '20',
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 0,
    },
    helpText: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
    },
    inputError: {
      borderColor: theme.colors.danger,
      backgroundColor: theme.colors.danger + '1A', // ~10% opacity
    },
    inputSuccess: {
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.bitcoinOrange + '20',
    },
    inputValidating: {
      borderColor: theme.colors.textSecondary,
      backgroundColor: theme.colors.textSecondary + '05',
    },
    errorIndicator: {
      marginTop: 8,
      padding: 8,
      backgroundColor: theme.colors.danger + '1A', // ~10% opacity
      borderRadius: 6,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger,
    },
    errorText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.danger,
    },
    validatingIndicator: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    validatingText: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
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
          : theme.colors.bitcoinOrange,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    checkboxCheckmark: {
      color: theme.colors.background,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    checkboxLabel: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.text,
      marginTop: 6,
      flex: 1,
    },
    preparingModalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      padding: 24,
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
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
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
          : theme.colors.bitcoinOrange + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    preparingModalIcon: {
      width: 32,
      height: 32,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    preparingModalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    preparingModalSubtitle: {
      fontSize: theme.fontSizes?.base || 14,
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
          : theme.colors.bitcoinOrange,
      marginRight: 8,
    },
    preparingStatusText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
    },
    preparingCountdownText: {
      fontSize: theme.fontSizes?.base || 13,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    informationCard: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 12,
      padding: 10,
      marginBottom: 16,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: Platform.OS === 'android' ? 2 : 3, // Reduce elevation on Android
      borderWidth: Platform.OS === 'android' ? 0.5 : 1, // Thinner border on Android to prevent distortion
      borderColor: theme.colors.border,
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
          : theme.colors.bitcoinOrange,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
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
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
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
    checkboxTextContainer: {
      flex: 1,
      padding: 8,
    },
    enhancedCheckboxLabel: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
    },
    warningHint: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      marginTop: 2,
      fontStyle: 'italic',
    },
    warningIcon: {
      fontSize: theme.fontSizes?.xl || 18,
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
          : theme.colors.bitcoinOrange,
    },
    finalStepTextContainer: {
      flex: 1,
    },
    finalStepTitle: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 12,
    },
    finalStepDescription: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      lineHeight: 20,
    },
    participantsList: {
      paddingHorizontal: 12,
      backgroundColor: theme.colors.cardBackground + '80',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border + '30',
    },
    participantsListTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      marginBottom: 8,
      padding: 12,
    },
    participantItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 8,
    },
    bulletPoint: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.primary,
      marginRight: 8,
      marginTop: 2,
    },
    participantText: {
      flex: 1,
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      lineHeight: 18,
    },
    participantLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    localDeviceBadge: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.primary,
      fontStyle: 'italic',
    },
    participantNpub: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    participantDevicesInfo: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.primary + '10',
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.border
          : theme.colors.border + '30',
    },
    participantDevicesInfoTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
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
          : theme.colors.bitcoinOrange,
      marginRight: 10,
    },
    participantDeviceLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    participantDeviceNpub: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary,
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
          : theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
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
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
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
          : theme.colors.bitcoinOrange,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    modalDescription: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      lineHeight: 20,
    },
    passwordContainer: {
      marginBottom: 16,
    },
    passwordLabel: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
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
      fontSize: theme.fontSizes?.lg || 16,
      color: theme.colors.text,
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
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
    },
    requirementsContainer: {
      marginTop: 8,
      paddingLeft: 4,
    },
    requirementText: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    errorInput: {
      borderColor: theme.colors.danger,
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
          : theme.colors.bitcoinOrange,
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      textDecorationLine: 'underline',
      textAlign: 'center',
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
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
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
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
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      textAlign: 'right',
      lineHeight: 14,
    },
    noPadding: {
      padding: 0,
    },
  });
  const isSpendPeersReady =
    (isSendBitcoin || isSignPSBT) &&
    !!localNpub &&
    sendModeDevices.length > 0 &&
    !sendModeDevices.some(d => !d.npub || !d.npub.startsWith('npub1')) &&
    (!threeKeyshareWallet || !!selectedPeerNpub);
  const showSpendStickyFooter =
    isSpendPeersReady && !isPairing && !mpcDone;
  const nostrSpendDisabled = !isSpendPeersReady;
  const nostrLocalDevice = sendModeDevices.find(d => d.isLocal);
  const nostrIsKeyShare1 = nostrLocalDevice?.keyshareLabel === 'KeyShare1';
  const nostrSpendLabel = isSendBitcoin || isSignPSBT
    ? nostrIsKeyShare1
      ? isSignPSBT
        ? 'Start PSBT Signing'
        : 'Start Co-Signing'
      : isSignPSBT
        ? 'Join PSBT Signing'
        : 'Join Co-Signing'
    : '';
  const nostrSpendSummary =
    isSendBitcoin && route.params
      ? sendCollapsedRecapLine(
          route.params.satoshiAmount ?? 0,
          route.params.toAddress || '',
          shortenAddress,
        )
      : isSignPSBT && psbtDetails
        ? psbtCollapsedSummaryLine(psbtDetails)
        : '';
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={[styles.container, {flex: 1}]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            showSpendStickyFooter && {
              paddingBottom: PAIRING_STICKY_FOOTER_SCROLL_PADDING,
            },
          ]}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          overScrollMode="never"
          showsVerticalScrollIndicator={false}>
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
                      <AppPressable
                        style={styles.helpButton}
                        onPress={() => {
                          setShowHelpModal(true);
                        }}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Image
                          source={require('../assets/about-icon.png')}
                          style={styles.helpIcon}
                          resizeMode="contain"
                        />
                      </AppPressable>
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
                                    : theme.colors.bitcoinOrange,
                              }}
                              resizeMode="contain"
                            />
                            <Text
                              style={{
                                fontSize: theme.fontSizes?.md || 15,
                                fontFamily: theme.fontFamilies.bold,
                                color: theme.colors.text,
                                textAlign: 'center',
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
                        <AppPressable
                          style={[styles.cancelSetupButton, {marginLeft: 12}]}
                          onPress={() => {
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
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Text style={styles.cancelLink}>
                            {isSendBitcoin || isSignPSBT ? 'Cancel' : 'Abort'}
                          </Text>
                        </AppPressable>
                      ) : (
                        <View style={{width: 36}} />
                      )}
                    </View>
                  </View>
                  {/* Relay Configuration - Show in setup and send/PSBT mode, right after title */}
                  {!showFinalStep && (
                    <View style={styles.section}>
                      <AppPressable
                        style={styles.collapsibleHeader}
                        onPress={() => {
                          setShowRelayConfig(!showRelayConfig);
                        }}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Text style={styles.collapsibleHeaderText}>
                          {showRelayConfig ? '▼' : '▶'} Advanced: Nostr Relays
                          Settings
                        </Text>
                      </AppPressable>
                      {showRelayConfig && (
                        <View style={styles.collapsibleContent}>
                          <Text
                            style={{
                              fontSize: theme.fontSizes?.sm || 12,
                              fontFamily: theme.fontFamilies.regular,
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
                            fontSize: theme.fontSizes?.base || 13,
                            fontFamily: theme.fontFamilies?.bold,
                            color: theme.colors.text,
                            marginBottom: 8,
                          }}>
                          First Co-Signer
                        </Text>
                        {!sendModeDevicesLoadDone ? (
                          <Text
                            style={{color: theme.colors.text, opacity: 0.6}}>
                            Loading…
                          </Text>
                        ) : sendModeDevicesLoadError ? (
                          <Text
                            style={{
                              color: theme.colors.textSecondary,
                              fontSize: theme.fontSizes?.sm || 13,
                            }}>
                            {sendModeDevicesLoadError}
                          </Text>
                        ) : sendModeDevices.length === 0 ? (
                          <Text
                            style={{color: theme.colors.text, opacity: 0.6}}>
                            No co-signers found.
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
                                        <Text
                                          style={styles.sendModeDeviceBadge}>
                                          {'>>'} This device
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
                                          fontSize: theme.fontSizes?.base || 13,
                                          fontFamily: theme.fontFamilies?.bold,
                                          color: theme.colors.text,
                                          marginBottom: 8,
                                        }}>
                                        {threeKeyshareWallet
                                          ? 'Choose Second Co-signer'
                                          : 'Second Co-Signer'}
                                      </Text>
                                      {otherDevices.map(dev => {
                                        // 2-keyshare wallet: fixed peer. 2-of-3: pick co-signer.
                                        if (!threeKeyshareWallet) {
                                          return (
                                            <View
                                              key={dev.keyshareLabel}
                                              style={styles.sendModeDeviceItem}>
                                              <Image
                                                source={require('../assets/phone-icon.png')}
                                                style={
                                                  styles.sendModeDeviceIcon
                                                }
                                                resizeMode="contain"
                                              />
                                              <View
                                                style={
                                                  styles.sendModeDeviceContent
                                                }>
                                                <Text
                                                  style={
                                                    styles.sendModeDeviceLabel
                                                  }
                                                  numberOfLines={1}
                                                  ellipsizeMode="tail">
                                                  {dev.keyshareLabel}
                                                </Text>
                                                <Text
                                                  style={
                                                    styles.sendModeDeviceNpub
                                                  }
                                                  numberOfLines={1}
                                                  ellipsizeMode="middle">
                                                  {shortenNpub(dev.npub, 8, 6)}
                                                </Text>
                                              </View>
                                              {selectedPeerNpub ===
                                                dev.npub && (
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
                                          <AppPressable
                                            key={dev.keyshareLabel}
                                            style={[
                                              styles.sendModeDeviceItem,
                                              selectedPeerNpub === dev.npub &&
                                                styles.sendModeDeviceItemSelected,
                                            ]}
                                            onPress={() => {
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
                                            android_ripple={{
                                              color: 'rgba(0,0,0,0.1)',
                                            }}>
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
                                                style={
                                                  styles.sendModeDeviceLabel
                                                }
                                                numberOfLines={1}
                                                ellipsizeMode="tail">
                                                {dev.keyshareLabel}
                                              </Text>
                                              <Text
                                                style={
                                                  styles.sendModeDeviceNpub
                                                }
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
                                              {selectedPeerNpub ===
                                                dev.npub && (
                                                <Text
                                                  style={
                                                    styles.sendModeCheckmark
                                                  }>
                                                  ✓
                                                </Text>
                                              )}
                                            </View>
                                          </AppPressable>
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
                  {isSpendPeersReady && !isPairing && !mpcDone && isSendBitcoin && route.params && (
                    <View style={styles.section}>
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
                    </View>
                  )}
                  {isSignPSBT &&
                    spendSignOutcome &&
                    !isPairing &&
                    route.params?.psbtBase64 && (
                    <View style={styles.section}>
                      <View style={styles.informationCard}>
                        <Text
                          style={[
                            styles.statusText,
                            {
                              fontFamily: theme.fontFamilies?.medium,
                              fontSize: theme.fontSizes?.md || 15,
                            },
                          ]}>
                          {spendSignOutcome === 'aborted'
                            ? 'PSBT signing was aborted.'
                            : 'PSBT signing failed.'}
                        </Text>
                        {spendSignOutcome === 'failed' && status ? (
                          <Text
                            style={[
                              styles.statusText,
                              {
                                marginTop: 6,
                                fontFamily: theme.fontFamilies?.regular,
                                fontSize: theme.fontSizes?.base || 14,
                                color: theme.colors.textSecondary,
                              },
                            ]}>
                            {status}
                          </Text>
                        ) : null}
                        <AppPressable
                          style={styles.backupButton}
                          onPress={() => startSignPSBT()}>
                          <Text style={styles.backupButtonText}>Try again</Text>
                        </AppPressable>
                      </View>
                    </View>
                  )}
                  {isSpendPeersReady &&
                    !isPairing &&
                    !mpcDone &&
                    isSignPSBT &&
                    route.params?.psbtBase64 && (
                    <View style={styles.section}>
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
                    </View>
                  )}
                  {!isSendBitcoin && !isSignPSBT && keygenBackend ? (
                    <TssBackendBadge backend={keygenBackend} />
                  ) : null}
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
                            fontSize: theme.fontSizes?.base || 14,
                            fontFamily: theme.fontFamilies?.bold,
                            color: theme.colors.text,
                            marginBottom: 12,
                          }}>
                          {'-->'} This Device (Copy or Share QR)
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
                            <AppPressable
                              onPress={copyConnectionDetails}
                              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                              style={{
                                padding: 8,
                                backgroundColor:
                                  theme.colors.background === '#ffffff'
                                    ? theme.colors.primary + '10'
                                    : theme.colors.bitcoinOrange + '20',
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
                            </AppPressable>
                            <AppPressable
                              onPress={showQRModal}
                              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                              style={{
                                padding: 8,
                                backgroundColor:
                                  theme.colors.background === '#ffffff'
                                    ? theme.colors.primary + '10'
                                    : theme.colors.bitcoinOrange + '20',
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
                            </AppPressable>
                          </View>
                        </View>
                      </View>
                    )}
                  {/* Peer Connection 1 - Hide when Final Step is shown or in send/sign mode */}
                  {!showFinalStep && !isSendBitcoin && !isSignPSBT && (
                    <View style={styles.section}>
                      <Text
                        style={{
                          fontSize: theme.fontSizes?.base || 14,
                          fontFamily: theme.fontFamilies?.bold,
                          color: theme.colors.text,
                          marginBottom: 12,
                        }}>
                        {isTrio
                          ? 'Next: Scan Second Device'
                          : '--> Scan Other Device (Paste or Scan QR)'}
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
                            <AppPressable
                              style={[
                                styles.iconButton,
                                styles.iconButtonCentered,
                              ]}
                              onPress={() => clearPeerConnection(1)}
                              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                              <Image
                                source={require('../assets/delete-icon.png')}
                                style={styles.iconImage}
                                resizeMode="contain"
                              />
                            </AppPressable>
                          )}
                          {!peerNpub1 && !peerInputValidating1 && (
                            <>
                              <AppPressable
                                style={[
                                  styles.iconButton,
                                  styles.iconButtonCentered,
                                ]}
                                onPress={() => handlePaste(1)}
                                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                                <Image
                                  source={require('../assets/paste-icon.png')}
                                  style={styles.iconImage}
                                  resizeMode="contain"
                                />
                              </AppPressable>
                              <AppPressable
                                style={[
                                  styles.iconButton,
                                  styles.iconButtonCentered,
                                ]}
                                onPress={() => {
                                  const peerNum: 1 | 2 = 1;
                                  setScanningForPeer(peerNum);
                                  scanningForPeerRef.current = peerNum; // Update ref immediately
                                  setIsQRScannerVisible(true);
                                }}
                                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                                <Image
                                  source={require('../assets/scan-icon.png')}
                                  style={styles.iconImage}
                                  resizeMode="contain"
                                />
                              </AppPressable>
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
                            fontSize: theme.fontSizes?.base || 14,
                            fontFamily: theme.fontFamilies?.bold,
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
                              <AppPressable
                                style={[
                                  styles.iconButton,
                                  styles.iconButtonCentered,
                                ]}
                                onPress={() => clearPeerConnection(2)}
                                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                                <Image
                                  source={require('../assets/delete-icon.png')}
                                  style={styles.iconImage}
                                  resizeMode="contain"
                                />
                              </AppPressable>
                            )}
                            {!peerNpub2 && !peerInputValidating2 && (
                              <>
                                <AppPressable
                                  style={[
                                    styles.iconButton,
                                    styles.iconButtonCentered,
                                  ]}
                                  onPress={() => handlePaste(2)}
                                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                                  <Image
                                    source={require('../assets/paste-icon.png')}
                                    style={styles.iconImage}
                                    resizeMode="contain"
                                  />
                                </AppPressable>
                                <AppPressable
                                  style={[
                                    styles.iconButton,
                                    styles.iconButtonCentered,
                                  ]}
                                  onPress={() => {
                                    const peerNum: 1 | 2 = 2;
                                    setScanningForPeer(peerNum);
                                    scanningForPeerRef.current = peerNum; // Update ref immediately
                                    setIsQRScannerVisible(true);
                                  }}
                                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                                  <Image
                                    source={require('../assets/scan-icon.png')}
                                    style={styles.iconImage}
                                    resizeMode="contain"
                                  />
                                </AppPressable>
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
                        <Text
                          style={{
                            fontSize: theme.fontSizes?.base || 14,
                            fontFamily: theme.fontFamilies?.bold,
                            color: theme.colors.text,
                            marginBottom: 12,
                          }}>
                          {'-->'} Keep app open during preparation
                        </Text>
                        <AppPressable
                          style={[
                            styles.button,
                            isPreparing && styles.buttonDisabled,
                          ]}
                          onPress={prepareDevice}
                          disabled={isPreparing}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Image
                            source={require('../assets/prepare-icon.png')}
                            style={styles.iconPrepare}
                            resizeMode="contain"
                          />
                          <Text style={styles.buttonText}>
                            {isPreparing ? 'Preparing...' : 'Prepare Device'}
                          </Text>
                        </AppPressable>
                      </View>
                    )}
                  {/* Preparing Modal */}
                  {isPreparing && (
                    <Modal
                      transparent={true}
                      visible={isPreparing}
                      onRequestClose={
                        () => {} /* non-dismissible: block Android back */
                      }>
                      <View style={styles.modalOverlay}>
                        <View style={styles.preparingModalContent}>
                          <MpcProgressModalHeader
                            icon={require('../assets/prepare-icon.png')}
                            title={prepareCopy.title}
                            subtitle={`${prepareCopy.subtitle} Do not leave the app during setup.`}
                          />
                          {/* Loading Indicator */}
                          <View style={styles.preparingProgressContainer}>
                            <View style={styles.preparingProgressTrack}>
                              <ProgressAnimatedView
                                style={styles.preparingProgressBar}
                                progressAnimation={progressAnimation}
                                backgroundColor={
                                  theme.colors.background === '#ffffff'
                                    ? theme.colors.primary
                                    : theme.colors.bitcoinOrange
                                }
                              />
                            </View>
                          </View>
                          {/* Status and Countdown */}
                          <View style={styles.preparingStatusContainer}>
                            <View style={styles.preparingStatusRow}>
                              <View style={styles.preparingStatusIndicator} />
                              <Text style={styles.preparingStatusText}>
                                {prepareCopy.statusLine}
                              </Text>
                            </View>
                            {keygenBackend === 'gg18' ? (
                              <Text style={styles.preparingCountdownText}>
                                Time elapsed: {prepCounter} seconds
                              </Text>
                            ) : null}
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
                          <AppPressable
                            style={styles.qrModalCloseButton}
                            onPress={() => {
                              setShowHelpModal(false);
                            }}
                            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                            <Text style={styles.qrModalCloseText}>✕</Text>
                          </AppPressable>
                        </View>
                        <ScrollView
                          style={styles.helpModalBody}
                          removeClippedSubviews
                          keyboardShouldPersistTaps="handled"
                          overScrollMode="never"
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
                                      : theme.colors.bitcoinOrange,
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
                                      : theme.colors.bitcoinOrange,
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
                                      : theme.colors.bitcoinOrange,
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
                                      : theme.colors.bitcoinOrange,
                                }}
                                resizeMode="contain"
                              />
                              <Text style={styles.helpTitle}>Tips</Text>
                            </View>
                            <Text style={styles.helpText}>
                              • Make sure all devices are ready{'\n'}• Your
                              internet connection must be stable{'\n'}• The
                              could take up 1-2 minutes
                              {'\n'}• Keep app open during setup
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
                      <>
                        <View style={styles.section}>
                          <Text style={styles.finalStepTitle}>
                            {'-->'} Final Step
                          </Text>
                          {/* Participants Device Information */}
                          {Object.keys(keyshareMapping).length > 0 && (
                            <View style={styles.participantsList}>
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
                          {/* Participant Devices Info - without container */}
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
                                    {participant.npub === localNpub
                                      ? 'This device'
                                      : participant.deviceName}
                                  </Text>
                                </View>
                                <Text style={styles.participantDeviceNpub}>
                                  {shortenNpub(participant.npub, 8, 6)}
                                </Text>
                              </View>
                            ));
                          })()}
                        </View>
                        {/* All devices ready checkbox and Start button - outside Final Step card */}
                        {!isPairing && !mpcDone && isPrepared && (
                          <>
                            <AppPressable
                              style={[styles.enhancedCheckboxContainer]}
                              onPress={() => {
                                toggleKeygenReady();
                              }}>
                              <View
                                style={[
                                  styles.enhancedCheckbox,
                                  isKeygenReady &&
                                    styles.enhancedCheckboxChecked,
                                ]}>
                                {isKeygenReady && (
                                  <Text style={styles.checkmark}>✓</Text>
                                )}
                              </View>
                              <View style={styles.checkboxTextContainer}>
                                <Text style={styles.enhancedCheckboxLabel}>
                                  All devices are ready.
                                </Text>
                                <Text style={styles.warningHint}>
                                  Do not leave the app during setup.
                                </Text>
                              </View>
                            </AppPressable>
                            <AppPressable
                              style={[
                                styles.button,
                                !canStartKeygen && styles.buttonDisabled,
                              ]}
                              onPress={startKeygen}
                              disabled={!canStartKeygen}
                              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                              <View style={styles.buttonContent}>
                                <Image
                                  source={require('../assets/key-icon.png')}
                                  style={styles.buttonIcon}
                                  resizeMode="contain"
                                />
                                <Text style={styles.buttonText}>
                                  {(() => {
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
                            </AppPressable>
                          </>
                        )}
                      </>
                    )}
                </>
              );
            })()}
          {/* Keygen Modal - Similar to MobilesPairing */}
          {isPairing && !isSendBitcoin && !isSignPSBT && (
            <Modal
              transparent={true}
              visible={isPairing}
              animationType="fade"
              onRequestClose={
                () => {} /* non-dismissible: block Android back */
              }>
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <MpcProgressModalHeader
                    icon={require('../assets/security-icon.png')}
                    title="Finalizing Your Wallet"
                  />
                  {/* Progress Container */}
                  <View style={styles.progressContainer}>
                    {/* Circular Progress */}
                    <Progress.Circle
                      size={80}
                      progress={displayPercent / 100}
                      thickness={6}
                      borderWidth={0}
                      showsText={false}
                      color={theme.colors.primary}
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
                    <MpcModalStatusRow
                      status={status}
                      sessionShort={mpcSessionShort}
                      pulseIndicator={
                        mpcTransportPulse || !!staleTransportHint
                      }
                    />
                    {staleTransportHint ? (
                      <Text
                        style={[
                          styles.finalizingCountdownText,
                          {marginBottom: 4},
                        ]}>
                        {staleTransportHint}
                      </Text>
                    ) : null}
                    <Text style={styles.finalizingCountdownText}>
                      Time elapsed: {prepCounter} seconds
                    </Text>
                  </View>
                  {isSendBitcoin && (
                    <View style={styles.modalActions}>
                      <AppPressable
                        style={[
                          styles.modalButton,
                          {backgroundColor: theme.colors.secondary},
                        ]}
                        onPress={abortActiveNostrMpc}>
                        <Text style={styles.buttonText}>Abort</Text>
                      </AppPressable>
                    </View>
                  )}
                </View>
              </View>
            </Modal>
          )}
          {/* Co-Signing Modal - Similar to MobilesPairing send_btc and sign_psbt */}
          {isPairing && (isSendBitcoin || isSignPSBT) && (
            <Modal
              transparent={true}
              visible={isPairing}
              animationType="fade"
              onRequestClose={
                () => {} /* non-dismissible: block Android back */
              }>
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <MpcProgressModalHeader
                    icon={require('../assets/cosign-icon.png')}
                    title={
                      isSignPSBT
                        ? 'PSBT Co-Signing'
                        : 'Co-Signing Your Transaction'
                    }
                  />
                  {/* Progress Container */}
                  <View style={styles.progressContainer}>
                    {/* Circular Progress */}
                    <Progress.Circle
                      size={80}
                      progress={displayPercent / 100}
                      thickness={6}
                      borderWidth={0}
                      showsText={false}
                      color={theme.colors.primary}
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
                    <MpcModalStatusRow
                      status={status}
                      sessionShort={mpcSessionShort}
                      pulseIndicator={
                        mpcTransportPulse || !!staleTransportHint
                      }
                    />
                    {staleTransportHint ? (
                      <Text
                        style={[
                          styles.finalizingCountdownText,
                          {marginBottom: 4},
                        ]}>
                        {staleTransportHint}
                      </Text>
                    ) : null}
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
                        onPress={abortActiveNostrMpc}>
                        <Text style={styles.buttonText}>Abort</Text>
                      </AppPressable>
                    </View>
                  )}
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
                        {
                          fontFamily: theme.fontFamilies?.bold,
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
                        fontSize: theme.fontSizes?.md || 15,
                        color: theme.colors.textSecondary,
                      },
                    ]}>
                    Create secure backups of your keyshares. Store each device's
                    backup in different locations to prevent single points of
                    failure.
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
                  </AppPressable>
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
                      <AppPressable
                        key={item.key}
                        style={[
                          styles.enhancedBackupCheckbox,
                          backupChecks[item.key as keyof typeof backupChecks] &&
                            styles.enhancedBackupCheckboxChecked,
                        ]}
                        onPress={() => {
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
              </View>
            </>
          )}
        </ScrollView>
        {showSpendStickyFooter && nostrSpendSummary ? (
          <PairingSpendStickyFooter
            summaryLine={nostrSpendSummary}
            network={route.params?.network}
            buttonLabel={nostrSpendLabel}
            onPress={isSignPSBT ? startSignPSBT : startSendBTC}
            disabled={nostrSpendDisabled}
          />
        ) : null}
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
              <AppPressable
                style={styles.qrModalCloseButton}
                onPress={() => {
                  setIsQRModalVisible(false);
                }}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text style={styles.qrModalCloseText}>✕</Text>
              </AppPressable>
            </View>
            <View style={styles.qrModalBody}>
              <StaticQRCode
                value={connectionDetails}
                size={250}
                copyContent={connectionDetails}
                toastMessage="Connection details copied to clipboard"
                getRef={ref => {
                  connectionQrRef.current = ref;
                }}
                style={[styles.qrContainer, styles.noPadding]}
              />
              <Text style={styles.connectionDetailsText}>
                {shortenNpub(connectionDetails)}
              </Text>
              <AppPressable
                style={{
                  backgroundColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.primary
                      : theme.colors.bitcoinOrange,
                  borderRadius: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                }}
                onPress={shareConnectionDetails}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
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
                    fontFamily: theme.fontFamilies?.bold,
                    fontSize: theme.fontSizes?.lg || 16,
                  }}>
                  Share
                </Text>
              </AppPressable>
            </View>
          </View>
        </View>
      </Modal>
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
            const apiTxShape =
              p.inputs &&
              p.outputs &&
              p.inputs.length > 0 &&
              p.outputs.length > 0
                ? {
                    txid: txId,
                    status: {
                      confirmed: false,
                      block_height: null,
                      block_time: null,
                      block_hash: null,
                    },
                    fee: p.satoshiFees,
                    vin: p.inputs.map(inp => ({
                      prevout: {
                        scriptpubkey_address: inp.scriptpubkey_address,
                        value: inp.value,
                      },
                    })),
                    vout: p.outputs!.map(o => ({
                      scriptpubkey_address: o.scriptpubkey_address,
                      value: o.value,
                    })),
                  }
                : {
                    txid: txId,
                    status: {
                      confirmed: false,
                      block_height: null,
                      block_time: null,
                      block_hash: null,
                    },
                    fee: p.satoshiFees,
                    vin: [
                      {
                        prevout: {
                          scriptpubkey_address: p.senderAddress,
                          value: p.satoshiAmount + p.satoshiFees,
                        },
                      },
                    ],
                    vout: [
                      {
                        scriptpubkey_address: p.toAddress,
                        value: p.satoshiAmount,
                      },
                    ],
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
            (async () => {
              try {
                await WalletService.getInstance().incrementChangeIndexAfterSend(
                  p.net,
                  p.addressTypeToUse,
                );
              } catch (e) {
                dbg(
                  'MobileNostrPairing: incrementChangeIndexAfterSend failed:',
                  e,
                );
              }
              try {
                await WalletService.getInstance().refreshSpendStateAfterBroadcast(
                  p.net,
                  p.addressTypeToUse,
                );
              } catch (e) {
                dbg(
                  'MobileNostrPairing: refreshSpendStateAfterBroadcast failed:',
                  e,
                );
              }
              if (p.originalNetwork && p.originalApiUrl) {
                try {
                  await BBMTLibNativeModule.setBtcNetwork(p.originalNetwork);
                  await BBMTLibNativeModule.setAPI(
                    p.originalNetwork,
                    p.originalApiUrl,
                  );
                  appConfigRepository.set('api', p.originalApiUrl);
                  if (
                    p.originalWalletServiceNetwork &&
                    p.originalWalletServiceApiUrl
                  ) {
                    const ws = WalletService.getInstance();
                    (ws as any).currentNetwork = p.originalWalletServiceNetwork;
                    (ws as any).currentApiUrl = p.originalWalletServiceApiUrl;
                  }
                } catch (e) {
                  dbg(
                    'MobileNostrPairing: Error restoring network after broadcast:',
                    e,
                  );
                }
              }
            })().catch(e => {
              dbg('MobileNostrPairing: post-broadcast cleanup failed:', e);
            });
          } catch (e) {
            dbg('MobileNostrPairing: post-broadcast cleanup failed:', e);
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

export default MobileNostrPairing;
