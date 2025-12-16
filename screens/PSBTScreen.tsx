import React, {useCallback, useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
  DeviceEventEmitter,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import EncryptedStorage from 'react-native-encrypted-storage';
import {NativeModules} from 'react-native';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {HeaderRightButton, HeaderTitle} from '../components/Header';
import {PSBTLoader} from './PSBTModal';
import {dbg, HapticFeedback, getDerivePathForNetwork, isLegacyWallet, generateAllOutputDescriptors} from '../utils';
import {CommonActions} from '@react-navigation/native';
import TransportModeSelector from '../components/TransportModeSelector';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import QRCodeModal from '../components/QRCodeModal';

const {BBMTLibNativeModule} = NativeModules;

interface KeyshareInfoForPsbt {
  xpub: string;
  outputDescriptors: {
    legacy: string;
    segwitNative: string;
    segwitCompatible: string;
  };
}

const PSBTScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const {activeNetwork: network, activeAddressType: addressType} = useUser();

  const [keyshareInfo, setKeyshareInfo] = useState<KeyshareInfoForPsbt | null>(
    null,
  );
  const [isWatchWalletExpanded, setIsWatchWalletExpanded] = useState(false);
  const [isXpubQrVisible, setIsXpubQrVisible] = useState(false);
  const [isOutputDescriptorQrVisible, setIsOutputDescriptorQrVisible] =
    useState(false);
  const [selectedDescriptorType, setSelectedDescriptorType] = useState<
    'legacy' | 'segwitNative' | 'segwitCompatible' | null
  >(null);
  const [isPSBTTransportModalVisible, setIsPSBTTransportModalVisible] =
    useState<boolean>(false);
  const [pendingPSBTParams, setPendingPSBTParams] = useState<{
    psbtBase64: string;
    derivePath: string;
  } | null>(null);

  // Animation for collapsible section
  const rotationAnim = useRef(
    new Animated.Value(isWatchWalletExpanded ? 1 : 0),
  ).current;

  useEffect(() => {
    Animated.timing(rotationAnim, {
      toValue: isWatchWalletExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isWatchWalletExpanded, rotationAnim]);

  const rotateInterpolate = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const handleToggleWatchWallet = () => {
    HapticFeedback.light();
    Animated.timing(rotationAnim, {
      toValue: isWatchWalletExpanded ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    setIsWatchWalletExpanded(prev => !prev);
  };

  const loadKeyshareInfo = useCallback(async () => {
    try {
      const keyshareJSON = await EncryptedStorage.getItem('keyshare');
      if (!keyshareJSON) {
        setKeyshareInfo(null);
        return;
      }

      const keyshare = JSON.parse(keyshareJSON);
      const pubKey = keyshare.pub_key || '';
      const chainCode = keyshare.chain_code_hex || '';

      // Generate xpub/tpub for watch-only wallet compatibility (Sparrow, etc.)
      const xpub =
        (await BBMTLibNativeModule.encodeXpub(pubKey, chainCode, network)) ||
        '';

      // Generate output descriptors for all address types using utility function
      const descriptors = await generateAllOutputDescriptors(
        BBMTLibNativeModule,
        pubKey,
        chainCode,
        network,
        keyshare.created_at,
      );

      const outputDescriptors = {
        legacy: descriptors.legacy,
        segwitNative: descriptors.segwitNative,
        segwitCompatible: descriptors.segwitCompatible,
      };

      setKeyshareInfo({
        xpub,
        outputDescriptors,
      });
    } catch (error) {
      dbg('PSBTScreen: Error loading keyshare info:', error);
      setKeyshareInfo(null);
    }
  }, [network]);

  // Share helper for exporting text as a small file (xpub / descriptor)
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
          title,
          message: title,
          url: `file://${filePath}`,
          type: 'text/plain',
          filename,
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

  const handleCopyXpub = useCallback(() => {
    if (!keyshareInfo?.xpub) return;
    HapticFeedback.light();
    Clipboard.setString(keyshareInfo.xpub);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Extended pubkey copied to clipboard',
    });
  }, [keyshareInfo]);

  const handleShareXpub = useCallback(() => {
    if (!keyshareInfo?.xpub) return;
    const now = new Date();
    const month = now.toLocaleDateString('en-US', {month: 'short'});
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const filename = `${
      network === 'mainnet' ? 'xpub' : 'tpub'
    }.${month}${day}.${year}.${hours}${minutes}.txt`;
    shareTextAsFile(keyshareInfo.xpub, filename, 'Share Extended Pubkey');
  }, [keyshareInfo, network, shareTextAsFile]);

  const handleShowXpubQR = useCallback(() => {
    if (!keyshareInfo?.xpub) return;
    HapticFeedback.light();
    setIsXpubQrVisible(true);
  }, [keyshareInfo]);

  const handleCopyOutputDescriptor = useCallback(
    (type: 'legacy' | 'segwitNative' | 'segwitCompatible') => {
      const descriptor =
        keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      HapticFeedback.light();
      Clipboard.setString(descriptor);
      const typeLabel =
        type === 'legacy'
          ? 'Legacy'
          : type === 'segwitNative'
            ? 'SegWit Native'
            : 'SegWit Compatible';
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
      const descriptor =
        keyshareInfo?.outputDescriptors[type] || '';
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
      const descriptor =
        keyshareInfo?.outputDescriptors[type] || '';
      if (!descriptor) return;
      HapticFeedback.light();
      setSelectedDescriptorType(type);
      setIsOutputDescriptorQrVisible(true);
    },
    [keyshareInfo],
  );

  // Handle PSBT signing - same logic as WalletHome
  const handlePSBTSign = useCallback(
    async (psbtBase64: string, derivePath?: string) => {
      // Use provided derivation path or default to current address type
      if (!derivePath) {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (keyshareJSON) {
          const keyshare = JSON.parse(keyshareJSON);
          const currentAddressType = addressType || 'legacy';
          // Check if this is a legacy wallet (created before migration timestamp)
          const useLegacyPath = isLegacyWallet(keyshare.created_at);
          derivePath = getDerivePathForNetwork(network, currentAddressType, useLegacyPath);
        }
      }
      const psbtDerivePath = derivePath || getDerivePathForNetwork(network, 'legacy', true);

      // Check if keyshare supports Nostr (has nostr_npub)
      try {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        if (keyshareJSON) {
          const keyshare = JSON.parse(keyshareJSON);
          const hasNostrSupport =
            keyshare.nostr_npub && keyshare.nostr_npub.trim() !== '';

          if (!hasNostrSupport) {
            // Keyshare was generated with local mode, navigate directly to Devices Pairing
            navigation.dispatch(
              CommonActions.navigate({
                name: 'Devices Pairing',
                params: {
                  mode: 'sign_psbt',
                  addressType,
                  psbtBase64,
                  derivePath: psbtDerivePath,
                },
              }),
            );
            return;
          }
        }
      } catch (error) {
        dbg('PSBTScreen: Error checking keyshare for Nostr support:', error);
        // Continue to show transport selector if check fails
      }

      // Store params and show transport selector
      setPendingPSBTParams({psbtBase64, derivePath: psbtDerivePath});
      setTimeout(() => {
        setIsPSBTTransportModalVisible(true);
      }, 300);
    },
    [network, addressType, navigation],
  );

  const navigateToPSBTSigning = useCallback(
    (transport: 'local' | 'nostr') => {
      if (!pendingPSBTParams) return;

      const {psbtBase64, derivePath} = pendingPSBTParams;

      const routeName =
        transport === 'local' ? 'Devices Pairing' : 'Nostr Connect';
      navigation.dispatch(
        CommonActions.navigate({
          name: routeName,
          params: {
            mode: 'sign_psbt',
            addressType,
            psbtBase64,
            derivePath,
          },
        }),
      );
      setPendingPSBTParams(null);
    },
    [pendingPSBTParams, addressType, navigation],
  );

  const headerRight = React.useCallback(
    () => <HeaderRightButton navigation={navigation} />,
    [navigation],
  );

  const headerTitle = React.useCallback(() => <HeaderTitle />, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight,
      headerTitle,
    });
  }, [navigation, headerRight, headerTitle]);

  useEffect(() => {
    loadKeyshareInfo();
  }, [loadKeyshareInfo]);

  return (
    <SafeAreaView style={styles.screenContainer} edges={['left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}>
        {keyshareInfo && (
          <View
            style={[
              styles.watchWalletCard,
              isWatchWalletExpanded && styles.watchWalletCardExpanded,
            ]}>
            <TouchableOpacity
              style={styles.watchWalletHeaderRow}
              onPress={handleToggleWatchWallet}
              activeOpacity={0.7}
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
                  source={require('../assets/bind-icon.png')}
                  style={styles.watchWalletIcon}
                  resizeMode="contain"
                />
                <Text style={styles.watchWalletTitle}>Bold Connect</Text>
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
            </TouchableOpacity>

            {/* Collapsible content - only rendered when expanded */}
            {isWatchWalletExpanded && (
              <View
                style={[
                  styles.watchWalletContent,
                  styles.watchWalletContentExpanded,
                ]}>
                <Text style={styles.watchWalletSubtitle}>
                  Bold acts as your multi-party Bitcoin signer. Create
                  transactions in a watch-only compatible wallet like Sparrow or Electrum and sign them securely via
                  PSBT.
                </Text>
                <Text style={styles.watchWalletHint}>
                  Import using one of the details below:
                </Text>

                {/* Extended Pubkey - Single Row Layout */}
                <View style={styles.watchWalletDetailRow}>
                  <Text style={styles.watchWalletDetailLabel}>
                    Extended Pubkey
                  </Text>
                  <View style={styles.watchWalletValueContainer}>
                    <Text
                      style={styles.watchWalletValueText}
                      numberOfLines={1}
                      ellipsizeMode="tail">
                      {keyshareInfo.xpub || 'N/A'}
                    </Text>
                    {keyshareInfo.xpub && (
                      <View style={styles.watchWalletButtonsRow}>
                        <TouchableOpacity
                          onPress={handleCopyXpub}
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/copy-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleShareXpub}
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleShowXpubQR}
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>

                {/* Output Descriptors - One row per address type */}
                {keyshareInfo.outputDescriptors.legacy && (
                  <View style={styles.watchWalletDetailRow}>
                    <Text style={styles.watchWalletDetailLabel}>
                      Output Descriptor (Legacy)
                    </Text>
                    <View style={styles.watchWalletValueContainer}>
                      <Text
                        style={styles.watchWalletValueText}
                        numberOfLines={1}
                        ellipsizeMode="tail">
                        {keyshareInfo.outputDescriptors.legacy || 'N/A'}
                      </Text>
                      <View style={styles.watchWalletButtonsRow}>
                        <TouchableOpacity
                          onPress={() => handleCopyOutputDescriptor('legacy')}
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/copy-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleShareOutputDescriptor('legacy')}
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleShowOutputDescriptorQR('legacy')}
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}

                {keyshareInfo.outputDescriptors.segwitNative && (
                  <View style={styles.watchWalletDetailRow}>
                    <Text style={styles.watchWalletDetailLabel}>
                      Output Descriptor (SegWit Native)
                    </Text>
                    <View style={styles.watchWalletValueContainer}>
                      <Text
                        style={styles.watchWalletValueText}
                        numberOfLines={1}
                        ellipsizeMode="tail">
                        {keyshareInfo.outputDescriptors.segwitNative || 'N/A'}
                      </Text>
                      <View style={styles.watchWalletButtonsRow}>
                        <TouchableOpacity
                          onPress={() =>
                            handleCopyOutputDescriptor('segwitNative')
                          }
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/copy-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            handleShareOutputDescriptor('segwitNative')
                          }
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            handleShowOutputDescriptorQR('segwitNative')
                          }
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}

                {keyshareInfo.outputDescriptors.segwitCompatible && (
                  <View style={styles.watchWalletDetailRow}>
                    <Text style={styles.watchWalletDetailLabel}>
                      Output Descriptor (SegWit Compatible)
                    </Text>
                    <View style={styles.watchWalletValueContainer}>
                      <Text
                        style={styles.watchWalletValueText}
                        numberOfLines={1}
                        ellipsizeMode="tail">
                        {keyshareInfo.outputDescriptors.segwitCompatible ||
                          'N/A'}
                      </Text>
                      <View style={styles.watchWalletButtonsRow}>
                        <TouchableOpacity
                          onPress={() =>
                            handleCopyOutputDescriptor('segwitCompatible')
                          }
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/copy-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            handleShareOutputDescriptor('segwitCompatible')
                          }
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/share-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            handleShowOutputDescriptorQR('segwitCompatible')
                          }
                          style={styles.watchWalletIconButton}
                          activeOpacity={0.7}>
                          <Image
                            source={require('../assets/qr-icon.png')}
                            style={styles.watchWalletIconButtonIcon}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        <View style={styles.psbtBodyContainer}>
          <PSBTLoader
            // We don't show fiat conversions here, so rate/symbol can be neutral
            btcRate={0}
            currencySymbol="$"
            onClose={() => {
              // In PSBT screen, Cancel should only reset the loader state,
              // not navigate away from this screen.
            }}
            disableCancelWhenEmpty={true}
            useOverlay={false}
            onSign={handlePSBTSign}
            middleButton={
              <TouchableOpacity
                style={styles.lockButton}
                onPress={() => {
                  HapticFeedback.light();
                  // Emit a reload event to App.tsx to trigger authentication lock
                  DeviceEventEmitter.emit('app:reload');
                }}
                activeOpacity={0.7}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Lock wallet"
                accessibilityHint="Double tap to lock the wallet">
                <Image
                  source={require('../assets/locker-icon.png')}
                  style={styles.lockButtonIcon}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            }
          />
        </View>
      </ScrollView>
      {/* QR Code Modals for watch-wallet import helpers */}
      <QRCodeModal
        visible={isXpubQrVisible}
        onClose={() => setIsXpubQrVisible(false)}
        title={`Wallet • ${network === 'mainnet' ? 'xpub' : 'tpub'}`}
        value={keyshareInfo?.xpub || ''}
        network={network as 'mainnet' | 'testnet'}
        showShareButton={true}
        topRightClose={true}
        nonDismissible={false}
      />
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
              ? 'SegWit Native'
              : 'SegWit Compatible'
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
        visible={isPSBTTransportModalVisible}
        onClose={() => {
          HapticFeedback.medium();
          setIsPSBTTransportModalVisible(false);
          setPendingPSBTParams(null);
        }}
        onSelect={(transport: 'local' | 'nostr') => {
          navigateToPSBTSigning(transport);
          setIsPSBTTransportModalVisible(false);
        }}
      />
    </SafeAreaView>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
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
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
    },
    watchWalletSubtitle: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textSecondary,
      marginBottom: 8,
    },
    watchWalletHint: {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.textSecondary,
      textDecorationLine: 'underline',
      marginTop: 12,
      marginBottom: 6,
    },
    watchWalletExpandIcon: {
      fontSize: 14,
      fontWeight: 'bold',
    },
    watchWalletContent: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      borderTopWidth: 1,
      borderTopColor: theme.colors.accent || theme.colors.primary,
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
      fontSize: 13,
      fontWeight: '600',
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
      fontSize: 11,
      fontFamily: 'monospace',
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
    psbtBodyContainer: {
      marginTop: 0,
      marginBottom: 8,
    },
    lockButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    },
    lockButtonIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.textOnPrimary,
    },
  });

export default PSBTScreen;
