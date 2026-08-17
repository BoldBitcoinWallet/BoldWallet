import React, {useCallback, useRef, useState, useMemo, useEffect} from 'react';
import {
  View,
  Modal,
  StyleSheet,
  Alert,
  Image,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import StaticQRCode from '../components/StaticQRCode';
import AppText from '../components/AppText';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import {safeUnlink} from '../services/rnfsSafe';
// @ts-ignore - bc-ur-registry types
import {CryptoPSBT} from '@keystonehq/bc-ur-registry-btc';
import type {UR} from '@ngraveio/bc-ur';
import {urFragmentCount, urPartAt} from '../utils/urBytesQr';
import {dbg} from '../utils';
import {useTheme} from '../theme';
import Toast from 'react-native-toast-message';
import {createToastConfig} from '../utils/toastConfig';
interface SignedPSBTModalProps {
  visible: boolean;
  signedPsbtBase64: string;
  onClose: () => void;
}
const SignedPSBTModal: React.FC<SignedPSBTModalProps> = ({
  visible,
  signedPsbtBase64,
  onClose,
}) => {
  const {theme} = useTheme();
  const [isCopied, setIsCopied] = useState(false);
  const [qrMode, setQrMode] = useState<'single' | 'animated'>('single');
  const qrRef = useRef<any>(null);
  // Convert base64 PSBT to bytes for UR encoding
  const psbtBytes = useMemo(() => {
    try {
      // Decode base64 to get raw bytes
      const binaryString = atob(signedPsbtBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    } catch (error) {
      dbg('Error converting PSBT to bytes:', error);
      return null;
    }
  }, [signedPsbtBase64]);
  // Store the original UR object (not the encoder, since encoder doesn't have reset)
  const urObject = useMemo(() => {
    if (!psbtBytes) return null;
    try {
      // Create CryptoPSBT from PSBT bytes
      // CryptoPSBT expects a Buffer, so convert Uint8Array to Buffer
      // Buffer is available globally via polyfills.js
      const psbtBuffer = (global as any).Buffer.from(psbtBytes);
      const cryptoPSBT = new CryptoPSBT(psbtBuffer);
      // Convert to UR format
      return cryptoPSBT.toUR() as UR;
    } catch (error) {
      dbg('Error creating UR object:', error);
      return null;
    }
  }, [psbtBytes]);
  const totalParts = useMemo(
    () => (urObject ? urFragmentCount(urObject) : 1),
    [urObject],
  );
  // Copy base64 to clipboard
  const handleCopy = useCallback(() => {
    Clipboard.setString(signedPsbtBase64);
    setIsCopied(true);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'PSBT copied to clipboard',
      position: 'bottom',
    });
    setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  }, [signedPsbtBase64]);
  // Share PSBT as file
  const handleShareFile = useCallback(async () => {
    try {
      // Create .psbt file
      const now = new Date();
      const month = now.toLocaleDateString('en-US', {month: 'short'});
      const day = now.getDate().toString().padStart(2, '0');
      const year = now.getFullYear();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const filename = `signed-psbt.${month}${day}.${year}.${hours}${minutes}.psbt`;
      const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
      const filePath = `${tempDir}/${filename}`;
      await safeUnlink(filePath);
      // Write base64 PSBT to file (as binary)
      await RNFS.writeFile(filePath, signedPsbtBase64, 'base64');
      // Share the file
      await Share.open({
        title: 'Share Signed PSBT',
        message: 'Signed Partially Signed Bitcoin Transaction',
        url: `file://${filePath}`,
        type: 'application/octet-stream',
        filename: filename,
        isNewTask: true,
        failOnCancel: false,
      });
      await safeUnlink(filePath);
    } catch (error: any) {
      dbg('Error sharing PSBT file:', error);
      if (error?.message !== 'User did not share') {
        Alert.alert('Error', 'Failed to share PSBT file');
      }
    }
  }, [signedPsbtBase64]);
  // Share PSBT as animated QR (UR format)
  const handleShareQR = useCallback(async () => {
    if (!qrRef.current) {
      Alert.alert('Error', 'QR Code is not ready yet');
      return;
    }
    try {
      // Generate base64 from QR component
      const base64Data: string = await new Promise((resolve, reject) => {
        qrRef.current.toDataURL((data: string) => {
          if (data) {
            resolve(data);
          } else {
            reject(new Error('No base64 data returned from QR code'));
          }
        });
      });
      const filePath = `${RNFS.TemporaryDirectoryPath}/signed-psbt-qr.jpg`;
      await safeUnlink(filePath);
      await RNFS.writeFile(filePath, base64Data, 'base64');
      await Share.open({
        title: 'Share Signed PSBT QR Code',
        message: 'Scan this QR code to import the signed PSBT',
        url: `file://${filePath}`,
        subject: 'Signed PSBT QR Code',
        isNewTask: true,
        failOnCancel: false,
      });
      await safeUnlink(filePath);
    } catch (error: any) {
      dbg('Error sharing QR code:', error);
      if (error?.message !== 'User did not share') {
        Alert.alert('Error', 'Failed to share QR code');
      }
    }
  }, []);
  // Track frame index for animated QR
  const [qrFrameIndex, setQrFrameIndex] = useState(0);
  // Get current QR data (single or animated)
  const getQRData = useCallback(() => {
    if (qrMode === 'animated' && urObject) {
      const part = urPartAt(urObject, qrFrameIndex);
      return part || signedPsbtBase64;
    } else {
      if (urObject) {
        const part = urPartAt(urObject, 0);
        return part || signedPsbtBase64;
      } else if (signedPsbtBase64.length <= 1000) {
        return signedPsbtBase64;
      } else {
        dbg('Warning: Large PSBT but no UR object available');
        return signedPsbtBase64;
      }
    }
  }, [qrMode, urObject, signedPsbtBase64, qrFrameIndex]);
  const qrData = getQRData();
  // Check if PSBT fits in a single QR code
  // QR codes can handle up to ~2953 bytes (Level H), but we'll be conservative
  // Also check if it's only 1 fragment (meaning it fits in one UR part)
  const fitsInSingleQR = useMemo(() => {
    if (!urObject) {
      // If no UR object, check base64 length directly
      return signedPsbtBase64.length <= 2000; // Conservative limit
    }
    // If it's only 1 fragment, it fits in a single QR
    if (totalParts === 1) {
      const firstPart = urPartAt(urObject, 0);
      return firstPart ? firstPart.length <= 2500 : false;
    }
    return false;
  }, [urObject, totalParts, signedPsbtBase64.length]);
  // If PSBT doesn't fit in single QR, force animated mode
  useEffect(() => {
    if (!fitsInSingleQR && qrMode === 'single') {
      setQrMode('animated');
    }
    // Omit qrMode from deps: we only auto-switch single→animated when size changes; including qrMode would fight user toggles or cause redundant runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitsInSingleQR]);
  const isAnimated = qrMode === 'animated' && urObject;
  const currentPart = qrFrameIndex + 1;
  // Auto-advance animated QR frames
  useEffect(() => {
    if (isAnimated && urObject && totalParts > 0) {
      setQrFrameIndex(0);
      const interval = setInterval(() => {
        setQrFrameIndex(prev => {
          const next = prev + 1;
          if (next >= totalParts) {
            return 0;
          }
          return next;
        });
      }, 500);
      return () => clearInterval(interval);
    } else if (urObject) {
      setQrFrameIndex(0);
    }
  }, [isAnimated, urObject, totalParts]);
  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 10,
      padding: 16,
      width: '90%',
      maxWidth: 500,
      maxHeight: '90%',
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
    },
    title: {
      fontSize: theme.fontSizes?.['3xl'] || 24,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
      marginBottom: 12,
      textAlign: 'center',
    },
    qrContainer: {
      alignItems: 'center',
      marginBottom: 10,
      backgroundColor: 'white',
      padding: 6,
      borderRadius: 6,
    },
    qrCode: {
      marginBottom: 12,
    },
    qrInfo: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 12,
    },
    button: {
      flex: 1,
      backgroundColor: theme.colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    buttonText: {
      color: theme.colors.textOnPrimary,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      height: 20,
      marginLeft: 8,
    },
    buttonSecondary: {
      backgroundColor: theme.colors.cardBackground,
    },
    buttonSecondaryText: {
      color: theme.colors.text,
      marginLeft: 8,
    },
    buttonIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.text,
    },
    closeButton: {
      marginTop: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      backgroundColor: theme.colors.cardBackground,
      alignItems: 'center',
    },
    closeButtonText: {
      color: theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    toastContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 10000,
      elevation: 10000,
      pointerEvents: 'box-none',
    },
    modeToggle: {
      flexDirection: 'row',
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      padding: 4,
      marginBottom: 16,
    },
    modeButton: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 6,
      alignItems: 'center',
    },
    modeButtonActive: {
      backgroundColor: theme.colors.primary,
    },
    modeButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
    },
    modeButtonTextActive: {
      color: '#FFFFFF',
    },
  });
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <AppPressable
        style={styles.modalOverlay}
        onPress={onClose}>
          <AppPressable
          style={styles.modalContent}
          onPress={e => e.stopPropagation()}>
          <AppText style={styles.subtitle}>
            Share back the signed PSBT
          </AppText>
          <View style={styles.qrContainer}>
            {urObject && fitsInSingleQR && (
              <View style={styles.modeToggle}>
                <AppPressable
                  style={[
                    styles.modeButton,
                    qrMode === 'single' && styles.modeButtonActive,
                  ]}
                  onPress={() => {
                    setQrMode('single');
                  }}>
                  <AppText
                    style={[
                      styles.modeButtonText,
                      qrMode === 'single' && styles.modeButtonTextActive,
                    ]}>
                    Single QR
                  </AppText>
                </AppPressable>
                <AppPressable
                  style={[
                    styles.modeButton,
                    qrMode === 'animated' && styles.modeButtonActive,
                  ]}
                  onPress={() => {
                    setQrMode('animated');
                  }}>
                  <AppText
                    style={[
                      styles.modeButtonText,
                      qrMode === 'animated' && styles.modeButtonTextActive,
                    ]}>
                    Animated QR
                  </AppText>
                </AppPressable>
              </View>
            )}
            {qrMode === 'single' ? (
              <StaticQRCode
                value={qrData}
                size={250}
                copyContent={signedPsbtBase64}
                toastMessage="PSBT copied to clipboard"
                getRef={ref => (qrRef.current = ref)}
                style={styles.qrCode}
              />
            ) : (
              <QRCode
                ref={qrRef}
                value={qrData}
                size={250}
                color="black"
                backgroundColor="white"
              />
            )}
            {isAnimated && (
              <AppText style={styles.qrInfo}>
                Frame {currentPart} of {totalParts}
              </AppText>
            )}
            {!fitsInSingleQR && urObject && (
              <AppText style={styles.qrInfo}>
                Large PSBT - Scanning all frames required
              </AppText>
            )}
          </View>
          <View style={styles.buttonRow}>
            <AppPressable
              style={[styles.button, styles.buttonSecondary]}
              onPress={handleCopy}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Image
                source={require('../assets/paste-icon.png')}
                style={styles.buttonIcon}
                resizeMode="contain"
              />
              <AppText style={styles.buttonSecondaryText}>
                {isCopied ? '✓ Copied' : 'Copy'}
              </AppText>
            </AppPressable>
            <AppPressable
              style={[styles.button, styles.buttonSecondary]}
              onPress={handleShareFile}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Image
                source={require('../assets/share-icon.png')}
                style={styles.buttonIcon}
                resizeMode="contain"
              />
              <AppText style={styles.buttonSecondaryText}>Share File</AppText>
            </AppPressable>
          </View>
          {fitsInSingleQR && (
            <AppPressable
              style={styles.button}
              onPress={handleShareQR}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Image
                source={require('../assets/share-icon.png')}
                style={[styles.buttonIcon, {tintColor: theme.colors.textOnPrimary}]}
                resizeMode="contain"
              />
              <AppText style={styles.buttonText} tone="onPrimary">
                Share QR Code
              </AppText>
            </AppPressable>
          )}
          <AppPressable
            style={styles.closeButton}
            onPress={onClose}
            android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
            <AppText style={styles.closeButtonText}>Close</AppText>
          </AppPressable>
          </AppPressable>
      </AppPressable>
      <View style={styles.toastContainer}>
        <Toast config={createToastConfig(theme)} />
      </View>
    </Modal>
  );
};
export default SignedPSBTModal;
