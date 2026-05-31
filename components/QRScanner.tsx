import React, {useState, useEffect, useRef} from 'react';
import {View, Text, StyleSheet, Modal, Platform} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {dbg} from '../utils';
// iOS-specific imports (only imported when needed)
let Camera: any = null;
let useCameraDevice: any = null;
let useCodeScanner: any = null;
if (Platform.OS === 'ios') {
  try {
    const visionCamera = require('react-native-vision-camera');
    Camera = visionCamera.Camera;
    useCameraDevice = visionCamera.useCameraDevice;
    useCodeScanner = visionCamera.useCodeScanner;
  } catch (e) {
    dbg('Vision camera not available:', e);
  }
}
// Android-specific import
let BarcodeZxingScan: any = null;
if (Platform.OS === 'android') {
  try {
    BarcodeZxingScan = require('rn-barcode-zxing-scan').default;
  } catch (e) {
    dbg('BarcodeZxingScan not available:', e);
  }
}
export interface QRProgress {
  received: number;
  total: number;
  percentage?: number;
}
export interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
  mode?: 'single' | 'continuous';
  title?: string;
  subtitle?: string;
  showProgress?: boolean;
  progress?: QRProgress;
  closeButtonText?: string;
}
// iOS QR Scanner Component (uses vision-camera)
const IOSQRScanner: React.FC<QRScannerProps> = ({
  visible,
  onClose,
  onScan,
  mode = 'single',
  title,
  subtitle,
  showProgress = false,
  progress,
  closeButtonText = 'Close',
}) => {
  const {theme} = useTheme();
  const device = useCameraDevice('back');
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: any) => {
      if (codes.length > 0 && codes[0].value) {
        onScan(codes[0].value);
        if (mode === 'single') {
          onClose();
        }
      }
    },
  });
  const styles = StyleSheet.create({
    scannerContainer: {
      flex: 1,
      backgroundColor: 'black',
    },
    qrFrame: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: theme.colors.primary,
      width: 250,
      height: 250,
      alignSelf: 'center',
      top: '25%',
      borderRadius: 12,
    },
    scannerHeader: {
      position: 'absolute',
      top: 80,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    scannerTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
      backgroundColor: theme.colors.blackOverlay30,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    scannerSubtitle: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.white,
      backgroundColor: theme.colors.blackOverlay30,
      borderRadius: 12,
      padding: 12,
      textAlign: 'center',
      paddingHorizontal: 20,
    },
    progressBarContainer: {
      marginTop: 16,
      width: 200,
      height: 6,
      backgroundColor: theme.colors.white + '33', // ~20% opacity
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: theme.colors.bitcoinOrange,
      borderRadius: 3,
    },
    closeScannerButton: {
      position: 'absolute',
      bottom: 60,
      alignSelf: 'center',
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
    },
    closeScannerButtonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textOnPrimary || theme.colors.white,
    },
    cameraNotFoundContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'black',
    },
    cameraNotFoundText: {
      fontSize: theme.fontSizes?.lg || 16,
      color: theme.colors.white,
      marginBottom: 8,
    },
    cameraNotFoundSubtext: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.white + 'B3', // ~70% opacity
      textAlign: 'center',
      paddingHorizontal: 20,
    },
  });
  if (!device || !codeScanner) {
    return (
      <Modal
        visible={visible}
        transparent={false}
        animationType="fade"
        onRequestClose={onClose}>
        <View style={styles.cameraNotFoundContainer}>
          <Text style={styles.cameraNotFoundText}>Camera Not Available</Text>
          <Text style={styles.cameraNotFoundSubtext}>
            Please check camera permissions in Settings
          </Text>
          <AppPressable
            style={styles.closeScannerButton}
            onPress={onClose}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Text style={styles.closeScannerButtonText}>{closeButtonText}</Text>
          </AppPressable>
        </View>
      </Modal>
    );
  }
  const isAnimatedQR = showProgress && progress && progress.total > 1;
  const progressPercent = isAnimatedQR
    ? Math.min(
        100,
        progress.percentage ||
          Math.round((progress.received / progress.total) * 100),
      )
    : 0;
  const isComplete = isAnimatedQR && progress.received >= progress.total;
  const displayTitle =
    title || (isAnimatedQR ? 'Scanning Animated QR...' : 'Scan QR Code');
  const displaySubtitle =
    subtitle ||
    (isAnimatedQR
      ? isComplete
        ? 'Processing...'
        : `Keep scanning animated QR: ${progressPercent}%`
      : 'Point camera at the QR code to scan');
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.scannerContainer}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={visible}
          torch="off"
          codeScanner={codeScanner}
        />
        <View style={styles.qrFrame} />
        {(title || subtitle || showProgress) && (
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>{displayTitle}</Text>
            <Text style={styles.scannerSubtitle}>{displaySubtitle}</Text>
            {isAnimatedQR && (
              <View style={styles.progressBarContainer}>
                <View
                  style={[styles.progressBar, {width: `${progressPercent}%`}]}
                />
              </View>
            )}
          </View>
        )}
        <AppPressable
          style={styles.closeScannerButton}
          onPress={onClose}
          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
          <Text style={styles.closeScannerButtonText}>{closeButtonText}</Text>
        </AppPressable>
      </View>
    </Modal>
  );
};
// Android QR Scanner Component (uses BarcodeZxingScan)
const AndroidQRScanner: React.FC<QRScannerProps> = ({
  visible,
  onClose,
  onScan,
  mode = 'single',
  title,
  subtitle,
  showProgress = false,
  progress,
  closeButtonText = 'Close',
}) => {
  const {theme} = useTheme();
  const [_isScanning, setIsScanning] = useState(false);
  const scanSubscriptionRef = useRef<any>(null);
  const isScanningRef = useRef(false);
  const styles = StyleSheet.create({
    scannerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'black',
    },
    qrFrame: {
      width: 250,
      height: 250,
      borderWidth: 2,
      borderColor: theme.colors.primary,
      borderRadius: 12,
      position: 'absolute',
      alignSelf: 'center',
      top: '25%',
    },
    scannerHeader: {
      position: 'absolute',
      top: 80,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    scannerTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
      marginBottom: 8,
    },
    scannerSubtitle: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.white + 'B3', // ~70% opacity
      textAlign: 'center',
      paddingHorizontal: 20,
    },
    progressBarContainer: {
      marginTop: 16,
      width: 200,
      height: 6,
      backgroundColor: theme.colors.white + '33', // ~20% opacity
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: theme.colors.bitcoinOrange,
      borderRadius: 3,
    },
    closeScannerButton: {
      position: 'absolute',
      bottom: 60,
      alignSelf: 'center',
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
    },
    closeScannerButtonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textOnPrimary || theme.colors.white,
    },
  });
  // Handle scanner close - properly stop scanner and cleanup
  const handleClose = () => {
    if (mode === 'continuous' && isScanningRef.current && BarcodeZxingScan) {
      dbg('Android: Stopping continuous scan (close requested)');
      BarcodeZxingScan.stopContinuousScan();
      BarcodeZxingScan.updateProgressText('');
      isScanningRef.current = false;
      setIsScanning(false);
    }
    if (BarcodeZxingScan?.stopQrReader) {
      BarcodeZxingScan.stopQrReader();
    }
    if (scanSubscriptionRef.current) {
      scanSubscriptionRef.current.remove();
      scanSubscriptionRef.current = null;
    }
    onClose();
  };
  // Handle continuous scanning for Android
  useEffect(() => {
    if (visible && mode === 'continuous' && BarcodeZxingScan) {
      // Only start if not already scanning
      if (!isScanningRef.current) {
        const {DeviceEventEmitter} = require('react-native');
        scanSubscriptionRef.current = DeviceEventEmitter.addListener(
          'BarcodeZxingScanContinuous',
          (event: {data?: string; error?: string}) => {
            if (event.error) {
              dbg('Android: Continuous scan error:', event.error);
              isScanningRef.current = false;
              setIsScanning(false);
              return;
            }
            if (event.data) {
              dbg(
                'Android: Continuous scan result:',
                event.data.substring(0, 50),
              );
              onScan(event.data);
            }
          },
        );
        BarcodeZxingScan.showQrReaderContinuous((error: any, data: any) => {
          if (error) {
            dbg('Android: Continuous scan error:', error);
            isScanningRef.current = false;
            setIsScanning(false);
            return;
          }
          if (data === 'SCANNER_STARTED') {
            isScanningRef.current = true;
            setIsScanning(true);
            if (showProgress) {
              setTimeout(() => {
                BarcodeZxingScan.updateProgressText(
                  title || 'Scanning QR Code...',
                );
              }, 100);
            }
          }
        });
      }
    } else if (!visible && mode === 'continuous' && BarcodeZxingScan) {
      // Stop scanner when modal becomes invisible
      if (isScanningRef.current) {
        dbg('Android: Stopping continuous scan (modal closed)');
        BarcodeZxingScan.stopContinuousScan();
        BarcodeZxingScan.updateProgressText('');
        isScanningRef.current = false;
        setIsScanning(false);
      }
      if (scanSubscriptionRef.current) {
        scanSubscriptionRef.current.remove();
        scanSubscriptionRef.current = null;
      }
    }
    return () => {
      // Cleanup on unmount or when dependencies change
      if (scanSubscriptionRef.current) {
        scanSubscriptionRef.current.remove();
        scanSubscriptionRef.current = null;
      }
      if (mode === 'continuous' && isScanningRef.current && BarcodeZxingScan) {
        dbg('Android: Cleanup - stopping continuous scan');
        BarcodeZxingScan.stopContinuousScan();
        BarcodeZxingScan.updateProgressText('');
        isScanningRef.current = false;
        setIsScanning(false);
      }
    };
  }, [visible, mode, onScan, showProgress, title]);
  // Handle single scan - native scanner handles its own UI and back button
  useEffect(() => {
    if (
      visible &&
      mode === 'single' &&
      BarcodeZxingScan &&
      !isScanningRef.current
    ) {
      // For single mode, native scanner opens its own activity
      // Set custom status message before opening scanner (if supported)
      if (subtitle && BarcodeZxingScan.setStatusMessage) {
        BarcodeZxingScan.setStatusMessage(subtitle);
      }
      // It handles back button itself, we just need to handle the result
      BarcodeZxingScan.showQrReader((error: any, data: any) => {
        // Scanner closed (either via back button or scan completed)
        isScanningRef.current = false;
        // Clear custom status message
        if (BarcodeZxingScan.setStatusMessage) {
          BarcodeZxingScan.setStatusMessage('');
        }
        if (error) {
          dbg('Android: Single scan error:', error);
          // User pressed back or cancelled - close our modal too
          onClose();
          return;
        }
        if (data) {
          onScan(data);
          onClose();
        } else {
          // No data but no error - user likely pressed back
          onClose();
        }
      });
      isScanningRef.current = true;
    } else if (!visible && mode === 'single') {
      // Reset scanning state when modal closes
      isScanningRef.current = false;
      if (BarcodeZxingScan?.stopQrReader) {
        BarcodeZxingScan.stopQrReader();
      }
      // Clear custom status message
      if (BarcodeZxingScan && BarcodeZxingScan.setStatusMessage) {
        BarcodeZxingScan.setStatusMessage('');
      }
    }
  }, [visible, mode, onScan, onClose, subtitle]);
  const isAnimatedQR = showProgress && progress && progress.total > 1;
  const progressPercent = isAnimatedQR
    ? Math.min(
        100,
        progress.percentage ||
          Math.round((progress.received / progress.total) * 100),
      )
    : 0;
  const isComplete = isAnimatedQR && progress.received >= progress.total;
  const displayTitle =
    title || (isAnimatedQR ? 'Scanning Animated QR...' : 'Scan QR Code');
  const displaySubtitle =
    subtitle ||
    (isAnimatedQR
      ? isComplete
        ? 'Processing...'
        : `Keep scanning animated QR: ${progressPercent}%`
      : 'Point camera at the QR code to scan');
  // For continuous mode, show UI overlay
  if (mode === 'continuous' && visible) {
    return (
      <Modal
        visible={visible}
        transparent={false}
        animationType="fade"
        onRequestClose={handleClose}>
        <View style={styles.scannerContainer}>
          <View style={styles.qrFrame} />
          {(title || subtitle || showProgress) && (
            <View style={styles.scannerHeader}>
              <Text style={styles.scannerTitle}>{displayTitle}</Text>
              <Text style={styles.scannerSubtitle}>{displaySubtitle}</Text>
              {isAnimatedQR && (
                <View style={styles.progressBarContainer}>
                  <View
                    style={[styles.progressBar, {width: `${progressPercent}%`}]}
                  />
                </View>
              )}
            </View>
          )}
          <AppPressable
            style={styles.closeScannerButton}
            onPress={handleClose}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Text style={styles.closeScannerButtonText}>{closeButtonText}</Text>
          </AppPressable>
        </View>
      </Modal>
    );
  }
  // For single mode, native scanner handles UI - return null (modal is just a container)
  // The native activity will handle its own UI and back button
  return null;
};
// Main QRScanner component - routes to platform-specific implementation
const QRScanner: React.FC<QRScannerProps> = props => {
  if (Platform.OS === 'ios') {
    return <IOSQRScanner {...props} />;
  } else {
    return <AndroidQRScanner {...props} />;
  }
};
export default QRScanner;
