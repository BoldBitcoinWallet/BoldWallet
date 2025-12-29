import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
} from 'react-native';
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
  const [isScanning, setIsScanning] = useState(false);
  const scanSubscriptionRef = useRef<any>(null);

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
      fontSize: 20,
      fontWeight: '700',
      color: '#FFFFFF',
      marginBottom: 8,
    },
    scannerSubtitle: {
      fontSize: 14,
      color: 'rgba(255, 255, 255, 0.7)',
      textAlign: 'center',
      paddingHorizontal: 20,
    },
    progressBarContainer: {
      marginTop: 16,
      width: 200,
      height: 6,
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: '#F7931A',
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
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: '600',
    },
    cameraNotFoundContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'black',
    },
    cameraNotFoundText: {
      color: '#FFFFFF',
      fontSize: 16,
      marginBottom: 8,
    },
    cameraNotFoundSubtext: {
      color: 'rgba(255, 255, 255, 0.7)',
      fontSize: 14,
      textAlign: 'center',
      paddingHorizontal: 20,
    },
  });

  // Handle continuous scanning for Android
  useEffect(() => {
    if (visible && mode === 'continuous' && Platform.OS === 'android') {
      // Set up event listener for continuous scanning
      const {DeviceEventEmitter} = require('react-native');
      scanSubscriptionRef.current = DeviceEventEmitter.addListener(
        'BarcodeZxingScanContinuous',
        (event: {data?: string; error?: string}) => {
          if (event.error) {
            dbg('FOSS: Continuous scan error:', event.error);
            setIsScanning(false);
            return;
          }
          if (event.data) {
            dbg('FOSS: Continuous scan result:', event.data.substring(0, 50));
            onScan(event.data);
          }
        },
      );

      // Start continuous scan
      BarcodeZxingScan.showQrReaderContinuous((error: any, data: any) => {
        if (error) {
          dbg('FOSS: Continuous scan error:', error);
          setIsScanning(false);
          return;
        }
        if (data === 'SCANNER_STARTED') {
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

    return () => {
      if (scanSubscriptionRef.current) {
        scanSubscriptionRef.current.remove();
        scanSubscriptionRef.current = null;
      }
      if (mode === 'continuous' && Platform.OS === 'android' && isScanning) {
        BarcodeZxingScan.stopContinuousScan();
        setIsScanning(false);
      }
    };
  }, [visible, mode, onScan, showProgress, title]);

  // Handle single scan
  const handleSingleScan = () => {
    if (Platform.OS === 'android') {
      BarcodeZxingScan.showQrReader((error: any, data: any) => {
        if (error) {
          dbg('FOSS: Single scan error:', error);
          return;
        }
        if (data) {
          onScan(data);
          onClose();
        }
      });
    } else {
      // iOS - use single scan
      BarcodeZxingScan.showQrReader((error: any, data: any) => {
        if (error) {
          dbg('FOSS: iOS scan error:', error);
          return;
        }
        if (data) {
          onScan(data);
          onClose();
        }
      });
    }
  };

  // Auto-start single scan when modal opens
  useEffect(() => {
    if (visible && mode === 'single' && !isScanning) {
      handleSingleScan();
    }
  }, [visible, mode]);

  const isAnimatedQR = showProgress && progress && progress.total > 1;
  const progressPercent = isAnimatedQR
    ? Math.min(
        100,
        progress.percentage ||
          Math.round((progress.received / progress.total) * 100),
      )
    : 0;
  const isComplete = isAnimatedQR && progress.received >= progress.total;

  const displayTitle = title || (isAnimatedQR ? 'Scanning Animated QR...' : 'Scan QR Code');
  const displaySubtitle =
    subtitle ||
    (isAnimatedQR
      ? isComplete
        ? 'Processing...'
        : `Keep scanning animated QR: ${progressPercent}%`
      : 'Position the QR code within the frame');

  // For continuous mode on Android, show the scanner UI
  if (mode === 'continuous' && Platform.OS === 'android' && visible) {
    return (
      <Modal
        visible={visible}
        transparent={false}
        animationType="fade"
        onRequestClose={onClose}>
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
          <TouchableOpacity
            style={styles.closeScannerButton}
            onPress={() => {
              if (isScanning) {
                BarcodeZxingScan.stopContinuousScan();
                setIsScanning(false);
              }
              onClose();
            }}
            activeOpacity={0.7}>
            <Text style={styles.closeScannerButtonText}>{closeButtonText}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // For single mode, the native scanner handles UI, but we show a placeholder
  // In practice, single mode opens native scanner which handles its own UI
  return null;
};

export default QRScanner;

