import React from 'react';
import {
  Modal,
  View,
  Image,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AppPressable from './AppPressable';
import AppText from './AppText';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {dbg, explorerWebBaseFromApiUrl, formatBitcoinDisplay} from '../utils';
import merchantLabelRepository from '../services/repositories/MerchantLabelRepository';
import {ActiveTxVisualizer} from './TransactionVisualizer';
import ErrorBoundary from './ErrorBoundary';

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
}) => {
  const {theme} = useTheme();
  const {showSats, balanceFormattingEnabled} = useUser();
  const [currentBlockHeight, setCurrentBlockHeight] = React.useState<
    number | null
  >(null);
  const [txidCopied, setTxidCopied] = React.useState(false);

  const baseUrl =
    explorerWebBaseFromApiUrl(baseApi) ||
    baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  const explorerLink = transaction ? `${baseUrl}/tx/${transaction.txid}` : '';

  React.useEffect(() => {
    if (visible && transaction?.status?.block_height) {
      const fetchCurrentBlockHeight = async () => {
        try {
          const apiUrl = baseApi.replace(/\/+$/, '');
          const response = await fetch(`${apiUrl}/blocks/tip/height`);
          if (response.ok) {
            const height = await response.text();
            const blockHeight = parseInt(height.trim(), 10);
            if (!isNaN(blockHeight) && blockHeight > 0) {
              setCurrentBlockHeight(blockHeight);
            }
          }
        } catch (error) {
          dbg('Failed to fetch current block height:', error);
        }
      };
      fetchCurrentBlockHeight();
    }
  }, [visible, transaction?.status?.block_height, baseApi]);

  React.useEffect(() => {
    if (!visible) {
      setTxidCopied(false);
    }
  }, [visible]);

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
    return null;
  }

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
  const amount = isSent ? amounts.sent : amounts.received;
  const hasValidAmount = typeof amount === 'number' && Number.isFinite(amount);
  const hasValidSent =
    typeof amounts.sent === 'number' && Number.isFinite(amounts.sent);
  const hasValidReceived =
    typeof amounts.received === 'number' && Number.isFinite(amounts.received);

  const confirmedAtMs = transaction.sentAt
    ? transaction.sentAt
    : transaction.status?.block_time
    ? transaction.status.block_time * 1000
    : null;

  const blockHeight = transaction.status?.block_height ?? null;
  const blockExplorerLink =
    blockHeight != null ? `${baseUrl}/block/${blockHeight}` : null;

  const copyTxid = () => {
    if (!transaction.txid) {
      return;
    }
    Clipboard.setString(transaction.txid);
    setTxidCopied(true);
    setTimeout(() => setTxidCopied(false), 2000);
  };

  const renderDetailRow = (label: string, value: string | React.ReactNode) => (
    <View style={styles.detailRow}>
      <AppText variant="caption" tone="muted" style={styles.detailLabel}>
        {label}
      </AppText>
      <View style={styles.detailValueWrap}>{value}</View>
    </View>
  );

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      width: '92%',
      maxHeight: '85%',
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
    modalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
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
    scrollContent: {
      padding: 16,
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
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 2,
    },
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
      fontFamily: theme.fontFamilies?.bold,
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
      fontFamily: theme.fontFamilies?.regular,
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
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      textAlign: 'right',
    },
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
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
    },
    clickableText: {
      color: theme.colors.text,
      textDecorationLine: 'underline',
      textDecorationColor: theme.colors.text,
    },
    visualizerSection: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <AppText variant="h2" style={styles.modalTitle}>
              {status.text}
            </AppText>
            <AppPressable
              onPress={onClose}
              style={styles.closeButton}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <AppText style={styles.closeButtonText}>✕</AppText>
            </AppPressable>
          </View>

          {transaction.txid && (
            <View style={styles.visualizerSection}>
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
                  blockHeight={blockHeight}
                  confirmedAtMs={confirmedAtMs}
                />
              </ErrorBoundary>
            </View>
          )}

          <ScrollView
            style={styles.scrollContent}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            overScrollMode="never"
            showsVerticalScrollIndicator={false}>
            {/* Hero amount */}
            <View style={styles.heroSection}>
              {isSent && hasValidSent && (
                <AppText style={styles.heroAmount}>
                  {isBlurred
                    ? '***'
                    : formatBitcoinDisplay(amounts.sent, {
                        inSats: showSats,
                        formatted: balanceFormattingEnabled,
                      })}
                </AppText>
              )}
              {!isSent && hasValidReceived && (
                <AppText style={styles.heroAmount}>
                  {isBlurred
                    ? '***'
                    : formatBitcoinDisplay(amounts.received, {
                        inSats: showSats,
                        formatted: balanceFormattingEnabled,
                      })}
                </AppText>
              )}
              {hasValidAmount && (
                <AppText style={styles.heroFiat}>
                  {isBlurred
                    ? '***'
                    : hasFiat && getFiatAmount(amount) != null
                    ? `${getCurrencySymbol(selectedCurrency)}${getFiatAmount(amount)}`
                    : '—'}
                </AppText>
              )}
              <View style={styles.heroChips}>
                {status.confirmed && confirmations != null && (
                  <View style={[styles.chip, styles.chipConfirmed]}>
                    <AppText
                      style={[
                        styles.chipText,
                        {color: theme.colors.received},
                      ]}>
                      {confirmations} confirmation
                      {confirmations !== 1 ? 's' : ''}
                    </AppText>
                  </View>
                )}
                {!status.confirmed && (
                  <View style={[styles.chip, styles.chipPending]}>
                    <AppText
                      style={[
                        styles.chipText,
                        {
                          color:
                            theme.colors.background === '#ffffff'
                              ? theme.colors.accent
                              : theme.colors.bitcoinOrange,
                        },
                      ]}>
                      Pending
                    </AppText>
                  </View>
                )}
              </View>
            </View>

            {/* Inputs / Outputs flow */}
            {(transaction.vin?.length > 0 || transaction.vout?.length > 0) && (
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
                        const merchantLabel = addr
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
                                      {pathInfo.derivationPath} ·{' '}
                                      {pathInfo.chain} #{pathInfo.index}
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
                        const merchantLabel = addr
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
                                      {pathInfo.derivationPath} ·{' '}
                                      {pathInfo.chain} #{pathInfo.index}
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

                <View style={styles.summaryBar}>
                  <AppText style={styles.summaryBarText}>
                    {`${transaction.vin?.length || 0} input${transaction.vin?.length !== 1 ? 's' : ''} → ${transaction.vout?.length || 0} output${transaction.vout?.length !== 1 ? 's' : ''}`}
                  </AppText>
                </View>
              </View>
            )}

            {/* On-chain metadata */}
            <View style={styles.section}>
              <AppText variant="h2" style={styles.sectionTitle}>
                On-chain
              </AppText>

              {renderDetailRow(
                'Transaction ID',
                <View style={styles.txIdBlock}>
                  <AppPressable
                    onPress={() => Linking.openURL(explorerLink)}
                    android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                    <AppText
                      style={[styles.txIdText, styles.clickableText]}
                      selectable>
                      {transaction.txid}
                    </AppText>
                  </AppPressable>
                  <View style={styles.txIdActions}>
                    <AppPressable
                      onPress={copyTxid}
                      style={styles.actionBtn}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <AppText style={styles.actionBtnText}>
                        {txidCopied ? 'Copied' : 'Copy'}
                      </AppText>
                    </AppPressable>
                    <AppPressable
                      onPress={() => Linking.openURL(explorerLink)}
                      style={styles.actionBtn}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <AppText style={styles.actionBtnText}>Explorer</AppText>
                    </AppPressable>
                  </View>
                </View>,
              )}

              {renderDetailRow(
                'Block height',
                blockHeight != null && blockExplorerLink ? (
                  <AppPressable
                    onPress={() => Linking.openURL(blockExplorerLink)}
                    android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                    <AppText style={[styles.detailValue, styles.clickableText]}>
                      #{blockHeight}
                    </AppText>
                  </AppPressable>
                ) : (
                  <AppText style={styles.detailValue}>Pending</AppText>
                ),
              )}

              {confirmations !== null &&
                renderDetailRow(
                  'Confirmations',
                  <AppText style={styles.detailValue}>
                    {confirmations.toString()}
                  </AppText>,
                )}

              {typeof transaction.fee === 'number' &&
                Number.isFinite(transaction.fee) &&
                renderDetailRow(
                  'Fee',
                  <AppText style={styles.detailValue}>
                    {`${formatBitcoinDisplay(transaction.fee / 1e8, {
                      inSats: showSats,
                      formatted: balanceFormattingEnabled,
                    })} (${
                      hasFiat && getFiatAmount(transaction.fee / 1e8) != null
                        ? getCurrencySymbol(selectedCurrency) +
                          getFiatAmount(transaction.fee / 1e8)
                        : '—'
                    })`}
                  </AppText>,
                )}

              {typeof transaction.size === 'number' &&
                Number.isFinite(transaction.size) &&
                renderDetailRow(
                  'Size',
                  <AppText style={styles.detailValue}>
                    {`${transaction.size} bytes`}
                  </AppText>,
                )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default TransactionDetailsModal;
