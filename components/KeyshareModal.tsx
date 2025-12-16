import React, {useCallback, useState, useEffect} from 'react';
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
import {HapticFeedback, getDerivePathForNetwork, isLegacyWallet} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import EncryptedStorage from 'react-native-encrypted-storage';
import LocalCache from '../services/LocalCache';

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
  const [derivePath, setDerivePath] = useState<string>('');

  // Load derivation path based on keyshare timestamp
  useEffect(() => {
    const loadDerivePath = async () => {
      try {
        const keyshareJSON = await EncryptedStorage.getItem('keyshare');
        let useLegacyPath = true; // Default to legacy for safety
        let currentAddressType = 'legacy';
        
        if (keyshareJSON) {
          const keyshare = JSON.parse(keyshareJSON);
          useLegacyPath = isLegacyWallet(keyshare.created_at);
          currentAddressType = (await LocalCache.getItem('addressType')) || 'legacy';
        }
        
        const path = getDerivePathForNetwork(network, currentAddressType, useLegacyPath);
        setDerivePath(path);
      } catch {
        // Fallback to legacy path on error
        const path = getDerivePathForNetwork(network, 'legacy', true);
        setDerivePath(path);
      }
    };
    
    if (visible) {
      loadDerivePath();
    }
  }, [visible, network]);

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
    const filename = `${
      network === 'mainnet' ? 'xpub' : 'tpub'
    }.${month}${day}.${year}.${hours}${minutes}.txt`;
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

  const handleCopyPubKey = useCallback(() => {
    if (!keyshareInfo?.pubKey) return;
    HapticFeedback.light();
    Clipboard.setString(keyshareInfo.pubKey);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Public key copied to clipboard',
    });
  }, [keyshareInfo]);

  const handleCopyDerivePath = useCallback(async () => {
    try {
      // Load keyshare to check if it's legacy
      const keyshareJSON = await EncryptedStorage.getItem('keyshare');
      let useLegacyPath = true; // Default to legacy for safety
      let currentAddressType = 'legacy';
      
      if (keyshareJSON) {
        const keyshare = JSON.parse(keyshareJSON);
        useLegacyPath = isLegacyWallet(keyshare.created_at);
        currentAddressType = (await LocalCache.getItem('addressType')) || 'legacy';
      }
      
      const path = getDerivePathForNetwork(network, currentAddressType, useLegacyPath);
      HapticFeedback.light();
      Clipboard.setString(path);
      Toast.show({
        type: 'success',
        text1: 'Copied',
        text2: 'Derivation path copied to clipboard',
      });
    } catch {
      // Fallback to legacy path on error
      const path = getDerivePathForNetwork(network, 'legacy', true);
      HapticFeedback.light();
      Clipboard.setString(path);
      Toast.show({
        type: 'success',
        text1: 'Copied',
        text2: 'Derivation path copied to clipboard',
      });
    }
  }, [network]);

  const handleShowPubKeyQR = useCallback(() => {
    if (!keyshareInfo?.pubKey) return;
    HapticFeedback.light();
    onClose();
    // Note: This will need to be wired up in WalletHome similar to other QR handlers
    // For now, we'll just close the modal - the parent can add onShowPubKeyQR prop if needed
  }, [keyshareInfo, onClose]);

  const handleShowDerivePathQR = useCallback(() => {
    HapticFeedback.light();
    onClose();
    // Note: This will need to be wired up in WalletHome similar to other QR handlers
    // For now, we'll just close the modal - the parent can add onShowDerivePathQR prop if needed
  }, [onClose]);

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
                <>
                  {/* Compact keyshare summary card */}
                  <View style={styles.keyshareInfoCard}>
                    <View style={styles.keyshareDetailRow}>
                      <Text style={styles.keyshareDetailLabel}>Keyshare ID</Text>
                      <Text style={styles.keyshareDetailValue}>
                        {keyshareInfo.label}
                      </Text>
                    </View>
                    <View style={styles.keyshareDetailRow}>
                      <Text style={styles.keyshareDetailLabel}>Keyshare Type</Text>
                      <View
                        style={[
                          styles.keyshareBadge,
                          keyshareInfo.type === 'flexi'
                            ? styles.keyshareBadgeFlexi
                            : styles.keyshareBadgeBasic,
                        ]}>
                        <Text style={styles.keyshareBadgeText}>
                          {keyshareInfo.type === 'flexi'
                            ? 'Flexi • 3 devices'
                            : 'Basic • 2 devices'}
                        </Text>
                      </View>
                    </View>
                    {typeof keyshareInfo.createdAt === 'number' &&
                      keyshareInfo.createdAt > 0 && (
                        <View style={styles.keyshareDetailRow}>
                          <Text style={styles.keyshareDetailLabel}>
                            Created
                          </Text>
                          <Text style={styles.keyshareDetailValue}>
                            {new Date(keyshareInfo.createdAt).toLocaleString()}
                          </Text>
                        </View>
                      )}
                    <View style={styles.keyshareKeyItem}>
                      <Text style={styles.keyshareKeyLabel}>Public Key</Text>
                      <View style={styles.keyshareKeyContainer}>
                        <Text
                          style={styles.keyshareKeyText}
                          numberOfLines={1}
                          ellipsizeMode="middle">
                          {keyshareInfo.pubKey || 'N/A'}
                        </Text>
                        <View style={styles.keyshareButtonsRow}>
                          <TouchableOpacity
                            onPress={handleCopyPubKey}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleShowPubKeyQR}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/qr-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                    <View style={styles.keyshareKeyItem}>
                      <Text style={styles.keyshareKeyLabel}>Default Path</Text>
                      <View style={styles.keyshareKeyContainer}>
                        <Text
                          style={styles.keyshareKeyText}
                          numberOfLines={1}
                          ellipsizeMode="middle">
                          {derivePath || getDerivePathForNetwork(network, 'legacy', true)}
                        </Text>
                        <View style={styles.keyshareButtonsRow}>
                          <TouchableOpacity
                            onPress={handleCopyDerivePath}
                            style={styles.keyshareCopyButton}>
                            <Image
                              source={require('../assets/copy-icon.png')}
                              style={styles.keyshareCopyIcon}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleShowDerivePathQR}
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

                  {/* Capabilities / connectivity summary */}
                  <View style={styles.keyshareInfoCard}>
                    <View style={styles.keyshareDetailRow}>
                      <Text style={styles.keyshareDetailLabel}>LAN / Hotspot</Text>
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
                          {keyshareInfo.supportsNostr ? '✓ Supported' : 'Not enabled'}
                        </Text>
                      </View>
                    </View>

                    {keyshareInfo.supportsNostr && keyshareInfo.npub && (
                      <View style={styles.keyshareKeyItem}>
                        <Text style={styles.keyshareKeyLabel}>Nostr Pubkey</Text>
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
                      Import the extended pubkey or output descriptor into Sparrow
                      or another PSBT-capable wallet to create a watch-only wallet.
                    </Text>
                    <View>
                      <View style={styles.watchWalletItem}>
                        <Text style={styles.watchWalletItemLabel}>
                          Extended Pubkey (
                          {network === 'mainnet' ? 'xpub' : 'tpub'})
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

                      {keyshareInfo.outputDescriptors && (
                        <View style={styles.watchWalletItem}>
                          <Text style={styles.watchWalletItemLabel}>
                            All Output Descriptors
                          </Text>
                          <View style={styles.watchWalletItemValueContainer}>
                            <Text
                              style={styles.watchWalletItemValue}
                              numberOfLines={0}>
                              {`Legacy:\n${keyshareInfo.outputDescriptors.legacy || 'N/A'}\n\nSegWit Native:\n${keyshareInfo.outputDescriptors.segwitNative || 'N/A'}\n\nSegWit Compatible:\n${keyshareInfo.outputDescriptors.segwitCompatible || 'N/A'}`}
                            </Text>
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
    </Modal>
  );
};

export default KeyshareModal;
