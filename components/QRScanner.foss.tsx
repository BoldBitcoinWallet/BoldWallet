import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Platform,
} from 'react-native';
import AppPressable from './AppPressable';
import BarcodeZxingScan from 'rn-barcode-zxing-scan';
import {useTheme} from '../theme';
import {dbg} from '../utils';
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
const QRScanner: React.FC<QRScannerProps> = ({
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
  // Keep latest callbacks/props in refs so continuous-scan effect does NOT
  // restart the native ZXing activity when progress / onScan identity changes.
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const titleRef = useRef(title);
  const subtitleRef = useRef(subtitle);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;
  titleRef.current = title;
  subtitleRef.current = subtitle;
  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'black',
    },
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
      color: theme.colors.textOnPrimary || theme.colors.white, // Use textOnPrimary for readability on primary button
    },
    cameraNotFoundContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'black',
    },
    cameraNotFoundText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
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
  const clearQrReaderCallback = useCallback(() => {
    BarcodeZxingScan.stopQrReader?.();
  }, []);
  const stopContinuousScan = useCallback(() => {
    dbg('FOSS: Stopping continuous scan');
    try {
      BarcodeZxingScan.stopContinuousScan();
      BarcodeZxingScan.updateProgressText('');
    } catch (e) {
      dbg('FOSS: stopContinuousScan error:', e);
    }
    isScanningRef.current = false;
    setIsScanning(false);
    if (scanSubscriptionRef.current) {
      scanSubscriptionRef.current.remove();
      scanSubscriptionRef.current = null;
    }
  }, []);
  const handleClose = useCallback(() => {
    if (mode === 'continuous' && Platform.OS === 'android') {
      stopContinuousScan();
    }
    clearQrReaderCallback();
    onCloseRef.current();
  }, [mode, clearQrReaderCallback, stopContinuousScan]);
  // Continuous scan: start/stop only when visibility or mode changes — never on
  // progress / onScan / isScanning updates (those used to reopen the camera each frame).
  useEffect(() => {
    if (
      !(visible && mode === 'continuous' && Platform.OS === 'android')
    ) {
      if (mode === 'continuous' && Platform.OS === 'android') {
        stopContinuousScan();
      }
      return;
    }
    if (isScanningRef.current) {
      return;
    }
    const {DeviceEventEmitter} = require('react-native');
    scanSubscriptionRef.current = DeviceEventEmitter.addListener(
      'BarcodeZxingScanContinuous',
      (event: {data?: string; error?: string}) => {
        if (event.error) {
          dbg('FOSS: Continuous scan error:', event.error);
          isScanningRef.current = false;
          setIsScanning(false);
          return;
        }
        if (event.data) {
          dbg('FOSS: Continuous scan result:', event.data.substring(0, 50));
          onScanRef.current(event.data);
        }
      },
    );
    isScanningRef.current = true;
    setIsScanning(true);
    BarcodeZxingScan.showQrReaderContinuous((error: any, data: any) => {
      if (error) {
        dbg('FOSS: Continuous scan error:', error);
        isScanningRef.current = false;
        setIsScanning(false);
        return;
      }
      if (data === 'SCANNER_STARTED') {
        isScanningRef.current = true;
        setIsScanning(true);
        const progressLabel =
          subtitleRef.current || titleRef.current || 'Scanning QR Code...';
        setTimeout(() => {
          if (isScanningRef.current) {
            BarcodeZxingScan.updateProgressText(progressLabel);
          }
        }, 100);
      }
    });
    return () => {
      stopContinuousScan();
    };
  }, [visible, mode, stopContinuousScan]);
  // Push progress into the native ZXing overlay without restarting the activity.
  useEffect(() => {
    if (
      !visible ||
      mode !== 'continuous' ||
      Platform.OS !== 'android' ||
      !isScanningRef.current
    ) {
      return;
    }
    if (progress && progress.total > 1) {
      const label =
        subtitle ||
        (progress.received >= progress.total
          ? 'Processing...'
          : `Keep scanning animated QR: ${progress.received} of ${progress.total}`);
      BarcodeZxingScan.updateProgressText(label);
    } else if (subtitle || title) {
      BarcodeZxingScan.updateProgressText(subtitle || title || '');
    }
  }, [visible, mode, progress, subtitle, title]);
  // Handle single scan
  const handleSingleScan = useCallback(() => {
    // Set custom status message before opening scanner (if supported)
    if (subtitleRef.current && BarcodeZxingScan.setStatusMessage) {
      BarcodeZxingScan.setStatusMessage(subtitleRef.current);
    }
    if (Platform.OS === 'android') {
      isScanningRef.current = true;
      BarcodeZxingScan.showQrReader((error: any, data: any) => {
        isScanningRef.current = false;
        // Clear custom status message
        if (BarcodeZxingScan.setStatusMessage) {
          BarcodeZxingScan.setStatusMessage('');
        }
        if (error) {
          dbg('FOSS: Single scan error:', error);
          onCloseRef.current();
          return;
        }
        if (data) {
          onScanRef.current(data);
          onCloseRef.current();
        } else {
          // No data, no error - user pressed back
          onCloseRef.current();
        }
      });
    } else {
      // iOS - use single scan
      isScanningRef.current = true;
      BarcodeZxingScan.showQrReader((error: any, data: any) => {
        isScanningRef.current = false;
        // Clear custom status message
        if (BarcodeZxingScan.setStatusMessage) {
          BarcodeZxingScan.setStatusMessage('');
        }
        if (error) {
          dbg('FOSS: iOS scan error:', error);
          onCloseRef.current();
          return;
        }
        if (data) {
          onScanRef.current(data);
          onCloseRef.current();
        } else {
          // No data, no error - user pressed back
          onCloseRef.current();
        }
      });
    }
  }, []);
  // Auto-start single scan when modal opens; clear stale callback when closed
  useEffect(() => {
    if (visible && mode === 'single' && !isScanningRef.current) {
      handleSingleScan();
    } else if (!visible && mode === 'single') {
      isScanningRef.current = false;
      clearQrReaderCallback();
      if (BarcodeZxingScan.setStatusMessage) {
        BarcodeZxingScan.setStatusMessage('');
      }
    }
  }, [visible, mode, handleSingleScan, clearQrReaderCallback]);
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
  // For continuous mode on Android, show the scanner UI
  if (mode === 'continuous' && Platform.OS === 'android' && visible) {
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
            android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
            <Text style={styles.closeScannerButtonText}>{closeButtonText}</Text>
          </AppPressable>
        </View>
      </Modal>
    );
  }
  // For single mode, the native scanner handles UI, but we show a placeholder
  // In practice, single mode opens native scanner which handles its own UI
  return null;
};
export default QRScanner;
