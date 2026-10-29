import React from 'react';
import {
  View,
  Image,
  StyleSheet,
  Linking,
  ScrollView,
  type LayoutChangeEvent,
  type TextStyle,
} from 'react-native';
import AppModal from './AppModal';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import Clipboard from '@react-native-clipboard/clipboard';
import AppPressable from './AppPressable';
import AppText from './AppText';
import GlassModalOverlay from './GlassModalOverlay';
import {COMMON_FONT_CONFIGS, useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {dbg, explorerWebBaseFromApiUrl, formatBitcoinDisplay} from '../utils';
import mempoolClient from '../services/MempoolClient';
import merchantLabelRepository from '../services/repositories/MerchantLabelRepository';
import {isBrantaEnabled} from '../services/BrantaService';
import {ActiveTxVisualizer} from './TransactionVisualizer';
import {isApiTxConfirmed} from '../services/txVisualizerPhase';
import ErrorBoundary from './ErrorBoundary';

/** Open-state stand-in until the diagram reports its real height. */
const VISUALIZER_FALLBACK_H = 260;

interface TransactionDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  transaction: any;
  baseApi: string;
  network?: string;
  selectedCurrency: string;
  /** Historical BTC rate at tx time; fiat shown only when set. */
  historicalRate: number | null;
  getCurrencySymbol: (currency: string) => string;
  /** HD address → path map, used to annotate our inputs/outputs with derivation path. */
  addressPathMap?: Record<
    string,
    {derivationPath: string; chain: 'receive' | 'change'; index: number}
  > | null;
  status: {
    confirmed: boolean;
    text: string;
  } | null;
  /** Local row said confirmed, but the chain still has the tx in the mempool. */
  onChainStatus?: (
    txid: string,
    status: {
      confirmed: boolean;
      blockHeight: number | null;
    },
  ) => void;
  amounts: {
    sent: number;
    received: number;
    changeAmount: number;
  } | null;
  isBlurred?: boolean;
}

const TransactionDetailsModal: React.FC<TransactionDetailsModalProps> = ({
  visible,
  onClose,
  transaction,
  baseApi,
  network = 'mainnet',
  selectedCurrency,
  historicalRate,
  getCurrencySymbol,
  addressPathMap,
  status,
  amounts,
  isBlurred = false,
  onChainStatus,
}) => {
  const {theme} = useTheme();
  const {showSats, balanceFormattingEnabled} = useUser();
  const [currentBlockHeight, setCurrentBlockHeight] = React.useState<
    number | null
  >(null);
  const [txidCopied, setTxidCopied] = React.useState(false);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [visualizerSlotH, setVisualizerSlotH] = React.useState(
    VISUALIZER_FALLBACK_H,
  );
  const [sheetMinH, setSheetMinH] = React.useState(0);
  const detailsScrollRef = React.useRef<ScrollView>(null);
  const scrollY = useSharedValue(0);
  const expandedH = useSharedValue(VISUALIZER_FALLBACK_H);

  const onDetailsScroll = useAnimatedScrollHandler({
    onScroll: event => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const visualizerParallaxStyle = useAnimatedStyle(() => {
    const full = expandedH.value;
    return {
      transform: [
        {
          scale: interpolate(
            scrollY.value,
            [0, full],
            [1, 0.94],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  const detailsSheetStyle = useAnimatedStyle(() => {
    const full = expandedH.value;
    const y = scrollY.value;
    const lift = interpolate(
      y,
      [0, full * 0.12, full * 0.88, full],
      [0.14, 0.24, 0.24, 0],
      Extrapolation.CLAMP,
    );
    return {
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      shadowOpacity: lift,
      elevation: interpolate(
        y,
        [0, full * 0.88, full],
        [14, 14, 0],
        Extrapolation.CLAMP,
      ),
    };
  });

  const onVisualizerLayout = React.useCallback(
    (e: LayoutChangeEvent) => {
      const h = Math.ceil(e.nativeEvent.layout.height);
      if (h < 80 || Math.abs(h - expandedH.value) <= 1) {
        return;
      }
      // Lock the slot once scrolling so a clipped layout cannot resize the list.
      if (scrollY.value > 2) {
        return;
      }
      expandedH.value = h;
      setVisualizerSlotH(h);
    },
    [expandedH, scrollY],
  );

  const onChainStatusRef = React.useRef(onChainStatus);
  onChainStatusRef.current = onChainStatus;

  const baseUrl =
    explorerWebBaseFromApiUrl(baseApi) ||
    baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  const explorerLink = transaction ? `${baseUrl}/tx/${transaction.txid}` : '';

  React.useEffect(() => {
    if (!visible || !transaction?.status?.block_height) {
      return;
    }
    let cancelled = false;
    const fetchCurrentBlockHeight = async () => {
      try {
        const apiUrl = baseApi.replace(/\/+$/, '');
        const response = await mempoolClient.get<number>(
          `${apiUrl}/blocks/tip/height`,
          {ttl: 5000, timeoutMs: 8000},
        );
        const blockHeight = Number(response.data);
        if (
          !cancelled &&
          response.ok &&
          Number.isFinite(blockHeight) &&
          blockHeight > 0
        ) {
          setCurrentBlockHeight(blockHeight);
        }
      } catch (error) {
        dbg('Failed to fetch current block height:', error);
      }
    };
    fetchCurrentBlockHeight();
    return () => {
      cancelled = true;
    };
  }, [visible, transaction?.status?.block_height, baseApi]);

  React.useEffect(() => {
    if (!visible || !status?.confirmed || !transaction?.txid) {
      return;
    }
    const txid = transaction.txid;
    let cancelled = false;
    (async () => {
      try {
        const apiUrl = baseApi.replace(/\/+$/, '');
        const response = await mempoolClient.get<{confirmed?: boolean}>(
          `${apiUrl}/tx/${encodeURIComponent(txid)}/status`,
          {fresh: true, timeoutMs: 8000},
        );
        if (cancelled || !response.ok || isApiTxConfirmed(response.data)) {
          return;
        }
        onChainStatusRef.current?.(txid, {
          confirmed: false,
          blockHeight: null,
        });
      } catch (error) {
        dbg('Transaction details: status check failed', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, status?.confirmed, transaction?.txid, baseApi]);

  React.useEffect(() => {
    scrollY.value = 0;
    expandedH.value = VISUALIZER_FALLBACK_H;
    setVisualizerSlotH(VISUALIZER_FALLBACK_H);
    if (!visible) {
      setTxidCopied(false);
      setBreakdownOpen(false);
      return;
    }
    requestAnimationFrame(() => {
      detailsScrollRef.current?.scrollTo({y: 0, animated: false});
    });
  }, [visible, transaction?.txid, scrollY, expandedH]);

  const confirmations = React.useMemo(() => {
    if (
      transaction?.status?.block_height &&
      currentBlockHeight &&
      currentBlockHeight >= transaction.status.block_height
    ) {
      return currentBlockHeight - transaction.status.block_height + 1;
    }
    return null;
  }, [transaction?.status?.block_height, currentBlockHeight]);

  if (!transaction || !status || !amounts) {
    return (
      <AppModal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      />
    );
  }

  const brantaOn = isBrantaEnabled();
  const getFiatAmount = (btcAmount: number): string | null => {
    if (historicalRate == null || historicalRate <= 0) return null;
    const amount = btcAmount * historicalRate;
    return amount.toFixed(2);
  };

  const hasFiat = historicalRate != null && historicalRate > 0;
  const isSent = status.text.includes('Sen') || transaction.sentAt;
  const isWalletOrigin =
    isSent ||
    status.text.includes('Consolidat') ||
    status.text.includes('Rebalanc');
  const confirmedAtMs = transaction.sentAt
    ? transaction.sentAt
    : transaction.status?.block_time
    ? transaction.status.block_time * 1000
    : null;

  const isSelfMove =
    status.text.includes('Consolidat') || status.text.includes('Rebalanc');
  const isOurs = (addr: string) => Boolean(addr && addressPathMap?.[addr]);
  const counterpartyAddrs = (
    isSent ? transaction.vout ?? [] : transaction.vin ?? []
  )
    .map((item: any) =>
      isSent
        ? item.scriptpubkey_address || ''
        : item.prevout?.scriptpubkey_address || '',
    )
    .filter((addr: string) => addr && !isOurs(addr));
  const firstParty = counterpartyAddrs[0] || '';
  const partyMerchant =
    firstParty && brantaOn
      ? merchantLabelRepository.getByAddress(firstParty)
      : null;
  const headline = status.text.includes('Consolidat')
    ? status.confirmed
      ? 'Consolidated'
      : 'Consolidating'
    : status.text.includes('Rebalanc')
      ? status.confirmed
        ? 'Rebalanced'
        : 'Rebalancing'
      : isSent && partyMerchant
        ? status.confirmed
          ? `Sent to ${partyMerchant.platform}`
          : `Paying ${partyMerchant.platform}`
        : status.text;
  const headerIcon = !status.confirmed
    ? require('../assets/pending-icon.png')
    : isSelfMove
      ? require('../assets/consolidate-icon.png')
      : isSent
        ? require('../assets/out-icon.png')
        : require('../assets/in-icon.png');
  const partyIcon = isSelfMove
    ? require('../assets/consolidate-icon.png')
    : isSent
      ? require('../assets/send-icon.png')
      : require('../assets/receive-icon.png');
  const partyLabel = isSelfMove ? 'Moved' : isSent ? 'To' : 'From';
  const partyIsAddress = !isSelfMove && !!firstParty && !partyMerchant;
  const partyValue = isSelfMove
    ? 'Your addresses'
    : firstParty
      ? `${
          partyMerchant?.platform ||
          `${firstParty.slice(0, 8)}…${firstParty.slice(-4)}`
        }${counterpartyAddrs.length > 1 ? ` +${counterpartyAddrs.length - 1}` : ''}`
      : isSent
        ? 'Your wallet'
        : 'The network';
  const whenLabel = confirmedAtMs
    ? new Date(confirmedAtMs).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : status.confirmed
      ? ''
      : 'Waiting for confirmation';
  const amountSign = isSent && !isSelfMove ? '-' : '+';
  const amountColor =
    isSent && !isSelfMove
      ? theme.colors.bitcoinOrange
      : theme.colors.received;
  const heroBtc = isSelfMove
    ? amounts.received
    : isSent
      ? amounts.sent
      : amounts.received;
  const hasHeroAmount =
    typeof heroBtc === 'number' && Number.isFinite(heroBtc);
  const inputCount = transaction.vin?.length || 0;
  const outputCount = transaction.vout?.length || 0;
  const hasFee =
    typeof transaction.fee === 'number' && Number.isFinite(transaction.fee);
  const feeLabel = hasFee
    ? formatBitcoinDisplay(transaction.fee / 1e8, {
        inSats: showSats,
        formatted: balanceFormattingEnabled,
      })
    : null;
  const virtualBytes = (() => {
    if (typeof transaction.vsize === 'number' && transaction.vsize > 0) {
      return transaction.vsize;
    }
    if (typeof transaction.weight === 'number' && transaction.weight > 0) {
      return Math.ceil(transaction.weight / 4);
    }
    return null;
  })();
  const byteSize =
    typeof transaction.size === 'number' && Number.isFinite(transaction.size)
      ? transaction.size
      : null;
  const feeRateLabel =
    hasFee && virtualBytes
      ? `${Math.max(1, Math.round(transaction.fee / virtualBytes))} sat/vB`
      : null;
  const blockHeight = transaction.status?.block_height ?? null;
  const blockExplorerLink =
    blockHeight != null ? `${baseUrl}/block/${blockHeight}` : null;
  const statusLine = !status.confirmed
    ? 'Waiting for a block'
    : confirmations != null
      ? `Confirmed · ${confirmations} block${confirmations === 1 ? '' : 's'}`
      : 'Confirmed';
  const chainFacts = [
    blockHeight != null ? `Block ${blockHeight}` : 'Not in a block yet',
    virtualBytes != null
      ? `${virtualBytes} vB`
      : byteSize != null
        ? `${byteSize} bytes`
        : null,
    typeof transaction.weight === 'number' && Number.isFinite(transaction.weight)
      ? `${transaction.weight} WU`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const walletRole = (pathInfo?: {
    chain: 'receive' | 'change';
    index: number;
  }) =>
    pathInfo
      ? pathInfo.chain === 'change'
        ? `Change #${pathInfo.index}`
        : `Receive #${pathInfo.index}`
      : '';

  const copyTxid = () => {
    if (!transaction.txid) {
      return;
    }
    Clipboard.setString(transaction.txid);
    setTxidCopied(true);
    setTimeout(() => setTxidCopied(false), 2000);
  };

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      width: '92%',
      height: '85%',
      maxHeight: '85%',
      overflow: 'hidden',
      elevation: 5,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.2,
      shadowRadius: 6,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalTitleRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginRight: 8,
    },
    modalTitle: {
      flex: 1,
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    headerIcon: {
      width: 22,
      height: 22,
      tintColor: theme.colors.text,
    },
    inlineIcon: {
      width: 16,
      height: 16,
      tintColor: theme.colors.textSecondary,
    },
    titledRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    closeButton: {
      padding: 8,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      opacity: 0.7,
    },
    scrollBody: {
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
    },
    scrollView: {
      flex: 1,
      minHeight: 0,
      zIndex: 2,
      backgroundColor: 'transparent',
    },
    scrollContent: {
      paddingBottom: 0,
    },
    scrollDetails: {
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 28,
      backgroundColor: theme.colors.background,
      shadowColor: theme.colors.shadowColor || '#000',
      shadowOffset: {width: 0, height: -8},
      shadowRadius: 16,
      zIndex: 2,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 12,
      letterSpacing: 0.2,
    },
    heroSection: {
      alignItems: 'center',
      paddingTop: 16,
      paddingBottom: 12,
      paddingHorizontal: 8,
      marginBottom: 16,
    },
    heroAmount: {
      fontSize: 28,
      lineHeight: 36,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      includeFontPadding: false,
      paddingTop: 4,
    },
    heroFiat: {
      fontSize: theme.fontSizes?.md || 15,
      lineHeight: 22,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      marginTop: 6,
      textAlign: 'center',
      includeFontPadding: false,
    },
    heroChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
      marginTop: 12,
    },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
    },
    chipConfirmed: {
      backgroundColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.received + '26'
          : theme.colors.receivedOverlay15,
      borderColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.received + '80'
          : theme.colors.receivedOverlay40,
    },
    chipPending: {
      backgroundColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.bitcoinOrange + '26'
          : theme.colors.dangerOverlay15,
      borderColor:
        theme.colors.background !== '#ffffff'
          ? theme.colors.bitcoinOrange + '80'
          : theme.colors.dangerOverlay40,
    },
    chipText: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.bold,
      letterSpacing: 0.4,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
      gap: 12,
    },
    detailLabel: {
      minWidth: 108,
    },
    detailValueWrap: {
      flex: 1,
      alignItems: 'flex-end',
    },
    detailValue: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      textAlign: 'right',
    },
    transactionFlow: {
      paddingVertical: 4,
    },
    flowSection: {
      width: '100%',
    },
    flowSectionTitle: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
      marginBottom: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    flowItem: {
      marginBottom: 6,
    },
    flowItemContent: {
      backgroundColor: theme.colors.cardBackground || theme.colors.background,
      borderRadius: 10,
      padding: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      overflow: 'hidden',
    },
    flowItemContentOurs: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '10'
          : theme.colors.bitcoinOrange + '1A',
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderWidth: 2,
      paddingLeft: 10,
    },
    flowItemAccentBar: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    flowItemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: 8,
    },
    flowIcon: {
      width: 18,
      height: 18,
      marginRight: 8,
      tintColor: theme.colors.textSecondary,
    },
    flowIconOurs: {
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    flowItemInfo: {
      flex: 1,
    },
    flowItemLabel: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily:
        theme.fontFamilies?.monospaceMedium || theme.fontFamilies?.monospace,
      color: theme.colors.text,
      marginBottom: 2,
      fontFeatureSettings: '"liga" 0',
    } as TextStyle,
    flowItemLabelOurs: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    flowItemPath: {
      fontSize: theme.fontSizes?.xs || 9,
      fontFamily:
        theme.fontFamilies?.monospaceMedium || theme.fontFamilies?.monospace,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    flowItemType: {
      fontSize: theme.fontSizes?.xs || 9,
      color: theme.colors.textSecondary,
      fontStyle: 'italic',
      marginTop: 1,
    },
    flowAmount: {
      alignItems: 'flex-end',
    },
    flowAmountBTC: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
      letterSpacing: COMMON_FONT_CONFIGS.bitcoinAmountMono.letterSpacing,
      color: theme.colors.text,
    },
    flowAmountBTCOurs: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    flowAmountFiat: {
      fontSize: theme.fontSizes?.xs || 9,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary,
      marginTop: 1,
    },
    flowConnectorVertical: {
      width: 1,
      height: 4,
      backgroundColor: theme.colors.border,
      marginLeft: 13,
      marginVertical: 1,
    },
    flowConnectorHub: {
      width: 1,
      height: 8,
      backgroundColor: theme.colors.border,
      alignSelf: 'center',
      marginVertical: 4,
    },
    summaryBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.cardBackground || theme.colors.background,
      borderRadius: 10,
      padding: 10,
      marginTop: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    summaryBarText: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      flex: 1,
      textAlign: 'center',
    },
    txIdBlock: {
      flex: 1,
      alignItems: 'flex-end',
    },
    txIdText: {
      fontSize: theme.fontSizes?.sm || 12,
      lineHeight: 20,
      fontFamily:
        theme.fontFamilies?.monospaceMedium || theme.fontFamilies?.monospace,
      color: theme.colors.text,
      textAlign: 'left',
      fontFeatureSettings: '"liga" 0',
    } as TextStyle,
    txIdActions: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 8,
      justifyContent: 'flex-end',
    },
    actionBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay03
          : theme.colors.whiteOverlay08,
    },
    actionBtnText: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    clickableText: {
      color: theme.colors.text,
      textDecorationLine: 'underline',
      textDecorationColor: theme.colors.text,
    },
    heroContext: {
      marginTop: 8,
      textAlign: 'center',
    },
    receiptCard: {
      backgroundColor: theme.colors.cardBackground || theme.colors.background,
      borderRadius: 12,
      paddingHorizontal: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    receiptRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    receiptLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 108,
      paddingTop: 1,
    },
    receiptValue: {
      flex: 1,
      textAlign: 'right',
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      fontSize: theme.fontSizes?.base || 14,
    },
    receiptAddress: {
      flex: 1,
      textAlign: 'right',
      fontFamily:
        theme.fontFamilies?.monospaceMedium || theme.fontFamilies?.monospace,
      color: theme.colors.text,
      fontSize: theme.fontSizes?.sm || 12,
      fontFeatureSettings: '"liga" 0',
    } as TextStyle,
    receiptAmount: {
      flex: 1,
      textAlign: 'right',
      fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
      letterSpacing: COMMON_FONT_CONFIGS.bitcoinAmountMono.letterSpacing,
      color: theme.colors.text,
      fontSize: theme.fontSizes?.base || 14,
    },
    disclosure: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardBackground || theme.colors.background,
    },
    disclosureBody: {
      flex: 1,
      gap: 2,
    },
    disclosureTitle: {
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      fontSize: theme.fontSizes?.md || 15,
    },
    disclosureChevron: {
      marginLeft: 12,
      fontSize: 22,
      lineHeight: 24,
      color: theme.colors.textSecondary,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    actionBtnGrow: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay03
          : theme.colors.whiteOverlay08,
    },
    chainFacts: {
      marginTop: 12,
      lineHeight: 18,
    },
    summaryCard: {
      backgroundColor: theme.colors.cardBackground || theme.colors.background,
      borderRadius: 12,
      padding: 14,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 6,
    },
    summaryToggle: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.primary,
      marginTop: 4,
    },
    visualizerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 0,
      elevation: 0,
      overflow: 'hidden',
      transformOrigin: 'top center',
    },
    visualizerInner: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      transformOrigin: 'top center',
    },
  });

  return (
    <AppModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <GlassModalOverlay style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <Image
                source={headerIcon}
                style={styles.headerIcon}
                resizeMode="contain"
              />
              <AppText variant="h2" style={styles.modalTitle} numberOfLines={2}>
                {headline}
              </AppText>
            </View>
            <AppPressable
              onPress={onClose}
              style={styles.closeButton}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <AppText style={styles.closeButtonText}>✕</AppText>
            </AppPressable>
          </View>

          <View
            style={styles.scrollBody}
            onLayout={e => {
              const h = Math.ceil(e.nativeEvent.layout.height);
              if (h > 0 && h !== sheetMinH) {
                setSheetMinH(h);
              }
            }}>
            {transaction.txid ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.visualizerOverlay, visualizerParallaxStyle]}>
                <View
                  style={styles.visualizerInner}
                  onLayout={onVisualizerLayout}
                  collapsable={false}>
                  <ErrorBoundary
                    key={transaction.txid}
                    fallback={
                      <AppText variant="caption" tone="muted">
                        Transaction preview unavailable
                      </AppText>
                    }>
                    <ActiveTxVisualizer
                      txid={transaction.txid}
                      network={network as 'mainnet' | 'testnet'}
                      initialPhase={status.confirmed ? 'confirmed' : 'mempool'}
                      explorerBaseUrl={baseApi}
                      compact
                      origin={isWalletOrigin ? 'wallet' : 'external'}
                      blockHeight={status.confirmed ? blockHeight : null}
                      confirmedAtMs={status.confirmed ? confirmedAtMs : null}
                    />
                  </ErrorBoundary>
                </View>
              </Animated.View>
            ) : null}
            <Animated.ScrollView
              ref={detailsScrollRef}
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              onScroll={onDetailsScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              overScrollMode="never"
              showsVerticalScrollIndicator={false}>
              {transaction.txid ? (
                <View style={{height: visualizerSlotH}} />
              ) : null}
              <Animated.View
                style={[
                  styles.scrollDetails,
                  sheetMinH > 0 ? {minHeight: sheetMinH} : null,
                  transaction.txid ? detailsSheetStyle : null,
                ]}>
            {/* Hero amount */}
            <View style={styles.heroSection}>
              {hasHeroAmount && (
                <AppText style={[styles.heroAmount, {color: amountColor}]}>
                  {isBlurred
                    ? '***'
                    : `${amountSign}${formatBitcoinDisplay(heroBtc, {
                        inSats: showSats,
                        formatted: balanceFormattingEnabled,
                      })}`}
                </AppText>
              )}
              {hasHeroAmount && (
                <AppText style={styles.heroFiat}>
                  {isBlurred
                    ? '***'
                    : hasFiat && getFiatAmount(heroBtc) != null
                    ? `${getCurrencySymbol(selectedCurrency)}${getFiatAmount(heroBtc)}`
                    : '—'}
                </AppText>
              )}
              <AppText variant="caption" tone="muted" style={styles.heroContext}>
                {statusLine}
              </AppText>
            </View>

            <View style={styles.receiptCard}>
              <View style={styles.receiptRow}>
                <View style={styles.receiptLabel}>
                  <Image source={partyIcon} style={styles.inlineIcon} resizeMode="contain" />
                  <AppText variant="caption" tone="muted">
                    {partyLabel}
                  </AppText>
                </View>
                <AppText
                  style={
                    partyIsAddress ? styles.receiptAddress : styles.receiptValue
                  }
                  numberOfLines={2}>
                  {partyValue}
                </AppText>
              </View>
              <View style={styles.receiptRow}>
                <View style={styles.receiptLabel}>
                  <Image
                    source={require('../assets/clock-icon.png')}
                    style={styles.inlineIcon}
                    resizeMode="contain"
                  />
                  <AppText variant="caption" tone="muted">
                    When
                  </AppText>
                </View>
                <AppText style={styles.receiptValue}>
                  {whenLabel || '—'}
                </AppText>
              </View>
              {feeLabel ? (
                <View style={styles.receiptRow}>
                  <View style={styles.receiptLabel}>
                    <Image
                      source={require('../assets/bitcoin-icon.png')}
                      style={styles.inlineIcon}
                      resizeMode="contain"
                    />
                    <AppText variant="caption" tone="muted">
                      Network fee
                    </AppText>
                  </View>
                  <AppText style={styles.receiptAmount}>
                    {isBlurred
                      ? '***'
                      : feeRateLabel
                        ? `${feeLabel} · ${feeRateLabel}`
                        : feeLabel}
                  </AppText>
                </View>
              ) : null}
            </View>

            {(inputCount > 0 || outputCount > 0) && (
              <AppPressable
                onPress={() => setBreakdownOpen(open => !open)}
                style={styles.disclosure}
                accessibilityRole="button"
                accessibilityState={{expanded: breakdownOpen}}
                accessibilityLabel={
                  breakdownOpen
                    ? 'Hide inputs and outputs'
                    : 'Show inputs and outputs'
                }>
                <View style={styles.disclosureBody}>
                  <View style={styles.titledRow}>
                    <Image
                      source={require('../assets/utxo-icon.png')}
                      style={styles.inlineIcon}
                      resizeMode="contain"
                    />
                    <AppText style={styles.disclosureTitle}>
                      {breakdownOpen ? 'Hide coins moved' : 'Coins moved'}
                    </AppText>
                  </View>
                  <AppText variant="caption" tone="muted">
                    {`${inputCount} input${inputCount === 1 ? '' : 's'} → ${outputCount} output${outputCount === 1 ? '' : 's'}`}
                  </AppText>
                </View>
                <AppText style={styles.disclosureChevron}>
                  {breakdownOpen ? '▾' : '›'}
                </AppText>
              </AppPressable>
            )}

            {/* Inputs / Outputs flow */}
            {breakdownOpen &&
              (transaction.vin?.length > 0 || transaction.vout?.length > 0) && (
              <View style={styles.section}>
                <View style={styles.transactionFlow}>
                  {transaction.vin?.length > 0 && (
                    <View style={styles.flowSection}>
                      <AppText style={styles.flowSectionTitle}>Inputs</AppText>
                      {transaction.vin.map((input: any, idx: number) => {
                        const addr: string =
                          input.prevout?.scriptpubkey_address || '';
                        const sats: number = input.prevout?.value || 0;
                        const pathInfo = addr
                          ? addressPathMap?.[addr]
                          : undefined;
                        const merchantLabel =
                          addr && brantaOn
                            ? merchantLabelRepository.getByAddress(addr)
                            : null;
                        const short = addr
                          ? `${addr.slice(0, 9)}…${addr.slice(-6)}`
                          : 'coinbase';
                        const addrLink = addr
                          ? `${baseUrl}/address/${addr}`
                          : null;
                        return (
                          <View key={idx} style={styles.flowItem}>
                            <View
                              style={[
                                styles.flowItemContent,
                                pathInfo && styles.flowItemContentOurs,
                              ]}>
                              {pathInfo && (
                                <View style={styles.flowItemAccentBar} />
                              )}
                              <View style={styles.flowItemHeader}>
                                <Image
                                  source={require('../assets/in-icon.png')}
                                  style={[
                                    styles.flowIcon,
                                    pathInfo && styles.flowIconOurs,
                                  ]}
                                  resizeMode="contain"
                                />
                                <View style={styles.flowItemInfo}>
                                  {addrLink ? (
                                    <AppPressable
                                      onPress={() => Linking.openURL(addrLink)}
                                      android_ripple={{
                                        color: 'rgba(0,0,0,0.1)',
                                      }}>
                                      <AppText
                                        style={[
                                          styles.flowItemLabel,
                                          pathInfo && styles.flowItemLabelOurs,
                                          styles.clickableText,
                                        ]}
                                        numberOfLines={1}
                                        ellipsizeMode="middle">
                                        {short}
                                      </AppText>
                                    </AppPressable>
                                  ) : (
                                    <AppText
                                      style={[
                                        styles.flowItemLabel,
                                        pathInfo && styles.flowItemLabelOurs,
                                      ]}
                                      numberOfLines={1}>
                                      {short}
                                    </AppText>
                                  )}
                                  {pathInfo ? (
                                    <AppText
                                      style={styles.flowItemPath}
                                      numberOfLines={1}>
                                      {walletRole(pathInfo)}
                                    </AppText>
                                  ) : merchantLabel ? (
                                    <AppText
                                      style={styles.flowItemType}
                                      numberOfLines={1}>
                                      {merchantLabel.platform}
                                    </AppText>
                                  ) : (
                                    <AppText style={styles.flowItemType}>
                                      external
                                    </AppText>
                                  )}
                                </View>
                              </View>
                              <View style={styles.flowAmount}>
                                <AppText
                                  style={[
                                    styles.flowAmountBTC,
                                    pathInfo && styles.flowAmountBTCOurs,
                                  ]}>
                                  {isBlurred
                                    ? '***'
                                    : formatBitcoinDisplay(sats / 1e8, {
                                        inSats: showSats,
                                        formatted: balanceFormattingEnabled,
                                      })}
                                </AppText>
                                {!isBlurred && hasFiat && (
                                  <AppText style={styles.flowAmountFiat}>
                                    {getCurrencySymbol(selectedCurrency)}
                                    {getFiatAmount(sats / 1e8) ?? '—'}
                                  </AppText>
                                )}
                              </View>
                            </View>
                            {idx < transaction.vin.length - 1 && (
                              <View style={styles.flowConnectorVertical} />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {transaction.vin?.length > 0 &&
                    transaction.vout?.length > 0 && (
                      <View style={styles.flowConnectorHub} />
                    )}

                  {transaction.vout?.length > 0 && (
                    <View style={styles.flowSection}>
                      <AppText style={styles.flowSectionTitle}>Outputs</AppText>
                      {transaction.vout.map((output: any, idx: number) => {
                        const addr: string = output.scriptpubkey_address || '';
                        const sats: number = output.value || 0;
                        const pathInfo = addr
                          ? addressPathMap?.[addr]
                          : undefined;
                        const merchantLabel =
                          addr && brantaOn
                            ? merchantLabelRepository.getByAddress(addr)
                            : null;
                        const isChange = pathInfo?.chain === 'change';
                        const short = addr
                          ? `${addr.slice(0, 9)}…${addr.slice(-6)}`
                          : 'OP_RETURN';
                        const addrLink = addr
                          ? `${baseUrl}/address/${addr}`
                          : null;
                        const outputIcon = pathInfo
                          ? isChange
                            ? require('../assets/consolidate-icon.png')
                            : require('../assets/in-icon.png')
                          : require('../assets/bitcoin-icon.png');
                        return (
                          <View key={idx} style={styles.flowItem}>
                            <View
                              style={[
                                styles.flowItemContent,
                                pathInfo && styles.flowItemContentOurs,
                              ]}>
                              {pathInfo && (
                                <View style={styles.flowItemAccentBar} />
                              )}
                              <View style={styles.flowItemHeader}>
                                <Image
                                  source={outputIcon}
                                  style={[
                                    styles.flowIcon,
                                    pathInfo && styles.flowIconOurs,
                                  ]}
                                  resizeMode="contain"
                                />
                                <View style={styles.flowItemInfo}>
                                  {addrLink ? (
                                    <AppPressable
                                      onPress={() => Linking.openURL(addrLink)}
                                      android_ripple={{
                                        color: 'rgba(0,0,0,0.1)',
                                      }}>
                                      <AppText
                                        style={[
                                          styles.flowItemLabel,
                                          pathInfo && styles.flowItemLabelOurs,
                                          styles.clickableText,
                                        ]}
                                        numberOfLines={1}
                                        ellipsizeMode="middle">
                                        {short}
                                      </AppText>
                                    </AppPressable>
                                  ) : (
                                    <AppText
                                      style={[
                                        styles.flowItemLabel,
                                        pathInfo && styles.flowItemLabelOurs,
                                      ]}
                                      numberOfLines={1}>
                                      {short}
                                    </AppText>
                                  )}
                                  {pathInfo ? (
                                    <AppText
                                      style={styles.flowItemPath}
                                      numberOfLines={1}>
                                      {walletRole(pathInfo)}
                                    </AppText>
                                  ) : merchantLabel ? (
                                    <AppText
                                      style={styles.flowItemType}
                                      numberOfLines={1}>
                                      {merchantLabel.platform}
                                    </AppText>
                                  ) : (
                                    <AppText style={styles.flowItemType}>
                                      external
                                    </AppText>
                                  )}
                                </View>
                              </View>
                              <View style={styles.flowAmount}>
                                <AppText
                                  style={[
                                    styles.flowAmountBTC,
                                    pathInfo && styles.flowAmountBTCOurs,
                                  ]}>
                                  {isBlurred
                                    ? '***'
                                    : formatBitcoinDisplay(sats / 1e8, {
                                        inSats: showSats,
                                        formatted: balanceFormattingEnabled,
                                      })}
                                </AppText>
                                {!isBlurred && hasFiat && (
                                  <AppText style={styles.flowAmountFiat}>
                                    {getCurrencySymbol(selectedCurrency)}
                                    {getFiatAmount(sats / 1e8) ?? '—'}
                                  </AppText>
                                )}
                              </View>
                            </View>
                            {idx < transaction.vout.length - 1 && (
                              <View style={styles.flowConnectorVertical} />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

              </View>
            )}

            <View style={styles.section}>
              <View style={[styles.titledRow, styles.sectionTitle]}>
                <Image
                  source={require('../assets/link-icon.png')}
                  style={styles.headerIcon}
                  resizeMode="contain"
                />
                <AppText variant="h2" style={styles.modalTitle}>
                  On the chain
                </AppText>
              </View>
              <AppText style={styles.txIdText} selectable>
                {transaction.txid}
              </AppText>
              <View style={styles.actionRow}>
                <AppPressable
                  onPress={copyTxid}
                  style={styles.actionBtnGrow}
                  accessibilityRole="button"
                  accessibilityLabel="Copy transaction id"
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <AppText style={styles.actionBtnText}>
                    {txidCopied ? 'Copied' : 'Copy id'}
                  </AppText>
                </AppPressable>
                <AppPressable
                  onPress={() => Linking.openURL(explorerLink)}
                  style={styles.actionBtnGrow}
                  accessibilityRole="button"
                  accessibilityLabel="View transaction in explorer"
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <AppText style={styles.actionBtnText}>Explorer</AppText>
                </AppPressable>
              </View>
              {blockHeight != null && blockExplorerLink ? (
                <AppPressable
                  onPress={() => Linking.openURL(blockExplorerLink)}
                  accessibilityRole="link"
                  accessibilityLabel={`Open block ${blockHeight}`}>
                  <AppText variant="caption" tone="muted" style={styles.chainFacts}>
                    {chainFacts}
                  </AppText>
                </AppPressable>
              ) : (
                <AppText variant="caption" tone="muted" style={styles.chainFacts}>
                  {chainFacts}
                </AppText>
              )}
            </View>
              </Animated.View>
            </Animated.ScrollView>
          </View>
        </View>
      </GlassModalOverlay>
    </AppModal>
  );
};

export default TransactionDetailsModal;
