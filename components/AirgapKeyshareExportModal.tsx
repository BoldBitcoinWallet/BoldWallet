import React, {useEffect, useRef, useState} from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  Alert,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  NativeModules,
} from 'react-native';
import {Buffer} from 'buffer';
import type {UR} from '@ngraveio/bc-ur';
import AppPressable from './AppPressable';
import GlassModalOverlay from './GlassModalOverlay';
import AnimatedUrQr from './AnimatedUrQr';
import {dbg, getKeyshareMetadata} from '../utils';
import {useTheme} from '../theme';
import {bufferToUr} from '../utils/urBytesQr';
import {formatAirgapPinDisplay, generateAirgapPin} from '../services/airgapPin';

const {BBMTLibNativeModule} = NativeModules;

type ExportStep = 'pin' | 'qr';

interface AirgapKeyshareExportModalProps {
  visible: boolean;
  onClose: () => void;
}

const PRIVACY_HINT = 'Eyes on these two screens only.';
const PIN_NEXT_HINT = 'Read the PIN on the new phone, then show the QR.';
const AIRGAP_QR_HINT =
  'Keep scanning until the other phone finishes. Restart if it missed the start.';

const AirgapKeyshareExportModal: React.FC<AirgapKeyshareExportModalProps> = ({
  visible,
  onClose,
}) => {
  const {theme} = useTheme();
  const {width: windowWidth} = useWindowDimensions();
  const qrSize = Math.min(280, Math.max(220, Math.round(windowWidth * 0.62)));

  const [step, setStep] = useState<ExportStep>('pin');
  const [exportUr, setExportUr] = useState<UR | null>(null);
  const [pin, setPin] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible) {
      setExportUr(null);
      setPin('');
      setIsEncrypting(false);
      setStep('pin');
      setRestartNonce(0);
      return;
    }

    let cancelled = false;
    const encryptWithPin = async () => {
      setIsEncrypting(true);
      setExportUr(null);
      setStep('pin');
      setRestartNonce(0);
      try {
        const nextPin = await generateAirgapPin();
        const meta = await getKeyshareMetadata();
        if (!meta) {
          throw new Error('Invalid keyshare.');
        }
        const encryptedKeyshare =
          await BBMTLibNativeModule.aesEncryptStoredKeyshare(
            await BBMTLibNativeModule.sha256(nextPin),
          );
        if (!encryptedKeyshare) {
          throw new Error('Failed to encrypt the keyshare.');
        }
        const ur = bufferToUr(Buffer.from(encryptedKeyshare, 'base64'));
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
          Alert.alert(
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

  const isLightTheme = theme.colors.background === '#ffffff';

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      width: '90%',
      maxWidth: 440,
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
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
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
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      minHeight: 48,
      marginTop: 12,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonContentBalanced: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
    },
    buttonSideSlot: {
      width: 32,
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
      width: 20,
      height: 20,
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
      flex: 1,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: isLightTheme ? theme.colors.white : theme.colors.text,
      textAlign: 'center',
    },
    qrCodeContainer: {
      backgroundColor: 'white',
      padding: 0,
      borderRadius: 8,
    },
    qrFrameLabel: {
      marginTop: 8,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      textAlign: 'center',
    },
    qrAnimatedHint: {
      marginTop: 8,
      marginBottom: 8,
      paddingHorizontal: 8,
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      textAlign: 'center',
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
    scrollContent: {
      alignItems: 'center',
      width: '100%',
    },
    qrStep: {
      width: '100%',
      alignItems: 'stretch',
    },
    qrScroll: {
      width: '100%',
    },
  });

  const pinReady = !!pin && !!exportUr && !isEncrypting;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <GlassModalOverlay style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Image
              source={require('../assets/qr-icon.png')}
              style={styles.modalHeaderIcon}
              resizeMode="contain"
            />
            <Text style={styles.modalTitle}>
              {step === 'qr' ? 'Scan Encrypted Keyshare' : 'Airgap QR Keyshare'}
            </Text>
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
            ) : step === 'pin' ? (
              <>
                <Text style={styles.privacyHint}>{PRIVACY_HINT}</Text>
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
            ) : (
              <View style={styles.qrStep}>
                <ScrollView
                  style={styles.qrScroll}
                  contentContainerStyle={styles.scrollContent}
                  showsVerticalScrollIndicator={false}>
                  {exportUr ? (
                    <AnimatedUrQr
                      ur={exportUr}
                      size={qrSize}
                      restartNonce={restartNonce}
                      frameLabelStyle={styles.qrFrameLabel}
                      hintStyle={styles.qrAnimatedHint}
                      containerStyle={styles.qrCodeContainer}
                      hint={AIRGAP_QR_HINT}
                      fallbackText="Could not render animated QR."
                    />
                  ) : (
                    <Text style={styles.qrAnimatedHint}>
                      Could not render animated QR.
                    </Text>
                  )}
                </ScrollView>
                <AppPressable
                  style={styles.secondaryButton}
                  onPress={handleRestartFrames}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <View style={styles.buttonContentBalanced}>
                    <View style={styles.buttonSideSlot}>
                      <Image
                        source={require('../assets/recycle-icon.png')}
                        style={styles.secondaryButtonIcon}
                        resizeMode="contain"
                      />
                    </View>
                    <Text style={styles.secondaryButtonText}>
                      Restart frames
                    </Text>
                    <View style={styles.buttonSideSlot} />
                  </View>
                </AppPressable>
              </View>
            )}
          </View>
        </View>
      </GlassModalOverlay>
    </Modal>
  );
};

export default AirgapKeyshareExportModal;
