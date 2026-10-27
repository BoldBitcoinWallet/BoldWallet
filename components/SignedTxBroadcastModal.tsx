import React, {useEffect, useRef, useState} from 'react';
import {showAppNotice} from '../services/appPrompt';
import {
  View,
  Text,
  Image,

  StyleSheet,
} from 'react-native';
import AppModal from './AppModal';
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
  CeremonyAuthRequiredError,
  CeremonyNoLockError,
  confirmSpendBroadcast,
  type SpendBroadcastPayment,
} from '../services/ceremonyAuth';
import {
  guardOnlineAction,
  useWalletOnline,
} from '../services/walletOnlineStore';

type BroadcastPhase = 'idle' | 'broadcasting' | 'success';

interface SignedTxBroadcastModalProps {
  visible: boolean;
  rawTxHex: string;
  payment: SpendBroadcastPayment | null;
  onBroadcastSuccess: (txId: string) => void | Promise<void>;
  onClose: () => void;
}

const SUCCESS_FLASH_MS = 450;
/**
 * Go PostTx: up to 4 attempts × 15s HTTP timeout + ~6s backoff.
 * JS races this overall so the UI never waits forever.
 */
const BROADCAST_MAX_WAIT_MS = 70_000;

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

const SignedTxBroadcastModal: React.FC<SignedTxBroadcastModalProps> = ({
  visible,
  rawTxHex,
  payment,
  onBroadcastSuccess,
  onClose,
}) => {
  const {theme} = useTheme();
  const accent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;
  const walletOnline = useWalletOnline();
  const [phase, setPhase] = useState<BroadcastPhase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(BROADCAST_MAX_WAIT_MS / 1000),
  );
  const broadcastLock = useRef(false);
  const cancelledRef = useRef(false);
  const requestIdRef = useRef(0);
  const deadlineRef = useRef(0);

  const busy = phase === 'broadcasting' || phase === 'success';

  useEffect(() => {
    if (!visible) {
      cancelledRef.current = true;
      requestIdRef.current += 1;
      setPhase('idle');
      setSecondsLeft(Math.ceil(BROADCAST_MAX_WAIT_MS / 1000));
    }
  }, [visible]);

  useEffect(() => {
    if (phase !== 'broadcasting') {
      return;
    }
    const tick = () => {
      const leftMs = Math.max(0, deadlineRef.current - Date.now());
      setSecondsLeft(Math.ceil(leftMs / 1000));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase]);

  const broadcastAccessibilityLabel =
    phase === 'broadcasting'
      ? `Cancel broadcast, ${formatCountdown(secondsLeft)} left`
      : phase === 'success'
        ? 'Transaction sent'
        : 'Broadcast';

  const confirmExportIfNeeded = async (): Promise<boolean> => {
    if (!payment) {
      return true;
    }
    try {
      await confirmSpendBroadcast(payment);
      return true;
    } catch (e: any) {
      if (
        e instanceof CeremonyAuthRequiredError ||
        e instanceof CeremonyNoLockError
      ) {
        if (e instanceof CeremonyNoLockError) {
          showAppNotice('Screen lock required', e.message);
        }
        return false;
      }
      throw e;
    }
  };

  const handleCopy = async () => {
    try {
      if (!(await confirmExportIfNeeded())) {
        return;
      }
      Clipboard.setString(rawTxHex);
      showAppNotice('Copied', 'Raw transaction copied to clipboard');
    } catch (e: any) {
      dbg('SignedTxBroadcastModal copy error', e);
      showAppNotice('Error', e?.message || 'Failed to copy transaction');
    }
  };

  const handleShare = async () => {
    try {
      if (!(await confirmExportIfNeeded())) {
        return;
      }
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
      showAppNotice('Error', e?.message || 'Failed to share transaction');
    }
  };

  const cancelBroadcast = (opts?: {silent?: boolean}) => {
    if (phase !== 'broadcasting') {
      return;
    }
    cancelledRef.current = true;
    requestIdRef.current += 1;
    setPhase('idle');
    setSecondsLeft(Math.ceil(BROADCAST_MAX_WAIT_MS / 1000));
    broadcastLock.current = false;
    if (!opts?.silent) {
      showAppNotice(
        'Broadcast cancelled',
        'Stopped waiting. If it already went through, it will show in history.',
      );
    }
  };

  const handleBroadcastPress = () => {
    if (phase === 'broadcasting') {
      cancelBroadcast();
      return;
    }
    handleBroadcast();
  };

  const handleBroadcast = async () => {
    if (busy || !rawTxHex || broadcastLock.current) return;
    if (!guardOnlineAction('Go online to broadcast')) {
      return;
    }
    broadcastLock.current = true;
    const requestId = ++requestIdRef.current;
    cancelledRef.current = false;
    try {
      if (payment) {
        await confirmSpendBroadcast(payment);
      }
      if (cancelledRef.current || requestId !== requestIdRef.current) {
        return;
      }
      deadlineRef.current = Date.now() + BROADCAST_MAX_WAIT_MS;
      setSecondsLeft(Math.ceil(BROADCAST_MAX_WAIT_MS / 1000));
      setPhase('broadcasting');

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const txId = await Promise.race([
          BBMTLibNativeModule.postTx(rawTxHex) as Promise<string>,
          new Promise<string>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error('Broadcast timed out'));
            }, BROADCAST_MAX_WAIT_MS);
          }),
        ]);

        if (cancelledRef.current || requestId !== requestIdRef.current) {
          // Native may still have succeeded after Cancel — finish the send path.
          if (txId && /^[a-fA-F0-9]{64}$/.test(txId)) {
            showAppNotice(
              'Broadcast went through',
              'It finished after you cancelled. Opening the result.',
            );
            await onBroadcastSuccess(txId);
          }
          return;
        }

        if (!txId || !/^[a-fA-F0-9]{64}$/.test(txId)) {
          throw new Error(txId || 'Invalid txid from broadcast');
        }
        setPhase('success');
        await new Promise<void>(resolve =>
          setTimeout(resolve, SUCCESS_FLASH_MS),
        );
        await onBroadcastSuccess(txId);
      } finally {
        if (timeoutId != null) {
          clearTimeout(timeoutId);
        }
      }
    } catch (e: any) {
      dbg('SignedTxBroadcastModal broadcast error', e);
      if (cancelledRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setPhase('idle');
      if (
        e instanceof CeremonyAuthRequiredError ||
        e instanceof CeremonyNoLockError
      ) {
        if (e instanceof CeremonyNoLockError) {
          showAppNotice('Screen lock required', e.message);
        }
        return;
      }
      showAppNotice('Broadcast failed', formatBroadcastError(e));
    } finally {
      if (requestId === requestIdRef.current) {
        broadcastLock.current = false;
      }
    }
  };

  const renderBroadcastContent = () => {
    if (phase === 'broadcasting') {
      return (
        <>
          <Text
            style={[styles.broadcastCountdown, {color: theme.colors.white}]}
            accessibilityLabel={`${formatCountdown(secondsLeft)} remaining`}>
            {formatCountdown(secondsLeft)}
          </Text>
          <Text style={[styles.broadcastCancelLabel, {color: theme.colors.white}]}>
            Cancel
          </Text>
        </>
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

  const handleClose = () => {
    if (phase === 'broadcasting') {
      cancelBroadcast({silent: true});
    }
    if (phase === 'success') {
      return;
    }
    onClose();
  };

  const hintText =
    phase === 'broadcasting'
      ? `Sending to the network. Up to ${formatCountdown(secondsLeft)} left — tap Cancel to stop waiting.`
      : walletOnline
        ? 'Your transaction is signed but not broadcast yet. You can copy/share the raw serialized transaction, or broadcast it.'
        : 'Wallet is offline. Copy or share the signed transaction, or go online to broadcast.';

  return (
    <AppModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={phase === 'success' ? undefined : handleClose}>
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
            <View style={styles.headerTitleRow}>
              <View
                style={[
                  styles.headerIconBg,
                  {backgroundColor: accent + '20'},
                ]}>
                <Image
                  source={require('../assets/send-icon.png')}
                  style={[styles.headerIcon, {tintColor: accent}]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.title, {color: theme.colors.text}]}>
                Signed transaction
              </Text>
            </View>
            <AppPressable
              accessibilityRole="button"
              accessibilityLabel={
                phase === 'broadcasting' ? 'Cancel broadcast and close' : 'Close'
              }
              style={[
                styles.closeButton,
                phase === 'success' && styles.disabledControl,
              ]}
              onPress={handleClose}
              disabled={phase === 'success'}>
              <Text
                style={[styles.closeButtonText, {color: theme.colors.text}]}>
                ×
              </Text>
            </AppPressable>
          </View>

          <Text style={[styles.hint, {color: theme.colors.textSecondary}]}>
            {hintText}
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
                ((phase === 'success' || !walletOnline) &&
                  phase !== 'broadcasting') &&
                  styles.broadcastButtonBusy,
                !walletOnline &&
                  phase !== 'broadcasting' &&
                  styles.broadcastButtonOffline,
                {
                  backgroundColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.accent
                      : theme.colors.bitcoinOrange,
                },
              ]}
              onPress={handleBroadcastPress}
              disabled={
                phase === 'success' ||
                (!walletOnline && phase !== 'broadcasting')
              }
              accessibilityState={{
                busy: phase === 'broadcasting',
                disabled:
                  phase === 'success' ||
                  (!walletOnline && phase !== 'broadcasting'),
              }}
              accessibilityLabel={
                walletOnline || phase === 'broadcasting'
                  ? broadcastAccessibilityLabel
                  : 'Go online to broadcast'
              }>
              {renderBroadcastContent()}
            </AppPressable>
          </View>
        </View>
      </GlassModalOverlay>
    </AppModal>
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
    marginLeft: 12,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'left',
    lineHeight: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  headerIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    width: 22,
    height: 22,
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
  broadcastCountdown: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 26,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  broadcastCancelLabel: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    opacity: 0.95,
    marginTop: 2,
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
