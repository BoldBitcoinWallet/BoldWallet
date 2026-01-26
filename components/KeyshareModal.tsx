import React, {useCallback, useState, useEffect} from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  Alert,
  Dimensions,
  NativeModules,
} from 'react-native';
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
import {dbg, HapticFeedback} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import {createToastConfig} from '../utils/toastConfig';
import QRCodeModal from './QRCodeModal';

const {BBMTLibNativeModule} = NativeModules;
interface KeyshareInfo {
  label: string;
  supportsLocal: boolean;
  supportsNostr: boolean;
  type: 'duo' | 'trio';
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
interface KeyshareModalProps {
  visible: boolean;
  onClose: () => void;
  keyshareInfo: KeyshareInfo | null;
  network: 'mainnet' | 'testnet';
  onShowOutputDescriptorQR?: () => void;
  onShowNpubQR?: () => void; // Deprecated - kept for backward compatibility
}
const KeyshareModal: React.FC<KeyshareModalProps> = ({
  visible,
  onClose,
  keyshareInfo,
  network,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);

  // Helper function to format long strings: first 8 chars ... last 8 chars
  const formatLongString = (value: string): string => {
    if (!value || value.length <= 16) return value;
    return `${value.substring(0, 8)}...${value.substring(value.length - 8)}`;
  };
  const screenHeight = Dimensions.get('window').height;
  const scrollViewHeight = screenHeight * 0.5;
  const [isOutputDescriptorQrVisible, setIsOutputDescriptorQrVisible] =
    useState(false);
  const [selectedDescriptorType, setSelectedDescriptorType] = useState<
    'legacy' | 'segwitNative' | 'segwitCompatible' | null
  >(null);
  const [isNpubQrVisible, setIsNpubQrVisible] = useState(false);
  const [pairingPubkeys, setPairingPubkeys] = useState<string>('');
  const [isPairingPubkeysQrVisible, setIsPairingPubkeysQrVisible] =
    useState(false);
  const [isWalletInfoExpanded, setIsWalletInfoExpanded] = useState(false);
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

  // Calculate pairing pubkeys with checksum
  useEffect(() => {
    const calculatePairingPubkeys = async () => {
      if (keyshareInfo?.pubKey && keyshareInfo?.chainCode) {
        try {
          const payload = `${keyshareInfo.pubKey}/${keyshareInfo.chainCode}`;
          const checksum = await BBMTLibNativeModule.sha256(payload);
          const checksumLast4 = checksum.slice(-4);
          setPairingPubkeys(`${payload}/${checksumLast4}`);
        } catch (error) {
          dbg('Failed to calculate pairing pubkeys checksum:', error);
          setPairingPubkeys('');
        }
      } else {
        setPairingPubkeys('');
      }
    };

    calculatePairingPubkeys();
  }, [keyshareInfo?.pubKey, keyshareInfo?.chainCode]);

  // Share text as file
  const shareTextAsFile = useCallback(
    async (text: string, filename: string, title: string) => {
      HapticFeedback.medium();
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
      HapticFeedback.light();
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
      HapticFeedback.light();
      setSelectedDescriptorType(type);
      setIsOutputDescriptorQrVisible(true);
    },
    [keyshareInfo],
  );
  const handleCopyNpub = useCallback(() => {
    if (!keyshareInfo?.npub) return;
    HapticFeedback.light();
    Clipboard.setString(keyshareInfo.npub);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Nostr public key copied to clipboard',
    });
  }, [keyshareInfo]);
  const handleShowNpubQR = useCallback(() => {
    HapticFeedback.light();
    setIsNpubQrVisible(true);
  }, []);

  const handleWalletIdPress = useCallback(() => {
    HapticFeedback.light();
    Toast.show({
      type: 'info',
      text1: 'Wallet ID Verification',
      text2: "All your wallet's keyshares share the same Wallet ID",
      visibilityTime: 3000,
    });
  }, []);

  const handleWalletTypePress = useCallback(() => {
    if (!keyshareInfo) return;
    HapticFeedback.light();
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

  const handleKeyshareIdPress = useCallback(() => {
    if (!keyshareInfo) return;
    HapticFeedback.light();
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
    HapticFeedback.light();
    Toast.show({
      type: 'info',
      text1: 'Wallet Creation Date',
      text2: 'This is when your wallet was initially set up and created',
      visibilityTime: 3000,
    });
  }, []);

  const handleLanHotspotPress = useCallback(() => {
    HapticFeedback.light();
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
    HapticFeedback.light();
    Toast.show({
      type: 'info',
      text1: 'Nostr Support',
      text2: keyshareInfo.supportsNostr
        ? 'Nostr is supported because your wallet was set up using Nostr'
        : 'Nostr is only supported if the wallet setup was done using Nostr',
      visibilityTime: 4000,
    });
  }, [keyshareInfo]);

  const handleCopyPairingPubkeys = useCallback(() => {
    if (!pairingPubkeys) return;
    HapticFeedback.light();
    Clipboard.setString(pairingPubkeys);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Pairing pubkeys copied to clipboard',
    });
  }, [pairingPubkeys]);

  const handleShowPairingPubkeysQR = useCallback(() => {
    HapticFeedback.light();
    setIsPairingPubkeysQrVisible(true);
  }, []);

  const handleToggleWalletInfo = useCallback(() => {
    HapticFeedback.light();
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
    HapticFeedback.light();
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
    HapticFeedback.light();
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
    HapticFeedback.light();
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
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={() => {}}>
      <View style={styles.modalOverlay}>
        <View
          onStartShouldSetResponder={() => false}
          onMoveShouldSetResponder={() => false}>
          <View style={styles.modalContentCompact}>
            <View style={styles.modalHeaderRowCompact}>
              <Image
                source={require('../assets/key-icon.png')}
                style={styles.modalHeaderIconCompact}
              />
              <Text style={styles.modalHeaderTitleCompact}>
                Device Keyshare
              </Text>
              <Pressable
                onPress={() => {
                  HapticFeedback.light();
                  onClose();
                }}
                style={styles.keyshareModalCloseButton}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text style={styles.keyshareModalCloseText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView
              style={[styles.keyshareModalBody, {maxHeight: scrollViewHeight}]}
              contentContainerStyle={styles.keyshareModalBodyContent}
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
                    <Pressable
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
                    </Pressable>
                    {isWalletInfoExpanded && (
                      <Animated.View
                        style={[
                          styles.collapsibleContent,
                          walletInfoContentOpacityStyle,
                        ]}>
                        <View style={styles.walletInfoContent}>
                          <View style={styles.walletInfoRow}>
                            <Text style={styles.keyshareDetailLabel}>
                              Wallet ID
                            </Text>
                            <Pressable
                              onPress={handleWalletIdPress}
                              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                              style={styles.keyshareKeyContainerBadge}>
                              <Text
                                style={styles.keyshareKeyTextClickable}
                                numberOfLines={1}
                                ellipsizeMode="middle"
                                adjustsFontSizeToFit={true}
                                minimumFontScale={0.5}>
                                {(
                                  keyshareInfo.fingerprint || 'N/A'
                                ).toUpperCase()}
                              </Text>
                            </Pressable>
                          </View>
                          <View style={styles.walletInfoRow}>
                            <Text style={styles.keyshareDetailLabel}>
                              Wallet Type
                            </Text>
                            <Pressable
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
                            </Pressable>
                          </View>
                          <View style={styles.walletInfoRow}>
                            <Text style={styles.keyshareDetailLabel}>
                              Keyshare ID
                            </Text>
                            <Pressable
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
                            </Pressable>
                          </View>
                          {typeof keyshareInfo.createdAt === 'number' &&
                            keyshareInfo.createdAt > 0 && (
                              <View style={styles.walletInfoRow}>
                                <Text style={styles.keyshareDetailLabel}>
                                  Created At
                                </Text>
                                <Pressable
                                  onPress={handleCreatedAtPress}
                                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                                  style={styles.keyshareKeyContainerBadge}>
                                  <Text
                                    style={styles.keyshareKeyTextClickable}
                                    numberOfLines={1}
                                    adjustsFontSizeToFit={true}
                                    minimumFontScale={0.5}>
                                    {new Date(
                                      keyshareInfo.createdAt,
                                    ).toLocaleString()}
                                  </Text>
                                </Pressable>
                              </View>
                            )}
                        </View>
                        <Text style={styles.walletInfoHint}>
                          Go to Wallet Settings &gt; Security to backup your
                          keyshare
                        </Text>
                      </Animated.View>
                    )}
                  </View>
                  {/* Capabilities / connectivity summary */}
                  <View style={styles.keyshareInfoCard}>
                    <Pressable
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
                    </Pressable>
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
                          <Pressable
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
                          </Pressable>
                        </View>
                        <View
                          style={[
                            styles.keyshareDetailRow,
                            !(
                              keyshareInfo.supportsNostr && keyshareInfo.npub
                            ) && styles.keyshareDetailRowLast,
                          ]}>
                          <Text style={styles.keyshareDetailLabel}>Nostr</Text>
                          <Pressable
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
                          </Pressable>
                        </View>
                        {keyshareInfo.supportsNostr && keyshareInfo.npub && (
                          <View
                            style={[
                              styles.keyshareKeyItem,
                              styles.keyshareKeyItemLast,
                            ]}>
                            <Text style={styles.keyshareKeyLabel}>NPub</Text>
                            <View style={styles.keyshareKeyContainer}>
                              <Pressable
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
                              </Pressable>
                              <View style={styles.keyshareButtonsRow}>
                                <Pressable
                                  onPress={handleShowNpubQR}
                                  style={styles.keyshareCopyButton}>
                                  <Image
                                    source={require('../assets/qr-icon.png')}
                                    style={styles.keyshareCopyIcon}
                                  />
                                </Pressable>
                              </View>
                            </View>
                          </View>
                        )}
                      </Animated.View>
                    )}
                  </View>
                  {/* Bold Extension Section */}
                  <View style={styles.watchWalletHeader}>
                    <Pressable
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
                    </Pressable>
                    {isBoldExtensionExpanded && (
                      <Animated.View
                        style={[
                          styles.collapsibleContent,
                          boldExtensionContentOpacityStyle,
                        ]}>
                        <Text style={styles.watchWalletDescription}>
                          This is a pubkey that should never be shared with
                          anyone for privacy. It is only used to bind Bold
                          Bitcoin Browser extension.
                        </Text>
                        <Text style={styles.watchWalletWarning}>
                          ⚠️ This does NOT hold any private key or keyshare
                          data.
                        </Text>
                        {pairingPubkeys && (
                          <View
                            style={[
                              styles.watchWalletItem,
                              styles.watchWalletItemLast,
                            ]}>
                            <Text style={styles.watchWalletItemLabel}>
                              Pairing Pubkeys
                            </Text>
                            <View style={styles.watchWalletItemValueContainer}>
                              <Pressable
                                onPress={handleCopyPairingPubkeys}
                                android_ripple={{color: 'rgba(0,0,0,0.1)'}}
                                style={styles.keyshareKeyContainerBadge}>
                                <Image
                                  source={require('../assets/copy-icon.png')}
                                  style={styles.keyshareBadgeCopyIcon}
                                />
                                <Text
                                  style={styles.keyshareKeyTextClickable}
                                  numberOfLines={1}>
                                  {formatLongString(pairingPubkeys)}
                                </Text>
                              </Pressable>
                              <View style={styles.keyshareButtonsRow}>
                                <Pressable
                                  onPress={handleShowPairingPubkeysQR}
                                  style={styles.keyshareCopyButton}>
                                  <Image
                                    source={require('../assets/qr-icon.png')}
                                    style={styles.keyshareCopyIcon}
                                  />
                                </Pressable>
                              </View>
                            </View>
                          </View>
                        )}
                      </Animated.View>
                    )}
                  </View>
                  {/* Watch Wallet Header Section */}
                  <View style={styles.watchWalletHeader}>
                    <Pressable
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
                    </Pressable>
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
                                  !keyshareInfo.outputDescriptors
                                    ?.segwitCompatible &&
                                  styles.watchWalletItemLast,
                              ]}>
                              <Text style={styles.watchWalletItemLabel}>
                                Output Descriptor (Legacy)
                              </Text>
                              <View
                                style={styles.watchWalletItemValueContainer}>
                                <Pressable
                                  onPress={() =>
                                    handleCopyOutputDescriptor('legacy')
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
                                      keyshareInfo.outputDescriptors.legacy ||
                                        'N/A',
                                    )}
                                  </Text>
                                </Pressable>
                                <View style={styles.keyshareButtonsRow}>
                                  <Pressable
                                    onPress={() =>
                                      handleShareOutputDescriptor('legacy')
                                    }
                                    style={styles.keyshareCopyButton}>
                                    <Image
                                      source={require('../assets/share-icon.png')}
                                      style={styles.keyshareCopyIcon}
                                    />
                                  </Pressable>
                                  <Pressable
                                    onPress={() =>
                                      handleShowOutputDescriptorQR('legacy')
                                    }
                                    style={styles.keyshareCopyButton}>
                                    <Image
                                      source={require('../assets/qr-icon.png')}
                                      style={styles.keyshareCopyIcon}
                                    />
                                  </Pressable>
                                </View>
                              </View>
                            </View>
                          )}
                          {keyshareInfo.outputDescriptors?.segwitNative && (
                            <View
                              style={[
                                styles.watchWalletItem,
                                !keyshareInfo.outputDescriptors
                                  ?.segwitCompatible &&
                                  styles.watchWalletItemLast,
                              ]}>
                              <Text style={styles.watchWalletItemLabel}>
                                Output Descriptor (Native Segwit)
                              </Text>
                              <View
                                style={styles.watchWalletItemValueContainer}>
                                <Pressable
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
                                      keyshareInfo.outputDescriptors
                                        .segwitNative || 'N/A',
                                    )}
                                  </Text>
                                </Pressable>
                                <View style={styles.keyshareButtonsRow}>
                                  <Pressable
                                    onPress={() =>
                                      handleShareOutputDescriptor(
                                        'segwitNative',
                                      )
                                    }
                                    style={styles.keyshareCopyButton}>
                                    <Image
                                      source={require('../assets/share-icon.png')}
                                      style={styles.keyshareCopyIcon}
                                    />
                                  </Pressable>
                                  <Pressable
                                    onPress={() =>
                                      handleShowOutputDescriptorQR(
                                        'segwitNative',
                                      )
                                    }
                                    style={styles.keyshareCopyButton}>
                                    <Image
                                      source={require('../assets/qr-icon.png')}
                                      style={styles.keyshareCopyIcon}
                                    />
                                  </Pressable>
                                </View>
                              </View>
                            </View>
                          )}
                          {keyshareInfo.outputDescriptors?.segwitCompatible && (
                            <View style={styles.watchWalletItem}>
                              <Text style={styles.watchWalletItemLabel}>
                                Output Descriptor (Nested SegWit)
                              </Text>
                              <View
                                style={styles.watchWalletItemValueContainer}>
                                <Pressable
                                  onPress={() =>
                                    handleCopyOutputDescriptor(
                                      'segwitCompatible',
                                    )
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
                                </Pressable>
                                <View style={styles.keyshareButtonsRow}>
                                  <Pressable
                                    onPress={() =>
                                      handleShareOutputDescriptor(
                                        'segwitCompatible',
                                      )
                                    }
                                    style={styles.keyshareCopyButton}>
                                    <Image
                                      source={require('../assets/share-icon.png')}
                                      style={styles.keyshareCopyIcon}
                                    />
                                  </Pressable>
                                  <Pressable
                                    onPress={() =>
                                      handleShowOutputDescriptorQR(
                                        'segwitCompatible',
                                      )
                                    }
                                    style={styles.keyshareCopyButton}>
                                    <Image
                                      source={require('../assets/qr-icon.png')}
                                      style={styles.keyshareCopyIcon}
                                    />
                                  </Pressable>
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
          </View>
        </View>
      </View>
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
      {/* QR Code Modal for Pairing Pubkeys */}
      <QRCodeModal
        visible={isPairingPubkeysQrVisible}
        onClose={() => {
          setIsPairingPubkeysQrVisible(false);
        }}
        title="Bold Extension • Pairing Pubkeys"
        value={pairingPubkeys}
        network={network as 'mainnet' | 'testnet'}
        showShareButton={true}
        topRightClose={true}
        nonDismissible={false}
      />
      <View style={styles.toastContainer}>
        <Toast config={createToastConfig(theme)} />
      </View>
    </Modal>
  );
};
export default KeyshareModal;
