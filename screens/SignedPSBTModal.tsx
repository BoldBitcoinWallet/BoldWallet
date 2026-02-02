import React, {useCallback, useRef, useState, useMemo, useEffect} from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Alert,
  Image,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
// @ts-ignore - bc-ur types (Buffer polyfill is in polyfills.js)
import {UREncoder} from '@ngraveio/bc-ur';
// @ts-ignore - bc-ur-registry types
import {CryptoPSBT} from '@keystonehq/bc-ur-registry-btc';
// Buffer is available globally via polyfills.js
import {dbg, HapticFeedback} from '../utils';
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
      return cryptoPSBT.toUR();
    } catch (error) {
      dbg('Error creating UR object:', error);
      return null;
    }
  }, [psbtBytes]);
  // Helper function to create a new encoder and get a specific part
  const getURPart = useCallback(
    (partIndex: number = 0): string | null => {
      if (!urObject) return null;
      try {
        // Create a new encoder each time (since there's no reset method)
        const encoder = new UREncoder(urObject, 200);
        // Advance to the desired part
        for (let i = 0; i < partIndex; i++) {
          encoder.nextPart();
        }
        return encoder.nextPart();
      } catch (error) {
        dbg('Error getting UR part:', error);
        return null;
      }
    },
    [urObject],
  );
  // Get encoder info (fragmentsLength) - create a temporary encoder to get this
  const encoderInfo = useMemo(() => {
    if (!urObject) return null;
    try {
      const encoder = new UREncoder(urObject, 200) as any;
      return {
        fragmentsLength: encoder.fragmentsLength || 1,
      };
    } catch (error) {
      dbg('Error getting encoder info:', error);
      return null;
    }
  }, [urObject]);
  // Copy base64 to clipboard
  const handleCopy = useCallback(() => {
    HapticFeedback.light();
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
    HapticFeedback.medium();
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
      // Check if file exists and delete
      const fileExists = await RNFS.exists(filePath);
      if (fileExists) {
        await RNFS.unlink(filePath);
      }
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
      // Cleanup
      try {
        await RNFS.unlink(filePath);
      } catch {}
    } catch (error: any) {
      dbg('Error sharing PSBT file:', error);
      if (error?.message !== 'User did not share') {
        Alert.alert('Error', 'Failed to share PSBT file');
      }
    }
  }, [signedPsbtBase64]);
  // Share PSBT as animated QR (UR format)
  const handleShareQR = useCallback(async () => {
    HapticFeedback.medium();
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
      const fileExists = await RNFS.exists(filePath);
      if (fileExists) {
        await RNFS.unlink(filePath);
      }
      await RNFS.writeFile(filePath, base64Data, 'base64');
      await Share.open({
        title: 'Share Signed PSBT QR Code',
        message: 'Scan this QR code to import the signed PSBT',
        url: `file://${filePath}`,
        subject: 'Signed PSBT QR Code',
        isNewTask: true,
        failOnCancel: false,
      });
      // Cleanup
      try {
        await RNFS.unlink(filePath);
      } catch {}
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
      // For animated QR, get the specific frame
      const part = getURPart(qrFrameIndex);
      return part || signedPsbtBase64;
    } else {
      // Single QR mode
      // For large PSBTs, always use UR format (first part)
      // For small PSBTs, use base64 directly
      if (urObject) {
        // Use UR format - get first part
        const part = getURPart(0);
        return part || signedPsbtBase64;
      } else if (signedPsbtBase64.length <= 1000) {
        // Small PSBT - use base64 directly
        return signedPsbtBase64;
      } else {
        // Large PSBT but no UR - this shouldn't happen, but fallback to base64
        dbg('Warning: Large PSBT but no UR object available');
        return signedPsbtBase64;
      }
    }
  }, [qrMode, urObject, signedPsbtBase64, qrFrameIndex, getURPart]);
  const qrData = getQRData();
  const totalParts = encoderInfo ? encoderInfo.fragmentsLength : 1;
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
      // Double-check the actual QR data length by creating encoder and getting first part
      try {
        const encoder = new UREncoder(urObject, 200);
        const firstPart = encoder.nextPart();
        return firstPart ? firstPart.length <= 2500 : false; // Conservative limit
      } catch (error) {
        dbg('Error checking if PSBT fits in single QR:', error);
        return false;
      }
    }
    return false;
  }, [urObject, totalParts, signedPsbtBase64.length]);
  // If PSBT doesn't fit in single QR, force animated mode
  useEffect(() => {
    if (!fitsInSingleQR && qrMode === 'single') {
      setQrMode('animated');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitsInSingleQR]);
  const isAnimated = qrMode === 'animated' && urObject;
  const currentPart = encoderInfo ? qrFrameIndex + 1 : 1;
  // Auto-advance animated QR frames
  useEffect(() => {
    if (isAnimated && urObject && encoderInfo) {
      // Reset frame index when switching to animated mode
      setQrFrameIndex(0);
      const interval = setInterval(() => {
        setQrFrameIndex(prev => {
          const next = prev + 1;
          if (next >= encoderInfo.fragmentsLength) {
            // Loop back to start
            return 0;
          }
          return next;
        });
      }, 500); // Change frame every 500ms
      return () => clearInterval(interval);
    } else if (urObject) {
      // Reset frame index when switching away from animated mode
      setQrFrameIndex(0);
    }
  }, [isAnimated, urObject, encoderInfo]);
  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 20,
      padding: 24,
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
      marginBottom: 24,
      textAlign: 'center',
    },
    qrContainer: {
      alignItems: 'center',
      marginBottom: 24,
      padding: 16,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 12,
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
          <Text style={styles.title}>Signed PSBT</Text>
          <Text style={styles.subtitle}>
            Share back the signed PSBT
          </Text>
          <View style={styles.qrContainer}>
            {urObject && fitsInSingleQR && (
              <View style={styles.modeToggle}>
                <AppPressable
                  style={[
                    styles.modeButton,
                    qrMode === 'single' && styles.modeButtonActive,
                  ]}
                  onPress={() => {
                    HapticFeedback.light();
                    setQrMode('single');
                  }}>
                  <Text
                    style={[
                      styles.modeButtonText,
                      qrMode === 'single' && styles.modeButtonTextActive,
                    ]}>
                    Single QR
                  </Text>
                </AppPressable>
                <AppPressable
                  style={[
                    styles.modeButton,
                    qrMode === 'animated' && styles.modeButtonActive,
                  ]}
                  onPress={() => {
                    HapticFeedback.light();
                    setQrMode('animated');
                  }}>
                  <Text
                    style={[
                      styles.modeButtonText,
                      qrMode === 'animated' && styles.modeButtonTextActive,
                    ]}>
                    Animated QR
                  </Text>
                </AppPressable>
              </View>
            )}
            <QRCode
              ref={qrRef}
              value={qrData}
              size={250}
              color={theme.colors.text}
              backgroundColor={theme.colors.background}
            />
            {isAnimated && (
              <Text style={styles.qrInfo}>
                Frame {currentPart} of {totalParts}
              </Text>
            )}
            {!fitsInSingleQR && urObject && (
              <Text style={styles.qrInfo}>
                Large PSBT - Scanning all frames required
              </Text>
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
              <Text style={styles.buttonSecondaryText}>
                {isCopied ? '✓ Copied' : 'Copy'}
              </Text>
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
              <Text style={styles.buttonSecondaryText}>Share File</Text>
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
              <Text style={styles.buttonText}>Share QR Code</Text>
            </AppPressable>
          )}
          <AppPressable
            style={styles.closeButton}
            onPress={onClose}
            android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
            <Text style={styles.closeButtonText}>Close</Text>
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
