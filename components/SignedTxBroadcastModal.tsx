import React, {useEffect, useState} from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  Alert,
  StyleSheet,
} from 'react-native';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Clipboard from '@react-native-clipboard/clipboard';
import AppPressable from './AppPressable';
import GlassModalOverlay from './GlassModalOverlay';
import {BBMTLibNativeModule} from '../native_modules';
import {useTheme} from '../theme';
import {safeUnlink} from '../services/rnfsSafe';
import {dbg} from '../utils';
import {formatBroadcastError} from '../services/broadcastErrorMessages';
import {
  guardOnlineAction,
  useWalletOnline,
} from '../services/walletOnlineStore';

type BroadcastPhase = 'idle' | 'broadcasting' | 'success';

interface SignedTxBroadcastModalProps {
  visible: boolean;
  rawTxHex: string;
  onBroadcastSuccess: (txId: string) => void | Promise<void>;
  onClose: () => void;
}

const SUCCESS_FLASH_MS = 450;

const SignedTxBroadcastModal: React.FC<SignedTxBroadcastModalProps> = ({
  visible,
  rawTxHex,
  onBroadcastSuccess,
  onClose,
}) => {
  const {theme} = useTheme();
  const walletOnline = useWalletOnline();
  const [phase, setPhase] = useState<BroadcastPhase>('idle');
  const [dotCount, setDotCount] = useState(1);

  const busy = phase === 'broadcasting' || phase === 'success';

  useEffect(() => {
    if (!visible) {
      setPhase('idle');
      setDotCount(1);
    }
  }, [visible]);

  useEffect(() => {
    if (phase !== 'broadcasting') {
      setDotCount(1);
      return;
    }
    const id = setInterval(() => {
      setDotCount(d => (d % 3) + 1);
    }, 350);
    return () => clearInterval(id);
  }, [phase]);

  const broadcastAccessibilityLabel =
    phase === 'broadcasting'
      ? 'Broadcasting'
      : phase === 'success'
        ? 'Transaction sent'
        : 'Broadcast';

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
      await safeUnlink(filePath);
    } catch (e: any) {
      dbg('SignedTxBroadcastModal share error', e);
      Alert.alert('Error', e?.message || 'Failed to share transaction');
    }
  };

  const handleBroadcast = async () => {
    if (busy || !rawTxHex) return;
    if (!guardOnlineAction('Go online to broadcast')) {
      return;
    }
    setPhase('broadcasting');
    try {
      const txId = await BBMTLibNativeModule.postTx(rawTxHex);
      if (!txId || !/^[a-fA-F0-9]{64}$/.test(txId)) {
        throw new Error(txId || 'Invalid txid from broadcast');
      }
      setPhase('success');
      await new Promise<void>(resolve =>
        setTimeout(resolve, SUCCESS_FLASH_MS),
      );
      await onBroadcastSuccess(txId);
    } catch (e: any) {
      dbg('SignedTxBroadcastModal broadcast error', e);
      setPhase('idle');
      Alert.alert('Broadcast failed', formatBroadcastError(e));
    }
  };

  const renderBroadcastContent = () => {
    if (phase === 'broadcasting') {
      return (
        <Text
          style={[styles.broadcastDotsText, {color: theme.colors.white}]}
          accessibilityLabel="Broadcasting">
          {'.'.repeat(dotCount)}
        </Text>
      );
    }
    if (phase === 'success') {
      return (
        <Text
          style={[styles.broadcastSentText, {color: theme.colors.white}]}
          accessibilityLabel="Sent">
          Sent ✓
        </Text>
      );
    }
    return (
      <>
        <Image
          source={require('../assets/send-icon.png')}
          style={[styles.actionIcon, {tintColor: theme.colors.white}]}
          resizeMode="contain"
        />
        <Text style={[styles.actionText, {color: theme.colors.white}]}>
          Broadcast
        </Text>
      </>
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}>
      <GlassModalOverlay style={styles.backdrop}>
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
              style={[styles.closeButton, busy && styles.disabledControl]}
              onPress={onClose}
              disabled={busy}>
              <Text
                style={[styles.closeButtonText, {color: theme.colors.text}]}>
                ×
              </Text>
            </AppPressable>
          </View>

          <Text style={[styles.hint, {color: theme.colors.textSecondary}]}>
            {walletOnline
              ? 'Your transaction is signed but not broadcast yet. You can copy/share the raw serialized transaction, or broadcast it.'
              : 'Wallet is offline. Copy or share the signed transaction, or go online to broadcast.'}
          </Text>

          <View style={styles.actionsRow}>
            <AppPressable
              style={[
                styles.actionButton,
                busy && styles.disabledControl,
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
              disabled={busy}>
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
                busy && styles.disabledControl,
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
              disabled={busy}>
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
                (busy || !walletOnline) && styles.broadcastButtonBusy,
                !walletOnline && styles.broadcastButtonOffline,
                {
                  backgroundColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.accent
                      : theme.colors.bitcoinOrange,
                },
              ]}
              onPress={handleBroadcast}
              disabled={busy || !walletOnline}
              accessibilityState={{
                busy,
                disabled: busy || !walletOnline,
              }}
              accessibilityLabel={
                walletOnline
                  ? broadcastAccessibilityLabel
                  : 'Go online to broadcast'
              }>
              {renderBroadcastContent()}
            </AppPressable>
          </View>
        </View>
      </GlassModalOverlay>
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
    minWidth: 72,
  },
  broadcastButtonBusy: {
    opacity: 0.92,
  },
  broadcastButtonOffline: {
    opacity: 0.5,
  },
  broadcastDotsText: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
    letterSpacing: 2,
    minWidth: 40,
    textAlign: 'center',
  },
  broadcastSentText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabledControl: {
    opacity: 0.45,
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
