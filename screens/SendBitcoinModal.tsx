import React, {useState, useCallback, useEffect, useMemo, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  NativeModules,
  ScrollView,
  Linking,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import AppText from '../components/AppText';
import QRScanner from '../components/QRScanner';
import Clipboard from '@react-native-clipboard/clipboard';
import debounce from 'lodash/debounce';
import Big from 'big.js';
import {dbg, decodeSendBitcoinQR, formatBitcoinDisplay} from '../utils';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  validateBitcoinAddressEnhanced,
  waitMS,
  WalletService,
} from '../services/WalletService';
import utxoRepository from '../services/repositories/UtxoRepository';
import {estimateFee, type FeeStrategy} from '../services/feeUtils';
import {formatFeeEstimationError} from '../services/feeErrorMessages';
import {resolveStoredMempoolApiBase} from '../services/mempoolApiBase';
import {initializeBranta, resolveBrantaQr} from '../services/BrantaService';
import merchantLabelRepository from '../services/repositories/MerchantLabelRepository';
import BrantaVerificationCard from '../components/BrantaVerificationCard';
import {extractBitcoinAddressFromPaymentInput, parseBitcoinUri} from '../services/incomingUrlRouter';
const {BBMTLibNativeModule} = NativeModules;

const SEND_BITCOIN_VIDEO_GUIDE_URL =
  'https://x.com/boldbtcwallet/status/1988332367489237160';

const openSendBitcoinVideoGuide = () => {
  Linking.openURL(SEND_BITCOIN_VIDEO_GUIDE_URL).catch(err => {
    Alert.alert('Error', 'Unable to open the video link');
    dbg('Error opening Send Bitcoin video guide URL:', err);
  });
};

interface SendBitcoinModalProps {
  visible: boolean;
  onClose: () => void;
  onSend: (
    address: string,
    amount: Big,
    estimatedFee: Big,
    spendingHash: string,
    utxosJson?: string | null,
    changeAddress?: string | null,
    brantaInitiated?: boolean,
  ) => void;
  btcToFiatRate: Big;
  walletBalance: Big;
  walletAddress: string;
  selectedCurrency: string;
  /** Pre-fill address when opening (e.g. from QR scan of a plain address). */
  initialAddress?: string;
  /** Pre-fill amount in BTC when opening (e.g. BIP-21 amount query). */
  initialAmountBtc?: string;
  /** Pre-fill Branta QR for verification when opening (e.g. from WalletHome scan). */
  initialBrantaRawQr?: string;
}
const E8 = Big(10).pow(8);
const SendBitcoinModal: React.FC<SendBitcoinModalProps> = ({
  visible,
  onClose,
  onSend,
  btcToFiatRate,
  walletBalance,
  walletAddress,
  selectedCurrency,
  initialAddress,
  initialAmountBtc,
  initialBrantaRawQr,
}) => {
  const isMountedRef = useRef(true);
  const visibleRef = useRef(visible);
  /** Compact UTXOs (no scriptpubkey) captured at fee-estimation time, embedded in the QR. */
  const lastUtxosJsonRef = useRef<string | null>(null);
  /** Change address computed alongside UTXOs; passed through to co-signers via route params. */
  const lastChangeAddressRef = useRef<string | null>(null);
  /** Fee estimation cache — skip redundant runs when inputs haven't changed. */
  const lastFeeInputsRef = useRef<string>('');
  const [address, setAddress] = useState<string>('');
  const [btcAmount, setBtcAmount] = useState<Big>(Big(0));
  const [inBtcAmount, setInBtcAmount] = useState('');
  const [inUsdAmount, setInUsdAmount] = useState('');
  const [isScannerVisible, setIsScannerVisible] = useState<boolean>(false);
  const [estimatedFee, setEstimatedFee] = useState<Big | null>(null);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);
  const [spendingHash, setSpendingHash] = useState<string>('');
  const [_activeInput, setActiveInput] = useState<'btc' | 'usd' | null>(null);
  const [feeStrategy, setFeeStrategy] = useState('1hr');
  const [addressError, setAddressError] = useState<string | null>(null);
  // Branta verification state
  const [brantaRawQr, setBrantaRawQr] = useState<string>('');
  const [brantaPayment, setBrantaPayment] = useState<{
    platform: string;
    description?: string;
    logoUrl?: string;
    logoLightUrl?: string;
  } | null>(null);
  const [brantaVerifyUrl, setBrantaVerifyUrl] = useState<string | undefined>();
  const [brantaLoading, setBrantaLoading] = useState(false);
  const [_brantaError, setBrantaError] = useState<string | null>(null);
  const [brantaRawQrProp, setBrantaRawQrProp] = useState<string>('');
  const {theme} = useTheme();
  const {
    showSats,
    balanceFormattingEnabled,
    activeNetwork,
    activeAddressType,
    activeApiProvider,
  } = useUser();
  const isSatsMode = showSats;
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const styles = StyleSheet.create({
    feeStrategyContainer: {
      marginBottom: 8,
    },
    feeStrategyButton: {
      backgroundColor: theme.colors.cardBackground,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 12,
      marginRight: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
    },
    feeStrategyButtonSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    feeStrategyText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    feeStrategyTextSelected: {
      color: theme.colors.white,
    },
    label: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 6,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.modalBackdrop,
    },
    modalContainer: {
      width: '90%',
      maxHeight: '90%',
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      marginBottom: 12,
      paddingHorizontal: 0,
    },
    titleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flex: 1,
    },
    bitcoinLogo: {
      width: 20,
      height: 20,
      resizeMode: 'contain',
      // Keep Bitcoin logo intact (no tint)
    },
    title: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      flex: 1,
    },
    helpButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    helpIcon: {
      width: 22,
      height: 22,
      opacity: 0.9,
    },
    input: {
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.monospace,
      maxHeight: 48,
      backgroundColor: theme.colors.cardBackground || '#FFF',
      marginBottom: 8,
      color: theme.colors.text,
    },
    inputWithIcons: {
      position: 'relative',
      marginBottom: 12,
      marginTop: 0,
    },
    inputAddressWithIcons: {
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      paddingRight: 80,
      minHeight: 56,
      maxHeight: 64,
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.monospace,
      lineHeight: 16,
      backgroundColor: theme.colors.cardBackground || '#FFF',
      textAlignVertical: 'top',
      color: theme.colors.text,
    },
    iconImage: {
      width: 24,
      height: 24,
      tintColor: theme.colors.text, // Fix dark mode visibility
    },
    pasteIconContainer: {
      position: 'absolute',
      top: 10,
      right: 40,
      padding: 4,
    },
    qrIconContainer: {
      position: 'absolute',
      top: 10,
      right: 8,
      padding: 4,
    },
    labelContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 5,
    },
    maxText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent
          : theme.colors.bitcoinOrange,
      marginBottom: 10,
      textDecorationLine: 'underline',
    },
    balanceCard: {
      backgroundColor: theme.colors.cardBackground || '#f8f9fa',
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary || '#e0e0e0',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    balanceCardLeft: {
      flex: 1,
    },
    balanceCardLabel: {
      fontSize: theme.fontSizes?.sm || 11,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
      marginBottom: 3,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    balanceCardBtc: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.monospaceBold,
      color: theme.colors.text,
      marginBottom: 2,
    },
    balanceCardFiat: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    balanceCardMaxButton: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent || theme.colors.primary
          : theme.colors.bitcoinOrange,
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: 8,
      minWidth: 60,
      alignItems: 'center',
      justifyContent: 'center',
    },
    balanceCardMaxButtonText: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: '#fff',
    },
    inputContainer: {
      marginBottom: 0,
    },
    inputLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 6,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    inputError: {
      borderColor: theme.colors.danger || '#DC3545',
    },
    errorText: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.danger || '#DC3545',
      marginTop: -8,
      marginBottom: 8,
      marginLeft: 4,
    },
    feeContainer: {
      marginTop: 10,
      padding: 12,
      backgroundColor: theme.colors.cardBackground || '#f8f9fa',
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary,
    },
    feeLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
      marginBottom: 8,
    },
    feeInfoContainer: {
      marginTop: 0,
    },
    feeAmount: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.monospaceBold,
      color: theme.colors.text,
    },
    feeCalculating: {
      marginLeft: 10,
      color: theme.colors.textSecondary, // Use theme color for dark mode readability
      fontSize: theme.fontSizes?.base || 14,
    },
    feeAmountContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    feeLoadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 5,
    },
    feeAmountUsd: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    sendCancelButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 14,
      gap: 10,
    },
    sendButton: {
      flex: 1,
      backgroundColor: theme.colors.bitcoinOrange,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      flex: 1,
      backgroundColor: theme.colors.secondary || theme.colors.border,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: {
      color: '#fff',
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
    },
    disabledButton: {
      opacity: 0.5,
    },
  });
  const currentNetworkForValidation =
    activeNetwork === 'testnet' || activeNetwork === 'testnet3'
      ? 'testnet'
      : 'mainnet';
  const validateAddressForCurrentNetwork = useCallback(
    (addr: string) =>
      validateBitcoinAddressEnhanced(addr, currentNetworkForValidation),
    [currentNetworkForValidation],
  );
  const feeStrategies = [
    {label: 'Eco', value: 'eco'},
    {label: 'Priority', value: 'top'},
    {label: '30 Min', value: '30m'},
    {label: '1 Hour', value: '1hr'},
  ];
  const formatUSD = (price: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  const getFee = useCallback(
    async (addr: string, amt: string) => {
      if (!isMountedRef.current || !visibleRef.current) return;
      if (!addr || !amt || btcAmount.eq(0)) {
        setEstimatedFee(null);
        lastFeeInputsRef.current = '';
        return;
      }
      if (!validateAddressForCurrentNetwork(addr)) {
        dbg(
          'Fee estimation skipped: invalid address for network',
          addr,
          currentNetworkForValidation,
        );
        setEstimatedFee(null);
        lastFeeInputsRef.current = '';
        return;
      }
      const amount = Big(amt);
      if (amount.gt(walletBalance) || !walletBalance) {
        setEstimatedFee(null);
        lastFeeInputsRef.current = '';
        return;
      }

      // Skip if inputs identical to last successful estimation (prevents UI flicker)
      const inputKey = `${addr}|${amt}|${feeStrategy}`;
      if (inputKey === lastFeeInputsRef.current) {
        return;
      }

      setIsCalculatingFee(true);
      const amountSats = Number(amount.times(1e8).toFixed(0));
      const satoshiAmount = amountSats.toString();

      try {
        const ws = WalletService.getInstance();
        const effectiveType = activeAddressType || 'segwit-native';

        // --- DB-first: HD addresses (cached, instant) + UTXOs from SQLite ---
        let hdAddrs: Array<{
          address: string;
          derivationPath: string;
          chain: string;
          index: number;
        }> = [];
        try {
          hdAddrs = await ws.getHdAddressesWithPaths(
            activeNetwork,
            effectiveType,
          );
        } catch {
          dbg('SendBitcoinModal: HD address derivation failed');
        }

        let dbUtxos =
          hdAddrs.length > 0
            ? utxoRepository.getUtxosForAddresses(
                hdAddrs.map(a => a.address),
                activeNetwork,
              )
            : utxoRepository.getUtxosForNetwork(activeNetwork, effectiveType);

        let changeAddress = '';
        try {
          changeAddress = await ws.getNextChangeAddress(
            activeNetwork,
            effectiveType,
          );
        } catch {
          // Non-critical for fee estimation
        }

        // Build spending-hash JSON from DB UTXOs + HD derivation paths
        let utxosJson: string | null = null;
        if (dbUtxos.length > 0 && hdAddrs.length > 0) {
          const pathMap = new Map(
            hdAddrs.map(a => [a.address, a.derivationPath]),
          );
          const utxoEntries = dbUtxos.map(u => ({
            txid: u.txid,
            vout: u.vout,
            value: u.valueSats,
            address: u.address,
            derivation_path: u.derivationPath || pathMap.get(u.address) || '',
            scriptpubkey: u.scriptPubkey || '',
          }));
          utxosJson = JSON.stringify(utxoEntries);
          lastUtxosJsonRef.current = JSON.stringify(
            utxoEntries.map(u => ({
              txid: u.txid,
              vout: u.vout,
              value: u.value,
              derivation_path: u.derivation_path,
              address: u.address,
            })),
          );
          lastChangeAddressRef.current = changeAddress;
          dbg(
            'SendBitcoinModal: using',
            dbUtxos.length,
            'UTXOs from DB (no live fetch)',
          );
        }

        // Fallback: if DB had no UTXOs, do a live fetch
        if (!dbUtxos.length && activeApiProvider) {
          dbg('SendBitcoinModal: DB empty, falling back to live UTXO fetch');
          try {
            const utxosWithPaths = await ws.fetchUtxosWithPaths(
              activeNetwork,
              effectiveType,
              activeApiProvider,
            );
            dbg(
              'SendBitcoinModal: live utxosWithPaths count',
              utxosWithPaths.length,
            );
            utxosJson = JSON.stringify(utxosWithPaths);
            lastUtxosJsonRef.current = JSON.stringify(
              utxosWithPaths.map(u => ({
                txid: u.txid,
                vout: u.vout,
                value: u.value,
                derivation_path: u.derivationPath,
                address: u.address,
              })),
            );
            lastChangeAddressRef.current = changeAddress;
            if (utxosWithPaths.length > 0) {
              dbUtxos = utxosWithPaths.map(u => ({
                txid: u.txid,
                vout: u.vout,
                address: u.address,
                network: activeNetwork,
                valueSats: u.value,
                scriptPubkey: null,
                derivationPath: u.derivationPath ?? null,
                isConfirmed: u.status?.confirmed ?? true,
                blockHeight: u.status?.block_height ?? null,
                blockTime: u.status?.block_time ?? null,
                fetchedAt: Date.now(),
              }));
            }
          } catch (e) {
            dbg('SendBitcoinModal: live UTXO fetch failed', e);
          }
        }

        // --- Spending hash (still native — MPC-specific) ---
        let hash: string;
        if (utxosJson) {
          hash = await BBMTLibNativeModule.spendingHashWithUTXOs(
            utxosJson,
            addr,
            satoshiAmount,
          );
        } else {
          hash = await BBMTLibNativeModule.spendingHash(
            walletAddress,
            addr,
            satoshiAmount,
          );
        }
        if (!isMountedRef.current || !visibleRef.current) return;
        setSpendingHash(hash);
        dbg('got spending hash:', hash);

        // --- Fee estimation (pure TS — DB UTXOs + cached fee rates) ---
        if (!dbUtxos.length) {
          throw new Error('No UTXOs available for fee estimation');
        }

        const apiBase =
          activeApiProvider || resolveStoredMempoolApiBase(activeNetwork);
        const result = await estimateFee({
          utxos: dbUtxos,
          receiverAddress: addr,
          amountSats,
          changeAddress: changeAddress || walletAddress,
          strategy: feeStrategy as FeeStrategy,
          apiBase,
        });

        if (!isMountedRef.current || !visibleRef.current) return;

        dbg('got fees (TS):', result.feeSats, 'sats', result.feeRate, 'sat/vB');
        const feeAmt = Big(result.feeSats);
        setEstimatedFee(feeAmt);
        lastFeeInputsRef.current = inputKey;
        Keyboard.dismiss();

        if (btcAmount.eq(walletBalance)) {
          const adjustedAmount = walletBalance.minus(feeAmt.div(1e8));
          setInBtcAmount(
            isSatsMode
              ? adjustedAmount.times(1e8).toFixed(0)
              : adjustedAmount.toFixed(8),
          );
          setBtcAmount(adjustedAmount);
          setInUsdAmount(adjustedAmount.times(btcToFiatRate).toFixed(2));
        }
      } catch (e: any) {
        if (!isMountedRef.current || !visibleRef.current) return;
        dbg('Fee estimation failed:', e);
        setEstimatedFee(null);
        if (e.message && !e.message.includes('Invalid number')) {
          Alert.alert(
            'Cannot estimate fee',
            formatFeeEstimationError(e),
            [
              {text: 'Cancel', style: 'cancel'},
              {text: 'Retry', onPress: () => getFee(addr, amt)},
            ],
            {cancelable: true},
          );
        }
      } finally {
        if (isMountedRef.current && visibleRef.current) {
          setIsCalculatingFee(false);
        }
      }
    },
    [
      btcAmount,
      walletBalance,
      walletAddress,
      btcToFiatRate,
      validateAddressForCurrentNetwork,
      currentNetworkForValidation,
      isSatsMode,
      feeStrategy,
      activeApiProvider,
      activeNetwork,
      activeAddressType,
    ],
  );
  const getFeeRef = useRef(getFee);
  getFeeRef.current = getFee;
  const debouncedGetFee = useMemo(
    () =>
      debounce((...args: [string, string]) => getFeeRef.current(...args), 1000),
    [],
  );
  useEffect(() => {
    const feeOption = appConfigRepository.get(CONFIG_KEYS.FEE_STRATEGY);
    const defaultFee = feeOption && feeOption !== 'min' ? feeOption : 'eco';
    setFeeStrategy(defaultFee);
    dbg('using fee strategy', defaultFee);
  }, []);
  useEffect(() => {
    if (!visible) {
      setAddress('');
      lastFeeInputsRef.current = '';
      // Reset Branta state when modal closes
      setBrantaRawQr('');
      setBrantaPayment(null);
      setBrantaVerifyUrl(undefined);
      setBrantaLoading(false);
      return;
    }
    if (initialAddress) {
      setAddress(initialAddress);
    }
    if (initialAmountBtc) {
      try {
        const amountBTC = Big(initialAmountBtc);
        if (amountBTC.gt(0)) {
          setBtcAmount(amountBTC);
          setInBtcAmount(amountBTC.toFixed(8));
          setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
        }
      } catch {
        // Ignore invalid pre-filled amounts
      }
    }
  }, [visible, initialAddress, initialAmountBtc, btcToFiatRate]);
  useEffect(() => {
    if (!address) {
      setAddressError(null);
      return;
    }
    if (!validateAddressForCurrentNetwork(address)) {
      setAddressError('Please enter a valid Bitcoin address.');
    } else {
      setAddressError(null);
    }
  }, [address, validateAddressForCurrentNetwork]);
  useEffect(() => {
    if (
      address &&
      btcAmount &&
      btcAmount.gt(0) &&
      validateAddressForCurrentNetwork(address)
    ) {
      debouncedGetFee(address, btcAmount.toString());
    } else {
      debouncedGetFee.cancel();
      setEstimatedFee(null);
    }
    return () => debouncedGetFee.cancel();
    // debouncedGetFee is memoized once; do not list it or getFee — would cancel/reset the debouncer on unrelated identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, btcAmount, feeStrategy, validateAddressForCurrentNetwork]);
  // Initialize Branta service and pre-load QR data if provided
  useEffect(() => {
    try {
      initializeBranta(activeNetwork);
      
      // If prop-provided Branta QR, extract address+amount immediately from bitcoin: URI
      // and also trigger merchant info resolution
      if (initialBrantaRawQr) {
        try {
          // Extract address and amount from bitcoin: URI without waiting for API
          const parsed = parseBitcoinUri(initialBrantaRawQr);
          if (parsed.kind === 'bitcoin-pay') {
            setAddress(parsed.address);
            if (parsed.amountBtc) {
              try {
                const amountBTC = Big(parsed.amountBtc);
                if (amountBTC.gt(0)) {
                  setBtcAmount(amountBTC);
                  setInBtcAmount(amountBTC.toFixed(8));
                  setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
                }
              } catch (e) {
                // Ignore invalid amount
              }
            }
          }
          // Trigger merchant info resolution in background
          setBrantaRawQrProp(initialBrantaRawQr);
        } catch (parseErr) {
          dbg('Error parsing Branta QR', parseErr);
          setBrantaRawQrProp('');
        }
      } else {
        setBrantaRawQrProp('');
      }
    } catch (err) {
      // Silent error in initialization
      dbg('Error initializing Branta', err);
      setBrantaRawQrProp('');
    }
  }, [activeNetwork, initialBrantaRawQr, btcToFiatRate]);
  // Resolve Branta QR when raw QR data is set (strict mode: only ZK-encoded QRs)
  useEffect(() => {
    const rawQr = brantaRawQr || brantaRawQrProp;
    
    if (!rawQr) {
      setBrantaPayment(null);
      setBrantaVerifyUrl(undefined);
      setBrantaLoading(false);
      setBrantaError(null);
      return;
    }

    // Reset error state and mark as loading
    setBrantaPayment(null);
    setBrantaVerifyUrl(undefined);
    setBrantaLoading(true);
    setBrantaError(null);
    let cancelled = false;

    // Wrap entire Branta resolution in try-catch for robustness
    (async () => {
      try {
        const result = await resolveBrantaQr(rawQr, activeNetwork);
        
        if (cancelled) return;

        if (!result) {
          // Silent fallback: no Branta data found, continue with manual entry
          setBrantaPayment(null);
          setBrantaVerifyUrl(undefined);
          setBrantaLoading(false);
          setBrantaError(null);
          return;
        }

        try {
          // Validate address
          if (validateAddressForCurrentNetwork(result.address)) {
            setAddress(result.address);
          }

          // Persist to merchant_labels repository with error handling
          try {
            merchantLabelRepository.upsert({
              address: result.address,
              platform: result.platform,
              description: result.description,
              logoUrl: result.logoUrl,
              logoLightUrl: result.logoLightUrl,
              verifyUrl: result.verifyUrl,
              fetchedAt: Date.now(),
            });
          } catch (dbErr) {
            // Silent DB error - doesn't block UI
            dbg('Warning: Failed to persist merchant label', dbErr);
          }

          // Update UI state
          setBrantaPayment({
            platform: result.platform,
            description: result.description,
            logoUrl: result.logoUrl,
            logoLightUrl: result.logoLightUrl,
          });
          setBrantaVerifyUrl(result.verifyUrl);
          setBrantaLoading(false);
          setBrantaError(null);
        } catch (processErr) {
          // Error processing result, silent fallback
          dbg('Error processing Branta result', processErr);
          setBrantaPayment(null);
          setBrantaVerifyUrl(undefined);
          setBrantaLoading(false);
          setBrantaError(null);
        }
      } catch (err) {
        // Top-level catch for any unexpected errors
        if (cancelled) return;
        dbg('Unexpected error in resolveBrantaQr', err);
        setBrantaPayment(null);
        setBrantaVerifyUrl(undefined);
        setBrantaLoading(false);
        setBrantaError(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brantaRawQr, brantaRawQrProp, activeNetwork, validateAddressForCurrentNetwork]);
  const pasteAddress = useCallback(async () => {
    const text = await Clipboard.getString();
    // Validate that the clipboard contains what looks like a Bitcoin address
    if (!text || !text.trim()) {
      Alert.alert('Error', 'No content found in clipboard');
      return;
    }
    // Show confirmation dialog for security
    Alert.alert(
      'Confirm Address',
      `Use this address?\n\n${text}`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Use Address',
          onPress: () => {
            setAddress(text.trim());
          },
        },
      ],
      {cancelable: true},
    );
  }, []);
  const handleBtcChange = (text: string) => {
    setActiveInput('btc');
    setInBtcAmount(text);
    try {
      const value = Big(text || 0);
      const btc = isSatsMode ? value.div(E8) : value;
      setBtcAmount(btc);
      // Always update USD amount when amount changes (BTC basis)
      setInUsdAmount(btc.mul(btcToFiatRate).toFixed(2));
    } catch {
      dbg('Invalid amount input:', text);
    }
  };
  const handleUsdChange = (text: string) => {
    setActiveInput('usd');
    setInUsdAmount(text);
    try {
      const usd = Big(text || 0);
      const calculatedBtc = usd.div(btcToFiatRate);
      // Always update BTC amount when USD changes (no need to check activeInput)
      setBtcAmount(calculatedBtc);
      setInBtcAmount(
        isSatsMode
          ? calculatedBtc.times(E8).toFixed(0)
          : calculatedBtc.toFixed(8),
      );
    } catch {
      dbg('Invalid USD input:', text);
    }
  };
  const handleMaxClick = () => {
    // If a fee estimation is already in progress, ignore repeated MAX clicks
    if (isCalculatingFee) {
      return;
    }
    // Require a valid address before calculating max and fees
    if (!address || !validateAddressForCurrentNetwork(address)) {
      setAddressError('Please enter a valid Bitcoin address.');
      Alert.alert('Error', 'Please enter a valid Bitcoin address.');
      return;
    }
    // clear up
    setBtcAmount(Big(0));
    setInBtcAmount('');
    setInUsdAmount('');
    waitMS(100).then(() => {
      // set the amount to the wallet balance
      setBtcAmount(walletBalance);
      setInBtcAmount(
        isSatsMode
          ? walletBalance.times(E8).toFixed(0)
          : walletBalance.toFixed(8),
      );
      setInUsdAmount(walletBalance.times(btcToFiatRate).toFixed(2));
    });
  };
  // Handle QR scan - supports both regular addresses and send bitcoin QR format
  const handleQRScan = useCallback(
    (qrData: string) => {
      if (!qrData || !qrData.trim()) {
        return;
      }

      if (qrData.trim().toLowerCase().startsWith('ur:')) {
        return;
      }

      // Store raw QR for Branta resolution (if it contains branta_id & branta_secret, it will resolve)
      setBrantaRawQr(qrData.trim());

      // Detect if this is a Branta ZK QR by checking for ZK parameters
      const hasBrantaParams = qrData.includes('branta_id') && qrData.includes('branta_secret');

      // Check if it's a send bitcoin QR format (address|amount|fee|hash|addressType|derivationPath)
      const decoded = decodeSendBitcoinQR(qrData) as {
        toAddress: string;
        amountSats: string;
        feeSats: string;
        spendingHash?: string;
        addressType?: string;
        derivationPath?: string;
      } | null;
      if (
        decoded &&
        decoded.toAddress &&
        decoded.amountSats &&
        decoded.feeSats
      ) {
        // It's a send bitcoin QR format - populate all fields
        if (!validateAddressForCurrentNetwork(decoded.toAddress)) {
          Alert.alert(
            'Error',
            'The scanned QR code contains an invalid Bitcoin address.',
          );
          return;
        }
        const amountSats = Big(decoded.amountSats);
        const feeSats = Big(decoded.feeSats);
        const amountBTC = amountSats.div(1e8);
        if (amountSats.lte(0) || feeSats.lte(0)) {
          Alert.alert(
            'Error',
            'The scanned QR code contains invalid amount or fee values.',
          );
          return;
        }
        // Populate form fields
        setAddress(decoded.toAddress);
        setBtcAmount(amountBTC);
        setInBtcAmount(amountBTC.toFixed(8));
        setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
        setSpendingHash(decoded.spendingHash || '');
        Alert.alert(
          'Transaction Details Loaded',
          `Address and amount have been filled from the QR code.\n\nAddress: ${decoded.toAddress.substring(
            0,
            10,
          )}...\nAmount: ${formatBitcoinDisplay(amountBTC.toNumber(), {
            inSats: showSats,
            formatted: balanceFormattingEnabled,
          })}\n\nPlease review and confirm.`,
        );
      } else if (hasBrantaParams) {
        // Branta ZK QR detected — don't extract address from URI placeholder
        // The Branta effect will resolve and set the actual destination address
        // (Branta returns the real merchant address, not the bitcoin: URI placeholder)
        dbg('handleQRScan: Detected Branta ZK params, waiting for resolution');
      } else {
        // Try to handle as bitcoin: URI or plain address
        const extractedAddress = extractBitcoinAddressFromPaymentInput(
          qrData.trim(),
        );
        if (extractedAddress && validateAddressForCurrentNetwork(extractedAddress)) {
          setAddress(extractedAddress);
          // If it was a bitcoin: URI with amount parameter, extract and populate it
          if (qrData.trim().toLowerCase().startsWith('bitcoin:')) {
            try {
              const url = new URL(qrData.trim());
              const amountParam = url.searchParams.get('amount');
              if (amountParam) {
                const amountBTC = Big(amountParam);
                if (amountBTC.gt(0)) {
                  setBtcAmount(amountBTC);
                  setInBtcAmount(amountBTC.toFixed(8));
                  setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
                }
              }
            } catch {
              // Ignore errors in URI parsing; address was already extracted
            }
          }
        } else {
          Alert.alert(
            'Invalid QR Code',
            'The scanned QR code is not a valid Bitcoin address or send bitcoin data.',
          );
        }
      }
    },
    [
      btcToFiatRate,
      showSats,
      balanceFormattingEnabled,
      validateAddressForCurrentNetwork,
    ],
  );
  const handleFeeStrategyChange = (value: string) => {
    setFeeStrategy(value);
    lastFeeInputsRef.current = '';
    dbg('setting fee strategy to', value);
    appConfigRepository.set(CONFIG_KEYS.FEE_STRATEGY, value);
    Keyboard.dismiss();
  };
  const handleSendClick = () => {
    try {
      // Client-side Bitcoin address validation
      if (!address || !validateAddressForCurrentNetwork(address)) {
        setAddressError('Please enter a valid Bitcoin addres');
        Alert.alert('Error', 'Please enter a valid Bitcoin addres');
        return;
      }
      if (!estimatedFee) {
        Alert.alert(
          'Fee Estimation Error',
          'Unable to estimate transaction fee. Please try again later.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Retry',
              onPress: () => {
                getFee(address, btcAmount.toString());
              },
            },
          ],
          {cancelable: true},
        );
        return;
      }
      // Work internally in BTC regardless of display mode
      const feeBTC = estimatedFee.div(E8);
      const totalAmountBTC = btcAmount.add(feeBTC);
      if (totalAmountBTC.gt(walletBalance)) {
        Alert.alert(
          'Error',
          'Total amount including fee exceeds wallet balance',
        );
        return;
      }
      // Normalize to sats for sending
      const amountSats = btcAmount.times(E8);
      onSend(
        address,
        amountSats,
        estimatedFee,
        spendingHash,
        lastUtxosJsonRef.current,
        lastChangeAddressRef.current,
        !!brantaPayment,
      );
    } catch (error) {
      dbg('SendBitcoinModal: handleSendClick failed', error);
      Alert.alert(
        'Send failed',
        'Could not start this transaction. Please try again.',
      );
    }
  };
  // Check if amount exceeds balance
  const amountExceedsBalance = btcAmount.gt(0) && btcAmount.gt(walletBalance);
  const renderFeeSection = () => {
    if (!address || !btcAmount) {
      return null;
    }
    return (
      <View style={styles.feeContainer}>
        {isCalculatingFee ? (
          <View style={styles.feeLoadingContainer}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.feeCalculating}>Calculating...</Text>
          </View>
        ) : estimatedFee ? (
          <View style={styles.feeInfoContainer}>
            <View style={styles.feeStrategyContainer}>
              <Text style={styles.feeLabel}>Network Fee:</Text>
              <ScrollView
                horizontal
                removeClippedSubviews
                keyboardShouldPersistTaps="handled"
                overScrollMode="never"
                showsHorizontalScrollIndicator={false}>
                {feeStrategies.map(strategy => (
                  <AppPressable
                    key={strategy.value}
                    style={[
                      styles.feeStrategyButton,
                      feeStrategy === strategy.value &&
                        styles.feeStrategyButtonSelected,
                    ]}
                    onPress={() => handleFeeStrategyChange(strategy.value)}>
                    <Text
                      style={[
                        styles.feeStrategyText,
                        feeStrategy === strategy.value &&
                          styles.feeStrategyTextSelected,
                      ]}>
                      {strategy.label}
                    </Text>
                  </AppPressable>
                ))}
              </ScrollView>
            </View>
            <View style={styles.feeAmountContainer}>
              <Text style={styles.feeAmount}>
                {formatBitcoinDisplay(estimatedFee.div(E8).toNumber(), {
                  inSats: showSats,
                  formatted: balanceFormattingEnabled,
                })}
              </Text>
              <Text style={styles.feeAmountUsd}>
                ({selectedCurrency}{' '}
                {formatUSD(
                  estimatedFee.div(E8).times(btcToFiatRate).toNumber(),
                )}
                )
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  };
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : -500}>
              <SafeAreaView edges={['top', 'left', 'right']}>
                <View style={styles.header}>
                  <View style={styles.titleContainer}>
                    <Image
                      source={require('../assets/bitcoin-logo.png')}
                      style={styles.bitcoinLogo}
                    />
                    <AppText style={styles.title}>Send Bitcoin</AppText>
                  </View>
                  <AppPressable
                    onPress={openSendBitcoinVideoGuide}
                    style={styles.helpButton}
                    accessibilityRole="button"
                    accessibilityLabel="Send Bitcoin video guide"
                    android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                    <Image
                      source={require('../assets/info-icon.png')}
                      style={[
                        styles.helpIcon,
                        {tintColor: theme.colors.text},
                      ]}
                      resizeMode="contain"
                    />
                  </AppPressable>
                </View>
                <ScrollView
                  removeClippedSubviews
                  keyboardShouldPersistTaps="handled"
                  overScrollMode="never"
                  showsVerticalScrollIndicator={false}>
                  <View style={styles.inputWithIcons}>
                    <TextInput
                      style={styles.inputAddressWithIcons}
                      placeholder="Recipient Bitcoin Address"
                      placeholderTextColor={theme.colors.textSecondary + '80'}
                      value={address}
                      onChangeText={setAddress}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                      numberOfLines={2}
                      scrollEnabled
                      selectTextOnFocus
                    />
                    <AppPressable
                      onPress={pasteAddress}
                      style={styles.pasteIconContainer}>
                      <Image
                        source={require('../assets/paste-icon.png')}
                        style={styles.iconImage}
                        resizeMode="contain"
                      />
                    </AppPressable>
                    <AppPressable
                      onPress={() => {
                        setIsScannerVisible(true);
                      }}
                      style={styles.qrIconContainer}>
                      <Image
                        source={require('../assets/scan-icon.png')}
                        style={styles.iconImage}
                        resizeMode="contain"
                      />
                    </AppPressable>
                  </View>
                  {addressError && (
                    <AppText style={styles.errorText}>{addressError}</AppText>
                  )}
                  <BrantaVerificationCard
                    platform={brantaPayment?.platform}
                    description={brantaPayment?.description}
                    logoUrl={brantaPayment?.logoUrl}
                    logoLightUrl={brantaPayment?.logoLightUrl}
                    verifyUrl={brantaVerifyUrl}
                    isLoading={brantaLoading}
                  />
                  {/* Balance Card */}
                  <View style={styles.balanceCard}>
                    <View style={styles.balanceCardLeft}>
                      <AppText style={styles.balanceCardLabel}>
                        Available Balance
                      </AppText>
                      <Text style={styles.balanceCardBtc}>
                        {formatBitcoinDisplay(walletBalance.toNumber(), {
                          inSats: showSats,
                          formatted: balanceFormattingEnabled,
                        })}
                      </Text>
                      <AppText style={styles.balanceCardFiat}>
                        ~{selectedCurrency}{' '}
                        {formatUSD(
                          walletBalance.times(btcToFiatRate).toNumber(),
                        )}
                      </AppText>
                    </View>
                    <AppPressable
                      onPress={handleMaxClick}
                      disabled={isCalculatingFee}
                      style={styles.balanceCardMaxButton}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <Text style={styles.balanceCardMaxButtonText}>Max</Text>
                    </AppPressable>
                  </View>
                  <View style={styles.inputContainer}>
                    <AppText style={styles.inputLabel}>
                      {isSatsMode ? 'Amount in sats' : 'Amount in BTC (₿)'}
                    </AppText>
                    <TextInput
                      style={[
                        styles.input,
                        amountExceedsBalance && styles.inputError,
                      ]}
                      placeholder={
                        isSatsMode ? 'Enter sats amount' : 'Enter BTC amount'
                      }
                      placeholderTextColor={theme.colors.textSecondary + '80'}
                      value={inBtcAmount}
                      onChangeText={handleBtcChange}
                      onFocus={() => setActiveInput('btc')}
                      keyboardType={isSatsMode ? 'numeric' : 'decimal-pad'}
                    />
                    {amountExceedsBalance && (
                      <AppText style={styles.errorText}>
                        Amount exceeds wallet balance (
                        {formatBitcoinDisplay(walletBalance.toNumber(), {
                          inSats: showSats,
                          formatted: balanceFormattingEnabled,
                        })}
                        )
                      </AppText>
                    )}
                  </View>
                  <View style={styles.inputContainer}>
                    <AppText style={styles.inputLabel}>
                      Amount in {selectedCurrency} ($)
                    </AppText>
                    <TextInput
                      style={styles.input}
                      placeholder={`Or ${selectedCurrency} amount`}
                      placeholderTextColor={theme.colors.textSecondary + '80'}
                      value={inUsdAmount}
                      onFocus={() => setActiveInput('usd')}
                      onChangeText={handleUsdChange}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  {renderFeeSection()}
                  <View style={styles.sendCancelButtons}>
                    <AppPressable
                      style={[
                        styles.sendButton,
                        (!address ||
                          !btcAmount ||
                          isCalculatingFee ||
                          !estimatedFee) &&
                          styles.disabledButton,
                      ]}
                      onPress={handleSendClick}
                      disabled={
                        !address ||
                        !btcAmount ||
                        isCalculatingFee ||
                        !estimatedFee
                      }
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <AppText style={styles.buttonText} tone="onPrimary">
                        Send
                      </AppText>
                    </AppPressable>
                    <AppPressable
                      style={styles.cancelButton}
                      onPress={() => {
                        onClose();
                      }}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <AppText style={styles.buttonText}>Cancel</AppText>
                    </AppPressable>
                  </View>
                </ScrollView>
                <QRScanner
                  visible={isScannerVisible}
                  onClose={() => setIsScannerVisible(false)}
                  onScan={handleQRScan}
                  mode="single"
                  title="Scan QR Code"
                  subtitle="Point camera at the QR data"
                />
              </SafeAreaView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
export default SendBitcoinModal;
