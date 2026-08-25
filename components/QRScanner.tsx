import React, {useState, useEffect, useRef} from 'react';
import {View, Text, StyleSheet, Modal, Platform} from 'react-native';
import AppPressable from './AppPressable';
import {ScannerHud, useElapsedScanSeconds, useUrScanFrameHud} from './QRScannerHud';
import {
  elapsedScanSecondsSince,
  formatAndroidZxingProgressLabel,
} from '../utils/scanElapsed';
import {useTheme} from '../theme';
import {dbg, areHapticsEnabled, HapticFeedback} from '../utils';
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

/** Stop native ZXing continuous scan before heavy JS work (AES import). */
export function stopAndroidContinuousScan(): void {
  if (Platform.OS !== 'android' || !BarcodeZxingScan) {
    return;
  }
  try {
    BarcodeZxingScan.stopContinuousScan();
    BarcodeZxingScan.updateProgressText('');
  } catch (e) {
    dbg('Android: stopAndroidContinuousScan error:', e);
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
  const elapsedSeconds = useElapsedScanSeconds(visible);
  const {frameProgress, noteScannedFrame} = useUrScanFrameHud(visible);
  const device = useCameraDevice('back');
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: any) => {
      if (codes.length > 0 && codes[0].value) {
        const value = codes[0].value;
        if (noteScannedFrame(value)) {
          HapticFeedback.light();
        }
        onScan(value);
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
      borderWidth: 0,
      width: 260,
      height: 260,
      alignSelf: 'center',
      top: '32%',
    },
    scannerHeader: {
      position: 'absolute',
      top: 56,
      left: 0,
      right: 0,
      alignItems: 'center',
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
  const hudProgress =
    progress && progress.total > 1 ? progress : frameProgress || undefined;
  const hudShowProgress = !!(
    (progress && progress.total > 1) ||
    (frameProgress && frameProgress.total > 1)
  );
  const progressPercent = isAnimatedQR
    ? Math.min(
        100,
        progress.percentage ||
          Math.round((progress.received / progress.total) * 100),
      )
    : hudShowProgress && hudProgress
      ? Math.min(
          100,
          hudProgress.percentage ||
            Math.round((hudProgress.received / hudProgress.total) * 100),
        )
      : 0;
  const isComplete = isAnimatedQR && progress.received >= progress.total;
  const displayTitle =
    title || (isAnimatedQR ? 'Scanning Animated QR...' : 'Scan QR Code');
  const displaySubtitle =
    subtitle ||
    (hudShowProgress && hudProgress
      ? isComplete
        ? 'Processing...'
        : `${hudProgress.received} / ${hudProgress.total} (${progressPercent}%)`
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
        <ScannerHud
          title={displayTitle}
          subtitle={displaySubtitle}
          elapsedSeconds={elapsedSeconds}
          showProgress={hudShowProgress}
          progress={hudProgress}
        />
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
  progress,
}) => {
  const [_isScanning, setIsScanning] = useState(false);
  const scanSubscriptionRef = useRef<any>(null);
  const isScanningRef = useRef(false);
  const scanStartedAtRef = useRef(0);
  // Keep latest callbacks/props in refs so continuous-scan effect does NOT
  // restart the native ZXing activity when progress / onScan identity changes.
  // (Airgap / animated UR updates progress every frame — restarting caused flicker.)
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const titleRef = useRef(title);
  const subtitleRef = useRef(subtitle);
  const progressRef = useRef(progress);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;
  titleRef.current = title;
  subtitleRef.current = subtitle;
  progressRef.current = progress;
  const pushNativeProgressText = () => {
    if (!BarcodeZxingScan?.updateProgressText || !isScanningRef.current) {
      return;
    }
    BarcodeZxingScan.updateProgressText(
      formatAndroidZxingProgressLabel({
        title: titleRef.current,
        subtitle: subtitleRef.current,
        progress: progressRef.current,
        elapsedSeconds: elapsedScanSecondsSince(scanStartedAtRef.current),
      }),
    );
  };
  const pushNativeProgressTextRef = useRef(pushNativeProgressText);
  pushNativeProgressTextRef.current = pushNativeProgressText;
  const stopContinuousScan = () => {
    if (!BarcodeZxingScan) {
      if (scanSubscriptionRef.current) {
        scanSubscriptionRef.current.remove();
        scanSubscriptionRef.current = null;
      }
      isScanningRef.current = false;
      scanStartedAtRef.current = 0;
      setIsScanning(false);
      return;
    }
    dbg('Android: Stopping continuous scan');
    try {
      BarcodeZxingScan.stopContinuousScan();
      BarcodeZxingScan.updateProgressText('');
    } catch (e) {
      dbg('Android: stopContinuousScan error:', e);
    }
    isScanningRef.current = false;
    scanStartedAtRef.current = 0;
    setIsScanning(false);
    if (scanSubscriptionRef.current) {
      scanSubscriptionRef.current.remove();
      scanSubscriptionRef.current = null;
    }
  };
  // Continuous scan: start/stop only when visibility or mode changes — never on
  // progress / onScan / title updates (those used to reopen the camera each frame).
  useEffect(() => {
    if (!(visible && mode === 'continuous' && BarcodeZxingScan)) {
      if (mode === 'continuous') {
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
          dbg('Android: Continuous scan error:', event.error);
          isScanningRef.current = false;
          scanStartedAtRef.current = 0;
          setIsScanning(false);
          // Native Back / cancel — close so we do not leave a second RN HUD.
          onCloseRef.current();
          return;
        }
        if (event.data) {
          dbg(
            'Android: Continuous scan result:',
            event.data.substring(0, 50),
          );
          onScanRef.current(event.data);
          pushNativeProgressTextRef.current();
        }
      },
    );
    // Mark scanning before native start so cleanup always stops the activity
    // even if SCANNER_STARTED has not fired yet.
    isScanningRef.current = true;
    scanStartedAtRef.current = Date.now();
    setIsScanning(true);
    if (BarcodeZxingScan.setStatusMessage) {
      BarcodeZxingScan.setStatusMessage(
        subtitleRef.current || titleRef.current || 'Scanning QR…',
      );
    }
    if (BarcodeZxingScan.setScanHud) {
      BarcodeZxingScan.setScanHud(
        titleRef.current || 'Scanning QR…',
        !!areHapticsEnabled(),
      );
    }
    pushNativeProgressTextRef.current();
    BarcodeZxingScan.showQrReaderContinuous((error: any, data: any) => {
      if (error) {
        dbg('Android: Continuous scan error:', error);
        isScanningRef.current = false;
        scanStartedAtRef.current = 0;
        setIsScanning(false);
        onCloseRef.current();
        return;
      }
      if (data === 'SCANNER_STARTED') {
        isScanningRef.current = true;
        setIsScanning(true);
        // Overlay is created in activity onResume — retry until it can accept text.
        [100, 350, 800].forEach(ms => {
          setTimeout(() => {
            if (isScanningRef.current) {
              pushNativeProgressTextRef.current();
            }
          }, ms);
        });
      }
    });
    return () => {
      stopContinuousScan();
    };
  }, [visible, mode]);
  // Push progress into the native ZXing overlay without restarting the activity
  // (same pattern as PSBT / Send continuous scan on WalletHome).
  useEffect(() => {
    if (!visible || mode !== 'continuous' || !isScanningRef.current) {
      return;
    }
    pushNativeProgressText();
  }, [visible, mode, progress, subtitle, title]);
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
      if (subtitleRef.current && BarcodeZxingScan.setStatusMessage) {
        BarcodeZxingScan.setStatusMessage(subtitleRef.current);
      }
      // It handles back button itself, we just need to handle the result
      BarcodeZxingScan.showQrReader((error: any, data: any) => {
        // Clear custom status message
        if (BarcodeZxingScan.setStatusMessage) {
          BarcodeZxingScan.setStatusMessage('');
        }
        if (error) {
          dbg('Android: Single scan error:', error);
          // User pressed back or cancelled - close our modal too
          onCloseRef.current();
          return;
        }
        if (data) {
          onScanRef.current(data);
          onCloseRef.current();
        } else {
          // No data but no error - user likely pressed back
          onCloseRef.current();
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
  }, [visible, mode]);
  // Native ZXing activity is the only Android scanner UI (single and continuous).
  // A RN Modal here sat under the capture activity — Back revealed a second HUD.
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
