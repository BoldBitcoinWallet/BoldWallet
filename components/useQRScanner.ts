import {useCallback, useState} from 'react';
import {Platform} from 'react-native';
import BarcodeZxingScan from 'rn-barcode-zxing-scan';
import {dbg} from '../utils';

export interface UseQRScannerOptions {
  onScan: (data: string) => void;
  mode?: 'single' | 'continuous';
  onError?: (error: any) => void;
}

export interface UseQRScannerReturn {
  isScanning: boolean;
  startScan: () => void;
  stopScan: () => void;
}

/**
 * Hook for handling QR scanning logic
 * Works with both vision-camera (iOS in .tsx) and BarcodeZxingScan (Android/FOSS)
 */
export const useQRScanner = (
  options: UseQRScannerOptions,
): UseQRScannerReturn => {
  const {onScan, mode = 'single', onError} = options;
  const [isScanning, setIsScanning] = useState(false);

  const handleScanResult = useCallback(
    (data: string) => {
      if (data) {
        dbg('QR Scanner: Scanned data:', data.substring(0, 50));
        onScan(data);
        if (mode === 'single') {
          setIsScanning(false);
        }
      }
    },
    [onScan, mode],
  );

  const startScan = useCallback(() => {
    if (isScanning) {
      dbg('QR Scanner: Already scanning, ignoring');
      return;
    }

    setIsScanning(true);

    if (Platform.OS === 'android' && mode === 'continuous') {
      // Continuous scanning for Android (handled by component)
      // This is mainly for reference - actual implementation in QRScanner.foss.tsx
      dbg('QR Scanner: Starting continuous scan (Android)');
    } else {
      // Single scan - handled by native scanner
      BarcodeZxingScan.showQrReader((error: any, data: any) => {
        setIsScanning(false);
        if (error) {
          dbg('QR Scanner: Scan error:', error);
          onError?.(error);
          return;
        }
        handleScanResult(data);
      });
    }
  }, [isScanning, mode, handleScanResult, onError]);

  const stopScan = useCallback(() => {
    if (Platform.OS === 'android' && mode === 'continuous') {
      BarcodeZxingScan.stopQrReader();
    }
    setIsScanning(false);
  }, [mode]);

  return {
    isScanning,
    startScan,
    stopScan,
  };
};

