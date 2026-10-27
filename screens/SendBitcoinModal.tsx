import React, {useState, useCallback, useEffect, useMemo, useRef} from 'react';
import {confirmAppPrompt, showAppNotice} from '../services/appPrompt';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
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
import AppModal from '../components/AppModal';
import Toast from 'react-native-toast-message';
import AppPressable from '../components/AppPressable';
import AppText from '../components/AppText';
import GlassModalOverlay from '../components/GlassModalOverlay';
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
import utxoTagRepository from '../services/repositories/UtxoTagRepository';
import {
  clampFeeRateSatVb,
  estimateFee,
  fetchFeeRates,
  pickRate,
  type FeeRates,
  type FeeStrategy,
} from '../services/feeUtils';
import FeeRateSlider from '../components/FeeRateSlider';
import {resolveStoredMempoolApiBase} from '../services/mempoolApiBase';
import {
  initializeBranta,
  isBrantaEnabled,
  resolveBrantaQr,
} from '../services/BrantaService';
import merchantLabelRepository from '../services/repositories/MerchantLabelRepository';
import BrantaVerificationCard from '../components/BrantaVerificationCard';
import UtxoCoinControlList from '../components/UtxoCoinControlList';
import {extractBitcoinAddressFromPaymentInput, parseBitcoinUri} from '../services/incomingUrlRouter';
import {
  clampSendAmountSats,
  filterUtxosByOutpoints,
  outpointKey,
  selectionFeeKey,
  sortCoinControlUtxos,
  sumSelectedSats,
  type CoinControlUtxo,
} from '../services/utxoCoinControl';
import type {StoredUtxo} from '../services/repositories/UtxoRepository';
import {scriptPubKeyFromAddress} from '../utils/scriptPubKeyFromAddress';
const {BBMTLibNativeModule} = NativeModules;

const SEND_BITCOIN_VIDEO_GUIDE_URL =
  'https://x.com/boldbtcwallet/status/1988332367489237160';

const openSendBitcoinVideoGuide = () => {
  Linking.openURL(SEND_BITCOIN_VIDEO_GUIDE_URL).catch(err => {
    showAppNotice('Error', 'Unable to open the video link');
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
  onDismiss?: () => void;
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
  onDismiss,
}) => {
  const isMountedRef = useRef(true);
  const visibleRef = useRef(visible);
  /** Compact UTXOs (no scriptpubkey) captured at fee-estimation time, embedded in the QR. */
  const lastUtxosJsonRef = useRef<string | null>(null);
  /** Change address computed alongside UTXOs; passed through to co-signers via route params. */
  const lastChangeAddressRef = useRef<string | null>(null);
  /** Fee estimation cache — skip redundant runs when inputs haven't changed. */
  const lastFeeInputsRef = useRef<string>('');
  /** Bumps on each fee run so a slower estimate cannot overwrite a newer one. */
  const feeReqRef = useRef(0);
  const [address, setAddress] = useState<string>('');
  const [clipboardAddress, setClipboardAddress] = useState<string | null>(null);
  const addressRef = useRef(address);
  addressRef.current = address;
  const [btcAmount, setBtcAmount] = useState<Big>(Big(0));
  const btcAmountRef = useRef(btcAmount);
  btcAmountRef.current = btcAmount;
  const rememberSendAmount = (next: Big) => {
    btcAmountRef.current = next;
    setBtcAmount(next);
  };
  const [inBtcAmount, setInBtcAmount] = useState('');
  const [inUsdAmount, setInUsdAmount] = useState('');
  const [isScannerVisible, setIsScannerVisible] = useState<boolean>(false);
  const [estimatedFee, setEstimatedFee] = useState<Big | null>(null);
  const [usingStaleFees, setUsingStaleFees] = useState(false);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);
  const [spendingHash, setSpendingHash] = useState<string>('');
  const [_activeInput, setActiveInput] = useState<'btc' | 'usd' | null>(null);
  const [feeStrategy, setFeeStrategy] = useState('1hr');
  const [feeRates, setFeeRates] = useState<FeeRates | null>(null);
  const [feeRateSatVb, setFeeRateSatVb] = useState<number>(1);
  const [feeRateDragging, setFeeRateDragging] = useState<number | null>(null);
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
  const [coinControlOpen, setCoinControlOpen] = useState(false);
  const [pickerUtxos, setPickerUtxos] = useState<CoinControlUtxo[]>([]);
  const [selectedOutpoints, setSelectedOutpoints] = useState<Set<string> | null>(
    null,
  );
  const selectedOutpointsRef = useRef<Set<string> | null>(null);
  const pickerUtxosRef = useRef<CoinControlUtxo[]>([]);
  selectedOutpointsRef.current = selectedOutpoints;
  pickerUtxosRef.current = pickerUtxos;
  const {theme} = useTheme();
  const {
    showSats,
    balanceFormattingEnabled,
    activeNetwork,
    activeAddressType,
    activeApiProvider,
    showUtxosTab,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    feeStrategyText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
    },
    feeStrategyTextSelected: {
      color: theme.colors.white,
    },
    feeRateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
      gap: 10,
    },
    feeRateLabel: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      flex: 1,
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
    },
    modalContainer: {
      width: '90%',
      maxHeight: '90%',
      overflow: 'hidden',
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
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      marginTop: 0,
      borderWidth: 1.5,
      borderColor: theme.colors.border || theme.colors.secondary,
      borderRadius: 10,
      backgroundColor: theme.colors.cardBackground || '#FFF',
      minHeight: 56,
    },
    inputAddressWithIcons: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      minHeight: 56,
      maxHeight: 64,
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.monospace,
      lineHeight: 16,
      backgroundColor: 'transparent',
      textAlignVertical: 'top',
      color: theme.colors.text,
    },
    iconImage: {
      width: 24,
      height: 24,
      tintColor: theme.colors.text, // Fix dark mode visibility
    },
    pasteIconContainer: {
      padding: 8,
    },
    qrIconContainer: {
      padding: 8,
      marginRight: 4,
    },
    pasteConfirm: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.colors.blackOverlay50,
      justifyContent: 'center',
      padding: 16,
      zIndex: 4,
    },
    pasteConfirmCard: {
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    pasteConfirmTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
    },
    pasteConfirmDetail: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      marginBottom: 14,
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
    balanceCardOpen: {
      marginBottom: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      borderBottomWidth: 0,
    },
    balanceCardLeft: {
      flex: 1,
    },
    balanceCardLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 3,
    },
    balanceCardChevron: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      marginLeft: 8,
    },
    balanceCardLabel: {
      fontSize: theme.fontSizes?.sm || 11,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary, // Remove fallback for better dark mode readability
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
    staleFeeHint: {
      marginTop: 8,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      opacity: 0.85,
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
  // Validator accepts every testnet spelling; pass through (undefined → default mainnet inside).
  const currentNetworkForValidation = activeNetwork;
  const validateAddressForCurrentNetwork = useCallback(
    (addr: string) =>
      validateBitcoinAddressEnhanced(addr, currentNetworkForValidation),
    [currentNetworkForValidation],
  );
  const feeStrategies: {label: string; value: FeeStrategy}[] = [
    {label: 'Eco', value: 'eco'},
    {label: '1 Hour', value: '1hr'},
    {label: '30 Min', value: '30m'},
    {label: 'Priority', value: 'top'},
  ];
  const feeAccent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;
  const sliderMin = Math.max(1, feeRates?.minimumFee ?? 1);
  const sliderMax = Math.max(
    feeRates?.fastestFee ?? 20,
    20,
    feeRateSatVb,
    feeRateDragging ?? 0,
  );
  const matchedStrategy = useMemo((): FeeStrategy | 'custom' => {
    if (!feeRates) {
      return 'custom';
    }
    const rate = feeRateDragging ?? feeRateSatVb;
    const named: FeeStrategy[] = ['eco', '1hr', '30m', 'top'];
    for (const s of named) {
      if (pickRate(feeRates, s) === rate) {
        return s;
      }
    }
    return 'custom';
  }, [feeRates, feeRateDragging, feeRateSatVb]);
  const formatUSD = (price: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  const spendableBalance = useMemo(() => {
    const selectedSats = sumSelectedSats(pickerUtxos, selectedOutpoints);
    if (selectedSats == null) {
      return walletBalance;
    }
    return Big(selectedSats).div(E8);
  }, [pickerUtxos, selectedOutpoints, walletBalance]);
  const selectionKey = selectionFeeKey(selectedOutpoints);
  const getFee = useCallback(
    async (addr: string, amt: string) => {
      if (!isMountedRef.current || !visibleRef.current) return;
      let amount: Big;
      try {
        amount = Big(amt);
      } catch {
        amount = Big(0);
      }
      if (!addr || !amt || amount.lte(0)) {
        feeReqRef.current += 1;
        setEstimatedFee(null);
        setUsingStaleFees(false);
        lastFeeInputsRef.current = '';
        setIsCalculatingFee(false);
        return;
      }
      if (!validateAddressForCurrentNetwork(addr)) {
        dbg(
          'Fee estimation skipped: invalid address for network',
          addr,
          currentNetworkForValidation,
        );
        feeReqRef.current += 1;
        setEstimatedFee(null);
        setUsingStaleFees(false);
        lastFeeInputsRef.current = '';
        setIsCalculatingFee(false);
        return;
      }
      const cap = spendableBalance;
      if (!cap || cap.lte(0)) {
        feeReqRef.current += 1;
        setEstimatedFee(null);
        setUsingStaleFees(false);
        lastFeeInputsRef.current = '';
        setIsCalculatingFee(false);
        return;
      }

      // Skip if inputs identical to last successful estimation (prevents UI flicker)
      const inputKey = `${addr}|${amt}|${feeRateSatVb}|${selectionKey}`;
      if (inputKey === lastFeeInputsRef.current) {
        return;
      }

      const requestId = ++feeReqRef.current;
      setIsCalculatingFee(true);

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

        let dbUtxos: StoredUtxo[] =
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

        // Fallback: if DB had no UTXOs, do a live fetch (full wallet, then coin-control filter)
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
            lastChangeAddressRef.current = changeAddress;
            if (utxosWithPaths.length > 0) {
              dbUtxos = utxosWithPaths.map(u => ({
                txid: u.txid,
                vout: u.vout,
                address: u.address,
                network: activeNetwork,
                valueSats: u.value,
                scriptPubkey: scriptPubKeyFromAddress(u.address),
                derivationPath: u.derivationPath ?? null,
                isConfirmed: u.status?.confirmed ?? true,
                blockHeight: u.status?.block_height ?? null,
                blockTime: u.status?.block_time ?? null,
                fetchedAt: Date.now(),
              }));
            }
          } catch (e) {
            dbg('SendBitcoinModal: live UTXO fetch failed', e);
            Toast.show({
              type: 'info',
              text1: 'Could not refresh UTXOs',
              text2: 'Using last known coins.',
              position: 'top',
            });
            if (!dbUtxos.length && lastUtxosJsonRef.current) {
              try {
                const prev = JSON.parse(lastUtxosJsonRef.current) as Array<{
                  txid: string;
                  vout: number;
                  value: number;
                  address?: string;
                  derivation_path?: string;
                }>;
                if (Array.isArray(prev) && prev.length) {
                  dbUtxos = prev.map(u => ({
                    txid: u.txid,
                    vout: u.vout,
                    address: u.address || '',
                    network: activeNetwork,
                    valueSats: u.value,
                    scriptPubkey: scriptPubKeyFromAddress(u.address || ''),
                    derivationPath: u.derivation_path ?? null,
                    isConfirmed: true,
                    blockHeight: null,
                    blockTime: null,
                    fetchedAt: Date.now(),
                  }));
                }
              } catch {
                // keep empty; blocking alert below if still no inputs
              }
            }
          }
        }

        // Exclusive-pool coin control: only the checked outpoints leave this device.
        dbUtxos = filterUtxosByOutpoints(
          dbUtxos,
          selectedOutpointsRef.current,
        );

        let utxosJson: string | null = null;
        if (dbUtxos.length > 0) {
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
            'UTXOs for spend pool',
          );
        }

        // Fee first, then the spending hash, so both match the amount that still fits.
        if (!dbUtxos.length) {
          throw new Error('No UTXOs available for fee estimation');
        }

        const apiBase =
          activeApiProvider || resolveStoredMempoolApiBase(activeNetwork);
        const capSats = Math.max(0, Math.floor(Number(cap.times(E8).toFixed(0))));
        const userAmountSats = Math.max(
          0,
          Math.floor(Number(amount.times(E8).toFixed(0))),
        );
        let sendSats = Math.min(userAmountSats, capSats);
        if (sendSats <= 0) {
          setEstimatedFee(null);
          setUsingStaleFees(false);
          lastFeeInputsRef.current = '';
          return;
        }
        const estimateAt = (sats: number) =>
          estimateFee({
            utxos: dbUtxos,
            receiverAddress: addr,
            amountSats: sats,
            changeAddress: changeAddress || walletAddress,
            strategy: feeStrategy as FeeStrategy,
            apiBase,
            feeRateSatVb,
          });
        const feeStillCurrent = () =>
          requestId === feeReqRef.current &&
          isMountedRef.current &&
          visibleRef.current &&
          btcAmountRef.current.eq(amount);

        let result = await estimateAt(sendSats);
        for (let pass = 0; pass < 3; pass++) {
          if (!feeStillCurrent()) return;
          const quotedFee = Math.max(0, Math.floor(result.feeSats));
          const clamped = clampSendAmountSats(sendSats, quotedFee, capSats);
          if (clamped == null) break;
          sendSats = clamped;
          result = await estimateAt(sendSats);
        }
        if (!feeStillCurrent()) return;

        const quotedFee = Math.max(0, Math.floor(result.feeSats));
        const overflow = clampSendAmountSats(sendSats, quotedFee, capSats);
        const feeMatchesSend = overflow == null;
        if (overflow != null) {
          sendSats = overflow;
        }

        dbg('got fees (TS):', result.feeSats, 'sats', result.feeRate, 'sat/vB');
        if (result.fromStaleFees && result.feeRate) {
          // Keep rates for chips when API fell back to DB.
          setFeeRates(prev =>
            prev
              ? {...prev, fromStaleCache: true}
              : {
                  fastestFee: result.feeRate,
                  halfHourFee: result.feeRate,
                  hourFee: result.feeRate,
                  economyFee: result.feeRate,
                  minimumFee: 1,
                  fetchedAt: Date.now(),
                  fromStaleCache: true,
                },
          );
        }
        const satoshiAmount = String(sendSats);
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
        if (!feeStillCurrent()) return;
        setSpendingHash(hash);
        dbg('got spending hash:', hash);

        const feeAmt = Big(quotedFee);
        setEstimatedFee(feeAmt);
        setUsingStaleFees(!!result.fromStaleFees);
        Keyboard.dismiss();

        if (sendSats < userAmountSats) {
          const adjusted = Big(sendSats).div(E8);
          if (feeMatchesSend) {
            lastFeeInputsRef.current = `${addr}|${adjusted.toString()}|${feeRateSatVb}|${selectionKey}`;
          } else {
            lastFeeInputsRef.current = '';
          }
          setInBtcAmount(
            isSatsMode ? String(sendSats) : adjusted.toFixed(8),
          );
          rememberSendAmount(adjusted);
          setInUsdAmount(
            adjusted.times(btcToFiatRateRef.current).toFixed(2),
          );
        } else {
          lastFeeInputsRef.current = inputKey;
        }
      } catch (e: any) {
        if (!isMountedRef.current || !visibleRef.current) return;
        dbg('Fee estimation failed:', e);
        setEstimatedFee(null);
        setUsingStaleFees(false);
        if (e.message && !e.message.includes('Invalid number')) {
          confirmAppPrompt({
            icon: 'fee',
            title: 'Fee unavailable',
            hint: 'Try again in a moment.',
            cancelLabel: 'Cancel',
            confirmLabel: 'Retry',
          }).then(ok => {
            if (ok) {
              getFee(addr, amt);
            }
          });
        }
      } finally {
        if (isMountedRef.current && requestId === feeReqRef.current) {
          setIsCalculatingFee(false);
        }
      }
    },
    [
      spendableBalance,
      selectionKey,
      walletAddress,
      validateAddressForCurrentNetwork,
      currentNetworkForValidation,
      isSatsMode,
      feeStrategy,
      feeRateSatVb,
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
    const defaultFee =
      feeOption && feeOption !== 'min' ? (feeOption as FeeStrategy) : 'eco';
    setFeeStrategy(defaultFee);
    dbg('using fee strategy', defaultFee);
  }, []);
  const feeRatesSeededRef = useRef(false);
  // Load recommended fee rates when the modal has a destination address.
  useEffect(() => {
    if (!visible) {
      feeRatesSeededRef.current = false;
      setFeeRates(null);
      return;
    }
    if (!address) {
      return;
    }
    let cancelled = false;
    const apiBase =
      activeApiProvider || resolveStoredMempoolApiBase(activeNetwork);
    fetchFeeRates(apiBase)
      .then(rates => {
        if (cancelled || !isMountedRef.current) {
          return;
        }
        setFeeRates(rates);
        if (feeRatesSeededRef.current) {
          return;
        }
        feeRatesSeededRef.current = true;
        const strategy = (appConfigRepository.get(CONFIG_KEYS.FEE_STRATEGY) ||
          'eco') as FeeStrategy;
        const fromStrategy = pickRate(
          rates,
          strategy === 'min' ? 'eco' : strategy,
        );
        const clamped = clampFeeRateSatVb(fromStrategy);
        setFeeRateSatVb(clamped);
        lastFeeInputsRef.current = '';
      })
      .catch(err => {
        dbg('SendBitcoinModal: fetchFeeRates failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, address, activeApiProvider, activeNetwork]);
  useEffect(() => {
    if (!visible) {
      setAddress('');
      setClipboardAddress(null);
      lastFeeInputsRef.current = '';
      setIsCalculatingFee(false);
      setIsScannerVisible(false);
      debouncedGetFee.cancel();
      setCoinControlOpen(false);
      setSelectedOutpoints(null);
      setPickerUtxos([]);
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
          rememberSendAmount(amountBTC);
          setInBtcAmount(amountBTC.toFixed(8));
          setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
        }
      } catch {
        // Ignore invalid pre-filled amounts
      }
    }
  }, [visible, initialAddress, initialAmountBtc, btcToFiatRate, debouncedGetFee]);
  useEffect(() => {
    if (!visible || !showUtxosTab) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ws = WalletService.getInstance();
        const effectiveType = activeAddressType || 'segwit-native';
        let hdAddrs: Array<{
          address: string;
          derivationPath: string;
        }> = [];
        try {
          hdAddrs = await ws.getHdAddressesWithPaths(
            activeNetwork,
            effectiveType,
          );
        } catch {
          dbg('SendBitcoinModal: coin-control HD derivation failed');
        }
        const dbUtxos =
          hdAddrs.length > 0
            ? utxoRepository.getUtxosForAddresses(
                hdAddrs.map(a => a.address),
                activeNetwork,
              )
            : utxoRepository.getUtxosForNetwork(activeNetwork, effectiveType);
        if (cancelled) {
          return;
        }
        const tags = utxoTagRepository.getByOutpoints(
          dbUtxos.map(u => outpointKey(u.txid, u.vout)),
        );
        const items: CoinControlUtxo[] = dbUtxos.map(u => ({
          txid: u.txid,
          vout: u.vout,
          valueSats: u.valueSats,
          address: u.address,
          derivationPath: u.derivationPath || '',
          tag: tags.get(outpointKey(u.txid, u.vout)) ?? null,
          isConfirmed: u.isConfirmed,
        }));
        setPickerUtxos(sortCoinControlUtxos(items));
      } catch (e) {
        dbg('SendBitcoinModal: coin-control UTXO load failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, showUtxosTab, activeNetwork, activeAddressType]);
  useEffect(() => {
    if (!selectedOutpoints || pickerUtxos.length === 0) {
      return;
    }
    const valid = new Set(
      pickerUtxos.map(u => outpointKey(u.txid, u.vout)),
    );
    let dropped = false;
    const next = new Set<string>();
    for (const key of selectedOutpoints) {
      if (valid.has(key)) {
        next.add(key);
      } else {
        dropped = true;
      }
    }
    if (dropped) {
      lastFeeInputsRef.current = '';
      setSelectedOutpoints(next.size === 0 ? null : next);
    }
  }, [pickerUtxos, selectedOutpoints]);
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
      setUsingStaleFees(false);
      setIsCalculatingFee(false);
    }
    return () => {
      feeReqRef.current += 1;
      debouncedGetFee.cancel();
    };
    // debouncedGetFee is memoized once; do not list it or getFee — would cancel/reset the debouncer on unrelated identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address,
    btcAmount,
    feeRateSatVb,
    selectionKey,
    validateAddressForCurrentNetwork,
  ]);
  const btcToFiatRateRef = useRef(btcToFiatRate);
  btcToFiatRateRef.current = btcToFiatRate;
  const validateAddressRef = useRef(validateAddressForCurrentNetwork);
  validateAddressRef.current = validateAddressForCurrentNetwork;
  // Initialize Branta service and pre-load QR data if provided
  useEffect(() => {
    try {
      if (!isBrantaEnabled()) {
        setBrantaRawQrProp('');
        return;
      }
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
                  const rate = btcToFiatRateRef.current;
                  rememberSendAmount(amountBTC);
                  setInBtcAmount(amountBTC.toFixed(8));
                  setInUsdAmount(amountBTC.times(rate).toFixed(2));
                }
              } catch {
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
  }, [activeNetwork, initialBrantaRawQr]);
  // Resolve Branta QR when raw QR data is set (strict mode: only ZK-encoded QRs)
  useEffect(() => {
    const rawQr = brantaRawQr || brantaRawQrProp;
    
    if (!rawQr || !isBrantaEnabled()) {
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
        
        if (cancelled) {
          dbg('resolveBrantaQr: result ignored (effect cancelled)');
          return;
        }

        if (!result) {
          // Silent fallback: no Branta data found, continue with manual entry
          dbg('SendBitcoinModal: no Branta merchant result');
          setBrantaPayment(null);
          setBrantaVerifyUrl(undefined);
          setBrantaLoading(false);
          setBrantaError(null);
          return;
        }

        try {
          // Validate address
          const persistAddresses = new Set<string>();
          if (validateAddressRef.current(result.address)) {
            setAddress(result.address);
            persistAddresses.add(result.address);
          }
          const formAddress = addressRef.current;
          if (
            formAddress &&
            validateAddressRef.current(formAddress)
          ) {
            persistAddresses.add(formAddress);
          }

          // Persist to merchant_labels for every on-chain dest we might send to
          // (Branta destination can differ from the BIP-21 URI address).
          try {
            for (const persistAddress of persistAddresses) {
              merchantLabelRepository.upsert({
                address: persistAddress,
                platform: result.platform,
                description: result.description,
                logoUrl: result.logoUrl,
                logoLightUrl: result.logoLightUrl,
                verifyUrl: result.verifyUrl,
                fetchedAt: Date.now(),
              });
            }
          } catch (dbErr) {
            // Silent DB error - doesn't block UI
            dbg('Warning: Failed to persist merchant label', dbErr);
          }

          // Update UI state
          dbg('SendBitcoinModal: showing Branta merchant', result.platform);
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
  }, [brantaRawQr, brantaRawQrProp, activeNetwork]);
  const pasteAddress = useCallback(async () => {
    let text = '';
    try {
      text = String((await Clipboard.getString()) || '').trim();
    } catch (error) {
      dbg('SendBitcoinModal: clipboard read failed', error);
      showAppNotice('Error', 'Could not read the clipboard');
      return;
    }
    if (!text) {
      showAppNotice('Error', 'No content found in clipboard');
      return;
    }
    // Confirm inside this sheet. A second native modal cannot present
    // over the one already on screen, so the tap used to look dead.
    setClipboardAddress(text);
  }, []);
  const handleBtcChange = (text: string) => {
    setActiveInput('btc');
    setInBtcAmount(text);
    try {
      const value = Big(text || 0);
      const btc = isSatsMode ? value.div(E8) : value;
      rememberSendAmount(btc);
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
      rememberSendAmount(calculatedBtc);
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
      showAppNotice('Error', 'Please enter a valid Bitcoin address.');
      return;
    }
    // clear up
    rememberSendAmount(Big(0));
    setInBtcAmount('');
    setInUsdAmount('');
    waitMS(100).then(() => {
      // set the amount to the wallet balance
      rememberSendAmount(spendableBalance);
      setInBtcAmount(
        isSatsMode
          ? spendableBalance.times(E8).toFixed(0)
          : spendableBalance.toFixed(8),
      );
      setInUsdAmount(spendableBalance.times(btcToFiatRate).toFixed(2));
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

      // Store raw QR for Branta resolution only when merchant verify is on
      if (isBrantaEnabled()) {
        setBrantaRawQr(qrData.trim());
      }

      // Detect if this is a Branta ZK QR by checking for ZK parameters
      const hasBrantaParams =
        isBrantaEnabled() &&
        qrData.includes('branta_id') &&
        qrData.includes('branta_secret');

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
          showAppNotice(
            'Error',
            'The scanned QR code contains an invalid Bitcoin address.',
          );
          return;
        }
        const amountSats = Big(decoded.amountSats);
        const feeSats = Big(decoded.feeSats);
        const amountBTC = amountSats.div(1e8);
        if (amountSats.lte(0) || feeSats.lte(0)) {
          showAppNotice(
            'Error',
            'The scanned QR code contains invalid amount or fee values.',
          );
          return;
        }
        // Populate form fields
        setAddress(decoded.toAddress);
        rememberSendAmount(amountBTC);
        setInBtcAmount(amountBTC.toFixed(8));
        setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
        setSpendingHash(decoded.spendingHash || '');
        showAppNotice(
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
                  rememberSendAmount(amountBTC);
                  setInBtcAmount(amountBTC.toFixed(8));
                  setInUsdAmount(amountBTC.times(btcToFiatRate).toFixed(2));
                }
              }
            } catch {
              // Ignore errors in URI parsing; address was already extracted
            }
          }
        } else {
          showAppNotice(
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
  const applyFeeRate = useCallback(
    (rate: number, strategy?: FeeStrategy) => {
      const next = clampFeeRateSatVb(rate);
      setFeeRateSatVb(next);
      setFeeRateDragging(null);
      lastFeeInputsRef.current = '';
      if (strategy) {
        setFeeStrategy(strategy);
        appConfigRepository.set(CONFIG_KEYS.FEE_STRATEGY, strategy);
        dbg('setting fee strategy to', strategy, next, 'sat/vB');
      } else {
        dbg('setting custom fee rate', next, 'sat/vB');
      }
      Keyboard.dismiss();
    },
    [],
  );
  const handleFeeStrategyChange = (value: FeeStrategy) => {
    const rate = feeRates ? pickRate(feeRates, value) : feeRateSatVb;
    applyFeeRate(rate, value);
  };
  const handleSendClick = () => {
    try {
      // Client-side Bitcoin address validation
      if (!address || !validateAddressForCurrentNetwork(address)) {
        setAddressError('Please enter a valid Bitcoin addres');
        showAppNotice('Error', 'Please enter a valid Bitcoin addres');
        return;
      }
      if (!estimatedFee) {
        confirmAppPrompt({
          icon: 'fee',
          title: 'Fee unavailable',
          hint: 'Try again in a moment.',
          cancelLabel: 'Cancel',
          confirmLabel: 'Retry',
        }).then(ok => {
          if (ok) {
            getFee(address, btcAmount.toString());
          }
        });
        return;
      }
      // Work internally in BTC regardless of display mode
      const feeBTC = estimatedFee.div(E8);
      const totalAmountBTC = btcAmount.add(feeBTC);
      if (totalAmountBTC.gt(spendableBalance)) {
        showAppNotice(
          'Error',
          selectedOutpoints
            ? 'Total amount including fee exceeds selected coins'
            : 'Total amount including fee exceeds wallet balance',
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
      showAppNotice(
        'Send failed',
        'Could not start this transaction. Please try again.',
      );
    }
  };
  // Check if amount exceeds balance
  const amountExceedsBalance =
    btcAmount.gt(0) && btcAmount.gt(spendableBalance);
  const toggleOutpoint = (key: string) => {
    lastFeeInputsRef.current = '';
    setSelectedOutpoints(prev => {
      if (prev == null) {
        return new Set([key]);
      }
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next.size === 0 ? null : next;
      }
      next.add(key);
      return next;
    });
  };
  const selectAllCoins = () => {
    lastFeeInputsRef.current = '';
    setSelectedOutpoints(null);
  };
  const renderFeeSection = () => {
    if (!address || !btcAmount || btcAmount.lte(0)) {
      return null;
    }
    const displayRate = feeRateDragging ?? feeRateSatVb;
    return (
      <View style={styles.feeContainer}>
        <View style={styles.feeInfoContainer}>
          <View style={styles.feeStrategyContainer}>
            <Text style={styles.feeLabel}>Network Fee:</Text>
            <ScrollView
              horizontal
              removeClippedSubviews
              keyboardShouldPersistTaps="handled"
              overScrollMode="never"
              showsHorizontalScrollIndicator={false}>
              {feeStrategies.map(strategy => {
                const rate = feeRates
                  ? pickRate(feeRates, strategy.value)
                  : null;
                const selected = matchedStrategy === strategy.value;
                return (
                  <AppPressable
                    key={strategy.value}
                    style={[
                      styles.feeStrategyButton,
                      selected && styles.feeStrategyButtonSelected,
                    ]}
                    onPress={() => handleFeeStrategyChange(strategy.value)}>
                    <Text
                      style={[
                        styles.feeStrategyText,
                        selected && styles.feeStrategyTextSelected,
                      ]}>
                      {strategy.label}
                      {rate != null ? ` · ${rate}` : ''}
                    </Text>
                  </AppPressable>
                );
              })}
            </ScrollView>
          </View>
          <View style={styles.feeRateRow} pointerEvents="none">
            <Text style={styles.feeRateLabel}>{displayRate} sat/vB</Text>
          </View>
          <FeeRateSlider
            value={feeRateSatVb}
            min={sliderMin}
            max={sliderMax}
            accent={feeAccent}
            trackColor={theme.colors.border}
            thumbBorder={theme.colors.cardBackground}
            onDrag={next => {
              setFeeRateDragging(next);
            }}
            onCommit={next => applyFeeRate(next)}
          />
          {isCalculatingFee ? (
            <View style={styles.feeLoadingContainer}>
              <ActivityIndicator size="small" color={feeAccent} />
              <Text style={styles.feeCalculating}>Calculating...</Text>
            </View>
          ) : estimatedFee ? (
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
          ) : null}
          {usingStaleFees ? (
            <Text style={styles.staleFeeHint}>
              Using last known fees — network issue
            </Text>
          ) : null}
        </View>
      </View>
    );
  };
  return (
    <AppModal
      animationType="fade"
      transparent
      visible={visible}
      onDismiss={onDismiss}
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <GlassModalOverlay style={styles.modalBackdrop}>
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
                  nestedScrollEnabled
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
                      style={styles.pasteIconContainer}
                      accessibilityRole="button"
                      accessibilityLabel="Paste address"
                      hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
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
                      style={styles.qrIconContainer}
                      accessibilityRole="button"
                      accessibilityLabel="Scan QR code">
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
                  <View
                    style={[
                      styles.balanceCard,
                      showUtxosTab && coinControlOpen && styles.balanceCardOpen,
                    ]}>
                    <AppPressable
                      style={styles.balanceCardLeft}
                      onPress={() => {
                        if (showUtxosTab) {
                          setCoinControlOpen(open => !open);
                        }
                      }}
                      disabled={!showUtxosTab}
                      accessibilityRole={showUtxosTab ? 'button' : undefined}
                      accessibilityLabel={
                        showUtxosTab
                          ? 'Choose coins to spend'
                          : 'Available balance'
                      }>
                      <View style={styles.balanceCardLabelRow}>
                        <AppText style={styles.balanceCardLabel}>
                          {selectedOutpoints
                            ? `Selected · ${selectedOutpoints.size}`
                            : 'Available Balance'}
                        </AppText>
                        {showUtxosTab ? (
                          <Text style={styles.balanceCardChevron}>
                            {coinControlOpen ? '▴' : '▾'}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.balanceCardBtc}>
                        {formatBitcoinDisplay(spendableBalance.toNumber(), {
                          inSats: showSats,
                          formatted: balanceFormattingEnabled,
                        })}
                      </Text>
                      <AppText style={styles.balanceCardFiat}>
                        ~{selectedCurrency}{' '}
                        {formatUSD(
                          spendableBalance.times(btcToFiatRate).toNumber(),
                        )}
                      </AppText>
                    </AppPressable>
                    <AppPressable
                      onPress={handleMaxClick}
                      disabled={isCalculatingFee}
                      style={styles.balanceCardMaxButton}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <Text style={styles.balanceCardMaxButtonText}>Max</Text>
                    </AppPressable>
                  </View>
                  {showUtxosTab && coinControlOpen ? (
                    <UtxoCoinControlList
                      utxos={pickerUtxos}
                      selectedKeys={selectedOutpoints}
                      onToggle={toggleOutpoint}
                      onSelectAll={selectAllCoins}
                      formatAmount={sats =>
                        formatBitcoinDisplay(sats / 1e8, {
                          inSats: showSats,
                          formatted: balanceFormattingEnabled,
                        })
                      }
                      formatFiat={sats =>
                        `~${selectedCurrency} ${formatUSD(
                          (sats / 1e8) * btcToFiatRate.toNumber(),
                        )}`
                      }
                    />
                  ) : null}
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
                        Amount exceeds{' '}
                        {selectedOutpoints
                          ? 'selected coins'
                          : 'wallet balance'}{' '}
                        (
                        {formatBitcoinDisplay(spendableBalance.toNumber(), {
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
            {clipboardAddress ? (
              <View style={styles.pasteConfirm}>
                <View style={styles.pasteConfirmCard}>
                  <AppText style={styles.pasteConfirmTitle}>
                    Use this address?
                  </AppText>
                  <AppText style={styles.pasteConfirmDetail} numberOfLines={4}>
                    {clipboardAddress}
                  </AppText>
                  <View style={styles.sendCancelButtons}>
                    <AppPressable
                      style={styles.cancelButton}
                      onPress={() => setClipboardAddress(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel paste">
                      <AppText style={styles.buttonText}>Cancel</AppText>
                    </AppPressable>
                    <AppPressable
                      style={styles.sendButton}
                      onPress={() => {
                        setAddress(clipboardAddress);
                        setClipboardAddress(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Use pasted address">
                      <AppText style={styles.buttonText} tone="onPrimary">
                        Use it
                      </AppText>
                    </AppPressable>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </GlassModalOverlay>
      </TouchableWithoutFeedback>
    </AppModal>
  );
};
export default SendBitcoinModal;
