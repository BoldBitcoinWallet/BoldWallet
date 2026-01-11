import React, {useCallback, useState} from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import Toast from 'react-native-toast-message';
import {HapticFeedback} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import QRCodeModal from './QRCodeModal';

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
  onNavigateToSettings: () => void;
  onShowOutputDescriptorQR?: () => void;
  onShowNpubQR: () => void;
}

const KeyshareModal: React.FC<KeyshareModalProps> = ({
  visible,
  onClose,
  keyshareInfo,
  network,
  onNavigateToSettings,
  onShowNpubQR,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const screenHeight = Dimensions.get('window').height;
  const scrollViewHeight = screenHeight * 0.5;

  const [isOutputDescriptorQrVisible, setIsOutputDescriptorQrVisible] =
    useState(false);
  const [selectedDescriptorType, setSelectedDescriptorType] = useState<
    'legacy' | 'segwitNative' | 'segwitCompatible' | null
  >(null);

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
    onClose();
    setTimeout(() => onShowNpubQR(), 300);
  }, [onClose, onShowNpubQR]);

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
              <TouchableOpacity
                onPress={() => {
                  HapticFeedback.light();
                  onClose();
                }}
                style={styles.keyshareModalCloseButton}
                activeOpacity={0.7}>
                <Text style={styles.keyshareModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={[styles.keyshareModalBody, {maxHeight: scrollViewHeight}]}
              contentContainerStyle={styles.keyshareModalBodyContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              scrollEnabled={true}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              directionalLockEnabled={true}
              alwaysBounceVertical={false}>
              {keyshareInfo ? (
                <>
                  {/* Compact keyshare summary card */}
                  <View style={styles.keyshareInfoCard}>
                    <View style={styles.keyshareKeyItem}>
                      <Text style={styles.keyshareKeyLabel}>Wallet ID</Text>
                      <View style={styles.keyshareKeyContainer}>
                        <Text
                          style={styles.keyshareKeyText}
                          numberOfLines={1}
                          ellipsizeMode="middle">
                          {keyshareInfo.fingerprint || 'N/A'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.keyshareDetailRow}>
                      <Text style={styles.keyshareDetailLabel}>
                        Wallet Type
                      </Text>
                      <View
                        style={[
                          styles.keyshareBadge,
                          keyshareInfo.type === 'trio'
                            ? styles.keyshareBadgeTrio
                            : styles.keyshareBadgeDuo,
                        ]}>
                        <Text style={styles.keyshareBadgeText}>
                          {keyshareInfo.type === 'trio'
                            ? 'Trio • 3 devices'
                            : 'Duo • 2 devices'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.keyshareDetailRow}>
                      <Text style={styles.keyshareDetailLabel}>
                        Keyshare ID
                      </Text>
                      <Text style={styles.keyshareDetailValue}>
                        {keyshareInfo.label}
                      </Text>
                    </View>
                    {typeof keyshareInfo.createdAt === 'number' &&
                      keyshareInfo.createdAt > 0 && (
                        <View style={styles.keyshareDetailRow}>
                          <Text style={styles.keyshareDetailLabel}>
                            Created At
                          </Text>
                          <Text style={styles.keyshareDetailValue}>
                            {new Date(keyshareInfo.createdAt).toLocaleString()}
                          </Text>
                        </View>
                      )}
                  </View>

                  {/* Capabilities / connectivity summary */}
                  <View style={styles.keyshareInfoCard}>
                    <View style={styles.keyshareDetailRow}>
                      <Text style={styles.keyshareDetailLabel}>
                        LAN / Hotspot
                      </Text>
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
                    </View>

                    <View style={styles.keyshareDetailRow}>
                      <Text style={styles.keyshareDetailLabel}>Nostr</Text>
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
                    </View>

                    {keyshareInfo.supportsNostr && keyshareInfo.npub && (
                      <View style={styles.keyshareKeyItem}>
                        <Text style={styles.keyshareKeyLabel}>NPub</Text>
                        <View style={styles.keyshareKeyContainer}>
                          <Text
                            style={styles.keyshareKeyText}
                            numberOfLines={1}
                            ellipsizeMode="middle">
                            {keyshareInfo.npub}
                          </Text>
                          <View style={styles.keyshareButtonsRow}>
                            <TouchableOpacity
                              onPress={handleCopyNpub}
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/copy-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={handleShowNpubQR}
                              style={styles.keyshareCopyButton}>
                              <Image
                                source={require('../assets/qr-icon.png')}
                                style={styles.keyshareCopyIcon}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>

                  {/* Watch Wallet Header Section */}
                  <View style={styles.watchWalletHeader}>
                    <Text style={styles.watchWalletTitle}>
                      Watch-Wallet • Export
                    </Text>
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
                        <View style={styles.watchWalletItem}>
                          <Text style={styles.watchWalletItemLabel}>
                            Output Descriptor (Legacy)
                          </Text>
                          <View style={styles.watchWalletItemValueContainer}>
                            <Text
                              style={styles.watchWalletItemValue}
                              numberOfLines={1}
                              ellipsizeMode="middle">
                              {keyshareInfo.outputDescriptors.legacy || 'N/A'}
                            </Text>
                            <View style={styles.keyshareButtonsRow}>
                              <TouchableOpacity
                                onPress={() =>
                                  handleCopyOutputDescriptor('legacy')
                                }
                                style={styles.keyshareCopyButton}>
                                <Image
                                  source={require('../assets/copy-icon.png')}
                                  style={styles.keyshareCopyIcon}
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() =>
                                  handleShareOutputDescriptor('legacy')
                                }
                                style={styles.keyshareCopyButton}>
                                <Image
                                  source={require('../assets/share-icon.png')}
                                  style={styles.keyshareCopyIcon}
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() =>
                                  handleShowOutputDescriptorQR('legacy')
                                }
                                style={styles.keyshareCopyButton}>
                                <Image
                                  source={require('../assets/qr-icon.png')}
                                  style={styles.keyshareCopyIcon}
                                />
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      )}

                      {keyshareInfo.outputDescriptors?.segwitNative && (
                        <View style={styles.watchWalletItem}>
                          <Text style={styles.watchWalletItemLabel}>
                            Output Descriptor (Native Segwit)
                          </Text>
                          <View style={styles.watchWalletItemValueContainer}>
                            <Text
                              style={styles.watchWalletItemValue}
                              numberOfLines={1}
                              ellipsizeMode="middle">
                              {keyshareInfo.outputDescriptors.segwitNative ||
                                'N/A'}
                            </Text>
                            <View style={styles.keyshareButtonsRow}>
                              <TouchableOpacity
                                onPress={() =>
                                  handleCopyOutputDescriptor('segwitNative')
                                }
                                style={styles.keyshareCopyButton}>
                                <Image
                                  source={require('../assets/copy-icon.png')}
                                  style={styles.keyshareCopyIcon}
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() =>
                                  handleShareOutputDescriptor('segwitNative')
                                }
                                style={styles.keyshareCopyButton}>
                                <Image
                                  source={require('../assets/share-icon.png')}
                                  style={styles.keyshareCopyIcon}
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() =>
                                  handleShowOutputDescriptorQR('segwitNative')
                                }
                                style={styles.keyshareCopyButton}>
                                <Image
                                  source={require('../assets/qr-icon.png')}
                                  style={styles.keyshareCopyIcon}
                                />
                              </TouchableOpacity>
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
                            <Text
                              style={styles.watchWalletItemValue}
                              numberOfLines={1}
                              ellipsizeMode="middle">
                              {keyshareInfo.outputDescriptors
                                .segwitCompatible || 'N/A'}
                            </Text>
                            <View style={styles.keyshareButtonsRow}>
                              <TouchableOpacity
                                onPress={() =>
                                  handleCopyOutputDescriptor('segwitCompatible')
                                }
                                style={styles.keyshareCopyButton}>
                                <Image
                                  source={require('../assets/copy-icon.png')}
                                  style={styles.keyshareCopyIcon}
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
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
                              </TouchableOpacity>
                              <TouchableOpacity
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
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
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

            <TouchableOpacity
              style={[
                styles.backupButtonCompact,
                styles.keyshareBackupButtonMargin,
              ]}
              onPress={() => {
                HapticFeedback.medium();
                onClose();
                onNavigateToSettings();
              }}
              activeOpacity={0.7}>
              <Text style={styles.backupButtonTextCompact}>
                Security Settings &gt; Backup
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <View style={styles.toastContainer}>
        <Toast />
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
    </Modal>
  );
};

export default KeyshareModal;
