import React, {useState, useEffect, useRef, useCallback} from 'react';
import {Platform} from 'react-native';
import BarcodeZxingScan from 'rn-barcode-zxing-scan';
import {
  elapsedScanSecondsSince,
  formatAndroidZxingProgressLabel,
} from '../utils/scanElapsed';
import {dbg, areHapticsEnabled} from '../utils';

/** Stop native ZXing continuous scan before heavy JS work (AES import). */
export function stopAndroidContinuousScan(): void {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    BarcodeZxingScan.stopContinuousScan();
    BarcodeZxingScan.updateProgressText('');
  } catch (e) {
    dbg('FOSS: stopAndroidContinuousScan error:', e);
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
const QRScanner: React.FC<QRScannerProps> = ({
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
    if (!isScanningRef.current) {
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
    scanStartedAtRef.current = 0;
    setIsScanning(false);
    if (scanSubscriptionRef.current) {
      scanSubscriptionRef.current.remove();
      scanSubscriptionRef.current = null;
    }
  }, []);
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
          scanStartedAtRef.current = 0;
          setIsScanning(false);
          onCloseRef.current();
          return;
        }
        if (event.data) {
          dbg('FOSS: Continuous scan result:', event.data.substring(0, 50));
          onScanRef.current(event.data);
          pushNativeProgressTextRef.current();
        }
      },
    );
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
        dbg('FOSS: Continuous scan error:', error);
        isScanningRef.current = false;
        scanStartedAtRef.current = 0;
        setIsScanning(false);
        onCloseRef.current();
        return;
      }
      if (data === 'SCANNER_STARTED') {
        isScanningRef.current = true;
        setIsScanning(true);
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
    pushNativeProgressText();
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
  // Native ZXing (or iOS showQrReader) owns the scanner UI — no RN Modal under it.
  return null;
};
export default QRScanner;
