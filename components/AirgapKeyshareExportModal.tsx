import React, {useCallback, useEffect, useRef, useState} from 'react';
import {showAppNotice} from '../services/appPrompt';
import {holdScreenAwake} from '../services/screenAwake';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Platform,
  StatusBar,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import {
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import AppModal from './AppModal';
import type {UR} from '@ngraveio/bc-ur';
import AppPressable from './AppPressable';
import GlassModalOverlay from './GlassModalOverlay';
import AnimatedUrQr, {UR_QR_QUIET_ZONE_PX} from './AnimatedUrQr';
import {dbg, getKeyshareMetadata} from '../utils';
import {useTheme} from '../theme';
import {
  airgapV2Bytes,
  bufferToUr,
  nextAirgapQrSpeed,
  UR_AIRGAP_DEFAULT_SPEED,
  UR_AIRGAP_SPEEDS,
  type AirgapQrSpeed,
} from '../utils/urBytesQr';
import {formatAirgapPinDisplay, generateAirgapPin} from '../services/airgapPin';
import {TssProvider} from '../services/TssProvider';

type ExportStep = 'pin' | 'qr';

interface AirgapKeyshareExportModalProps {
  visible: boolean;
  onClose: () => void;
}

const PRIVACY_HINT = 'Eyes on these two screens only.';
const PIN_NEXT_HINT = 'Read the PIN on the new phone, then show the QR.';
const AIRGAP_PROCESS_HINT =
  'Takes a couple of minutes — keep scanning. PIN + QR only; no files or SD cards.';
const AIRGAP_QR_HINT_TIME = 'A couple of minutes is normal.';
const AIRGAP_QR_HINT_FOUNTAIN = 'Fountain can finish before every frame.';

/**
 * This modal draws under the status bar and the Android navigation bar.
 * Inside a modal the live safe-area inset is often 0, so use the larger of
 * that, the inset measured at launch, and the system bar the window does
 * not already reserve.
 */
function statusBarInset(reportedTop: number): number {
  const measured = Math.max(
    reportedTop,
    initialWindowMetrics?.insets.top ?? 0,
  );
  if (Platform.OS !== 'android') {
    return measured;
  }
  return Math.max(measured, StatusBar.currentHeight ?? 0);
}

function androidNavigationInset(reportedBottom: number): number {
  const measured = Math.max(
    reportedBottom,
    initialWindowMetrics?.insets.bottom ?? 0,
  );
  if (Platform.OS !== 'android') {
    return measured;
  }
  const screenH = Dimensions.get('screen').height;
  const windowH = Dimensions.get('window').height;
  const status = StatusBar.currentHeight ?? 0;
  const gap = screenH - windowH;
  const reserved = gap > status + 1 ? gap - status : 0;
  return Math.max(measured, reserved);
}

const AirgapKeyshareExportModal: React.FC<AirgapKeyshareExportModalProps> = ({
  visible,
  onClose,
}) => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const {width: windowWidth} = useWindowDimensions();
  const overlayGutter = 8;
  const [qrSlot, setQrSlot] = useState({width: 0, height: 0});
  const [qrFrame, setQrFrame] = useState({frame: 1, total: 1});
  const qrSize = Math.max(
    0,
    Math.floor(
      Math.min(qrSlot.width, qrSlot.height) - UR_QR_QUIET_ZONE_PX * 2,
    ),
  );

  const [step, setStep] = useState<ExportStep>('pin');
  const [exportUr, setExportUr] = useState<UR | null>(null);
  const [pin, setPin] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);
  const [qrSpeed, setQrSpeed] = useState<AirgapQrSpeed>(UR_AIRGAP_DEFAULT_SPEED);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible) {
      setExportUr(null);
      setPin('');
      setIsEncrypting(false);
      setStep('pin');
      setRestartNonce(0);
      setQrSpeed(UR_AIRGAP_DEFAULT_SPEED);
      return;
    }

    let cancelled = false;
    const encryptWithPin = async () => {
      setIsEncrypting(true);
      setExportUr(null);
      setStep('pin');
      setRestartNonce(0);
      setQrSpeed(UR_AIRGAP_DEFAULT_SPEED);
      try {
        const nextPin = await generateAirgapPin();
        const meta = await getKeyshareMetadata();
        if (!meta) {
          throw new Error('Invalid keyshare.');
        }
        // F1: v2 format (Argon2id + AES-GCM in Go). PIN entropy itself is F16b, out of scope.
        // 3b-3 A12: token-gated export (OS-visible prompt).
        const encryptedKeyshare =
          await TssProvider.backupEncryptStoredKeyshare(nextPin);
        if (!encryptedKeyshare) {
          throw new Error('Failed to encrypt the keyshare.');
        }
        const raw = airgapV2Bytes(encryptedKeyshare);
        const ur = raw ? bufferToUr(raw) : null;
        if (!ur) {
          throw new Error('Failed to encode the keyshare QR.');
        }
        if (cancelled) {
          return;
        }
        setPin(nextPin);
        setExportUr(ur);
      } catch (error) {
        dbg('Error encrypting airgap keyshare:', error);
        if (!cancelled) {
          showAppNotice(
            'Error',
            error instanceof Error
              ? error.message
              : 'Failed to encrypt the keyshare.',
          );
          onCloseRef.current();
        }
      } finally {
        if (!cancelled) {
          setIsEncrypting(false);
        }
      }
    };
    encryptWithPin();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleShowQr = () => {
    if (!exportUr) {
      return;
    }
    setRestartNonce(n => n + 1);
    setStep('qr');
  };

  const handleRestartFrames = () => {
    setRestartNonce(n => n + 1);
  };

  const handleCycleSpeed = () => {
    setQrSpeed(prev => nextAirgapQrSpeed(prev));
    setRestartNonce(n => n + 1);
  };

  const handleQrSlotLayout = (event: LayoutChangeEvent) => {
    const width = Math.floor(event.nativeEvent.layout.width);
    const height = Math.floor(event.nativeEvent.layout.height);
    setQrSlot(prev =>
      prev.width === width && prev.height === height ? prev : {width, height},
    );
  };

  const handleQrFrame = useCallback((frame: number, total: number) => {
    setQrFrame(prev =>
      prev.frame === frame && prev.total === total ? prev : {frame, total},
    );
  }, []);

  useEffect(() => {
    if (!visible || step !== 'qr') {
      return;
    }
    let release: (() => void) | undefined;
    let cancelled = false;
    holdScreenAwake().then(done => {
      if (cancelled) {
        done();
        return;
      }
      release = done;
    });
    return () => {
      cancelled = true;
      release?.();
    };
  }, [visible, step]);

  const speedPreset = UR_AIRGAP_SPEEDS[qrSpeed];

  const isLightTheme = theme.colors.background === '#ffffff';

  useEffect(() => {
    if (!visible || step !== 'qr') {
      return;
    }
    const entry = StatusBar.pushStackEntry({
      barStyle: isLightTheme ? 'dark-content' : 'light-content',
      backgroundColor: theme.colors.background,
    });
    return () => {
      StatusBar.popStackEntry(entry);
    };
  }, [visible, step, isLightTheme, theme.colors.background]);

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: overlayGutter,
    },
    modalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      width: '100%',
      maxWidth: windowWidth,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalHeaderIcon: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      marginLeft: 12,
      color: theme.colors.text,
      flex: 1,
    },
    closeButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
      backgroundColor: theme.colors.subPrimary + '10',
      borderRadius: 32,
      borderWidth: 1,
      paddingTop: 2,
      borderColor: theme.colors.border + '10',
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    modalBody: {
      paddingHorizontal: 24,
      paddingVertical: 20,
      alignItems: 'center',
    },
    privacyHint: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      textAlign: 'center',
      lineHeight: 20,
    },
    processHint: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      marginBottom: 16,
      paddingHorizontal: 8,
      textAlign: 'center',
      lineHeight: 18,
    },
    pinLabel: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    pinValue: {
      fontSize: 36,
      fontFamily: theme.fontFamilies?.monospaceBold || theme.fontFamilies?.bold,
      color: theme.colors.text,
      letterSpacing: 4,
      marginBottom: 24,
    },
    primaryButton: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      minHeight: 48,
    },
    secondaryButton: {
      backgroundColor: theme.colors.secondary,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      minHeight: 48,
    },
    qrActionsRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      width: '100%',
      gap: 10,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    disabledButton: {
      opacity: 0.5,
    },
    buttonIcon: {
      width: 18,
      height: 18,
      marginRight: 10,
      tintColor: theme.colors.white,
    },
    secondaryButtonIcon: {
      width: 18,
      height: 18,
      marginLeft: 4,
      marginRight: 10,
      tintColor: isLightTheme ? theme.colors.white : theme.colors.text,
    },
    primaryButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.background
          : theme.colors.white,
    },
    secondaryButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: isLightTheme ? theme.colors.white : theme.colors.text,
      textAlign: 'center',
    },
    qrCodeContainer: {
      alignSelf: 'center',
    },
    loadingWrap: {
      paddingVertical: 36,
      alignItems: 'center',
    },
    loadingText: {
      marginTop: 12,
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
    },
    qrStage: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    qrTopBar: {
      paddingHorizontal: 16,
      paddingBottom: 4,
    },
    qrStatus: {
      alignItems: 'center',
      paddingHorizontal: 32,
      paddingTop: 20,
      paddingBottom: 16,
    },
    qrTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    qrTopIcon: {
      width: 22,
      height: 22,
      marginRight: 10,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    qrTopTitle: {
      flex: 1,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    qrSlot: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qrBottomBar: {
      paddingHorizontal: 16,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isLightTheme
        ? theme.colors.blackOverlay10
        : theme.colors.whiteOverlay10,
    },
    qrStageFrame: {
      fontSize: theme.fontSizes?.base || 15,
      lineHeight: 22,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
    },
    qrStageHint: {
      marginTop: 10,
      fontSize: theme.fontSizes?.sm || 13,
      lineHeight: 18,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    qrStageHintFollow: {
      marginTop: 2,
      fontSize: theme.fontSizes?.sm || 13,
      lineHeight: 18,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    qrActionButton: {
      backgroundColor: isLightTheme
        ? theme.colors.cardBackground
        : theme.colors.subPrimary,
      borderWidth: 1,
      borderColor: isLightTheme
        ? theme.colors.border
        : theme.colors.whiteOverlay12,
    },
    qrActionIcon: {
      tintColor: theme.colors.text,
    },
    qrActionText: {
      color: theme.colors.text,
    },
  });

  const pinReady = !!pin && !!exportUr && !isEncrypting;

  const qrStage =
    step === 'qr' && exportUr ? (
      <View style={styles.qrStage}>
        <View
          style={[
            styles.qrTopBar,
            {paddingTop: statusBarInset(insets.top) + 8},
          ]}>
          <View style={styles.qrTopRow}>
            <Image
              source={require('../assets/scan-icon.png')}
              style={styles.qrTopIcon}
              resizeMode="contain"
            />
            <Text style={styles.qrTopTitle}>Scan Encrypted Keyshare</Text>
            <AppPressable
              style={styles.closeButton}
              onPress={onClose}
              android_ripple={{
                color: isLightTheme
                  ? theme.colors.blackOverlay10
                  : theme.colors.whiteOverlay10,
              }}>
              <Text style={styles.closeButtonText}>✕</Text>
            </AppPressable>
          </View>
        </View>
        <View style={styles.qrStatus}>
          <Text style={styles.qrStageFrame}>
            Frame {qrFrame.frame} of {qrFrame.total}
          </Text>
          <Text style={styles.qrStageHint}>{AIRGAP_QR_HINT_TIME}</Text>
          <Text style={styles.qrStageHintFollow}>{AIRGAP_QR_HINT_FOUNTAIN}</Text>
        </View>
        <View style={styles.qrSlot} onLayout={handleQrSlotLayout}>
          {qrSize > 0 ? (
            <AnimatedUrQr
              ur={exportUr}
              size={qrSize}
              restartNonce={restartNonce}
              maxFragmentLen={speedPreset.fragmentSize}
              frameIntervalMs={speedPreset.frameIntervalMs}
              frameLabelStyle={styles.qrStageFrame}
              hintStyle={styles.qrStageHint}
              containerStyle={styles.qrCodeContainer}
              hint=""
              showFrameLabel={false}
              onFrame={handleQrFrame}
              fallbackText="Could not render animated QR."
            />
          ) : qrSlot.width > 0 && qrSlot.height > 0 ? (
            <Text style={styles.qrStageHint}>Could not render animated QR.</Text>
          ) : null}
        </View>
        <View
          style={[
            styles.qrBottomBar,
            {paddingBottom: androidNavigationInset(insets.bottom) + 12},
          ]}>
          <View style={styles.qrActionsRow}>
            <AppPressable
              style={[styles.secondaryButton, styles.qrActionButton]}
              onPress={handleRestartFrames}
              android_ripple={{
                color: isLightTheme
                  ? theme.colors.blackOverlay10
                  : theme.colors.whiteOverlay10,
              }}>
              <View style={styles.buttonContent}>
                <Image
                  source={require('../assets/recycle-icon.png')}
                  style={[styles.secondaryButtonIcon, styles.qrActionIcon]}
                  resizeMode="contain"
                />
                <Text
                  style={[styles.secondaryButtonText, styles.qrActionText]}
                  numberOfLines={1}>
                  Restart frames
                </Text>
              </View>
            </AppPressable>
            <AppPressable
              style={[styles.secondaryButton, styles.qrActionButton]}
              onPress={handleCycleSpeed}
              android_ripple={{
                color: isLightTheme
                  ? theme.colors.blackOverlay10
                  : theme.colors.whiteOverlay10,
              }}>
              <View style={styles.buttonContent}>
                <Image
                  source={require('../assets/refresh-icon.png')}
                  style={[styles.secondaryButtonIcon, styles.qrActionIcon]}
                  resizeMode="contain"
                />
                <Text
                  style={[styles.secondaryButtonText, styles.qrActionText]}
                  numberOfLines={1}>
                  Speed: {speedPreset.label}
                </Text>
              </View>
            </AppPressable>
          </View>
        </View>
      </View>
    ) : null;

  return (
    <AppModal
      visible={visible}
      transparent={true}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      {qrStage ?? (
      <GlassModalOverlay style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Image
              source={require('../assets/qr-icon.png')}
              style={styles.modalHeaderIcon}
              resizeMode="contain"
            />
            <Text style={styles.modalTitle}>Airgap QR Keyshare</Text>
            <AppPressable
              style={styles.closeButton}
              onPress={onClose}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text style={styles.closeButtonText}>✕</Text>
            </AppPressable>
          </View>
          <View style={styles.modalBody}>
            {isEncrypting && !exportUr ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text style={styles.loadingText}>Encrypting keyshare…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.privacyHint}>{PRIVACY_HINT}</Text>
                <Text style={styles.processHint}>{AIRGAP_PROCESS_HINT}</Text>
                <Text style={styles.pinLabel}>PIN</Text>
                <Text style={styles.pinValue}>
                  {pin ? formatAirgapPinDisplay(pin) : '— — —'}
                </Text>
                <Text style={styles.privacyHint}>{PIN_NEXT_HINT}</Text>
                <AppPressable
                  style={[
                    styles.primaryButton,
                    !pinReady && styles.disabledButton,
                  ]}
                  onPress={handleShowQr}
                  disabled={!pinReady}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <View style={styles.buttonContent}>
                    <Image
                      source={require('../assets/qr-icon.png')}
                      style={styles.buttonIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.primaryButtonText}>Show QR</Text>
                  </View>
                </AppPressable>
              </>
            )}
          </View>
        </View>
      </GlassModalOverlay>
      )}
    </AppModal>
  );
};

export default AirgapKeyshareExportModal;
