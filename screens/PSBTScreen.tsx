import React, {useCallback, useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  Animated,
  DeviceEventEmitter,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import AppText from '../components/AppText';
import {SafeAreaView} from 'react-native-safe-area-context';
import EncryptedStorage from 'react-native-encrypted-storage';
import {NativeModules} from 'react-native';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {PSBTLoader} from './PSBTModal';
import {canonicalPsbtBase64} from '../services/psbtIdentity';
import {dbg, generateAllOutputDescriptors, getKeyshareMetadata} from '../utils';
import {CommonActions, useRoute, RouteProp} from '@react-navigation/native';
import TransportModeSelector from '../components/TransportModeSelector';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import {safeUnlink} from '../services/rnfsSafe';
import QRCodeModal from '../components/QRCodeModal';
import SignedPSBTModal from './SignedPSBTModal';
import {WalletService} from '../services/WalletService';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {
  nostrMessaging,
  type CoSignResponsePayload,
  type Nip46Response,
} from '../services/nostrMessaging';
import {
  clearPendingCoSignRequest,
  getPendingCoSignRequest,
} from '../services/nostrCoSignSession';
import CurrencySelector from '../components/CurrencySelector';
import {createStyles as createGlobalStyles} from '../components/Styles';
const {BBMTLibNativeModule} = NativeModules;
interface KeyshareInfoForPsbt {
  outputDescriptors: {
    legacy: string;
    segwitNative: string;
    segwitCompatible: string;
  };
}
type RouteParams = {
  signedPsbt?: string;
  sharedPsbtBase64?: string;
  psbtBase64?: string;
  psbtHex?: string;
  isInitiator?: boolean;
  forwardPeerCosign?: boolean;
  initiatorTxId?: string;
  payload?: {
    psbtBase64?: string;
    psbtHex?: string;
    sighash?: string;
    hash?: string;
    txId?: string;
    recipientAddress?: string;
    amountSats?: number;
    feeSats?: number;
  };
  nip46RequestId?: string;
  nip46ReplyTo?: string;
  autoSign?: boolean;
};

function fingerprintFromNpub(npub: string): string {
  if (!npub) return 'mobile-wallet';
  return `${npub.slice(0, 4)}${npub.slice(-4)}`;
}

function normalizeNpub(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveRemoteKeysharePeers(localNpub: string): Promise<string[]> {
  const meta = await getKeyshareMetadata();
  const keyCandidates = Array.isArray(meta?.keygen_committee_keys)
    ? meta.keygen_committee_keys
    : [];

  const committee: string[] = [];
  for (const key of keyCandidates) {
    const normalized = normalizeNpub(key);
    if (!normalized) continue;
    if (normalized.startsWith('npub1')) {
      committee.push(normalized);
      continue;
    }
    const isHex = /^[0-9a-fA-F]+$/.test(normalized);
    if (!isHex || typeof BBMTLibNativeModule?.hexToNpub !== 'function') {
      continue;
    }
    try {
      const converted = await BBMTLibNativeModule.hexToNpub(normalized);
      const convertedNpub = normalizeNpub(converted);
      if (convertedNpub.startsWith('npub1')) {
        committee.push(convertedNpub);
      }
    } catch (err) {
      dbg('[NIP46-TLM][PSBTScreen] failed to convert committee key to npub', {
        keyPrefix: normalized.slice(0, 12),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const localCandidates = new Set(
    [
      normalizeNpub(localNpub),
      normalizeNpub(meta?.nostr_npub),
      normalizeNpub(meta?.local_party_key),
    ].filter(Boolean),
  );
  return Array.from(new Set(committee.filter(npub => !localCandidates.has(npub))));
}

function normalizePsbtFromParams(params?: RouteParams): {
  psbtBase64: string;
  source: string;
  raw: string;
  isHex: boolean;
} {
  const rawCandidates: Array<{value: unknown; source: string}> = [
    {value: params?.psbtHex, source: 'params.psbtHex'},
    {value: params?.psbtBase64, source: 'params.psbtBase64'},
    {value: params?.sharedPsbtBase64, source: 'params.sharedPsbtBase64'},
    {value: params?.payload?.psbtHex, source: 'params.payload.psbtHex'},
    {value: params?.payload?.psbtBase64, source: 'params.payload.psbtBase64'},
  ];

  const picked = rawCandidates.find(c => typeof c.value === 'string' && c.value.trim().length > 0);
  const raw = typeof picked?.value === 'string' ? picked.value.trim() : '';
  if (!raw) {
    return {psbtBase64: '', source: '', raw: '', isHex: false};
  }

  const compact = raw.replace(/\s+/g, '');
  const isHex = /^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0;
  if (isHex) {
    return {
      psbtBase64: nostrMessaging.psbtHexToBase64(compact),
      source: picked?.source || 'unknown',
      raw: compact,
      isHex: true,
    };
  }

  return {
    psbtBase64: canonicalPsbtBase64(compact),
    source: picked?.source || 'unknown',
    raw: compact,
    isHex: false,
  };
}
const PSBTScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const route = useRoute<RouteProp<{params: RouteParams}>>();
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const globalStyles = createGlobalStyles(theme);

  // Helper function to format long strings: first 8 chars ... last 8 chars
  const formatLongString = useCallback((value: string): string => {
    if (!value || value.length <= 16) return value;
    return `${value.substring(0, 8)}...${value.substring(value.length - 8)}`;
  }, []);

  const {activeNetwork: network, activeAddressType: addressType} = useUser();
  const [keyshareInfo, setKeyshareInfo] = useState<KeyshareInfoForPsbt | null>(
    null,
  );
  const [isWatchWalletExpanded, setIsWatchWalletExpanded] = useState(false);
  const [isPSBTSectionExpanded, setIsPSBTSectionExpanded] = useState(false);
  const [sharedInitialPsbt, setSharedInitialPsbt] = useState<string | undefined>(
    undefined,
  );
  const [normalizedPsbtSource, setNormalizedPsbtSource] = useState('');
  const [pendingNip46Hash, setPendingNip46Hash] = useState<string>('');
  const [isForwardingToPeers, setIsForwardingToPeers] = useState(false);
  const [nip46Handoff, setNip46Handoff] = useState<{
    requestId: string;
    replyTo: string;
    autoSign: boolean;
  } | null>(null);
  const [isOutputDescriptorQrVisible, setIsOutputDescriptorQrVisible] =
    useState(false);
  const [selectedDescriptorType, setSelectedDescriptorType] = useState<
    'legacy' | 'segwitNative' | 'segwitCompatible' | null
  >(null);
  const [isPSBTTransportModalVisible, setIsPSBTTransportModalVisible] =
    useState<boolean>(false);
  const [pendingPSBTParams, setPendingPSBTParams] = useState<{
    psbtBase64: string;
    forwardPeerCosign?: boolean;
    isInitiator?: boolean;
    initiatorTxId?: string;
  } | null>(null);
  const [isNostrTransportSupported, setIsNostrTransportSupported] =
    useState(true);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);
  const [isSignedPSBTModalVisible, setIsSignedPSBTModalVisible] =
    useState(false);
  const [_btcPrice, setBtcPrice] = useState<string>('');
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [priceData, setPriceData] = useState<{[key: string]: number}>({});
  const [isCurrencySelectorVisible, setIsCurrencySelectorVisible] =
    useState(false);
  // Animation for Bold Connect collapsible section
  const rotationAnim = useRef(
    new Animated.Value(isWatchWalletExpanded ? 1 : 0),
  ).current;
  // Animation for Sign PSBT collapsible section
  const psbtRotationAnim = useRef(
    new Animated.Value(isPSBTSectionExpanded ? 1 : 0),
  ).current;
  useEffect(() => {
    Animated.timing(rotationAnim, {
      toValue: isWatchWalletExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isWatchWalletExpanded, rotationAnim]);
  useEffect(() => {
    Animated.timing(psbtRotationAnim, {
      toValue: isPSBTSectionExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isPSBTSectionExpanded, psbtRotationAnim]);
  const rotateInterpolate = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });
  const psbtRotateInterpolate = psbtRotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });
  const handleToggleWatchWallet = useCallback(() => {
    const newValue = !isWatchWalletExpanded;
    setIsWatchWalletExpanded(newValue);
    // Close other section if opening this one
    if (newValue) {
      setIsPSBTSectionExpanded(false);
    }
  }, [isWatchWalletExpanded]);
  const handleTogglePSBTSection = useCallback(() => {
    const newValue = !isPSBTSectionExpanded;
    setIsPSBTSectionExpanded(newValue);
    // Close other section if opening this one
    if (newValue) {
      setIsWatchWalletExpanded(false);
    }
  }, [isPSBTSectionExpanded]);
  const loadKeyshareInfo = useCallback(async () => {
    try {
      const keyshare = await getKeyshareMetadata();
      if (!keyshare) {
        setKeyshareInfo(null);
        return;
      }
      const pubKey = keyshare.pub_key || '';
      const chainCode = keyshare.chain_code_hex || '';
      // Generate output descriptors for all address types using utility function
      const descriptors = await generateAllOutputDescriptors(
        BBMTLibNativeModule,
        pubKey,
        chainCode,
        network,
        keyshare,
      );
      const outputDescriptors = {
        legacy: descriptors.legacy,
        segwitNative: descriptors.segwitNative,
        segwitCompatible: descriptors.segwitCompatible,
      };
      setKeyshareInfo({
        outputDescriptors,
      });
    } catch (error) {
      dbg('PSBTScreen: Error loading keyshare info:', error);
      setKeyshareInfo(null);
    }
  }, [network]);

  useEffect(() => {
    console.log('[NIP46-TLM][PSBTScreen] Mounted with params:', route.params);
    dbg('[NIP46-TLM][PSBTScreen] Mounted with params', route.params || {});
  }, []);
  // Check for signedPsbt in route params and show modal
  useEffect(() => {
    const signedPsbtParam = route.params?.signedPsbt;
    if (signedPsbtParam) {
      setSignedPsbt(signedPsbtParam);
      setIsSignedPSBTModalVisible(true);

      const pending = getPendingCoSignRequest();
      if (pending) {
        if (pending.mode === 'nip46' && pending.nip46RequestId) {
          const nip46Response: Nip46Response = {
            id: pending.nip46RequestId,
            result: {
              signedPsbtBase64: signedPsbtParam,
              signedPsbtHex: nostrMessaging.psbtBase64ToHex(signedPsbtParam),
              txId: pending.request.txId,
            },
          };

          dbg('[NIP46-TLM][PSBTScreen] sending NIP-46 response', {
            requestId: pending.nip46RequestId,
            senderNpub: pending.senderNpub,
            txId: pending.request.txId,
            signedPsbtPrefix: signedPsbtParam.slice(0, 16),
          });

          void nostrMessaging
            .sendNip46Response(pending.senderNpub, nip46Response)
            .then(() => {
              DeviceEventEmitter.emit('nostr-cosign:status', {
                mode: 'nip46',
                requestId: pending.nip46RequestId,
                txId: pending.request.txId,
                status: 'signed',
              });
              dbg('[NIP46-TLM][PSBTScreen] sent NIP-46 sign_event response over Nostr', {
                requestId: pending.nip46RequestId,
              });
              console.log(
                '[NIP46-TLM][PSBTScreen] Successfully sent NIP-46 response for ID:',
                pending.nip46RequestId,
              );
              clearPendingCoSignRequest();
              navigation.dispatch(
                CommonActions.navigate({
                  name: 'Keyshare Chat',
                }),
              );
            })
            .catch(err => {
              DeviceEventEmitter.emit('nostr-cosign:status', {
                mode: 'nip46',
                requestId: pending.nip46RequestId,
                txId: pending.request.txId,
                status: 'rejected',
              });
              dbg('[NIP46-TLM][PSBTScreen] failed to send NIP-46 response', {
                requestId: pending.nip46RequestId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        } else {
          const response: CoSignResponsePayload = {
            txId: pending.request.txId,
            approved: true,
            signedPsbtBase64: signedPsbtParam,
            signedPsbtHex: nostrMessaging.psbtBase64ToHex(signedPsbtParam),
          };

          void nostrMessaging
            .sendCoSignResponse(
              pending.senderNpub,
              pending.recipientFingerprint || 'mobile-wallet',
              pending.senderFingerprint,
              response,
            )
            .then(() => {
              DeviceEventEmitter.emit('nostr-cosign:status', {
                mode: 'legacy',
                txId: pending.request.txId,
                status: 'signed',
              });
              dbg('PSBTScreen: sent COSIGN_RESPONSE over Nostr');
              clearPendingCoSignRequest();
            })
            .catch(err => {
              DeviceEventEmitter.emit('nostr-cosign:status', {
                mode: 'legacy',
                txId: pending.request.txId,
                status: 'rejected',
              });
              dbg('PSBTScreen: failed to send COSIGN_RESPONSE', err);
            });
        }
      } else if (route.params?.forwardPeerCosign) {
        const submitPeerRequest = async () => {
          try {
            setIsForwardingToPeers(true);
            const localNpub = await nostrMessaging.getOrCreateLocalNpub();
            const peerNpubs = await resolveRemoteKeysharePeers(localNpub);
            if (peerNpubs.length === 0) {
              Alert.alert('No Peer Keyshares', 'No remote peer npubs were found for this wallet committee.');
              return;
            }

            const txId =
              (typeof route.params?.initiatorTxId === 'string' && route.params.initiatorTxId.trim()) ||
              `peer-cosign-${Date.now()}`;

            const payload = {
              txId,
              psbtHex: nostrMessaging.psbtBase64ToHex(signedPsbtParam),
              psbtBase64: signedPsbtParam,
              amountSats: 0,
              feeSats: 0,
              recipientAddress: 'N/A',
              network: (network || 'mainnet') as 'mainnet' | 'testnet' | 'testnet4',
            };

            await nostrMessaging.sendCoSignRequestToMany(
              peerNpubs,
              fingerprintFromNpub(localNpub),
              'peer-group',
              payload,
            );

            DeviceEventEmitter.emit('nostr-cosign:request', {
              ts: Date.now(),
              mode: 'legacy',
              eventId: `local:${txId}`,
              envelopeId: `local:${txId}`,
              senderNpub: localNpub,
              senderFingerprint: fingerprintFromNpub(localNpub),
              recipientFingerprint: 'peer-group',
              request: payload,
            });

            DeviceEventEmitter.emit('nostr-cosign:status', {
              mode: 'legacy',
              txId,
              status: 'pending',
            });

            dbg('[NIP46-TLM][PSBTScreen] fan-out COSIGN_REQUEST to peers complete', {
              txId,
              peerCount: peerNpubs.length,
              peers: peerNpubs,
            });

            Alert.alert('Peer Co-Sign Requested', `Forwarded partially-signed PSBT to ${peerNpubs.length} peer device(s).`);
            navigation.dispatch(
              CommonActions.navigate({
                name: 'MainTabs',
                params: {
                  screen: 'Chat',
                },
              }),
            );
          } catch (err) {
            dbg('[NIP46-TLM][PSBTScreen] failed to fan-out peer COSIGN_REQUEST', err);
            Alert.alert(
              'Failed to Request Peer Co-Sign',
              err instanceof Error ? err.message : String(err),
            );
          } finally {
            setIsForwardingToPeers(false);
          }
        };

        void submitPeerRequest();
      }

      // Clear the param to prevent showing again
      navigation.setParams({
        signedPsbt: undefined,
        forwardPeerCosign: undefined,
        initiatorTxId: undefined,
      });
    }
  }, [route.params?.signedPsbt, route.params?.forwardPeerCosign, route.params?.initiatorTxId, navigation, network]);
  useEffect(() => {
    const normalized = normalizePsbtFromParams(route.params);
    const sharedPsbt = normalized.psbtBase64;
    const requestId =
      typeof route.params?.nip46RequestId === 'string'
        ? route.params.nip46RequestId.trim()
        : '';
    const replyTo =
      typeof route.params?.nip46ReplyTo === 'string'
        ? route.params.nip46ReplyTo.trim()
        : '';
    const autoSign = !!route.params?.autoSign;

    if (requestId) {
      setNip46Handoff({
        requestId,
        replyTo,
        autoSign,
      });
      void loadKeyshareInfo();
      dbg('[NIP46-TLM][PSBTScreen] detected NIP-46 handoff params', {
        requestId,
        replyTo,
        autoSign,
        hasSharedPsbt: !!sharedPsbt,
        normalizedSource: normalized.source,
      });

      const rawHash =
        typeof route.params?.payload?.sighash === 'string'
          ? route.params.payload.sighash.trim()
          : typeof route.params?.payload?.hash === 'string'
          ? route.params.payload.hash.trim()
          : '';
      setPendingNip46Hash(rawHash);
    }

    if (sharedPsbt) {
      setSharedInitialPsbt(sharedPsbt);
      setNormalizedPsbtSource(normalized.source);
      setIsPSBTSectionExpanded(true);
      navigation.setParams({
        sharedPsbtBase64: undefined,
        psbtBase64: undefined,
        psbtHex: undefined,
        nip46RequestId: undefined,
        nip46ReplyTo: undefined,
        autoSign: undefined,
      });
    } else if (requestId) {
      dbg('[PSBTScreen] No valid PSBT payload string found in route.params', {
        requestId,
      });
    }
  }, [
    route.params?.sharedPsbtBase64,
    route.params?.psbtBase64,
    route.params?.psbtHex,
    route.params?.payload,
    route.params?.nip46RequestId,
    route.params?.nip46ReplyTo,
    route.params?.autoSign,
    navigation,
    loadKeyshareInfo,
  ]);
  // Share helper for exporting text as a small file (descriptor)
  const shareTextAsFile = useCallback(
    async (text: string, filename: string, title: string) => {
      try {
        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${filename}`;
        await safeUnlink(filePath);
        await RNFS.writeFile(filePath, text, 'utf8');
        await Share.open({
          title,
          message: title,
          url: `file://${filePath}`,
          type: 'text/plain',
          filename,
          isNewTask: true,
          failOnCancel: false,
        });
        await safeUnlink(filePath);
      } catch (error: any) {
        if (error?.message !== 'User did not share') {
          Alert.alert('Error', 'Failed to share file');
        }
      }
    },
    [],
  );
  const handleCopyOutputDescriptor = useCallback(
    (type: 'legacy' | 'segwitNative' | 'segwitCompatible') => {
      const descriptor = keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      Clipboard.setString(descriptor);
      const typeLabel =
        type === 'legacy'
          ? 'Legacy'
          : type === 'segwitNative'
          ? 'Native SegWit'
          : 'Nested SegWit';
      Toast.show({
        type: 'success',
        text1: 'Copied',
        text2: `${typeLabel} output descriptor copied to clipboard`,
      });
    },
    [keyshareInfo],
  );
  const handleShareOutputDescriptor = useCallback(
    (type: 'legacy' | 'segwitNative' | 'segwitCompatible') => {
      const descriptor = keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      const now = new Date();
      const month = now.toLocaleDateString('en-US', {month: 'short'});
      const day = now.getDate().toString().padStart(2, '0');
      const year = now.getFullYear();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const typeLabel =
        type === 'legacy'
          ? 'legacy'
          : type === 'segwitNative'
          ? 'segwit-native'
          : 'segwit-compatible';
      const filename = `output-descriptor-${typeLabel}.${month}${day}.${year}.${hours}${minutes}.txt`;
      shareTextAsFile(descriptor, filename, 'Share Output Descriptor');
    },
    [keyshareInfo, shareTextAsFile],
  );
  const handleShowOutputDescriptorQR = useCallback(
    (type: 'legacy' | 'segwitNative' | 'segwitCompatible') => {
      const descriptor = keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      setSelectedDescriptorType(type);
      setIsOutputDescriptorQrVisible(true);
    },
    [keyshareInfo],
  );
  const resolveNostrTransportSupport = useCallback(async (): Promise<boolean> => {
    try {
      const keyshare = await getKeyshareMetadata();
      return !!(keyshare?.nostr_npub && keyshare.nostr_npub.trim() !== '');
    } catch (error) {
      dbg('PSBTScreen: Error checking keyshare for Nostr support:', error);
      return false;
    }
  }, []);
  // Handle PSBT signing - same logic as WalletHome
  // Note: The actual signing functions extract derivation paths from PSBT's Bip32Derivation internally
  const handlePSBTSign = useCallback(
    async (psbtBase64: string, _derivePath?: string) => {
      const normalizedPsbt = canonicalPsbtBase64(psbtBase64);
      // The actual PSBT signing will extract paths from PSBT's Bip32Derivation field
      // derivePath parameter is kept for API compatibility but not used
      const hasNostrSupport = await resolveNostrTransportSupport();
      setIsNostrTransportSupported(hasNostrSupport);

      const shouldForwardPeerCosign =
        route.params?.isInitiator === true ||
        route.params?.forwardPeerCosign === true ||
        !nip46Handoff;

      const initiatorTxId =
        (typeof route.params?.initiatorTxId === 'string' &&
          route.params.initiatorTxId.trim()) ||
        `peer-cosign-${Date.now()}`;

      dbg('[NIP46-TLM][PSBTScreen] handlePSBTSign handoff flags', {
        shouldForwardPeerCosign,
        hasNip46Handoff: !!nip46Handoff,
        initiatorTxId,
      });

      // Store params and show transport selector
      setPendingPSBTParams({
        psbtBase64: normalizedPsbt,
        forwardPeerCosign: shouldForwardPeerCosign,
        isInitiator: shouldForwardPeerCosign,
        initiatorTxId: shouldForwardPeerCosign ? initiatorTxId : undefined,
      });
      setTimeout(() => {
        setIsPSBTTransportModalVisible(true);
      }, 300);
    },
    [resolveNostrTransportSupport, route.params?.isInitiator, route.params?.forwardPeerCosign, route.params?.initiatorTxId, nip46Handoff],
  );
  const navigateToPSBTSigning = useCallback(
    (transport: 'local' | 'nostr') => {
      if (!pendingPSBTParams) return;
      const {psbtBase64, forwardPeerCosign, isInitiator, initiatorTxId} = pendingPSBTParams;
      const routeName =
        transport === 'local' ? 'Devices Pairing' : 'Nostr Connect';
      // For PSBT signing, network is not strictly required (extracted from app state in MobilesPairing),
      // but we pass it for consistency. Derivation path is extracted from PSBT's Bip32Derivation.
      navigation.dispatch(
        CommonActions.navigate({
          name: routeName,
          params: {
            mode: 'sign_psbt',
            addressType,
            psbtBase64,
            network: network || 'mainnet', // Pass network for consistency (not strictly required for PSBT)
            forwardPeerCosign: !!forwardPeerCosign,
            isInitiator: !!isInitiator,
            initiatorTxId: initiatorTxId || undefined,
          },
        }),
      );
      setPendingPSBTParams(null);
    },
    [pendingPSBTParams, addressType, navigation, network],
  );

  const startNip46CoSignFlow = useCallback(() => {
    const pending = getPendingCoSignRequest();
    const sourcePsbt = sharedInitialPsbt || '';
    if (!sourcePsbt && !pendingNip46Hash) {
      Alert.alert('Missing Payload', 'No PSBT or signable hash payload is available for this NIP-46 request.');
      return;
    }

    const requestId =
      (nip46Handoff?.requestId || pending?.nip46RequestId || '').trim();
    const replyTo = (nip46Handoff?.replyTo || pending?.senderNpub || '').trim();

    if (!sourcePsbt && pendingNip46Hash) {
      if (!requestId || !replyTo) {
        Alert.alert('Missing Request Context', 'Unable to publish NIP-46 response without request id and reply target.');
        return;
      }
      const notSupported: Nip46Response = {
        id: requestId,
        error:
          'Direct non-PSBT sign_event payload is not supported in mobile UI flow yet; provide a BIP-174 PSBT payload.',
      };
      dbg('[NIP46-TLM][PSBTScreen] responding with non-PSBT unsupported error', {
        requestId,
        replyTo,
        hashPrefix: pendingNip46Hash.slice(0, 16),
      });
      void nostrMessaging.sendNip46Response(replyTo, notSupported);
      Alert.alert('Unsupported Request', 'This NIP-46 request does not contain a PSBT payload. A rejection response was sent.');
      return;
    }

    dbg('[NIP46-TLM][PSBTScreen] launching NIP-46 co-sign flow', {
      requestId,
      replyTo,
      hasPendingSession: !!pending,
      normalizedSource: normalizedPsbtSource,
    });

    setPendingPSBTParams(null);
    navigation.dispatch(
      CommonActions.navigate({
        name: 'Nostr Connect',
        params: {
          mode: 'sign_psbt',
          transport: 'nostr',
          addressType,
          psbtBase64: sourcePsbt,
          network: network || 'mainnet',
          nip46RequestId: requestId || undefined,
          nip46ReplyTo: replyTo || undefined,
        },
      }),
    );
  }, [sharedInitialPsbt, nip46Handoff, navigation, addressType, network]);

  const startSignAndForwardFlow = useCallback(() => {
    const sourcePsbt = sharedInitialPsbt || '';
    if (!sourcePsbt) {
      Alert.alert('Missing PSBT', 'No PSBT payload available to sign and forward.');
      return;
    }

    const initiatorTxId = `peer-cosign-${Date.now()}`;
    dbg('[NIP46-TLM][PSBTScreen] launching initiator Sign & Forward flow', {
      initiatorTxId,
      psbtPrefix: sourcePsbt.slice(0, 16),
    });

    navigation.dispatch(
      CommonActions.navigate({
        name: 'Nostr Connect',
        params: {
          mode: 'sign_psbt',
          transport: 'nostr',
          addressType,
          psbtBase64: sourcePsbt,
          network: network || 'mainnet',
          forwardPeerCosign: true,
          initiatorTxId,
        },
      }),
    );
  }, [sharedInitialPsbt, navigation, addressType, network]);
  useEffect(() => {
    loadKeyshareInfo();
  }, [loadKeyshareInfo]);
  // Fetch bitcoin price and initialize currency
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const currency = appConfigRepository.get(CONFIG_KEYS.CURRENCY) || 'USD';
        setSelectedCurrency(currency);
        const walletService = WalletService.getInstance();
        await walletService.initialize();
        const priceResponse = await walletService.getBitcoinPrice();
        if (priceResponse && priceResponse.rates) {
          setPriceData(priceResponse.rates);
          const r = priceResponse.rates[currency] || priceResponse.rate || 0;
          if (r && r > 0) {
            setBtcPrice(r.toString());
          }
        }
      } catch (error) {
        dbg('PSBTScreen: Error fetching price:', error);
      }
    };
    fetchPrice();
  }, []);
  const handleCurrencySelect = async (currency: {code: string}) => {
    setSelectedCurrency(currency.code);
    appConfigRepository.set(CONFIG_KEYS.CURRENCY, currency.code);
    if (priceData[currency.code]) {
      const formattedPrice = priceData[currency.code].toFixed(2);
      setBtcPrice(formattedPrice);
    }
  };
  // Handle section expansion based on PSBT mode toggle state
  useEffect(() => {
    const checkPSBTModeState = async () => {
      try {
        const isFirstVisit = await EncryptedStorage.getItem(
          'psbt_mode_first_visit',
        );
        if (isFirstVisit === 'true') {
          // First visit after toggle: both sections closed
          setIsWatchWalletExpanded(false);
          setIsPSBTSectionExpanded(false);
          // Clear the flag so subsequent visits use default behavior
          await EncryptedStorage.removeItem('psbt_mode_first_visit');
        } else {
          // Subsequent visits: Bold Connect closed, Sign PSBT open
          setIsWatchWalletExpanded(false);
          setIsPSBTSectionExpanded(true);
        }
      } catch (error) {
        dbg('PSBTScreen: Error checking PSBT mode state:', error);
        // Default behavior on error: Bold Connect closed, Sign PSBT open
        setIsWatchWalletExpanded(false);
        setIsPSBTSectionExpanded(true);
      }
    };
    checkPSBTModeState();
  }, []);
  return (
    <SafeAreaView style={styles.screenContainer} edges={['left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}>
        {nip46Handoff && sharedInitialPsbt ? (
          <View style={styles.nip46ActionCard}>
            <AppText style={styles.nip46ActionTitle}>NIP-46 Co-Sign Request</AppText>
            <AppText style={styles.nip46ActionSubtitle}>
              Request ID: {nip46Handoff.requestId}
            </AppText>
            <AppText style={styles.nip46ActionSubtitle}>
              Payload Source: {normalizedPsbtSource || 'unknown'}
            </AppText>
            <AppPressable
              style={styles.nip46ActionButton}
              onPress={startNip46CoSignFlow}
              accessibilityRole="button"
              accessibilityLabel="Co-Sign and broadcast NIP-46 response">
              <AppText style={styles.nip46ActionButtonText}>
                Co-Sign & Broadcast NIP-46 Response
              </AppText>
            </AppPressable>
          </View>
        ) : null}

        {!nip46Handoff && sharedInitialPsbt ? (
          <View style={styles.nip46ActionCard}>
            <AppText style={styles.nip46ActionTitle}>Peer Co-Signing</AppText>
            <AppText style={styles.nip46ActionSubtitle}>
              Unsigned PSBT loaded from watch-only flow.
            </AppText>
            <AppPressable
              style={styles.nip46ActionButton}
              onPress={startSignAndForwardFlow}
              accessibilityRole="button"
              accessibilityLabel="Sign and request peer co-signature">
              <AppText style={styles.nip46ActionButtonText}>
                {isForwardingToPeers ? 'Forwarding to Peers...' : 'Sign & Request Peer Co-Signature'}
              </AppText>
            </AppPressable>
          </View>
        ) : null}

        {nip46Handoff && !sharedInitialPsbt ? (
          <View style={styles.nip46ActionCard}>
            <AppText style={styles.nip46ActionTitle}>NIP-46 Co-Sign Request</AppText>
            <AppText style={styles.nip46ActionSubtitle}>
              Request ID: {nip46Handoff.requestId}
            </AppText>
            <AppText style={styles.nip46ActionSubtitle}>
              PSBT payload not found. Hash mode: {pendingNip46Hash ? 'detected' : 'missing'}
            </AppText>
            <AppPressable
              style={styles.nip46ActionButton}
              onPress={startNip46CoSignFlow}
              accessibilityRole="button"
              accessibilityLabel="Send NIP-46 fallback response">
              <AppText style={styles.nip46ActionButtonText}>
                Send NIP-46 Fallback Response
              </AppText>
            </AppPressable>
          </View>
        ) : null}

        {!nip46Handoff && keyshareInfo && (
          <View
            style={[
              styles.watchWalletCard,
              isWatchWalletExpanded && styles.watchWalletCardExpanded,
            ]}>
            <AppPressable
              style={styles.watchWalletHeaderRow}
              onPress={handleToggleWatchWallet}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Bold Wallet Connect section, ${
                isWatchWalletExpanded ? 'expanded' : 'collapsed'
              }`}
              accessibilityHint={`Double tap to ${
                isWatchWalletExpanded ? 'collapse' : 'expand'
              } Bold Connect section`}>
              <View style={styles.watchWalletHeaderContent}>
                <Image
                  source={require('../assets/descriptor-icon.png')}
                  style={styles.watchWalletIcon}
                  resizeMode="contain"
                />
                <AppText style={styles.watchWalletTitle}>
                  Watch Wallet Export
                </AppText>
              </View>
              <Animated.Text
                style={[
                  styles.watchWalletExpandIcon,
                  {
                    transform: [{rotate: rotateInterpolate}],
                    color: theme.colors.text,
                  },
                ]}>
                ▶
              </Animated.Text>
            </AppPressable>
            {/* Collapsible content - only rendered when expanded */}
            {isWatchWalletExpanded && (
              <View
                style={[
                  styles.watchWalletContent,
                  styles.watchWalletContentExpanded,
                ]}>
                <AppText style={styles.watchWalletSubtitle}>
                  Bold acts as your multi-party Bitcoin signer. Create
                  transactions in a watch-only compatible wallet like Sparrow or
                  Electrum and sign them securely via PSBT.
                </AppText>
                <AppText style={styles.watchWalletWarning}>
                  ⚠️ Note: Taproot is not supported. Only Legacy, Native SegWit,
                  and Nested SegWit address types are supported.
                </AppText>
                {/* Output Descriptors - One row per address type */}
                {keyshareInfo.outputDescriptors.legacy && (
                  <View
                    style={[
                      globalStyles.watchWalletItem,
                      !keyshareInfo.outputDescriptors.segwitNative &&
                        !keyshareInfo.outputDescriptors.segwitCompatible &&
                        globalStyles.watchWalletItemLast,
                    ]}>
                    <AppText style={globalStyles.watchWalletItemLabel}>
                      Output Descriptor (Legacy)
                    </AppText>
                    <View style={globalStyles.watchWalletItemValueContainer}>
                      <AppPressable
                        onPress={() => handleCopyOutputDescriptor('legacy')}
                        style={globalStyles.keyshareKeyContainerBadge}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Image
                          source={require('../assets/copy-icon.png')}
                          style={globalStyles.keyshareBadgeCopyIcon}
                        />
                        <Text
                          style={globalStyles.keyshareKeyTextClickable}
                          numberOfLines={1}>
                          {formatLongString(
                            keyshareInfo.outputDescriptors.legacy || 'N/A',
                          )}
                        </Text>
                      </AppPressable>
                      <View style={globalStyles.keyshareButtonsRow}>
                        <AppPressable
                          onPress={() => handleShareOutputDescriptor('legacy')}
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                        <AppPressable
                          onPress={() => handleShowOutputDescriptorQR('legacy')}
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                      </View>
                    </View>
                  </View>
                )}
                {keyshareInfo.outputDescriptors.segwitNative && (
                  <View
                    style={[
                      globalStyles.watchWalletItem,
                      !keyshareInfo.outputDescriptors.segwitCompatible &&
                        globalStyles.watchWalletItemLast,
                    ]}>
                    <AppText style={globalStyles.watchWalletItemLabel}>
                      Output Descriptor (Native SegWit)
                    </AppText>
                    <View style={globalStyles.watchWalletItemValueContainer}>
                      <AppPressable
                        onPress={() =>
                          handleCopyOutputDescriptor('segwitNative')
                        }
                        style={globalStyles.keyshareKeyContainerBadge}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Image
                          source={require('../assets/copy-icon.png')}
                          style={globalStyles.keyshareBadgeCopyIcon}
                        />
                        <Text
                          style={globalStyles.keyshareKeyTextClickable}
                          numberOfLines={1}>
                          {formatLongString(
                            keyshareInfo.outputDescriptors.segwitNative ||
                              'N/A',
                          )}
                        </Text>
                      </AppPressable>
                      <View style={globalStyles.keyshareButtonsRow}>
                        <AppPressable
                          onPress={() =>
                            handleShareOutputDescriptor('segwitNative')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                        <AppPressable
                          onPress={() =>
                            handleShowOutputDescriptorQR('segwitNative')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                      </View>
                    </View>
                  </View>
                )}
                {keyshareInfo.outputDescriptors.segwitCompatible && (
                  <View style={globalStyles.watchWalletItem}>
                    <AppText style={globalStyles.watchWalletItemLabel}>
                      Output Descriptor (Nested SegWit)
                    </AppText>
                    <View style={globalStyles.watchWalletItemValueContainer}>
                      <AppPressable
                        onPress={() =>
                          handleCopyOutputDescriptor('segwitCompatible')
                        }
                        style={globalStyles.keyshareKeyContainerBadge}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Image
                          source={require('../assets/copy-icon.png')}
                          style={globalStyles.keyshareBadgeCopyIcon}
                        />
                        <Text
                          style={globalStyles.keyshareKeyTextClickable}
                          numberOfLines={1}>
                          {formatLongString(
                            keyshareInfo.outputDescriptors.segwitCompatible ||
                              'N/A',
                          )}
                        </Text>
                      </AppPressable>
                      <View style={globalStyles.keyshareButtonsRow}>
                        <AppPressable
                          onPress={() =>
                            handleShareOutputDescriptor('segwitCompatible')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                        <AppPressable
                          onPress={() =>
                            handleShowOutputDescriptorQR('segwitCompatible')
                          }
                          style={globalStyles.keyshareCopyButton}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={globalStyles.keyshareCopyIcon}
                          />
                        </AppPressable>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
        {/* Sign PSBT Section - Collapsible */}
        <View
          style={[
            styles.psbtSectionCard,
            isPSBTSectionExpanded && styles.psbtSectionCardExpanded,
          ]}>
          <AppPressable
            style={styles.psbtSectionHeaderRow}
            onPress={handleTogglePSBTSection}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`Sign PSBT section, ${
              isPSBTSectionExpanded ? 'expanded' : 'collapsed'
            }`}
            accessibilityHint={`Double tap to ${
              isPSBTSectionExpanded ? 'collapse' : 'expand'
            } Sign PSBT section`}>
            <View style={styles.psbtSectionHeaderContent}>
              <Image
                source={require('../assets/cosign-icon.png')}
                style={styles.psbtSectionIcon}
                resizeMode="contain"
              />
              <AppText style={styles.psbtSectionTitle}>
                Bold PSBT Signer
              </AppText>
            </View>
            <Animated.Text
              style={[
                styles.psbtSectionExpandIcon,
                {
                  transform: [{rotate: psbtRotateInterpolate}],
                  color: theme.colors.text,
                },
              ]}>
              ▶
            </Animated.Text>
          </AppPressable>
          {/* Collapsible content - only rendered when expanded */}
          {isPSBTSectionExpanded && (
            <View style={styles.psbtSectionContent}>
              <View style={styles.psbtBodyContainer}>
                <PSBTLoader
                  initialPsbtBase64={sharedInitialPsbt}
                  onClose={() => {
                    // In PSBT screen, Cancel should only reset the loader state,
                    // not navigate away from this screen.
                  }}
                  disableCancelWhenEmpty={true}
                  useOverlay={false}
                  onSign={handlePSBTSign}
                />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
      <CurrencySelector
        visible={isCurrencySelectorVisible}
        onClose={() => setIsCurrencySelectorVisible(false)}
        onSelect={handleCurrencySelect}
        currentCurrency={selectedCurrency}
        availableCurrencies={priceData}
      />
      {/* QR Code Modals for watch-wallet import helpers */}
      <QRCodeModal
        visible={isOutputDescriptorQrVisible}
        onClose={() => {
          setIsOutputDescriptorQrVisible(false);
          setSelectedDescriptorType(null);
        }}
        title={`Wallet • Output Descriptor (${
          selectedDescriptorType === 'legacy'
            ? 'Legacy'
            : selectedDescriptorType === 'segwitNative'
            ? 'Native SegWit'
            : 'Nested SegWit'
        })`}
        value={
          selectedDescriptorType && keyshareInfo?.outputDescriptors
            ? keyshareInfo.outputDescriptors[selectedDescriptorType] || ''
            : ''
        }
        network={network as 'mainnet' | 'testnet'}
        showShareButton={true}
        topRightClose={true}
        nonDismissible={false}
      />
      {/* PSBT Transport Mode Selector */}
      <TransportModeSelector
        title="Co-Sign Via…"
        description=""
        visible={isPSBTTransportModalVisible}
        nostrEnabled={isNostrTransportSupported}
        defaultTransport={isNostrTransportSupported ? null : 'local'}
        onClose={() => {
          setIsPSBTTransportModalVisible(false);
          setPendingPSBTParams(null);
        }}
        onSelect={(transport: 'local' | 'nostr') => {
          navigateToPSBTSigning(transport);
          setIsPSBTTransportModalVisible(false);
        }}
      />
      {/* Signed PSBT Modal */}
      {signedPsbt && (
        <SignedPSBTModal
          visible={isSignedPSBTModalVisible}
          signedPsbtBase64={signedPsbt}
          onClose={() => {
            setIsSignedPSBTModalVisible(false);
            setSignedPsbt(null);
          }}
        />
      )}
    </SafeAreaView>
  );
};
const createStyles = (theme: any) =>
  StyleSheet.create({
    headerRightContainer: {
      paddingTop: 12,
      paddingBottom: 12,
      paddingRight: 16,
      paddingLeft: 8,
      justifyContent: 'center',
    },
    screenContainer: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 24,
      paddingTop: 12,
    },
    nip46ActionCard: {
      marginBottom: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.cardBackground,
      padding: 12,
      gap: 8,
    },
    nip46ActionTitle: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    nip46ActionSubtitle: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
    },
    nip46ActionButton: {
      borderRadius: 8,
      backgroundColor: theme.colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: 'center',
    },
    nip46ActionButtonText: {
      color: theme.colors.textOnPrimary,
      fontFamily: theme.fontFamilies?.bold,
      fontSize: theme.fontSizes?.sm || 13,
    },
    watchWalletCard: {
      marginBottom: 8,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    watchWalletCardExpanded: {
      // Additional styles when expanded if needed
    },
    watchWalletHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      backgroundColor: theme.colors.cardBackground,
    },
    watchWalletHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    watchWalletIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
      tintColor: theme.colors.text,
    },
    watchWalletTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    watchWalletSubtitle: {
      fontSize: theme.fontSizes?.base || 13,
      lineHeight: 18,
      color: theme.colors.textSecondary,
      marginBottom: 8,
    },
    watchWalletWarning: {
      fontSize: theme.fontSizes?.sm || 12,
      lineHeight: 16,
      color: theme.colors.textSecondary,
      fontStyle: 'italic',
    },
    watchWalletHint: {
      fontSize: theme.fontSizes?.sm || 12,
      lineHeight: 16,
      color: theme.colors.textSecondary,
      textDecorationLine: 'underline',
      marginTop: 12,
      marginBottom: 6,
    },
    watchWalletExpandIcon: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    watchWalletContent: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      borderTopWidth: 1,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent || theme.colors.primary
          : theme.colors.bitcoinOrange,
      overflow: 'hidden',
    },
    watchWalletContentExpanded: {
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    watchWalletDetailRow: {
      flexDirection: 'row',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border + '30',
      alignItems: 'center',
      marginBottom: 0,
    },
    watchWalletDetailLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
      width: 140,
      flexShrink: 0,
      marginRight: 12,
    },
    watchWalletValueContainer: {
      flex: 1,
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
    },
    watchWalletValueText: {
      flex: 1,
      flexShrink: 1,
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      minWidth: 0,
    },
    watchWalletButtonsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    watchWalletIconButton: {
      padding: 8,
      borderRadius: 6,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Subtle shadow for depth
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.15,
      shadowRadius: 2,
      elevation: 2,
    },
    watchWalletIconButtonIcon: {
      width: 16,
      height: 16,
      tintColor: theme.colors.textOnPrimary,
    },
    psbtSectionCard: {
      marginBottom: 8,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    psbtSectionCardExpanded: {
      // Additional styles when expanded if needed
    },
    psbtSectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      backgroundColor: theme.colors.cardBackground,
    },
    psbtSectionHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    psbtSectionIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
      tintColor: theme.colors.text,
    },
    psbtSectionTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    psbtSectionExpandIcon: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    psbtSectionContent: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      borderTopWidth: 1,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent || theme.colors.primary
          : theme.colors.bitcoinOrange,
      overflow: 'hidden',
    },
    psbtBodyContainer: {
      marginTop: 0,
      marginBottom: 8,
      padding: 12,
    },
  });
export default PSBTScreen;
