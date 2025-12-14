import React, {useCallback} from 'react';
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
import {HapticFeedback, getDerivePathForNetwork} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';

interface KeyshareInfo {
  label: string;
  supportsLocal: boolean;
  supportsNostr: boolean;
  type: 'basic' | 'flexi';
  pubKey: string;
  chainCode: string;
  xpub: string;
  outputDescriptor: string;
  npub: string | null;
}

interface KeyshareModalProps {
  visible: boolean;
  onClose: () => void;
  keyshareInfo: KeyshareInfo | null;
  network: 'mainnet' | 'testnet';
  onNavigateToSettings: () => void;
  onShowXpubQR: () => void;
  onShowOutputDescriptorQR: () => void;
  onShowNpubQR: () => void;
}

const KeyshareModal: React.FC<KeyshareModalProps> = ({
  visible,
  onClose,
  keyshareInfo,
  network,
  onNavigateToSettings,
  onShowXpubQR,
  onShowOutputDescriptorQR,
  onShowNpubQR,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const screenHeight = Dimensions.get('window').height;
  const scrollViewHeight = screenHeight * 0.5;

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

  const handleShareXpub = useCallback(() => {
    if (!keyshareInfo?.xpub) return;
    const now = new Date();
    const month = now.toLocaleDateString('en-US', {month: 'short'});
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const filename = `${network === 'mainnet' ? 'xpub' : 'tpub'}.${month}${day}.${year}.${hours}${minutes}.txt`;
    shareTextAsFile(keyshareInfo.xpub, filename, 'Share Extended Pubkey');
  }, [keyshareInfo, network, shareTextAsFile]);

  const handleShareOutputDescriptor = useCallback(() => {
    if (!keyshareInfo?.outputDescriptor) return;
    const now = new Date();
    const month = now.toLocaleDateString('en-US', {month: 'short'});
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const filename = `output-descriptor.${month}${day}.${year}.${hours}${minutes}.txt`;
    shareTextAsFile(
      keyshareInfo.outputDescriptor,
      filename,
      'Share Output Descriptor',
    );
  }, [keyshareInfo, shareTextAsFile]);

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

  const handleCopyOutputDescriptor = useCallback(() => {
    if (!keyshareInfo?.outputDescriptor) return;
    HapticFeedback.light();
    Clipboard.setString(keyshareInfo.outputDescriptor);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Output descriptor copied to clipboard',
    });
  }, [keyshareInfo]);

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

  const handleShowXpubQR = useCallback(() => {
    HapticFeedback.light();
    onClose();
    setTimeout(() => onShowXpubQR(), 300);
  }, [onClose, onShowXpubQR]);

  const handleShowOutputDescriptorQR = useCallback(() => {
    HapticFeedback.light();
    onClose();
    setTimeout(() => onShowOutputDescriptorQR(), 300);
  }, [onClose, onShowOutputDescriptorQR]);

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
                <View style={styles.keyshareTable}>
                  <View style={styles.keyshareTableRow}>
                    <Text style={styles.keyshareTableKey}>Keyshare ID</Text>
                    <Text style={styles.keyshareTableValue}>
                      {keyshareInfo.label}
                    </Text>
                  </View>

                  <View style={styles.keyshareTableRow}>
                    <Text style={styles.keyshareTableKey}>Keyshare Type</Text>
                    <Text style={styles.keyshareTableValue}>
                      {keyshareInfo.type === 'flexi'
                        ? 'Flexi (3-parties)'
                        : 'Basic (2-parties)'}
                    </Text>
                  </View>

                  <View style={styles.keyshareTableRow}>
                    <Text style={styles.keyshareTableKey}>LAN/Hotspot</Text>
                    <Text
                      style={[
                        styles.keyshareTableValue,
                        styles.keyshareTableValueSuccess,
                      ]}>
                      ✓ Supported
                    </Text>
                  </View>

                  <View style={styles.keyshareTableRow}>
                    <Text style={styles.keyshareTableKey}>Nostr Protocol</Text>
                    <Text
                      style={[
                        styles.keyshareTableValue,
                        keyshareInfo.supportsNostr
                          ? styles.keyshareTableValueSuccess
                          : styles.keyshareTableValueDisabled,
                      ]}>
                      {keyshareInfo.supportsNostr
                        ? '✓ Supported'
                        : '✗ Not Supported'}
                    </Text>
                  </View>

                  <View style={styles.keyshareTableRow}>
                    <Text style={styles.keyshareTableKey}>Derivation Path</Text>
                    <View style={styles.keyshareTableValueContainer}>
                      <Text
                        style={[styles.keyshareTableValue]}
                        numberOfLines={1}
                        ellipsizeMode="middle">
                        {getDerivePathForNetwork(network)}
                      </Text>
                    </View>
                  </View>

                  {/* Watch Wallet Header Section */}
                  <View style={styles.watchWalletHeader}>
                    <Text style={styles.watchWalletTitle}>Watch-Wallet • Export</Text>
                    <Text style={styles.watchWalletDescription}>
                      Import the extended pubkey or output descriptor into
                      Sparrow or similar wallets to create a watch-only wallet.
                      This enables advanced PSBT workflows for interoperability
                      with other Bitcoin tools.
                    </Text>

                    <View style={styles.watchWalletItem}>
                      <Text style={styles.watchWalletItemLabel}>
                        Extended Pubkey ({network === 'mainnet' ? 'xpub' : 'tpub'})
                      </Text>
                      <View style={styles.watchWalletItemValueContainer}>
                        <Text
                          style={styles.watchWalletItemValue}
                          numberOfLines={1}
                          ellipsizeMode="middle">
                          {keyshareInfo.xpub || 'N/A'}
                        </Text>
                        <View style={styles.keyshareButtonsRow}>
                          <TouchableOpacity
                            onPress={handleCopyXpub}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleShareXpub}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/share-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleShowXpubQR}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/qr-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    <View style={styles.watchWalletItem}>
                      <Text style={styles.watchWalletItemLabel}>
                        Output Descriptor
                      </Text>
                      <View style={styles.watchWalletItemValueContainer}>
                        <Text
                          style={styles.watchWalletItemValue}
                          numberOfLines={1}
                          ellipsizeMode="middle">
                          {keyshareInfo.outputDescriptor || 'N/A'}
                        </Text>
                        <View style={styles.keyshareButtonsRow}>
                          <TouchableOpacity
                            onPress={handleCopyOutputDescriptor}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleShareOutputDescriptor}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/share-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleShowOutputDescriptorQR}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/qr-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </View>

                  {keyshareInfo.supportsNostr && keyshareInfo.npub && (
                    <View style={styles.keyshareTableRow}>
                      <Text style={styles.keyshareTableKey}>Nostr Pubkey</Text>
                      <View style={styles.keyshareTableValueContainer}>
                        <Text
                          style={styles.keyshareTableValueKey}
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
    </Modal>
  );
};

export default KeyshareModal;
