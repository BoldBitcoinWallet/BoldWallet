import React, {useCallback, useState, useEffect, useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  View,
  Text,
  Image,
  ScrollView,
  Alert,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import AppPressable from './AppPressable';
import AppText from './AppText';
import {SafeAreaView} from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
  interpolate,
} from 'react-native-reanimated';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import {safeUnlink} from '../services/rnfsSafe';
import Toast from 'react-native-toast-message';
import {
  dbg,
  formatKeyshareCreatedAt,
  formatKeyshareCreatedAtLong,
} from '../utils';
import {
  parseKeyshareJsonForDevView,
  prettyPrintKeyshareJson,
} from '../utils/keyshareDevView';
import {colorsFromWalletFingerprint} from '../utils/fingerprintPillColors';
import {isDevDebugEnabled} from '../services/devDebug';
import {
  promptWalletBiometricAuth,
  WALLET_SENSITIVE_ACTION_AUTH,
} from '../services/walletBiometricAuth';
import {useTheme} from '../theme';
import {getFontStyle} from '../theme/utils';
import {createStyles} from './Styles';
import KeyshareJsonTree from './KeyshareJsonTree';
import QRCodeModal from './QRCodeModal';
import QRScanner from './QRScanner';
import {
  parsePairingCodeFromScannedData,
  computeExtensionBindResponseQr,
  computeExtensionPairingPayloadQr,
} from '../utils/extensionBind';
import type {TssBackend} from '../services/tssBackend';

const TSS_BACKEND_LOGO = {
  dkls23: require('../assets/0xcarbon-lib.png'),
  gg18: require('../assets/bnb-lib.png'),
} as const;

function tssBackendLogoFor(
  backend: TssBackend | undefined,
  label: string | undefined,
): (typeof TSS_BACKEND_LOGO)[keyof typeof TSS_BACKEND_LOGO] {
  if (backend === 'dkls23') {
    return TSS_BACKEND_LOGO.dkls23;
  }
  if (backend === 'gg18') {
    return TSS_BACKEND_LOGO.gg18;
  }
  const hint = (label ?? '').toLowerCase();
  if (
    hint.includes('dkls') ||
    hint.includes('0xcarbon') ||
    hint.includes('libtss')
  ) {
    return TSS_BACKEND_LOGO.dkls23;
  }
  return TSS_BACKEND_LOGO.gg18;
}

const PHONE_ICON = require('../assets/phone-icon.png');
const FINGERPRINT_ICON = require('../assets/id-icon.png');
const CLOCK_ICON = require('../assets/clock-icon.png');
const KEY_ICON = require('../assets/key-icon.png');

function keyshareIndexFromLabel(label: string): number | null {
  const m = /^KeyShare(\d+)$/i.exec(String(label || '').trim());
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 3 ? n : null;
}

function WalletModePhoneIcons({
  type,
  phoneIconStyle,
  phoneIconMutedStyle,
  rowStyle,
}: {
  type: 'duo' | 'trio';
  phoneIconStyle: object;
  phoneIconMutedStyle: object;
  rowStyle: object;
}) {
  if (type === 'duo') {
    return (
      <View style={rowStyle}>
        <Image
          source={PHONE_ICON}
          style={phoneIconStyle}
          resizeMode="contain"
        />
        <Image
          source={PHONE_ICON}
          style={phoneIconStyle}
          resizeMode="contain"
        />
      </View>
    );
  }
  return (
    <View style={rowStyle}>
      <Image source={PHONE_ICON} style={phoneIconStyle} resizeMode="contain" />
      <Image source={PHONE_ICON} style={phoneIconStyle} resizeMode="contain" />
      <Image
        source={PHONE_ICON}
        style={phoneIconMutedStyle}
        resizeMode="contain"
      />
    </View>
  );
}

interface KeyshareInfo {
  label: string;
  supportsLocal: boolean;
  supportsNostr: boolean;
  type: 'duo' | 'trio';
  tssBackend?: TssBackend;
  tssBackendLabel?: string;
  pubKey: string;
  chainCode: string;
  fingerprint: string;
  npub: string | null;
  createdAt?: number | null;
  outputDescriptors?: {
    legacy: string;
    segwitNative: string;
    segwitCompatible: string;
  };
}
interface KeyshareInfoContentProps {
  keyshareInfo: KeyshareInfo | null;
  network: 'mainnet' | 'testnet';
}
const KeyshareInfoContent: React.FC<KeyshareInfoContentProps> = ({
  keyshareInfo,
  network,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const isLightTheme = theme.colors.background === '#ffffff';
  const screenStyles = React.useMemo(
    () =>
      StyleSheet.create({
        safeArea: {flex: 1, backgroundColor: theme.colors.background},
        scrollView: {flex: 1},
        scrollContent: {
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 24,
        },
        walletInfoHintLink: {textDecorationLine: 'underline'},
        walletInfoHintLinkColor: {
          color: isLightTheme ? theme.colors.primary : theme.colors.secondary,
        },
        bindExtensionDescription: {marginTop: 4, marginBottom: 8},
        bindExtensionButton: {
          flexDirection: 'row' as const,
          justifyContent: 'center' as const,
        },
        bindExtensionButtonText: {marginLeft: 8},
        extensionResponseQrPadding: {padding: 16},
        extensionLinkItem: {marginBottom: 8},
        extensionLinkText: {marginBottom: 0},
        devKeyshareWarning: {
          fontSize: theme.fontSizes?.sm || 12,
          color: theme.colors.warning || theme.colors.textSecondary,
          marginBottom: 8,
        },
        devKeyshareError: {
          fontSize: theme.fontSizes?.sm || 12,
          color: theme.colors.danger,
          marginBottom: 8,
        },
        devKeyshareActions: {
          flexDirection: 'row' as const,
          flexWrap: 'wrap' as const,
          gap: 8,
          marginBottom: 8,
        },
        devKeyshareActionChip: {
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 8,
          backgroundColor: theme.colors.cardBackground,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        devKeyshareActionText: {
          fontSize: theme.fontSizes?.sm || 12,
          color: theme.colors.text,
        },
        devKeyshareActionTextActive: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        devKeyshareTreeBox: {
          maxHeight: 360,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 8,
          backgroundColor:
            theme.colors.cardBackground || theme.colors.background,
        },
        devKeysharePrettyScroll: {
          maxHeight: 360,
        },
        devKeysharePrettyText: {
          fontSize: 11,
          color: theme.colors.text,
        },
        walletInfoRowUniform: {
          minHeight: 36,
          paddingVertical: 5,
          alignItems: 'center' as const,
        },
        tssBackendBadgeIcon: {
          width: 20,
          height: 20,
        },
        walletInfoPill: {
          flex: 1,
          flexShrink: 1,
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          justifyContent: 'flex-start' as const,
          gap: 8,
          minWidth: 0,
          height: 36,
          minHeight: 36,
          maxHeight: 36,
          paddingHorizontal: 10,
          paddingVertical: 0,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        /** Neutral value chips — lifted surface on the info card */
        walletInfoPillSurface: {
          backgroundColor: isLightTheme
            ? theme.colors.white
            : theme.colors.whiteOverlay08,
        },
        walletInfoPillDuo: {
          backgroundColor: theme.colors.secondary,
        },
        walletInfoPillTrio: {
          backgroundColor: theme.colors.primary,
        },
        walletInfoPillDkls: {
          backgroundColor: theme.colors.secondary,
        },
        walletInfoPillGg18: {
          backgroundColor: theme.colors.primary,
        },
        walletInfoPillLeading: {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          flexShrink: 0,
          gap: 4,
        },
        walletInfoPillValue: {
          flex: 1,
          minWidth: 0,
          textAlign: 'right' as const,
        },
        walletInfoPillValueBrand: {
          flex: 1,
          minWidth: 0,
          textAlign: 'right' as const,
          fontSize: theme.fontSizes?.sm || 12,
          lineHeight: 18,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.white,
        },
        walletInfoPillValueNeutral: {
          flex: 1,
          minWidth: 0,
          textAlign: 'right' as const,
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.text,
        },
        walletInfoPillIcon: {
          width: 20,
          height: 20,
        },
        walletInfoPillFingerprint: {
          paddingLeft: 0,
          paddingVertical: 0,
          gap: 0,
          overflow: 'hidden' as const,
        },
        walletInfoPillFingerprintStarter: {
          width: '25%',
          minWidth: 44,
          maxWidth: 72,
          height: 36,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          marginRight: 8,
          borderRightWidth: 1,
          borderRightColor: theme.colors.border,
        },
        walletInfoPillFingerprintIcon: {
          width: 20,
          height: 20,
        },
        walletInfoPillFingerprintText: {
          flex: 1,
          minWidth: 0,
          fontSize: theme.fontSizes?.sm || 12,
          lineHeight: 18,
          fontFamily: theme.fontFamilies?.monospace,
          color: theme.colors.text,
          textAlign: 'right' as const,
        },
        walletInfoPillClockIcon: {
          width: 20,
          height: 20,
          tintColor: isLightTheme
            ? theme.colors.primary
            : theme.colors.bitcoinOrange,
        },
        walletInfoPillDateText: {
          flex: 1,
          minWidth: 0,
          fontSize: theme.fontSizes?.sm || 12,
          lineHeight: 18,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.text,
          textAlign: 'right' as const,
        },
        walletInfoKeyIconWrap: {
          width: 24,
          height: 24,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
        },
        walletInfoKeyIcon: {
          width: 20,
          height: 20,
          tintColor: isLightTheme
            ? theme.colors.primary
            : theme.colors.bitcoinOrange,
        },
        walletInfoKeyIndexBadge: {
          position: 'absolute' as const,
          right: -2,
          bottom: -2,
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          paddingHorizontal: 4,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          backgroundColor: isLightTheme
            ? theme.colors.secondary
            : theme.colors.accent,
          borderWidth: 1,
          borderColor: theme.colors.cardBackground,
        },
        walletInfoKeyIndexText: {
          fontSize: 10,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.white,
        },
        walletInfoModePhoneRow: {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          gap: 4,
        },
        walletInfoModePhoneIcon: {
          width: 20,
          height: 20,
        },
        walletInfoPhoneOnBrandBg: {
          width: 20,
          height: 20,
          tintColor: theme.colors.white,
        },
        walletInfoPhoneOnBrandBgMuted: {
          width: 20,
          height: 20,
          tintColor: theme.colors.whiteOverlay30,
        },
        walletInfoPillValueClickable: {
          flex: 1,
          minWidth: 0,
          fontSize: theme.fontSizes?.sm || 11,
          lineHeight: 18,
          textAlign: 'right' as const,
        },
        walletInfoPillKeyshareIdValue: {
          flex: 1,
          minWidth: 0,
          fontSize: theme.fontSizes?.sm || 11,
          lineHeight: 18,
          letterSpacing: 0.3,
          textAlign: 'right' as const,
          fontFamily: theme.fontFamilies?.monospaceBold,
          color: isLightTheme ? theme.colors.primary : theme.colors.text,
        },
      }),
    [isLightTheme, theme],
  );
  const walletPhoneOnBrandStyle = screenStyles.walletInfoPhoneOnBrandBg;
  const walletPhoneOnBrandMutedStyle =
    screenStyles.walletInfoPhoneOnBrandBgMuted;
  const fingerprintBandColors = React.useMemo(
    () => colorsFromWalletFingerprint(keyshareInfo?.fingerprint, isLightTheme),
    [keyshareInfo?.fingerprint, isLightTheme],
  );
  const devMonoStyle = React.useMemo(
    () => getFontStyle(theme, {family: 'monospace', weight: 'normal'}),
    [theme],
  );
  const fingerprintStarterBandStyle = React.useMemo(
    () => ({
      backgroundColor: fingerprintBandColors.bandBackgroundColor,
    }),
    [fingerprintBandColors.bandBackgroundColor],
  );

  // Helper function to format long strings: first 8 chars ... last 8 chars
  const formatLongString = (value: string): string => {
    if (!value || value.length <= 16) return value;
    return `${value.substring(0, 8)}...${value.substring(value.length - 8)}`;
  };
  const [isOutputDescriptorQrVisible, setIsOutputDescriptorQrVisible] =
    useState(false);
  const [selectedDescriptorType, setSelectedDescriptorType] = useState<
    'legacy' | 'segwitNative' | 'segwitCompatible' | null
  >(null);
  const [isNpubQrVisible, setIsNpubQrVisible] = useState(false);
  const [isExtensionBindScannerVisible, setIsExtensionBindScannerVisible] =
    useState(false);
  const [extensionResponseQrData, setExtensionResponseQrData] = useState<
    string | null
  >(null);
  const [isExtensionResponseQrVisible, setIsExtensionResponseQrVisible] =
    useState(false);
  const extensionBindHandledRef = useRef(false);
  const [isWalletInfoExpanded, setIsWalletInfoExpanded] = useState(true);
  const [isCapabilitiesExpanded, setIsCapabilitiesExpanded] = useState(false);
  const [isBoldExtensionExpanded, setIsBoldExtensionExpanded] = useState(false);
  const [isWatchWalletExpanded, setIsWatchWalletExpanded] = useState(false);
  const [devDebugEnabled, setDevDebugEnabled] = useState(false);
  const [isDevKeyshareExpanded, setIsDevKeyshareExpanded] = useState(false);
  const [devKeyshareView, setDevKeyshareView] = useState<'tree' | 'pretty'>(
    'tree',
  );
  const [devKeyshareData, setDevKeyshareData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [devKeyshareError, setDevKeyshareError] = useState<string | null>(null);
  const [devKeyshareLoading, setDevKeyshareLoading] = useState(false);
  const [devKeyshareAuthPending, setDevKeyshareAuthPending] = useState(false);

  // Animation refs for collapsible sections
  const walletInfoRotationAnim = useSharedValue(isWalletInfoExpanded ? 1 : 0);
  const capabilitiesRotationAnim = useSharedValue(
    isCapabilitiesExpanded ? 1 : 0,
  );
  const boldExtensionRotationAnim = useSharedValue(
    isBoldExtensionExpanded ? 1 : 0,
  );
  const watchWalletRotationAnim = useSharedValue(isWatchWalletExpanded ? 1 : 0);
  const devKeyshareRotationAnim = useSharedValue(isDevKeyshareExpanded ? 1 : 0);

  const loadDevKeyshareStructure = useCallback(async () => {
    setDevKeyshareLoading(true);
    try {
      const raw = await EncryptedStorage.getItem('keyshare');
      const parsed = parseKeyshareJsonForDevView(raw);
      if ('error' in parsed) {
        setDevKeyshareData(null);
        setDevKeyshareError(parsed.error);
      } else {
        setDevKeyshareData(parsed.data);
        setDevKeyshareError(null);
      }
    } catch (e) {
      dbg('loadDevKeyshareStructure:', e);
      setDevKeyshareData(null);
      setDevKeyshareError('Failed to load keyshare');
    } finally {
      setDevKeyshareLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      isDevDebugEnabled()
        .then(setDevDebugEnabled)
        .catch(() => setDevDebugEnabled(false));
    }, []),
  );

  useEffect(() => {
    if (!devDebugEnabled || !isDevKeyshareExpanded) {
      return;
    }
    loadDevKeyshareStructure();
  }, [
    devDebugEnabled,
    isDevKeyshareExpanded,
    keyshareInfo,
    loadDevKeyshareStructure,
  ]);

  // Sync animations with state
  useEffect(() => {
    walletInfoRotationAnim.value = withTiming(isWalletInfoExpanded ? 1 : 0, {
      duration: 200,
    });
  }, [isWalletInfoExpanded, walletInfoRotationAnim]);

  useEffect(() => {
    capabilitiesRotationAnim.value = withTiming(
      isCapabilitiesExpanded ? 1 : 0,
      {duration: 200},
    );
  }, [isCapabilitiesExpanded, capabilitiesRotationAnim]);

  useEffect(() => {
    boldExtensionRotationAnim.value = withTiming(
      isBoldExtensionExpanded ? 1 : 0,
      {duration: 200},
    );
  }, [isBoldExtensionExpanded, boldExtensionRotationAnim]);

  useEffect(() => {
    watchWalletRotationAnim.value = withTiming(isWatchWalletExpanded ? 1 : 0, {
      duration: 200,
    });
  }, [isWatchWalletExpanded, watchWalletRotationAnim]);

  useEffect(() => {
    devKeyshareRotationAnim.value = withTiming(isDevKeyshareExpanded ? 1 : 0, {
      duration: 200,
    });
  }, [isDevKeyshareExpanded, devKeyshareRotationAnim]);

  const handleToggleDevKeyshare = useCallback(async () => {
    if (devKeyshareAuthPending) {
      return;
    }
    if (isDevKeyshareExpanded) {
      setIsDevKeyshareExpanded(false);
      return;
    }
    setDevKeyshareAuthPending(true);
    try {
      const ok = await promptWalletBiometricAuth({
        ...WALLET_SENSITIVE_ACTION_AUTH.viewKeyshareStructure,
        showFailureAlert: true,
      });
      if (!ok) {
        return;
      }
      setIsDevKeyshareExpanded(true);
    } finally {
      setDevKeyshareAuthPending(false);
    }
  }, [devKeyshareAuthPending, isDevKeyshareExpanded]);

  const handleCopyDevKeyshareJson = useCallback(() => {
    if (!devKeyshareData) {
      return;
    }
    Alert.alert(
      'Copy full keyshare JSON?',
      'This includes secrets (MPC share, Nostr nsec). Only copy on a trusted device.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Copy',
          onPress: () => {
            Clipboard.setString(prettyPrintKeyshareJson(devKeyshareData));
            Toast.show({
              type: 'success',
              text1: 'Copied',
              text2: 'Full keyshare JSON copied to clipboard',
            });
          },
        },
      ],
    );
  }, [devKeyshareData]);

  const devKeyshareRotateStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${interpolate(
          devKeyshareRotationAnim.value,
          [0, 1],
          [0, 90],
        )}deg`,
      },
    ],
  }));

  const devKeyshareContentOpacityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(devKeyshareRotationAnim.value, [0, 1], [0.6, 1]),
  }));

  // Share text as file
  const shareTextAsFile = useCallback(
    async (text: string, filename: string, title: string) => {
      try {
        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${filename}`;
        await safeUnlink(filePath);
        await RNFS.writeFile(filePath, text, 'utf8');
        await Share.open({
          title: title,
          message: title,
          url: `file://${filePath}`,
          type: 'text/plain',
          filename: filename,
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
      const descriptor = keyshareInfo?.outputDescriptors?.[type] || '';
      if (!descriptor) return;
      Clipboard.setString(descriptor);
      const typeLabel =
        type === 'legacy'
          ? 'Legacy'
          : type === 'segwitNative'
          ? 'Native Segwit'
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
      const descriptor = keyshareInfo?.outputDescriptors?.[type] || '';
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
      const descriptor = keyshareInfo?.outputDescriptors?.[type] || '';
      if (!descriptor) return;
      setSelectedDescriptorType(type);
      setIsOutputDescriptorQrVisible(true);
    },
    [keyshareInfo],
  );
  const handleCopyNpub = useCallback(() => {
    if (!keyshareInfo?.npub) return;
    Clipboard.setString(keyshareInfo.npub);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Nostr public key copied to clipboard',
    });
  }, [keyshareInfo]);
  const handleShowNpubQR = useCallback(() => {
    setIsNpubQrVisible(true);
  }, []);

  const handleWalletIdPress = useCallback(() => {
    Toast.show({
      type: 'info',
      text1: 'Wallet ID Verification',
      text2: "All your wallet's keyshares share the same Wallet ID",
      visibilityTime: 3000,
    });
  }, []);

  const handleWalletTypePress = useCallback(() => {
    if (!keyshareInfo) return;
    const isTrio = keyshareInfo.type === 'trio';
    Toast.show({
      type: 'info',
      text1: isTrio ? 'Trio Wallet' : 'Duo Wallet',
      text2: isTrio
        ? 'Any 2 of the 3 devices/keyshares are needed for signing transactions'
        : 'Two different devices/keyshares are needed for signing transactions',
      visibilityTime: 4000,
    });
  }, [keyshareInfo]);

  const handleTssBackendPress = useCallback(() => {
    if (!keyshareInfo) return;
    const isDkls = keyshareInfo.tssBackend === 'dkls23';
    Toast.show({
      type: 'info',
      text1: isDkls ? 'DKLs23 (libtss)' : 'GG18 (BNB)',
      text2: isDkls
        ? 'Threshold signing uses the DKLs23 MPC stack via libtss'
        : 'Threshold signing uses the BNB GG18 MPC stack',
      visibilityTime: 4000,
    });
  }, [keyshareInfo]);

  const handleKeyshareIdPress = useCallback(() => {
    if (!keyshareInfo) return;
    const isTrio = keyshareInfo.type === 'trio';
    Toast.show({
      type: 'info',
      text1: 'Keyshare ID',
      text2: isTrio
        ? 'This is the unique identifier for one of the 3 keyshares in your wallet'
        : 'This is the unique identifier for one of the 2 keyshares in your wallet',
      visibilityTime: 4000,
    });
  }, [keyshareInfo]);

  const handleCreatedAtPress = useCallback(() => {
    const literal = formatKeyshareCreatedAtLong(keyshareInfo?.createdAt);
    const explanation =
      'The wallet was initially set up on';
    Toast.show({
      type: 'info',
      text1: 'Wallet Setup Date',
      text2: literal ? `${explanation} ${literal}` : explanation,
      visibilityTime: 6000,
    });
  }, [keyshareInfo?.createdAt]);

  const handleLanHotspotPress = useCallback(() => {
    Toast.show({
      type: 'info',
      text1: 'LAN / Hotspot Support',
      text2:
        'LAN/Hotspot connectivity is always supported by default for all wallets',
      visibilityTime: 3000,
    });
  }, []);

  const handleNostrPress = useCallback(() => {
    if (!keyshareInfo) return;
    Toast.show({
      type: 'info',
      text1: 'Nostr Support',
      text2: keyshareInfo.supportsNostr
        ? 'Nostr is supported because your wallet was set up using Nostr'
        : 'Nostr is only supported if the wallet setup was done using Nostr',
      visibilityTime: 4000,
    });
  }, [keyshareInfo]);

  const handleBindExtensionPress = useCallback(() => {
    setIsExtensionBindScannerVisible(true);
  }, []);

  const handleExtensionPairingCodeScanned = useCallback(
    async (rawData: string) => {
      if (extensionBindHandledRef.current) return;
      const pairingCode = parsePairingCodeFromScannedData(rawData);
      if (!pairingCode) {
        Alert.alert(
          'Invalid QR',
          'This QR code does not contain a pairing_code. Please scan the QR shown by the Bold extension.',
        );
        return;
      }
      const pubKey = keyshareInfo?.pubKey;
      const chainCode = keyshareInfo?.chainCode;
      if (!pubKey || !chainCode) {
        Alert.alert('Error', 'Keyshare info is not available.');
        setIsExtensionBindScannerVisible(false);
        return;
      }
      extensionBindHandledRef.current = true;
      setIsExtensionBindScannerVisible(false);
      try {
        let qrData = '';
        try {
          qrData = await computeExtensionPairingPayloadQr({
            pairingCode,
            pubKey,
            chainCode,
            keyshareMeta: {
              created_at: keyshareInfo?.createdAt,
              keygen_committee_keys:
                keyshareInfo?.type === 'trio'
                  ? [1, 2, 3]
                  : [1, 2],
              nostr_npub: keyshareInfo?.npub || undefined,
            },
            activeNetwork: network,
          });
        } catch (payloadErr) {
          dbg('Standard pairing payload generation failed, using legacy bind response:', payloadErr);
          qrData = await computeExtensionBindResponseQr(
            pairingCode,
            pubKey,
            chainCode,
          );
        }
        setExtensionResponseQrData(qrData);
        setIsExtensionResponseQrVisible(true);
      } catch (e) {
        dbg('Extension bind qrData computation failed:', e);
        extensionBindHandledRef.current = false;
        Alert.alert('Error', 'Failed to generate response QR.');
      }
    },
    [
      keyshareInfo?.pubKey,
      keyshareInfo?.chainCode,
      keyshareInfo?.createdAt,
      keyshareInfo?.type,
      network,
    ],
  );

  const handleToggleWalletInfo = useCallback(() => {
    const newValue = !isWalletInfoExpanded;
    setIsWalletInfoExpanded(newValue);
    // Close other sections if opening this one
    if (newValue) {
      setIsCapabilitiesExpanded(false);
      setIsBoldExtensionExpanded(false);
      setIsWatchWalletExpanded(false);
    }
  }, [isWalletInfoExpanded]);

  const handleToggleCapabilities = useCallback(() => {
    const newValue = !isCapabilitiesExpanded;
    setIsCapabilitiesExpanded(newValue);
    // Close other sections if opening this one
    if (newValue) {
      setIsWalletInfoExpanded(false);
      setIsBoldExtensionExpanded(false);
      setIsWatchWalletExpanded(false);
    }
  }, [isCapabilitiesExpanded]);

  const handleToggleBoldExtension = useCallback(() => {
    const newValue = !isBoldExtensionExpanded;
    setIsBoldExtensionExpanded(newValue);
    // Close other sections if opening this one
    if (newValue) {
      setIsWalletInfoExpanded(false);
      setIsCapabilitiesExpanded(false);
      setIsWatchWalletExpanded(false);
    }
  }, [isBoldExtensionExpanded]);

  const handleToggleWatchWallet = useCallback(() => {
    const newValue = !isWatchWalletExpanded;
    setIsWatchWalletExpanded(newValue);
    // Close other sections if opening this one
    if (newValue) {
      setIsWalletInfoExpanded(false);
      setIsCapabilitiesExpanded(false);
      setIsBoldExtensionExpanded(false);
    }
  }, [isWatchWalletExpanded]);

  // Animated styles for rotation
  const walletInfoRotateStyle = useAnimatedStyle(() => {
    const rotation = interpolate(walletInfoRotationAnim.value, [0, 1], [0, 90]);
    return {
      transform: [{rotate: `${rotation}deg`}],
    };
  });

  const capabilitiesRotateStyle = useAnimatedStyle(() => {
    const rotation = interpolate(
      capabilitiesRotationAnim.value,
      [0, 1],
      [0, 90],
    );
    return {
      transform: [{rotate: `${rotation}deg`}],
    };
  });

  const boldExtensionRotateStyle = useAnimatedStyle(() => {
    const rotation = interpolate(
      boldExtensionRotationAnim.value,
      [0, 1],
      [0, 90],
    );
    return {
      transform: [{rotate: `${rotation}deg`}],
    };
  });

  const watchWalletRotateStyle = useAnimatedStyle(() => {
    const rotation = interpolate(
      watchWalletRotationAnim.value,
      [0, 1],
      [0, 90],
    );
    return {
      transform: [{rotate: `${rotation}deg`}],
    };
  });

  // Animated values for content opacity
  const walletInfoContentAnim = useSharedValue(isWalletInfoExpanded ? 1 : 0);
  const capabilitiesContentAnim = useSharedValue(
    isCapabilitiesExpanded ? 1 : 0,
  );
  const boldExtensionContentAnim = useSharedValue(
    isBoldExtensionExpanded ? 1 : 0,
  );
  const watchWalletContentAnim = useSharedValue(isWatchWalletExpanded ? 1 : 0);

  // Sync content animations with state
  useEffect(() => {
    walletInfoContentAnim.value = withTiming(isWalletInfoExpanded ? 1 : 0, {
      duration: 200,
    });
  }, [isWalletInfoExpanded, walletInfoContentAnim]);

  useEffect(() => {
    capabilitiesContentAnim.value = withTiming(isCapabilitiesExpanded ? 1 : 0, {
      duration: 200,
    });
  }, [isCapabilitiesExpanded, capabilitiesContentAnim]);

  useEffect(() => {
    boldExtensionContentAnim.value = withTiming(
      isBoldExtensionExpanded ? 1 : 0,
      {duration: 200},
    );
  }, [isBoldExtensionExpanded, boldExtensionContentAnim]);

  useEffect(() => {
    watchWalletContentAnim.value = withTiming(isWatchWalletExpanded ? 1 : 0, {
      duration: 200,
    });
  }, [isWatchWalletExpanded, watchWalletContentAnim]);

  // Animated styles for content opacity
  const walletInfoContentOpacityStyle = useAnimatedStyle(() => ({
    opacity: walletInfoContentAnim.value,
  }));

  const capabilitiesContentOpacityStyle = useAnimatedStyle(() => ({
    opacity: capabilitiesContentAnim.value,
  }));

  const boldExtensionContentOpacityStyle = useAnimatedStyle(() => ({
    opacity: boldExtensionContentAnim.value,
  }));

  const watchWalletContentOpacityStyle = useAnimatedStyle(() => ({
    opacity: watchWalletContentAnim.value,
  }));

  return (
    <SafeAreaView
      style={screenStyles.safeArea}
      edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={screenStyles.scrollView}
        contentContainerStyle={screenStyles.scrollContent}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
        scrollEnabled={true}
        bounces={false}
        scrollEventThrottle={16}
        directionalLockEnabled={true}
        alwaysBounceVertical={false}>
        {keyshareInfo ? (
          <>
            {/* Wallet Information Container */}
            <View style={styles.keyshareInfoCard}>
              <AppPressable
                style={styles.collapsibleHeader}
                onPress={handleToggleWalletInfo}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.collapsibleHeaderContent}>
                  <Image
                    source={require('../assets/info-icon.png')}
                    style={styles.collapsibleHeaderIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.collapsibleHeaderTitle}>
                    Wallet Information
                  </Text>
                </View>
                <Animated.Text
                  style={[
                    styles.collapsibleChevron,
                    walletInfoRotateStyle,
                    {
                      color: theme.colors.text,
                    },
                  ]}>
                  ▶
                </Animated.Text>
              </AppPressable>
              {isWalletInfoExpanded && (
                <Animated.View
                  style={[
                    styles.collapsibleContent,
                    walletInfoContentOpacityStyle,
                  ]}>
                  <View style={styles.walletInfoContent}>
                    <View
                      style={[
                        styles.walletInfoRow,
                        screenStyles.walletInfoRowUniform,
                      ]}>
                      <Text style={styles.keyshareDetailLabel}>
                        Fingerprint
                      </Text>
                      <AppPressable
                        onPress={handleWalletIdPress}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        style={[
                          screenStyles.walletInfoPill,
                          screenStyles.walletInfoPillSurface,
                          screenStyles.walletInfoPillFingerprint,
                        ]}>
                        <View
                          style={[
                            screenStyles.walletInfoPillFingerprintStarter,
                            fingerprintStarterBandStyle,
                          ]}>
                          <Image
                            source={FINGERPRINT_ICON}
                            style={[
                              screenStyles.walletInfoPillFingerprintIcon,
                              {tintColor: fingerprintBandColors.iconTint},
                            ]}
                            resizeMode="contain"
                          />
                        </View>
                        <Text
                          style={screenStyles.walletInfoPillFingerprintText}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          adjustsFontSizeToFit={true}
                          minimumFontScale={0.5}>
                          {(keyshareInfo.fingerprint || 'N/A').toUpperCase()}
                        </Text>
                      </AppPressable>
                    </View>
                    <View
                      style={[
                        styles.walletInfoRow,
                        screenStyles.walletInfoRowUniform,
                      ]}>
                      <Text style={styles.keyshareDetailLabel}>Keyshares</Text>
                      <AppPressable
                        onPress={handleWalletTypePress}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        style={[
                          screenStyles.walletInfoPill,
                          keyshareInfo.type === 'trio'
                            ? screenStyles.walletInfoPillTrio
                            : screenStyles.walletInfoPillDuo,
                        ]}>
                        <View style={screenStyles.walletInfoPillLeading}>
                          <WalletModePhoneIcons
                            type={keyshareInfo.type}
                            rowStyle={screenStyles.walletInfoModePhoneRow}
                            phoneIconStyle={walletPhoneOnBrandStyle}
                            phoneIconMutedStyle={walletPhoneOnBrandMutedStyle}
                          />
                        </View>
                        <Text
                          style={screenStyles.walletInfoPillValueBrand}
                          adjustsFontSizeToFit={true}
                          minimumFontScale={0.5}
                          numberOfLines={1}>
                          {keyshareInfo.type === 'trio'
                            ? 'Trio • 3 devices'
                            : 'Duo • 2 devices'}
                        </Text>
                      </AppPressable>
                    </View>
                    {keyshareInfo.tssBackendLabel ? (
                      <View
                        style={[
                          styles.walletInfoRow,
                          screenStyles.walletInfoRowUniform,
                        ]}>
                        <Text style={styles.keyshareDetailLabel}>
                          Wallet type
                        </Text>
                        <AppPressable
                          onPress={handleTssBackendPress}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                          style={[
                            screenStyles.walletInfoPill,
                            keyshareInfo.tssBackend === 'dkls23'
                              ? screenStyles.walletInfoPillDkls
                              : screenStyles.walletInfoPillGg18,
                          ]}>
                          <View style={screenStyles.walletInfoPillLeading}>
                            <Image
                              source={tssBackendLogoFor(
                                keyshareInfo.tssBackend,
                                keyshareInfo.tssBackendLabel,
                              )}
                              style={screenStyles.tssBackendBadgeIcon}
                              resizeMode="contain"
                            />
                          </View>
                          <Text
                            style={screenStyles.walletInfoPillValueBrand}
                            numberOfLines={1}
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.5}>
                            {keyshareInfo.tssBackendLabel}
                          </Text>
                        </AppPressable>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.walletInfoRow,
                        screenStyles.walletInfoRowUniform,
                      ]}>
                      <Text style={styles.keyshareDetailLabel}>
                        Keyshare ID
                      </Text>
                      <AppPressable
                        onPress={handleKeyshareIdPress}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        style={[
                          screenStyles.walletInfoPill,
                          screenStyles.walletInfoPillSurface,
                        ]}>
                        <View style={screenStyles.walletInfoPillLeading}>
                          <View style={screenStyles.walletInfoKeyIconWrap}>
                            <Image
                              source={KEY_ICON}
                              style={screenStyles.walletInfoKeyIcon}
                              resizeMode="contain"
                            />
                            {keyshareIndexFromLabel(keyshareInfo.label) !=
                            null ? (
                              <View
                                style={screenStyles.walletInfoKeyIndexBadge}>
                                <Text
                                  style={screenStyles.walletInfoKeyIndexText}>
                                  {keyshareIndexFromLabel(keyshareInfo.label)}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        <Text
                          style={screenStyles.walletInfoPillKeyshareIdValue}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          adjustsFontSizeToFit={true}
                          minimumFontScale={0.5}>
                          {keyshareInfo.label}
                        </Text>
                      </AppPressable>
                    </View>
                    {formatKeyshareCreatedAt(keyshareInfo.createdAt) !=
                      null && (
                      <View
                        style={[
                          styles.walletInfoRow,
                          screenStyles.walletInfoRowUniform,
                        ]}>
                        <Text style={styles.keyshareDetailLabel}>
                          Created At
                        </Text>
                        <AppPressable
                          onPress={handleCreatedAtPress}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                          style={[
                            screenStyles.walletInfoPill,
                            screenStyles.walletInfoPillSurface,
                          ]}>
                          <View style={screenStyles.walletInfoPillLeading}>
                            <Image
                              source={CLOCK_ICON}
                              style={screenStyles.walletInfoPillClockIcon}
                              resizeMode="contain"
                            />
                          </View>
                          <Text
                            style={screenStyles.walletInfoPillDateText}
                            numberOfLines={1}
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.5}>
                            {formatKeyshareCreatedAt(keyshareInfo.createdAt)}
                          </Text>
                        </AppPressable>
                      </View>
                    )}
                  </View>
                </Animated.View>
              )}
            </View>
            {/* Capabilities / connectivity summary */}
            <View style={styles.keyshareInfoCard}>
              <AppPressable
                style={styles.collapsibleHeader}
                onPress={handleToggleCapabilities}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.collapsibleHeaderContent}>
                  <Image
                    source={require('../assets/capability-icon.png')}
                    style={styles.collapsibleHeaderIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.collapsibleHeaderTitle}>
                    Capabilities
                  </Text>
                </View>
                <Animated.Text
                  style={[
                    styles.collapsibleChevron,
                    capabilitiesRotateStyle,
                    {
                      color: theme.colors.text,
                    },
                  ]}>
                  ▶
                </Animated.Text>
              </AppPressable>
              {isCapabilitiesExpanded && (
                <Animated.View
                  style={[
                    styles.collapsibleContent,
                    capabilitiesContentOpacityStyle,
                  ]}>
                  <View style={styles.keyshareDetailRow}>
                    <Text style={styles.keyshareDetailLabel}>
                      LAN / Hotspot
                    </Text>
                    <AppPressable
                      onPress={handleLanHotspotPress}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <View
                        style={[
                          styles.keyshareStatusBadge,
                          styles.keyshareStatusBadgeSuccess,
                        ]}>
                        <Text
                          style={[
                            styles.keyshareStatusBadgeText,
                            styles.keyshareStatusBadgeTextSuccess,
                          ]}>
                          ✓ Supported
                        </Text>
                      </View>
                    </AppPressable>
                  </View>
                  <View
                    style={[
                      styles.keyshareDetailRow,
                      !(keyshareInfo.supportsNostr && keyshareInfo.npub) &&
                        styles.keyshareDetailRowLast,
                    ]}>
                    <Text style={styles.keyshareDetailLabel}>Nostr</Text>
                    <AppPressable
                      onPress={handleNostrPress}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <View
                        style={[
                          styles.keyshareStatusBadge,
                          keyshareInfo.supportsNostr
                            ? styles.keyshareStatusBadgeSuccess
                            : styles.keyshareStatusBadgeDisabled,
                        ]}>
                        <Text
                          style={[
                            styles.keyshareStatusBadgeText,
                            keyshareInfo.supportsNostr
                              ? styles.keyshareStatusBadgeTextSuccess
                              : styles.keyshareStatusBadgeTextDisabled,
                          ]}>
                          {keyshareInfo.supportsNostr
                            ? '✓ Supported'
                            : 'Not enabled'}
                        </Text>
                      </View>
                    </AppPressable>
                  </View>
                  {keyshareInfo.supportsNostr && keyshareInfo.npub && (
                    <View
                      style={[
                        styles.keyshareKeyItem,
                        styles.keyshareKeyItemLast,
                      ]}>
                      <Text style={styles.keyshareKeyLabel}>NPub</Text>
                      <View style={styles.keyshareKeyContainer}>
                        <AppPressable
                          onPress={handleCopyNpub}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                          style={styles.keyshareKeyContainerBadge}>
                          <Image
                            source={require('../assets/copy-icon.png')}
                            style={styles.keyshareBadgeCopyIcon}
                          />
                          <Text
                            style={styles.keyshareKeyTextClickable}
                            numberOfLines={1}
                            ellipsizeMode="middle">
                            {formatLongString(keyshareInfo.npub)}
                          </Text>
                        </AppPressable>
                        <View style={styles.keyshareButtonsRow}>
                          <AppPressable
                            onPress={handleShowNpubQR}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/qr-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </AppPressable>
                        </View>
                      </View>
                    </View>
                  )}
                </Animated.View>
              )}
            </View>
            {/* Bold Extension Section */}
            <View style={styles.watchWalletHeader}>
              <AppPressable
                style={styles.collapsibleHeader}
                onPress={handleToggleBoldExtension}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.collapsibleHeaderContent}>
                  <Image
                    source={require('../assets/extension-icon.png')}
                    style={styles.collapsibleHeaderIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.watchWalletTitle}>
                    Bold Web • Extension
                  </Text>
                </View>
                <Animated.Text
                  style={[
                    styles.collapsibleChevron,
                    boldExtensionRotateStyle,
                    {
                      color: theme.colors.text,
                    },
                  ]}>
                  ▶
                </Animated.Text>
              </AppPressable>
              {isBoldExtensionExpanded && (
                <Animated.View
                  style={[
                    styles.collapsibleContent,
                    boldExtensionContentOpacityStyle,
                  ]}>
                  <Text style={styles.watchWalletDescription}>
                    This is a pubkey that should never be shared with anyone for
                    privacy. It is only used to bind Bold Bitcoin Browser
                    extension.
                  </Text>
                  <Text style={styles.watchWalletWarning}>
                    ⚠️ This does NOT hold any private keyshare data.
                  </Text>
                  <AppPressable
                    onPress={() =>
                      Linking.openURL(
                        'https://chromewebstore.google.com/detail/bold-wallet/dpgigdojkmhknnoedgbkfdeilmlbdecf',
                      )
                    }
                    style={[
                      styles.watchWalletItem,
                      screenStyles.extensionLinkItem,
                    ]}>
                    <AppText
                      variant="body"
                      style={[
                        screenStyles.walletInfoHintLink,
                        screenStyles.walletInfoHintLinkColor,
                        screenStyles.extensionLinkText,
                      ]}>
                      Get Bold Wallet for Chrome →
                    </AppText>
                  </AppPressable>
                  {/* Bind Extension: scan extension QR then show response QR */}
                  {keyshareInfo?.pubKey && keyshareInfo?.chainCode && (
                    <View style={[styles.watchWalletItem]}>
                      <Text
                        style={[
                          styles.watchWalletDescription,
                          screenStyles.bindExtensionDescription,
                        ]}>
                        1. Scan the extension&apos;s QR with the mobile
                        {'\n'}
                        2. Scan back confirmation QR with the extension
                      </Text>
                      <AppPressable
                        onPress={handleBindExtensionPress}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        style={[
                          styles.keyshareCopyButton,
                          screenStyles.bindExtensionButton,
                        ]}>
                        <Image
                          source={require('../assets/scan-icon.png')}
                          style={styles.keyshareCopyIcon}
                        />
                        <Text
                          style={[
                            styles.keyshareCopyButtonText,
                            screenStyles.bindExtensionButtonText,
                          ]}>
                          Bind Extension
                        </Text>
                      </AppPressable>
                    </View>
                  )}
                </Animated.View>
              )}
            </View>
            {/* Watch Wallet Header Section */}
            <View style={styles.watchWalletHeader}>
              <AppPressable
                style={styles.collapsibleHeader}
                onPress={handleToggleWatchWallet}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.collapsibleHeaderContent}>
                  <Image
                    source={require('../assets/descriptor-icon.png')}
                    style={styles.collapsibleHeaderIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.watchWalletTitle}>
                    Watch-Wallet • Export
                  </Text>
                </View>
                <Animated.Text
                  style={[
                    styles.collapsibleChevron,
                    watchWalletRotateStyle,
                    {
                      color: theme.colors.text,
                    },
                  ]}>
                  ▶
                </Animated.Text>
              </AppPressable>
              {isWatchWalletExpanded && (
                <Animated.View
                  style={[
                    styles.collapsibleContent,
                    watchWalletContentOpacityStyle,
                  ]}>
                  <Text style={styles.watchWalletDescription}>
                    Import the output descriptor into Sparrow or another
                    PSBT-capable wallet to create a watch-only wallet.
                  </Text>
                  <Text style={styles.watchWalletWarning}>
                    ⚠️ Note: Taproot is not supported. Only Legacy, SegWit
                    Native, and Nested SegWit address types are supported.
                  </Text>
                  <View>
                    {/* Output Descriptors - One row per address type */}
                    {keyshareInfo.outputDescriptors?.legacy && (
                      <View
                        style={[
                          styles.watchWalletItem,
                          !keyshareInfo.outputDescriptors?.segwitNative &&
                            !keyshareInfo.outputDescriptors?.segwitCompatible &&
                            styles.watchWalletItemLast,
                        ]}>
                        <Text style={styles.watchWalletItemLabel}>
                          Output Descriptor (Legacy)
                        </Text>
                        <View style={styles.watchWalletItemValueContainer}>
                          <AppPressable
                            onPress={() => handleCopyOutputDescriptor('legacy')}
                            android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                            style={styles.keyshareKeyContainerBadge}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.keyshareBadgeCopyIcon}
                            />
                            <Text
                              style={styles.keyshareKeyTextClickable}
                              numberOfLines={1}>
                              {formatLongString(
                                keyshareInfo.outputDescriptors.legacy || 'N/A',
                              )}
                            </Text>
                          </AppPressable>
                          <View style={styles.keyshareButtonsRow}>
                            <AppPressable
                              onPress={() =>
                                handleShareOutputDescriptor('legacy')
                              }
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/share-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </AppPressable>
                            <AppPressable
                              onPress={() =>
                                handleShowOutputDescriptorQR('legacy')
                              }
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/qr-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </AppPressable>
                          </View>
                        </View>
                      </View>
                    )}
                    {keyshareInfo.outputDescriptors?.segwitNative && (
                      <View
                        style={[
                          styles.watchWalletItem,
                          !keyshareInfo.outputDescriptors?.segwitCompatible &&
                            styles.watchWalletItemLast,
                        ]}>
                        <Text style={styles.watchWalletItemLabel}>
                          Output Descriptor (Native Segwit)
                        </Text>
                        <View style={styles.watchWalletItemValueContainer}>
                          <AppPressable
                            onPress={() =>
                              handleCopyOutputDescriptor('segwitNative')
                            }
                            android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                            style={styles.keyshareKeyContainerBadge}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.keyshareBadgeCopyIcon}
                            />
                            <Text
                              style={styles.keyshareKeyTextClickable}
                              numberOfLines={1}>
                              {formatLongString(
                                keyshareInfo.outputDescriptors.segwitNative ||
                                  'N/A',
                              )}
                            </Text>
                          </AppPressable>
                          <View style={styles.keyshareButtonsRow}>
                            <AppPressable
                              onPress={() =>
                                handleShareOutputDescriptor('segwitNative')
                              }
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/share-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </AppPressable>
                            <AppPressable
                              onPress={() =>
                                handleShowOutputDescriptorQR('segwitNative')
                              }
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/qr-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </AppPressable>
                          </View>
                        </View>
                      </View>
                    )}
                    {keyshareInfo.outputDescriptors?.segwitCompatible && (
                      <View style={styles.watchWalletItem}>
                        <Text style={styles.watchWalletItemLabel}>
                          Output Descriptor (Nested SegWit)
                        </Text>
                        <View style={styles.watchWalletItemValueContainer}>
                          <AppPressable
                            onPress={() =>
                              handleCopyOutputDescriptor('segwitCompatible')
                            }
                            android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                            style={styles.keyshareKeyContainerBadge}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.keyshareBadgeCopyIcon}
                            />
                            <Text
                              style={styles.keyshareKeyTextClickable}
                              numberOfLines={1}>
                              {formatLongString(
                                keyshareInfo.outputDescriptors
                                  .segwitCompatible || 'N/A',
                              )}
                            </Text>
                          </AppPressable>
                          <View style={styles.keyshareButtonsRow}>
                            <AppPressable
                              onPress={() =>
                                handleShareOutputDescriptor('segwitCompatible')
                              }
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/share-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </AppPressable>
                            <AppPressable
                              onPress={() =>
                                handleShowOutputDescriptorQR('segwitCompatible')
                              }
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/qr-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </AppPressable>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                </Animated.View>
              )}
            </View>
            {devDebugEnabled ? (
              <View style={styles.keyshareInfoCard}>
                <AppPressable
                  style={styles.collapsibleHeader}
                  onPress={handleToggleDevKeyshare}
                  disabled={devKeyshareAuthPending}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                  accessibilityLabel="Keyshare structure developer view"
                  accessibilityHint={
                    isDevKeyshareExpanded
                      ? 'Double tap to collapse'
                      : 'Double tap to authenticate and expand keyshare JSON'
                  }>
                  <View style={styles.collapsibleHeaderContent}>
                    <Image
                      source={require('../assets/json-icon.png')}
                      style={styles.collapsibleHeaderIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.collapsibleHeaderTitle}>
                      Keyshare structure
                    </Text>
                  </View>
                  {devKeyshareAuthPending ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.text}
                      style={styles.collapsibleChevronSpinner}
                    />
                  ) : (
                    <Animated.Text
                      style={[
                        styles.collapsibleChevron,
                        devKeyshareRotateStyle,
                        {color: theme.colors.text},
                      ]}>
                      ▶
                    </Animated.Text>
                  )}
                </AppPressable>
                {isDevKeyshareExpanded ? (
                  <Animated.View
                    style={[
                      styles.collapsibleContent,
                      devKeyshareContentOpacityStyle,
                    ]}>
                    <Text style={screenStyles.devKeyshareWarning}>
                      Developer mode only. Contains sensitive secrets — make
                      sure you know what you are doing!
                    </Text>
                    <View style={screenStyles.devKeyshareActions}>
                      <AppPressable
                        style={screenStyles.devKeyshareActionChip}
                        onPress={() => setDevKeyshareView('tree')}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Text
                          style={
                            devKeyshareView === 'tree'
                              ? screenStyles.devKeyshareActionTextActive
                              : screenStyles.devKeyshareActionText
                          }>
                          Tree
                        </Text>
                      </AppPressable>
                      <AppPressable
                        style={screenStyles.devKeyshareActionChip}
                        onPress={() => setDevKeyshareView('pretty')}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Text
                          style={
                            devKeyshareView === 'pretty'
                              ? screenStyles.devKeyshareActionTextActive
                              : screenStyles.devKeyshareActionText
                          }>
                          Pretty JSON
                        </Text>
                      </AppPressable>
                      {devKeyshareData ? (
                        <AppPressable
                          style={screenStyles.devKeyshareActionChip}
                          onPress={handleCopyDevKeyshareJson}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                          <Text style={screenStyles.devKeyshareActionText}>
                            Copy JSON
                          </Text>
                        </AppPressable>
                      ) : null}
                    </View>
                    {devKeyshareLoading ? (
                      <Text style={styles.modalTextCompact}>Loading…</Text>
                    ) : devKeyshareError ? (
                      <Text style={screenStyles.devKeyshareError}>
                        {devKeyshareError}
                      </Text>
                    ) : devKeyshareData ? (
                      devKeyshareView === 'tree' ? (
                        <ScrollView
                          style={screenStyles.devKeyshareTreeBox}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator>
                          <KeyshareJsonTree data={devKeyshareData} />
                        </ScrollView>
                      ) : (
                        <ScrollView
                          style={[
                            screenStyles.devKeyshareTreeBox,
                            screenStyles.devKeysharePrettyScroll,
                          ]}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator>
                          <Text
                            style={[
                              screenStyles.devKeysharePrettyText,
                              devMonoStyle,
                            ]}
                            selectable>
                            {prettyPrintKeyshareJson(devKeyshareData)}
                          </Text>
                        </ScrollView>
                      )
                    ) : (
                      <Text style={styles.modalTextCompact}>
                        No keyshare loaded
                      </Text>
                    )}
                  </Animated.View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.keyshareLoadingContainer}>
            <Text style={styles.modalTextCompact}>
              Loading keyshare information...
            </Text>
          </View>
        )}
      </ScrollView>
      {/* QR Code Modal for Output Descriptors */}
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
            ? 'Native Segwit'
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
      {/* QR Code Modal for NPub */}
      <QRCodeModal
        visible={isNpubQrVisible}
        onClose={() => {
          setIsNpubQrVisible(false);
        }}
        title="Nostr • Public Key (NPub)"
        value={keyshareInfo?.npub || ''}
        network={network as 'mainnet' | 'testnet'}
        showShareButton={true}
        topRightClose={true}
        nonDismissible={false}
      />
      {/* Scanner: extension pairing_code QR (data: pairing_code=...) */}
      <QRScanner
        visible={isExtensionBindScannerVisible}
        onClose={() => setIsExtensionBindScannerVisible(false)}
        onScan={handleExtensionPairingCodeScanned}
        title="Scan extension pairing QR"
        subtitle="Point camera at the QR shown by the Bold extension"
      />
      {/* Response QR for extension to scan after mobile scanned pairing_code */}
      <QRCodeModal
        visible={isExtensionResponseQrVisible}
        onClose={() => {
          setIsExtensionResponseQrVisible(false);
          setExtensionResponseQrData(null);
          extensionBindHandledRef.current = false;
        }}
        title="Bold Extension • Scan this QR"
        value={extensionResponseQrData || ''}
        network={network as 'mainnet' | 'testnet'}
        showShareButton={false}
        topRightClose={true}
        nonDismissible={false}
        qrSize={320}
        contentMaxWidth={400}
        qrContentStyle={screenStyles.extensionResponseQrPadding}
      />
    </SafeAreaView>
  );
};
export default KeyshareInfoContent;
