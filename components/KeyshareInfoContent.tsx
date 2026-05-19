import React, {useCallback, useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  Alert,
  StyleSheet,
  Linking,
} from 'react-native';
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
import Toast from 'react-native-toast-message';
import {dbg, formatKeyshareCreatedAt} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import QRCodeModal from './QRCodeModal';
import QRScanner from './QRScanner';
import {
  parsePairingCodeFromScannedData,
  computeExtensionBindResponseQr,
} from '../utils/extensionBind';
import type {TssBackend} from '../services/tssBackend';
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
  /** When provided, "Go to Wallet Settings > Security" becomes clickable and opens Settings with this section expanded (e.g. 'backup' for Security). */
  onOpenSettingsSection?: (section: string) => void;
}
const KeyshareInfoContent: React.FC<KeyshareInfoContentProps> = ({
  keyshareInfo,
  network,
  onOpenSettingsSection,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
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
        bindExtensionDescription: {marginTop: 4, marginBottom: 8},
        bindExtensionButton: {
          flexDirection: 'row' as const,
          justifyContent: 'center' as const,
        },
        bindExtensionButtonText: {marginLeft: 8},
        extensionResponseQrPadding: {padding: 16},
        extensionLinkItem: {marginBottom: 8},
        extensionLinkText: {marginBottom: 0},
      }),
    [theme.colors.background],
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

  // Animation refs for collapsible sections
  const walletInfoRotationAnim = useSharedValue(isWalletInfoExpanded ? 1 : 0);
  const capabilitiesRotationAnim = useSharedValue(
    isCapabilitiesExpanded ? 1 : 0,
  );
  const boldExtensionRotationAnim = useSharedValue(
    isBoldExtensionExpanded ? 1 : 0,
  );
  const watchWalletRotationAnim = useSharedValue(isWatchWalletExpanded ? 1 : 0);

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

  // Share text as file
  const shareTextAsFile = useCallback(
    async (text: string, filename: string, title: string) => {
      try {
        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${filename}`;
        const fileExists = await RNFS.exists(filePath);
        if (fileExists) {
          await RNFS.unlink(filePath);
        }
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
        try {
          await RNFS.unlink(filePath);
        } catch {}
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
    Toast.show({
      type: 'info',
      text1: 'Wallet Creation Date',
      text2: 'This is when your wallet was initially set up and created',
      visibilityTime: 3000,
    });
  }, []);

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
        const qrData = await computeExtensionBindResponseQr(
          pairingCode,
          pubKey,
          chainCode,
        );
        setExtensionResponseQrData(qrData);
        setIsExtensionResponseQrVisible(true);
      } catch (e) {
        dbg('Extension bind qrData computation failed:', e);
        extensionBindHandledRef.current = false;
        Alert.alert('Error', 'Failed to generate response QR.');
      }
    },
    [keyshareInfo?.pubKey, keyshareInfo?.chainCode],
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
                    <View style={styles.walletInfoRow}>
                      <Text style={styles.keyshareDetailLabel}>
                        Fingerprint
                      </Text>
                      <AppPressable
                        onPress={handleWalletIdPress}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        style={styles.keyshareKeyContainerBadge}>
                        <Text
                          style={styles.keyshareKeyTextClickable}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          adjustsFontSizeToFit={true}
                          minimumFontScale={0.5}>
                          {(keyshareInfo.fingerprint || 'N/A').toUpperCase()}
                        </Text>
                      </AppPressable>
                    </View>
                    <View style={styles.walletInfoRow}>
                      <Text style={styles.keyshareDetailLabel}>Keyshares</Text>
                      <AppPressable
                        onPress={handleWalletTypePress}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        style={[
                          styles.keyshareKeyContainerBadge,
                          keyshareInfo.type === 'trio'
                            ? styles.keyshareBadgeTrio
                            : styles.keyshareBadgeDuo,
                        ]}>
                        <Text
                          style={styles.keyshareBadgeText}
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
                      <View style={styles.walletInfoRow}>
                        <Text style={styles.keyshareDetailLabel}>
                          Wallet type
                        </Text>
                        <AppPressable
                          onPress={handleTssBackendPress}
                          android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                          style={[
                            styles.keyshareKeyContainerBadge,
                            keyshareInfo.tssBackend === 'dkls23'
                              ? styles.keyshareBadgeDkls
                              : styles.keyshareBadgeGg18,
                          ]}>
                          <Text
                            style={styles.keyshareBadgeText}
                            numberOfLines={1}
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.5}>
                            {keyshareInfo.tssBackendLabel}
                          </Text>
                        </AppPressable>
                      </View>
                    ) : null}
                    <View style={styles.walletInfoRow}>
                      <Text style={styles.keyshareDetailLabel}>
                        Keyshare ID
                      </Text>
                      <AppPressable
                        onPress={handleKeyshareIdPress}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                        style={styles.keyshareKeyContainerBadge}>
                        <Text
                          style={styles.keyshareKeyTextClickable}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          adjustsFontSizeToFit={true}
                          minimumFontScale={0.5}>
                          {keyshareInfo.label}
                        </Text>
                      </AppPressable>
                    </View>
                    {formatKeyshareCreatedAt(keyshareInfo.createdAt) != null && (
                        <View style={styles.walletInfoRow}>
                          <Text style={styles.keyshareDetailLabel}>
                            Created At
                          </Text>
                          <AppPressable
                            onPress={handleCreatedAtPress}
                            android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                            style={styles.keyshareKeyContainerBadge}>
                            <Text
                              style={styles.keyshareKeyTextClickable}
                              numberOfLines={1}
                              adjustsFontSizeToFit={true}
                              minimumFontScale={0.5}>
                              {formatKeyshareCreatedAt(keyshareInfo.createdAt)}
                            </Text>
                          </AppPressable>
                        </View>
                      )}
                  </View>
                  {onOpenSettingsSection ? (
                    <AppPressable
                      onPress={() => {
                        onOpenSettingsSection('backup');
                      }}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                      accessible={true}
                      accessibilityRole="link"
                      accessibilityLabel="Open Settings Security section to backup keyshare">
                      <Text
                        style={[
                          styles.walletInfoHint,
                          screenStyles.walletInfoHintLink,
                          {
                            fontSize: theme.fontSizes?.base || 14,
                            color:
                              theme.colors.background === '#121212' ||
                              theme.colors.background.includes('12')
                                ? theme.colors.secondary
                                : theme.colors.primary,
                          },
                        ]}>
                        Settings &gt; Security to backup keyshare
                      </Text>
                    </AppPressable>
                  ) : (
                    <Text style={styles.walletInfoHint}>
                      Settings &gt; Security to backup keyshare
                    </Text>
                  )}
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
                    style={[styles.watchWalletItem, screenStyles.extensionLinkItem]}>
                    <AppText
                      variant="body"
                      tone="primary"
                      style={[
                        screenStyles.walletInfoHintLink,
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
