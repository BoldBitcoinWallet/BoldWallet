import React, {useState, useCallback, useRef, useEffect} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Platform,
  NativeModules,
  DeviceEventEmitter,
  EmitterSubscription,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import * as RNFS from 'react-native-fs';
import QRScanner from '../components/QRScanner';
import BarcodeZxingScan from 'rn-barcode-zxing-scan';
// @ts-ignore - bc-ur types (Buffer polyfill is in polyfills.js)
import {URDecoder} from '@ngraveio/bc-ur';
import {dbg, HapticFeedback} from '../utils';
import {useTheme} from '../theme';

const {BBMTLibNativeModule} = NativeModules;

// PSBT details structure (will be populated when parsing is implemented)
interface PSBTDetails {
  inputs: Array<{
    txid: string;
    vout: number;
    amount: number; // in satoshis
  }>;
  outputs: Array<{
    address: string;
    amount: number; // in satoshis
  }>;
  fee: number; // in satoshis
  totalInput: number;
  totalOutput: number;
  derivePaths: string[]; // Derivation path for each input (indexed array)
}

// UR (Uniform Resource) animated QR support for large PSBTs

export interface PSBTLoaderProps {
  btcRate?: number; // BTC to fiat rate
  currencySymbol?: string; // e.g., "$", "€"
  network?: string; // Network: 'mainnet' or 'testnet3'
  onClose: () => void;
  onSign: (psbtBase64: string) => void;
  // When true, disables the Cancel button until a PSBT is loaded.
  // Used by full-screen PSBT flows (e.g. PSBTScreen) where "Cancel"
  // isn't meaningful before any PSBT has been imported.
  disableCancelWhenEmpty?: boolean;
  // When true (default), renders a dark modal-style overlay behind the content.
  // When false, PSBTLoader behaves like an embedded card without blocking the
  // underlying screen (used by PSBTScreen).
  useOverlay?: boolean;
  // Optional middle button to render between Cancel and Co-Sign buttons
  middleButton?: React.ReactNode;
}

export interface PSBTModalProps extends PSBTLoaderProps {
  visible: boolean;
}


export const PSBTLoader: React.FC<PSBTLoaderProps> = ({
  btcRate = 0,
  currencySymbol = '$',
  network = 'mainnet',
  onClose,
  onSign,
  disableCancelWhenEmpty = false,
  useOverlay = true,
  middleButton,
}) => {
  const {theme} = useTheme();
  const [psbtBase64, setPsbtBase64] = useState<string | null>(null);
  const [psbtDetails, setPsbtDetails] = useState<PSBTDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAndroidScanning, setIsAndroidScanning] = useState(false); // For Android continuous scanning modal
  const isCancelDisabled = disableCancelWhenEmpty && !psbtBase64;

  // UR (Uniform Resource) animated QR state - using bc-ur library
  const urDecoderRef = useRef<any>(null);
  const isScanningRef = useRef<boolean>(false); // Track if we're actively scanning (Android)
  const scanSessionIdRef = useRef<number>(0); // Track scan sessions to ignore stale events
  const continuousScanSubscriptionRef = useRef<EmitterSubscription | null>(
    null,
  );
  const [urProgress, setUrProgress] = useState<{
    total: number;
    received: number;
    percentage: number;
  } | null>(null);

  // Debug: Log isScanningRef periodically when scanning
  useEffect(() => {
    if (Platform.OS === 'android' && isAndroidScanning) {
      const interval = setInterval(() => {
        dbg(
          'Android: Periodic check - isScanningRef.current =',
          isScanningRef.current,
          'isAndroidScanning =',
          isAndroidScanning,
        );
      }, 3000); // Log every 3 seconds when scanning

      return () => clearInterval(interval);
    }
  }, [isAndroidScanning]);

  // Update progress text overlay in Android zxing activity when urProgress changes
  // This updates the native scanner's progress overlay (not a modal)
  useEffect(() => {
    if (Platform.OS === 'android' && isAndroidScanning && urProgress) {
      const progressPercent = Math.min(
        100,
        Math.round(urProgress.received || 0),
      );
      const progressText = `PSBT scanning progress... ${progressPercent}%`;
      BarcodeZxingScan.updateProgressText(progressText);
    } else if (Platform.OS === 'android' && isAndroidScanning && !urProgress) {
      // Show initial message when scanning starts but no progress yet
      BarcodeZxingScan.updateProgressText('Scanning PSBT QR Code...');
    } else if (Platform.OS === 'android' && !isAndroidScanning) {
      // Clear progress text when scanning stops
      BarcodeZxingScan.updateProgressText('');
    }
  }, [urProgress, isAndroidScanning]);

  // Reset state when modal closes
  const handleClose = useCallback(() => {
    setPsbtBase64(null);
    setPsbtDetails(null);
    setError(null);
    setIsLoading(false);
    setIsScannerVisible(false);
    setIsAndroidScanning(false);
    isScanningRef.current = false;
    // Invalidate session to ignore any pending events
    scanSessionIdRef.current = 0;
    // Stop continuous scan on Android
    if (Platform.OS === 'android') {
      BarcodeZxingScan.stopContinuousScan();
      BarcodeZxingScan.updateProgressText('');
      // DON'T remove event listener here - let useEffect cleanup handle it
      // The listener should persist across scans
    }
    urDecoderRef.current = null;
    setUrProgress(null);
    onClose();
  }, [onClose]);

  // Reset UR state when scanner closes
  const handleScannerClose = useCallback(() => {
    setIsScannerVisible(false);
    setIsAndroidScanning(false);
    isScanningRef.current = false;
    // Invalidate session to ignore any pending events
    scanSessionIdRef.current = 0;
    // Stop continuous scan on Android
    if (Platform.OS === 'android') {
      BarcodeZxingScan.stopContinuousScan();
      BarcodeZxingScan.updateProgressText('');
      // DON'T remove event listener here - let it persist for next scan
    }
    urDecoderRef.current = null;
    setUrProgress(null);
  }, []);

  // Parse PSBT and extract details using native module
  const parsePSBT = useCallback(async (base64Data: string) => {
    setIsLoading(true);
    setError(null);

    try {
      dbg('PSBT Base64 length:', base64Data.length);

      // Use native module to parse PSBT details
      const detailsJson = await BBMTLibNativeModule.parsePSBTDetails(
        base64Data,
      );
      dbg('Native PSBT parse result:', detailsJson.substring(0, 200));

      // Check for error response
      if (detailsJson.startsWith('error') || detailsJson.includes('failed')) {
        throw new Error(detailsJson);
      }

      // Parse the JSON response
      const parsed = JSON.parse(detailsJson);

      const details: PSBTDetails = {
        inputs: parsed.inputs || [],
        outputs: parsed.outputs || [],
        fee: parsed.fee || 0,
        totalInput: parsed.totalInput || 0,
        totalOutput: parsed.totalOutput || 0,
        derivePaths: parsed.derivePaths || parsed.derivePathPerInput || [], // Per-input derivation paths
      };

      dbg('PSBT details:', {
        inputCount: details.inputs.length,
        outputCount: details.outputs.length,
        totalInput: details.totalInput,
        totalOutput: details.totalOutput,
        fee: details.fee,
        derivePaths: details.derivePaths,
      });

      setPsbtBase64(base64Data);
      setPsbtDetails(details);
      // Use most common derivation path for initial display/navigation
      // The signing functions will extract the correct path per input from the PSBT
      dbg('PSBT loaded successfully.');
      if (details.derivePaths && details.derivePaths.length > 0) {
        dbg('Derivation paths per input:', details.derivePaths);
      }
    } catch (e: any) {
      dbg('Error parsing PSBT:', e.message || e);
      setError(e.message || 'Failed to parse PSBT');
      setPsbtBase64(null);
      setPsbtDetails(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle file upload
  const handleUploadFile = useCallback(async () => {
    HapticFeedback.light();
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        copyTo: 'cachesDirectory',
      });

      const file = result[0];
      dbg('Selected file:', file.name, file.type);

      if (file.fileCopyUri) {
        const fileContent = await RNFS.readFile(
          file.fileCopyUri.replace('file://', ''),
          'base64',
        );
        await parsePSBT(fileContent);
      } else if (file.uri) {
        // Try reading from original URI
        const uri =
          Platform.OS === 'ios' ? file.uri : file.uri.replace('file://', '');
        const fileContent = await RNFS.readFile(uri, 'base64');
        await parsePSBT(fileContent);
      }
    } catch (e: any) {
      if (!DocumentPicker.isCancel(e)) {
        dbg('Error picking file:', e);
        setError('Failed to load PSBT file');
      }
    }
  }, [parsePSBT]);

  // Process UR QR code using bc-ur library (supports fountain codes)
  const processURCode = useCallback(
    (data: string): {isUR: boolean; complete: boolean; psbtBase64?: string} => {
      const lowerData = data.toLowerCase();

      // Check if it's a UR code
      if (!lowerData.startsWith('ur:')) {
        return {isUR: false, complete: false};
      }

      // Check if it's a PSBT type
      const urType = lowerData.split('/')[0].substring(3);
      if (urType !== 'psbt' && urType !== 'crypto-psbt') {
        dbg('Not a PSBT UR, type:', urType);
        return {isUR: true, complete: false};
      }

      try {
        // Initialize decoder if needed
        if (!urDecoderRef.current) {
          urDecoderRef.current = new URDecoder();
          dbg('Created new URDecoder');
        }

        // Feed the QR data to the decoder
        // UR decoder uses fountain codes - it can reconstruct from any subset of frames
        // Duplicate frames are automatically handled by the decoder
        urDecoderRef.current.receivePart(data.toLowerCase());

        // Get progress
        const progress = urDecoderRef.current.getProgress();
        const estimatedPercentComplete = Math.round(
          urDecoderRef.current.estimatedPercentComplete() * 100,
        );

        dbg(`UR progress: ${estimatedPercentComplete}%, received: ${progress}`);

        // Update progress - use percentage directly for more accurate display
        // On iOS, ensure we always update even if the value seems the same
        // to trigger re-renders for progress bar
        setUrProgress({
          total: 100,
          received: estimatedPercentComplete,
          percentage: estimatedPercentComplete,
        });

        HapticFeedback.light();

        // Check if complete
        if (urDecoderRef.current.isComplete()) {
          dbg('UR decoder reports complete');
          if (urDecoderRef.current.isSuccess()) {
            const ur = urDecoderRef.current.resultUR();
            dbg('UR complete! Type:', ur.type);

            // Get the CBOR payload
            const cborPayload = ur.decodeCBOR();
            dbg(
              'CBOR payload type:',
              typeof cborPayload,
              'length:',
              cborPayload?.length,
            );

            // The CBOR payload should be the raw PSBT bytes
            let psbtBytes: Uint8Array;
            if (cborPayload instanceof Uint8Array) {
              psbtBytes = cborPayload;
            } else if (Buffer.isBuffer(cborPayload)) {
              psbtBytes = new Uint8Array(cborPayload);
            } else if (typeof cborPayload === 'object' && cborPayload.data) {
              // Sometimes it comes wrapped
              psbtBytes = new Uint8Array(cborPayload.data);
            } else {
              dbg('Unknown CBOR payload format:', cborPayload);
              return {isUR: true, complete: false};
            }

            dbg('PSBT bytes length:', psbtBytes.length);

            // Verify PSBT magic bytes (psbt = 0x70736274)
            if (
              psbtBytes.length > 4 &&
              psbtBytes[0] === 0x70 &&
              psbtBytes[1] === 0x73 &&
              psbtBytes[2] === 0x62 &&
              psbtBytes[3] === 0x74
            ) {
              // Convert to base64
              const base64 = btoa(
                String.fromCharCode.apply(null, Array.from(psbtBytes)),
              );
              dbg('PSBT base64 length:', base64.length);

              // Reset decoder
              urDecoderRef.current = null;
              setUrProgress(null);

              return {isUR: true, complete: true, psbtBase64: base64};
            } else {
              dbg(
                'Invalid PSBT magic bytes:',
                psbtBytes.slice(0, 4).toString(),
              );
            }
          } else {
            dbg('UR decoding failed:', urDecoderRef.current.resultError());
          }

          // Reset on failure
          urDecoderRef.current = null;
          setUrProgress(null);
        }

        return {isUR: true, complete: false};
      } catch (e: any) {
        dbg('UR processing error:', e.message || e);
        // Reset decoder on error
        urDecoderRef.current = null;
        setUrProgress(null);
        return {isUR: true, complete: false};
      }
    },
    [],
  );

  // Process scanned QR data (handles both plain base64 and UR format)
  const processScannedData = useCallback(
    async (data: string, shouldContinueScanning?: () => void) => {
      dbg(
        'Processing scanned data:',
        data.substring(0, 50) + '...',
        'isScanningRef:',
        isScanningRef.current,
      );

      // Check if it's UR format
      const urResult = processURCode(data);

      if (urResult.isUR) {
        if (urResult.complete && urResult.psbtBase64) {
          // Complete! Stop scanning and parse
          dbg('Android: UR complete, stopping scan');
          setIsScannerVisible(false);
          setIsAndroidScanning(false);
          isScanningRef.current = false;
          // Reset session ID to invalidate any pending events
          scanSessionIdRef.current = 0;
          // Stop continuous scan on Android
          if (Platform.OS === 'android') {
            BarcodeZxingScan.stopContinuousScan();
            // Clear progress text
            BarcodeZxingScan.updateProgressText('');
          }
          // Decoder is already reset in processURCode when complete
          await parsePSBT(urResult.psbtBase64);
        } else {
          // Not complete yet - scanner stays open for next frame (Android continuous mode)
          dbg(
            'Android: UR incomplete, continuing scan. isScanningRef:',
            isScanningRef.current,
          );
          // Ensure isScanningRef stays true for continuous scanning
          if (!isScanningRef.current) {
            dbg(
              'Android: WARNING - isScanningRef was false during UR processing, resetting to true',
            );
            isScanningRef.current = true;
          }
          // On iOS, shouldContinueScanning callback is used
          if (shouldContinueScanning && Platform.OS === 'ios') {
            shouldContinueScanning();
          }
          // On Android, scanner is already open and will emit more events
        }
        return;
      }

      // Not UR format - could be:
      // 1. Plain base64 PSBT (single scan) - stop and parse
      // 2. Random QR code (not a PSBT) - ignore and keep scanning in continuous mode
      // Check if it looks like base64 PSBT (starts with cHNidP8BA)
      if (
        data.startsWith('cHNidP8BA') ||
        (data.length > 100 && !data.startsWith('UR:'))
      ) {
        // Looks like a PSBT - stop scanning and parse
        dbg('Android: Found plain PSBT, stopping scan');
        setIsScannerVisible(false);
        setIsAndroidScanning(false);
        isScanningRef.current = false;
        // Reset session ID to invalidate any pending events
        scanSessionIdRef.current = 0;
        // Stop continuous scan on Android
        if (Platform.OS === 'android') {
          BarcodeZxingScan.stopContinuousScan();
          // Clear progress text
          BarcodeZxingScan.updateProgressText('');
        }
        // Reset decoder for next scan
        urDecoderRef.current = null;
        setUrProgress(null);
        await parsePSBT(data);
      } else {
        // Doesn't look like a PSBT - ignore and keep scanning
        dbg(
          'Android: Ignoring non-PSBT QR code, continuing scan. isScanningRef:',
          isScanningRef.current,
        );
        // Ensure isScanningRef stays true for continuous scanning
        if (!isScanningRef.current) {
          dbg(
            'Android: WARNING - isScanningRef was false when ignoring non-PSBT, resetting to true',
          );
          isScanningRef.current = true;
        }
      }
    },
    [processURCode, parsePSBT],
  );

  // Helper function to set up the event listener for continuous scanning
  // Called every time we start a scan to ensure listener is fresh and active
  const setupEventListener = useCallback(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    // Remove existing listener if any
    if (continuousScanSubscriptionRef.current) {
      dbg(
        'Android: Removing existing event listener before setting up new one',
      );
      continuousScanSubscriptionRef.current.remove();
      continuousScanSubscriptionRef.current = null;
    }

    dbg('Android: Setting up EventEmitter listener for continuous scanning');

    const subscription = DeviceEventEmitter.addListener(
      'BarcodeZxingScanContinuous',
      (event: {data?: string; error?: string}) => {
        // Always check current ref value - refs don't have closure issues
        const currentIsScanning = isScanningRef.current;
        const currentSessionId = scanSessionIdRef.current;
        dbg(
          'Android: Received continuous scan event. isScanningRef:',
          currentIsScanning,
          'sessionId:',
          currentSessionId,
          'hasData:',
          !!event.data,
          'hasError:',
          !!event.error,
          'eventKeys:',
          Object.keys(event),
        );

        if (event.error) {
          // Error or cancellation
          dbg('Android scan error:', event.error);
          setIsAndroidScanning(false);
          isScanningRef.current = false;
          urDecoderRef.current = null;
          setUrProgress(null);
          BarcodeZxingScan.stopContinuousScan();
          BarcodeZxingScan.updateProgressText('');
          return;
        }

        if (event.data) {
          dbg(
            'Android: Processing event with data:',
            event.data.substring(0, 50) + '...',
          );

          // CRITICAL: Simplified logic - if we receive an event, process it UNLESS
          // we explicitly know the scan was completed and stopped
          // The session ID helps, but if scanner is open and we get events, process them

          // Only reject if BOTH conditions are true: not scanning AND session ID is 0
          // This means the scan was explicitly stopped and we're not in a new session
          if (!currentIsScanning && currentSessionId === 0) {
            // Both false - scan was stopped, ignore this stale event
            dbg(
              'Android: Received event but scan was stopped (sessionId=0, isScanningRef=false) - ignoring stale event',
            );
            // Don't stop scanner here - it might already be stopped
            return;
          }

          // If we get here, we should process the event
          // Re-enable scanning state if needed (handles race conditions)
          if (!currentIsScanning) {
            dbg(
              'Android: Received event but isScanningRef is false. Enabling scanning (sessionId=' +
                currentSessionId +
                ')',
            );
            isScanningRef.current = true;
            setIsAndroidScanning(true);
          }

          // CRITICAL: Ensure UR decoder is initialized for this scan session
          // Initialize decoder when we receive the first UR frame
          if (
            !urDecoderRef.current &&
            event.data.toLowerCase().startsWith('ur:')
          ) {
            dbg('Android: Initializing new UR decoder for scan session');
            urDecoderRef.current = new URDecoder();
          }

          // If decoder exists but we're getting non-UR data, reset decoder for new scan
          if (
            urDecoderRef.current &&
            !event.data.toLowerCase().startsWith('ur:')
          ) {
            dbg(
              'Android: Received non-UR data with existing decoder, resetting decoder for new scan',
            );
            urDecoderRef.current = null;
            setUrProgress(null);
          }

          dbg('Android scanned QR frame:', event.data.substring(0, 50) + '...');
          // Process the scanned data - the scanner stays open for next frame
          // Use the latest processScannedData via closure, but also ensure refs are current
          processScannedData(event.data, () => {
            // This callback is called if UR is incomplete - scanner stays open
            dbg('Android: UR incomplete, scanner stays open for next frame...');
            // Ensure isScanningRef is still true (only if we're still scanning)
            if (isScanningRef.current) {
              // Only reset if we're still supposed to be scanning
              setIsAndroidScanning(true);
            }
          });
        }
      },
    );

    continuousScanSubscriptionRef.current = subscription;
    dbg('Android: EventEmitter listener set up successfully');
  }, [processScannedData]);

  // Cleanup listener on component unmount
  useEffect(() => {
    return () => {
      if (Platform.OS === 'android' && continuousScanSubscriptionRef.current) {
        dbg('Android: Component unmounting, removing EventEmitter listener');
        continuousScanSubscriptionRef.current.remove();
        continuousScanSubscriptionRef.current = null;
      }
    };
  }, []);

  // Android continuous scanning function - uses native continuous scanning
  // The scanner stays open and sends results via EventEmitter until UR is complete
  const startAndroidContinuousScan = useCallback(() => {
    if (isScanningRef.current) {
      dbg('Android: Already scanning, ignoring duplicate call');
      return; // Already scanning
    }

    // CRITICAL: Set up event listener every time we start a scan
    // This ensures the listener is fresh and active for each scan session
    dbg('Android: Setting up event listener for new scan');
    setupEventListener();

    // CRITICAL: Reset decoder and progress FIRST
    // This ensures clean state for subsequent scans
    urDecoderRef.current = null;
    setUrProgress(null);
    // Clear any progress text from previous scan
    BarcodeZxingScan.updateProgressText('');

    // CRITICAL: Increment session ID BEFORE setting scanning flags
    // This ensures events are associated with the correct session
    scanSessionIdRef.current = (scanSessionIdRef.current || 0) + 1;
    const currentSessionId = scanSessionIdRef.current;
    dbg('Android: Starting new scan session, sessionId:', currentSessionId);

    // CRITICAL: Set scanning flags BEFORE starting scanner
    // This ensures event listener processes events correctly
    dbg('Android: Setting isScanningRef to true BEFORE starting scanner');
    isScanningRef.current = true;
    setIsAndroidScanning(true);

    dbg(
      'Android: Starting continuous scan for animated QR, sessionId:',
      currentSessionId,
      'isScanningRef:',
      isScanningRef.current,
      'isAndroidScanning:',
      true,
      'listenerActive:',
      !!continuousScanSubscriptionRef.current,
    );

    // Use the new continuous scanning API that keeps the activity open
    // The callback is only invoked once to acknowledge scanner start
    // Subsequent results come via EventEmitter
    BarcodeZxingScan.showQrReaderContinuous((scanError: any, data: any) => {
      dbg(
        'Android: Scanner start callback. Error:',
        scanError,
        'Data:',
        data,
        'isScanningRef:',
        isScanningRef.current,
      );

      if (scanError) {
        // Error starting scanner
        dbg('Android: Failed to start scanner:', scanError);
        setIsAndroidScanning(false);
        isScanningRef.current = false;
        BarcodeZxingScan.updateProgressText('');
        // Reset session ID on error
        if (scanSessionIdRef.current === currentSessionId) {
          scanSessionIdRef.current = 0;
        }
        return;
      }

      // Scanner started successfully - results will come via EventEmitter
      if (data === 'SCANNER_STARTED') {
        // Verify this is still the current session (not a stale callback)
        if (scanSessionIdRef.current !== currentSessionId) {
          dbg('Android: Scanner start callback for stale session, ignoring');
          return;
        }
        dbg(
          'Android: Scanner started, waiting for QR frames via EventEmitter. sessionId:',
          currentSessionId,
          'isScanningRef:',
          isScanningRef.current,
        );
        // Double-check that isScanningRef is still true
        if (!isScanningRef.current) {
          dbg(
            'Android: WARNING - isScanningRef was set to false, resetting to true',
          );
          isScanningRef.current = true;
          setIsAndroidScanning(true);
        }
        // Show progress text now that scanner activity is created
        // Do this after a small delay to ensure activity is ready
        setTimeout(() => {
          BarcodeZxingScan.updateProgressText('Scanning PSBT QR Code...');
        }, 100);
      }
    });
  }, [setupEventListener]); // Include setupEventListener to ensure we have the latest version

  // Handle QR scan button press
  const handleScanQR = useCallback(() => {
    HapticFeedback.light();

    // Reset all state when starting a new scan
    setError(null); // Clear any previous errors
    setIsLoading(false); // Clear loading state
    setPsbtBase64(null); // Clear any previous PSBT data
    setPsbtDetails(null); // Clear PSBT details

    // Ensure any previous scan is fully stopped before starting a new one
    if (Platform.OS === 'android') {
      // Always stop any existing scan first to ensure clean state
      if (isScanningRef.current || isAndroidScanning) {
        dbg('handleScanQR: Stopping previous scan before starting new one');
        // Stop the scanner first
        BarcodeZxingScan.stopContinuousScan();
        setIsAndroidScanning(false);
        isScanningRef.current = false;
        // Reset decoder and progress when stopping previous scan
        urDecoderRef.current = null;
        setUrProgress(null);
        BarcodeZxingScan.updateProgressText('');

        // Add a small delay to ensure native scanner is fully stopped
        // before starting a new scan (fixes Android subsequent scan issue)
        // NOTE: Don't reset sessionId to 0 here - let the new scan set it
        setTimeout(() => {
          dbg('handleScanQR: Starting new Android scan after cleanup delay');
          startAndroidContinuousScan();
        }, 250); // 250ms delay to ensure cleanup completes
      } else {
        // No previous scan - reset state and start immediately
        urDecoderRef.current = null;
        setUrProgress(null);
        // Don't reset sessionId here - let startAndroidContinuousScan handle it
        dbg('handleScanQR: Starting new Android scan immediately');
        startAndroidContinuousScan();
      }
    } else {
      // iOS: Reset scanning ref first, then start scanner
      isScanningRef.current = true; // Set to true for iOS
      setIsScannerVisible(true);
    }
  }, [startAndroidContinuousScan, isAndroidScanning]);

  // Handle sign button
  const handleSign = useCallback(() => {
    HapticFeedback.medium();
    if (psbtBase64) {
      // Pass both PSBT and derivation path to the signing handler
      // The handler will need to accept an object with both values
      onSign(psbtBase64);
    }
  }, [psbtBase64, onSign]);

  // Format satoshis to BTC string (compact)
  const formatBTC = (sats: number): string => {
    const btc = sats / 100000000;
    // Show fewer decimals for readability, but keep precision for small amounts
    if (btc >= 0.01) {
      return btc.toFixed(6) + ' BTC';
    }
    return btc.toFixed(8) + ' BTC';
  };

  // Format satoshis to fiat string
  const formatFiat = (sats: number): string => {
    if (!btcRate || btcRate === 0) {
      return '';
    }
    const btc = sats / 100000000;
    const fiat = btc * btcRate;
    return `${currencySymbol}${fiat.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const styles = createStyles(theme);

  // Handler for QR scan results (wraps processScannedData for new QRScanner component)
  const handleQRScan = useCallback((data: string) => {
    dbg('QR Scanner: Scanned data:', data.substring(0, 50) + '...');

    // CRITICAL: Ensure UR decoder is initialized for this scan session
    // This ensures progress tracking works correctly
    if (
      !urDecoderRef.current &&
      data.toLowerCase().startsWith('ur:')
    ) {
      dbg('QR Scanner: Initializing new UR decoder for scan session');
      urDecoderRef.current = new URDecoder();
    }

    // Use processScannedData to handle both plain PSBT and UR format
    processScannedData(data);
  }, [processScannedData]);

  return (
    <View style={useOverlay ? styles.modalOverlay : undefined}>
      <View style={useOverlay ? styles.modalContent : styles.embeddedContent}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Image
              source={require('../assets/key-icon.png')}
              style={styles.headerIcon}
            />
            <Text style={styles.headerTitle}>Sign • PSBT</Text>
            <View style={styles.networkBadge}>
              <Text style={styles.networkBadgeText}>
                {network === 'mainnet' ? 'MAINNET' : 'TESTNET'}
              </Text>
            </View>
          </View>

          {/* Description */}
          <Text style={styles.description}>
            Import a Partially Signed Bitcoin Transaction (PSBT) from Sparrow or
            another wallet to sign with your keyshare on.
          </Text>

          {/* Import buttons */}
          {!psbtBase64 && (
            <View style={styles.importButtonsContainer}>
              <TouchableOpacity
                style={styles.importButton}
                onPress={handleUploadFile}
                disabled={isLoading}>
                <Image
                  source={require('../assets/upload-icon.png')}
                  style={styles.importButtonIcon}
                />
                <Text style={styles.importButtonText}>Load PSBT File</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.importButton}
                onPress={handleScanQR}
                disabled={isLoading}>
                <Image
                  source={require('../assets/scan-icon.png')}
                  style={styles.importButtonIcon}
                />
                <Text style={styles.importButtonText}>Scan PSBT QR</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Parsing PSBT...</Text>
            </View>
          )}

          {/* Error message */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  setError(null);
                  setPsbtBase64(null);
                  setPsbtDetails(null);
                }}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* PSBT Details - Sparrow-style Visual Flow */}
          {psbtDetails && psbtBase64 && !error && (
            <ScrollView
              style={styles.detailsContainer}
              showsVerticalScrollIndicator={false}>
              {/* Transaction Flow Diagram - Vertical Mobile-Friendly Layout */}
              <View style={styles.transactionFlow}>
                {/* Inputs Section */}
                <View style={styles.flowSection}>
                  <Text style={styles.flowSectionTitle}>Inputs</Text>
                  {psbtDetails.inputs.map((input, index) => {
                    const derivePath = psbtDetails.derivePaths[index] || 'N/A';
                    return (
                      <View key={index} style={styles.flowItem}>
                        <View style={styles.flowItemContent}>
                          <View style={styles.flowItemHeader}>
                            <Image
                              source={require('../assets/in-icon.png')}
                              style={styles.flowIcon}
                              resizeMode="contain"
                            />
                            <View style={styles.flowItemInfo}>
                              <Text
                                style={styles.flowItemLabel}
                                numberOfLines={1}
                                ellipsizeMode="middle">
                                {input.txid.slice(0, 8)}...
                                {input.txid.slice(-6)}:{input.vout}
                              </Text>
                              <Text
                                style={styles.flowItemPath}
                                numberOfLines={1}>
                                {derivePath}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.flowAmount}>
                            <Text style={styles.flowAmountBTC}>
                              {formatBTC(input.amount)}
                            </Text>
                            {btcRate > 0 && (
                              <Text style={styles.flowAmountFiat}>
                                {formatFiat(input.amount)}
                              </Text>
                            )}
                          </View>
                        </View>
                        {/* Flow line connector */}
                        {index < psbtDetails.inputs.length - 1 && (
                          <View style={styles.flowConnectorVertical} />
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Transaction Hub (Center Arrow) */}
                <View style={styles.transactionHubVertical}>
                  <View style={styles.hubArrow}>
                    <Text style={styles.hubArrowText}>↓</Text>
                  </View>
                  <View style={styles.hubLabel}>
                    <Text style={styles.hubLabelText}>Transaction</Text>
                  </View>
                </View>

                {/* Outputs Section */}
                <View style={styles.flowSection}>
                  <Text style={styles.flowSectionTitle}>Outputs</Text>
                  {psbtDetails.outputs.map((output, index) => {
                    // Determine output type: change (likely if small amount), recipient, or fee
                    const isLikelyChange =
                      output.amount < psbtDetails.totalInput * 0.1; // Heuristic: small outputs are often change

                    let outputIcon = require('../assets/bitcoin-icon.png');
                    let outputType = 'recipient';

                    if (isLikelyChange) {
                      outputIcon = require('../assets/consolidate-icon.png');
                      outputType = 'change';
                    }

                    return (
                      <View key={index} style={styles.flowItem}>
                        <View style={styles.flowItemContent}>
                          <View style={styles.flowItemHeader}>
                            <Image
                              source={outputIcon}
                              style={styles.flowIcon}
                              resizeMode="contain"
                            />
                            <View style={styles.flowItemInfo}>
                              <Text
                                style={styles.flowItemLabel}
                                numberOfLines={1}
                                ellipsizeMode="middle">
                                {output.address.slice(0, 8) +
                                  '...' +
                                  output.address.slice(-6)}
                              </Text>
                              {outputType === 'change' && (
                                <Text style={styles.flowItemType}>Change</Text>
                              )}
                            </View>
                          </View>
                          <View style={styles.flowAmount}>
                            <Text style={styles.flowAmountBTC}>
                              {formatBTC(output.amount)}
                            </Text>
                            {btcRate > 0 && (
                              <Text style={styles.flowAmountFiat}>
                                {formatFiat(output.amount)}
                              </Text>
                            )}
                          </View>
                        </View>
                        {/* Flow line connector */}
                        {index < psbtDetails.outputs.length - 1 && (
                          <View style={styles.flowConnectorVertical} />
                        )}
                      </View>
                    );
                  })}

                  {/* Fee as separate item */}
                  {psbtDetails.fee > 0 && (
                    <View style={styles.flowItem}>
                      <View style={styles.flowItemContent}>
                        <View style={styles.flowItemHeader}>
                          <Image
                            source={require('../assets/send-icon.png')}
                            style={styles.flowIcon}
                            resizeMode="contain"
                          />
                          <View style={styles.flowItemInfo}>
                            <Text style={styles.flowItemLabel}>Fee</Text>
                          </View>
                        </View>
                        <View style={styles.flowAmount}>
                          <Text style={styles.flowAmountBTC}>
                            {formatBTC(psbtDetails.fee)}
                          </Text>
                          {btcRate > 0 && (
                            <Text style={styles.flowAmountFiat}>
                              {formatFiat(psbtDetails.fee)}
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* Summary Bar */}
              <View style={styles.summaryBar}>
                <View style={styles.summaryBarContent}>
                  <Text style={styles.summaryBarText} numberOfLines={2}>
                    {psbtDetails.inputs.length} input
                    {psbtDetails.inputs.length !== 1 ? 's' : ''} →{' '}
                    {psbtDetails.outputs.length} output
                    {psbtDetails.outputs.length !== 1 ? 's' : ''} •{' '}
                    {formatBTC(psbtDetails.totalOutput + psbtDetails.fee)} total
                  </Text>
                  {psbtDetails.derivePaths.length > 0 && (
                    <Text style={styles.summaryBarPath} numberOfLines={1}>
                      Path: {psbtDetails.derivePaths.join(', ')}
                    </Text>
                  )}
                </View>
                <View style={styles.summaryBarBadge}>
                  <Text style={styles.summaryBarBadgeText}>
                    {Math.round(psbtBase64.length / 1024)} KB
                  </Text>
                </View>
              </View>
            </ScrollView>
          )}

        {/* Action buttons */}
        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity
            style={[
              styles.cancelButton,
              isCancelDisabled && styles.cancelButtonDisabled,
            ]}
            onPress={handleClose}
            disabled={isCancelDisabled}>
            <Text
              style={[
                styles.cancelButtonText,
                isCancelDisabled && styles.cancelButtonTextDisabled,
              ]}>
              Cancel
            </Text>
          </TouchableOpacity>

          {middleButton && (
            <View style={styles.middleButtonContainer}>
              {middleButton}
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.signButton,
              !psbtBase64 && styles.signButtonDisabled,
            ]}
            onPress={handleSign}
            disabled={!psbtBase64 || isLoading}>
            <Image
              source={require('../assets/cosign-icon.png')}
              style={[
                styles.signButtonIcon,
                !psbtBase64 && styles.signButtonIconDisabled,
              ]}
            />
            <Text
              style={[
                styles.signButtonText,
                !psbtBase64 && styles.signButtonTextDisabled,
              ]}>
              Co-Sign
            </Text>
          </TouchableOpacity>
        </View>

        {/* QR Scanner Modal */}
        <QRScanner
          visible={isScannerVisible}
          onClose={handleScannerClose}
          onScan={handleQRScan}
          mode="continuous"
          title="Scan PSBT QR Code"
          subtitle={
            urProgress && urProgress.total > 1
              ? urProgress.received >= urProgress.total
                ? 'Processing PSBT...'
                : `Keep scanning animated QR: ${Math.min(
                    100,
                    urProgress.percentage ||
                      Math.round((urProgress.received / urProgress.total) * 100),
                  )}%`
              : 'Point camera at the PSBT QR code to scan'
          }
          showProgress={!!urProgress && urProgress.total > 1}
          progress={urProgress || undefined}
          closeButtonText="Cancel"
        />
      </View>
    </View>
  );
};

const PSBTModal: React.FC<PSBTModalProps> = ({
  visible,
  btcRate = 0,
  currencySymbol = '$',
  network = 'mainnet',
  onClose,
  onSign,
}) => {
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={() => {}}>
      <PSBTLoader
        btcRate={btcRate}
        currencySymbol={currencySymbol}
        network={network}
        onClose={onClose}
        onSign={onSign}
      />
    </Modal>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      padding: 20,
      width: '100%',
      maxWidth: 400,
      maxHeight: '85%',
      // Add shadow for better visibility
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },
    // Embedded version used on the dedicated PSBT screen (no overlay)
    // No border/shadow here since it's inside a collapsible section that already has borders
    embeddedContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      padding: 16,
      width: '100%',
      overflow: 'hidden',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    headerIcon: {
      width: 24,
      height: 24,
      marginRight: 10,
      tintColor: theme.colors.text, // Use text color for better visibility in dark mode
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.text,
      flex: 1,
    },
    networkBadge: {
      backgroundColor: theme.colors.background,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    networkBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.colors.text,
      letterSpacing: 0.5,
    },
    description: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
      marginBottom: 16,
    },
    importButtonsContainer: {
      marginBottom: 20,
    },
    importButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.background,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderStyle: 'dashed',
      marginBottom: 12,
    },
    importButtonIcon: {
      width: 24,
      height: 24,
      marginRight: 12,
      tintColor: theme.colors.text, // Use text color for better visibility in dark mode
    },
    importButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
    },
    loadingContainer: {
      alignItems: 'center',
      padding: 20,
    },
    loadingText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
    errorContainer: {
      backgroundColor: 'rgba(255, 59, 48, 0.1)',
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
      alignItems: 'center',
    },
    errorText: {
      fontSize: 14,
      color: '#FF3B30',
      textAlign: 'center',
      marginBottom: 12,
    },
    retryButton: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 8,
    },
    retryButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    detailsContainer: {
      maxHeight: 400,
      marginBottom: 16,
    },
    summaryHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    summaryLabel: {
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    psbtSizeBadge: {
      backgroundColor: 'rgba(52, 199, 89, 0.15)',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    psbtSizeText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#34C759',
    },
    detailsSection: {
      marginBottom: 12,
    },
    detailsSectionTitle: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.colors.textSecondary,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    inputRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      backgroundColor: theme.colors.card || theme.colors.background,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      marginBottom: 6,
    },
    inputInfo: {
      flex: 1,
      marginRight: 8,
    },
    inputTxidText: {
      fontSize: 11,
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginBottom: 4,
    },
    derivePathContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
    },
    derivePathLabel: {
      fontSize: 9,
      color: theme.colors.textSecondary,
      marginRight: 6,
      fontWeight: '600',
    },
    derivePathText: {
      fontSize: 10,
      color: theme.colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      flex: 1,
    },
    outputRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.card || theme.colors.background,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      marginBottom: 6,
    },
    addressText: {
      fontSize: 11,
      color: theme.colors.text,
      flex: 1,
      marginRight: 8,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    derivePathSummary: {
      backgroundColor: theme.colors.card || theme.colors.background,
      borderRadius: 8,
      padding: 12,
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    derivePathSummaryLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.colors.textSecondary,
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    derivePathSummaryText: {
      fontSize: 12,
      color: theme.colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontWeight: '600',
    },
    derivePathNote: {
      fontSize: 9,
      color: theme.colors.textSecondary,
      marginTop: 4,
      fontStyle: 'italic',
    },
    // Sparrow-style Transaction Flow (Vertical for Mobile)
    transactionFlow: {
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    flowSection: {
      width: '100%',
    },
    flowSectionTitle: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.colors.textSecondary,
      marginBottom: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    flowItem: {
      marginBottom: 8,
    },
    flowItemContent: {
      backgroundColor: theme.colors.card || theme.colors.background,
      borderRadius: 8,
      padding: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    flowItemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    flowIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
      tintColor: theme.colors.text, // Use text color for better visibility in dark mode
    },
    flowItemInfo: {
      flex: 1,
    },
    flowItemLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginBottom: 2,
    },
    flowItemPath: {
      fontSize: 9,
      color: theme.colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    flowItemType: {
      fontSize: 9,
      color: theme.colors.textSecondary,
      fontStyle: 'italic',
      marginTop: 2,
    },
    flowAmount: {
      alignItems: 'flex-end',
    },
    flowAmountBTC: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.colors.primary,
    },
    flowAmountFiat: {
      fontSize: 9,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    flowConnectorVertical: {
      width: 1,
      height: 8,
      backgroundColor: theme.colors.border,
      marginLeft: 14,
      marginVertical: 4,
    },
    transactionHubVertical: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    hubArrow: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    hubArrowText: {
      fontSize: 20,
      color: theme.colors.primary,
      fontWeight: '700',
    },
    hubLabel: {
      marginTop: 4,
    },
    hubLabelText: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    summaryBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.card || theme.colors.background,
      borderRadius: 12,
      padding: 12,
      marginTop: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    summaryBarContent: {
      flex: 1,
      marginRight: 12,
    },
    summaryBarText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 4,
    },
    summaryBarPath: {
      fontSize: 10,
      color: theme.colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    summaryBarBadge: {
      backgroundColor: theme.colors.primary + '20',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    summaryBarBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.colors.primary,
    },
    amountContainer: {
      alignItems: 'flex-end',
    },
    amountText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.primary,
    },
    fiatText: {
      fontSize: 10,
      color: theme.colors.textSecondary,
      marginTop: 1,
    },
    feeTotalContainer: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingTop: 10,
    },
    feeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    feeLabel: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    feeValueContainer: {
      alignItems: 'flex-end',
    },
    feeValue: {
      fontSize: 12,
      color: theme.colors.text,
    },
    feeFiatValue: {
      fontSize: 10,
      color: theme.colors.textSecondary,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    totalLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.text,
    },
    totalValueContainer: {
      alignItems: 'flex-end',
    },
    totalValue: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.primary,
    },
    totalFiatValue: {
      fontSize: 11,
      color: theme.colors.textSecondary,
      marginTop: 1,
    },
    actionButtonsContainer: {
      flexDirection: 'row',
      marginTop: 20,
    },
    cancelButton: {
      flex: 1,
      backgroundColor: theme.colors.background,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginRight: 6,
    },
    middleButtonContainer: {
      marginHorizontal: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cancelButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
    },
    cancelButtonDisabled: {
      opacity: 0.5,
    },
    cancelButtonTextDisabled: {
      color: theme.colors.textSecondary,
    },
    signButton: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 6,
    },
    signButtonDisabled: {
      backgroundColor: theme.colors.border,
    },
    signButtonIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
      tintColor: '#FFFFFF',
    },
    signButtonIconDisabled: {
      tintColor: theme.colors.textSecondary,
    },
    signButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    signButtonTextDisabled: {
      color: theme.colors.textSecondary,
    },
    // Scanner styles
    scannerContainer: {
      flex: 1,
      backgroundColor: 'black',
    },
    qrFrame: {
      position: 'absolute',
      top: '30%',
      left: '15%',
      width: '70%',
      height: '30%',
      borderWidth: 2,
      borderColor: theme.colors.primary,
      borderRadius: 12,
      backgroundColor: 'transparent',
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
      backgroundColor: '#F7931A', // Bitcoin orange
      borderRadius: 3,
    },
    closeScannerButton: {
      position: 'absolute',
      bottom: 60,
      alignSelf: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      paddingVertical: 14,
      paddingHorizontal: 40,
      borderRadius: 12,
    },
    closeScannerButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    cameraNotFound: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      color: '#FFFFFF',
      fontSize: 16,
    },
    // Android scanning progress modal styles
    androidScanModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    androidScanModalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      padding: 24,
      width: '90%',
      maxWidth: 400,
      alignItems: 'center',
    },
    androidScanModalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.text,
      marginBottom: 12,
      textAlign: 'center',
    },
    androidScanModalSubtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 20,
    },
    androidScanCancelButton: {
      marginTop: 20,
      backgroundColor: theme.colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 32,
      borderRadius: 12,
    },
    androidScanCancelButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#FFFFFF',
    },
  });

export default PSBTModal;