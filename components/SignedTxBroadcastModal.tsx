import React, {useState} from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Clipboard from '@react-native-clipboard/clipboard';
import AppPressable from './AppPressable';
import {BBMTLibNativeModule} from '../native_modules';
import {useTheme} from '../theme';
import {dbg} from '../utils';

interface SignedTxBroadcastModalProps {
  visible: boolean;
  rawTxHex: string;
  onBroadcastSuccess: (txId: string) => void;
  onClose: () => void;
}

const SignedTxBroadcastModal: React.FC<SignedTxBroadcastModalProps> = ({
  visible,
  rawTxHex,
  onBroadcastSuccess,
  onClose,
}) => {
  const {theme} = useTheme();
  const [broadcasting, setBroadcasting] = useState(false);

  const handleCopy = () => {
    Clipboard.setString(rawTxHex);
    Alert.alert('Copied', 'Raw transaction copied to clipboard');
  };

  const handleShare = async () => {
    try {
      const txid = await BBMTLibNativeModule.computeTxId(rawTxHex);
      const filename = `${txid}.txt`;
      const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
      const filePath = `${tempDir}/${filename}`;
      await RNFS.writeFile(filePath, rawTxHex, 'utf8');
      await Share.open({
        title: 'Signed transaction',
        message: 'Raw signed transaction (broadcast when ready)',
        url: `file://${filePath}`,
        type: 'text/plain',
        filename,
        failOnCancel: false,
      });
      await RNFS.unlink(filePath).catch(() => {});
    } catch (e: any) {
      dbg('SignedTxBroadcastModal share error', e);
      Alert.alert('Error', e?.message || 'Failed to share transaction');
    }
  };

  const handleBroadcast = async () => {
    if (broadcasting || !rawTxHex) return;
    setBroadcasting(true);
    try {
      const txId = await BBMTLibNativeModule.postTx(rawTxHex);
      if (txId && /^[a-fA-F0-9]{64}$/.test(txId)) {
        onBroadcastSuccess(txId);
      } else {
        throw new Error(txId || 'Invalid txid from broadcast');
      }
    } catch (e: any) {
      dbg('SignedTxBroadcastModal broadcast error', e);
      Alert.alert(
        'Broadcast failed',
        e?.message || 'Failed to broadcast transaction',
      );
    } finally {
      setBroadcasting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View
        style={[
          styles.backdrop,
          {backgroundColor: theme.colors.modalBackdrop},
        ]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.background,
              borderColor:
                theme.colors.background === '#ffffff'
                  ? theme.colors.blackOverlay10
                  : theme.colors.whiteOverlay20,
              shadowColor: theme.colors.shadowColor,
            },
          ]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, {color: theme.colors.text}]}>
              Signed transaction
            </Text>
            <AppPressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeButton}
              onPress={onClose}>
              <Text
                style={[styles.closeButtonText, {color: theme.colors.text}]}>
                ×
              </Text>
            </AppPressable>
          </View>

          <Text style={[styles.hint, {color: theme.colors.textSecondary}]}>
            Your transaction is signed but not broadcast yet. You can copy/share
            the raw serialized transaction, or broadcast it.
          </Text>

          <View style={styles.actionsRow}>
            <AppPressable
              style={[
                styles.actionButton,
                {
                  backgroundColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.blackOverlay05
                      : theme.colors.whiteOverlay10,
                  borderColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.blackOverlay10
                      : theme.colors.whiteOverlay20,
                },
              ]}
              onPress={handleCopy}
              disabled={broadcasting}>
              <Image
                source={require('../assets/copy-icon.png')}
                style={[styles.actionIcon, {tintColor: theme.colors.text}]}
                resizeMode="contain"
              />
              <Text style={[styles.actionText, {color: theme.colors.text}]}>
                Copy
              </Text>
            </AppPressable>

            <AppPressable
              style={[
                styles.actionButton,
                {
                  backgroundColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.blackOverlay05
                      : theme.colors.whiteOverlay10,
                  borderColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.blackOverlay10
                      : theme.colors.whiteOverlay20,
                },
              ]}
              onPress={handleShare}
              disabled={broadcasting}>
              <Image
                source={require('../assets/share-icon.png')}
                style={[styles.actionIcon, {tintColor: theme.colors.text}]}
                resizeMode="contain"
              />
              <Text style={[styles.actionText, {color: theme.colors.text}]}>
                Share
              </Text>
            </AppPressable>

            <AppPressable
              style={[
                styles.actionButton,
                styles.broadcastButton,
                {
                  backgroundColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.accent
                      : theme.colors.bitcoinOrange,
                },
              ]}
              onPress={handleBroadcast}
              disabled={broadcasting}>
              {broadcasting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Image
                    source={require('../assets/send-icon.png')}
                    style={[styles.actionIcon, {tintColor: theme.colors.white}]}
                    resizeMode="contain"
                  />
                  <Text
                    style={[styles.actionText, {color: theme.colors.white}]}>
                    Broadcast
                  </Text>
                </>
              )}
            </AppPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 16,
    padding: 18,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'left',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '400',
    opacity: 0.8,
    marginTop: -2,
  },
  hint: {
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'left',
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 72,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  broadcastButton: {
    borderWidth: 0,
  },
  actionIcon: {
    width: 22,
    height: 22,
    opacity: 0.95,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

export default SignedTxBroadcastModal;
