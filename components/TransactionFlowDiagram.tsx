/* eslint-disable react-native/no-inline-styles */
import React, {useMemo} from 'react';
import {View, Text, Image, Linking, StyleSheet} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {explorerWebBaseFromApiUrl, shortenAddress} from '../utils';
import {resolveStoredMempoolApiBase} from '../services/mempoolApiBase';
import type {
  CollapsedSummaryMode,
  PsbtFlowDetails,
  SendFlowParams,
  TxPreview,
} from '../types/transactionFlow';
import {
  computeChangeSats,
  isLikelyPsbtChangeOutput,
  isTestnetNetwork,
  networkForApi,
  networkLabel,
  psbtCollapsedSummaryLine,
  sat2btcStr,
} from './transactionFlowUtils';

type BaseProps = {
  expanded: boolean;
  onToggleExpand: () => void;
  collapsedSummary?: CollapsedSummaryMode;
  defaultExpanded?: boolean;
  /** When false, always show full flow (e.g. PSBTModal). */
  expandable?: boolean;
  cardStyle?: object;
};

export type SendTransactionFlowProps = BaseProps & {
  variant: 'send';
  sendParams: SendFlowParams;
  txPreview: TxPreview | null;
  loading?: boolean;
  error?: string | null;
  formatFiat?: (price?: string) => string;
};

export type PsbtTransactionFlowProps = BaseProps & {
  variant: 'psbt';
  psbtDetails: PsbtFlowDetails | null;
  psbtBase64?: string | null;
  parseError?: string | null;
  onRetryParse?: () => void;
  showPsbtTitle?: boolean;
};

export type TransactionFlowDiagramProps =
  | SendTransactionFlowProps
  | PsbtTransactionFlowProps;

function NetworkBadge({network}: {network?: string}) {
  const {theme} = useTheme();
  const isTestnet = isTestnetNetwork(network);
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: isTestnet
          ? theme.colors.bitcoinOrange + '22'
          : theme.colors.primary + '18',
      }}>
      <Text
        style={{
          fontSize: theme.fontSizes?.xs || 10,
          fontFamily: theme.fontFamilies?.bold,
          color: isTestnet ? theme.colors.bitcoinOrange : theme.colors.primary,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
        {networkLabel(network)}
      </Text>
    </View>
  );
}

const TransactionFlowDiagram: React.FC<TransactionFlowDiagramProps> = props => {
  const {theme} = useTheme();
  const accentColor =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;

  const expandable = props.expandable !== false;
  const showCollapsedStrip =
    expandable && props.collapsedSummary === 'full' && !props.expanded;
  const showExpandedBody = !expandable || props.expanded;

  const sendNet =
    props.variant === 'send' ? props.sendParams.network || '' : '';
  const sendNetForApi = networkForApi(sendNet);
  const sendExplorerBase = useMemo(() => {
    if (props.variant !== 'send') {
      return 'https://mempool.space';
    }
    const isTestnet = isTestnetNetwork(sendNet);
    return (
      explorerWebBaseFromApiUrl(resolveStoredMempoolApiBase(sendNetForApi)) ||
      (isTestnet
        ? 'https://mempool.space/testnet'
        : 'https://mempool.space')
    );
  }, [props.variant, sendNet, sendNetForApi]);

  const accentBar = (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        backgroundColor: accentColor,
        borderTopLeftRadius: 8,
        borderBottomLeftRadius: 8,
      }}
    />
  );

  const sectionTitle = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  };
  const rowBase = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.primary + '06'
        : '#ffffff08',
    borderRadius: 8,
    padding: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  };
  const rowOurs = {
    ...rowBase,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? accentColor + '12'
        : accentColor + '1A',
    borderColor: accentColor + '60',
    paddingLeft: 11,
    overflow: 'hidden' as const,
  };
  const iconBase = {width: 18, height: 18, marginRight: 8};
  const labelStyle = {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.monospaceBold,
    color: theme.colors.text,
  };
  const labelOurs = {...labelStyle, color: accentColor};
  const pathText = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.monospace,
    color: theme.colors.textSecondary,
    marginTop: 1,
  };
  const subLabel = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.monospace,
    color: theme.colors.textSecondary,
    fontStyle: 'italic' as const,
    marginTop: 1,
  };
  const amtBTC = {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.monospaceBold,
    color: theme.colors.text,
    textAlign: 'right' as const,
  };
  const amtBTCOurs = {...amtBTC, color: accentColor};
  const amtFiat = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.monospace,
    color: theme.colors.textSecondary,
    textAlign: 'right' as const,
  };

  const renderExpandHeader = (title: string) => (
    <AppPressable
      onPress={props.onToggleExpand}
      accessibilityRole="button"
      accessibilityState={{expanded: props.expanded}}
      accessibilityLabel={
        props.expanded
          ? 'Collapse transaction details'
          : 'Review inputs and outputs'
      }
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 6,
        marginBottom: showCollapsedStrip ? 8 : 4,
      }}>
      <Text
        style={{
          flex: 1,
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginRight: 8,
        }}>
        {title}
      </Text>
      <Text
        style={{
          fontSize: theme.fontSizes?.xs || 10,
          color: theme.colors.textSecondary,
        }}>
        {props.expanded ? '▼' : '▶ Review inputs & outputs'}
      </Text>
    </AppPressable>
  );

  const renderHub = () => (
    <View style={{alignItems: 'center', paddingVertical: 8}}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: accentColor + '20',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text
          style={{
            fontSize: 14,
            color: accentColor,
            fontFamily: theme.fontFamilies?.bold,
          }}>
          ↓
        </Text>
      </View>
      <Text
        style={{
          fontSize: theme.fontSizes?.xs || 10,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginTop: 4,
        }}>
        Transaction
      </Text>
    </View>
  );

  const renderLoadingInputs = () => (
    <View style={[rowBase, {opacity: 0.7}]}>
      <Text style={labelStyle}>Loading inputs…</Text>
    </View>
  );

  if (props.variant === 'psbt') {
    const {
      psbtDetails,
      psbtBase64,
      parseError,
      onRetryParse,
      showPsbtTitle = true,
    } = props;
    const net = undefined;

    if (parseError) {
      return (
        <View
          style={[
            cardStyles(theme).card,
            props.cardStyle,
          ]}>
          <Text style={cardStyles(theme).errorTitle}>Could not parse PSBT</Text>
          <Text style={cardStyles(theme).errorBody}>{parseError}</Text>
          {onRetryParse ? (
            <AppPressable onPress={onRetryParse} style={{marginTop: 8}}>
              <Text style={{color: accentColor, fontFamily: theme.fontFamilies?.bold}}>
                Retry
              </Text>
            </AppPressable>
          ) : null}
        </View>
      );
    }

    if (!psbtDetails) {
      return (
        <View style={[cardStyles(theme).card, props.cardStyle]}>
          <Text style={cardStyles(theme).title}>PSBT Ready to Sign</Text>
          <Text style={cardStyles(theme).muted}>
            {psbtBase64
              ? `PSBT (${Math.round((psbtBase64.length || 0) / 1024)} KB) — parsing…`
              : 'No PSBT data'}
          </Text>
        </View>
      );
    }

    const headerTitle = psbtCollapsedSummaryLine(psbtDetails);

    return (
      <View style={[cardStyles(theme).card, props.cardStyle]}>
        {showPsbtTitle ? (
          <Text style={cardStyles(theme).title}>PSBT Ready to Sign</Text>
        ) : null}
        {expandable ? renderExpandHeader(headerTitle) : null}
        {showCollapsedStrip && (
          <View style={cardStyles(theme).summaryStrip}>
            <Text style={cardStyles(theme).summaryLine}>
              {psbtDetails.inputs.length} inputs · {psbtDetails.outputs.length}{' '}
              outputs
            </Text>
            <View style={cardStyles(theme).summaryRow2}>
              <Text style={cardStyles(theme).summaryMuted}>
                Fee {sat2btcStr(psbtDetails.fee)} BTC
              </Text>
              {net ? <NetworkBadge network={net} /> : null}
            </View>
          </View>
        )}
        {showExpandedBody && (
          <>
            <Text style={sectionTitle}>
              Inputs ({psbtDetails.inputs.length})
            </Text>
            {psbtDetails.inputs.map((input, idx) => {
              const derivePath =
                psbtDetails.derivePaths?.[idx] || '';
              const isOurs = derivePath.length > 0;
              const rowStyle = isOurs ? rowOurs : rowBase;
              return (
                <View
                  key={`${input.txid}-${input.vout}`}
                  style={[
                    rowStyle,
                    {
                      marginBottom:
                        idx < psbtDetails.inputs.length - 1 ? 3 : 4,
                    },
                  ]}>
                  {isOurs ? accentBar : null}
                  <Image
                    source={require('../assets/in-icon.png')}
                    style={[
                      iconBase,
                      {tintColor: isOurs ? accentColor : theme.colors.textSecondary},
                    ]}
                    resizeMode="contain"
                  />
                  <View style={{flex: 1}}>
                    <Text style={isOurs ? labelOurs : labelStyle} numberOfLines={1}>
                      {input.address
                        ? shortenAddress(input.address)
                        : `${input.txid.slice(0, 8)}…${input.txid.slice(-6)}:${input.vout}`}
                    </Text>
                    {derivePath ? (
                      <Text style={pathText}>{derivePath}</Text>
                    ) : null}
                  </View>
                  <Text style={isOurs ? amtBTCOurs : amtBTC}>
                    {sat2btcStr(input.amount)} BTC
                  </Text>
                </View>
              );
            })}
            {renderHub()}
            <Text style={sectionTitle}>
              Outputs ({psbtDetails.outputs.length})
            </Text>
            {psbtDetails.outputs.map((output, idx) => {
              const outputPath =
                output.derivationPath ||
                psbtDetails.outputDerivePaths?.[idx] ||
                '';
              const isChange =
                output.isChange === true ||
                (output.isChange !== false &&
                  isLikelyPsbtChangeOutput(
                    output.amount,
                    psbtDetails.totalInput,
                  ));
              const isOurs = outputPath.length > 0;
              const derivePathHint = isChange ? 'change' : 'recipient';
              const rowStyle = isOurs ? rowOurs : rowBase;
              return (
                <View
                  key={`${output.address}-${idx}`}
                  style={[
                    rowStyle,
                    {marginBottom: idx < psbtDetails.outputs.length - 1 ? 3 : 4},
                  ]}>
                  {isOurs ? accentBar : null}
                  <Image
                    source={
                      isChange
                        ? require('../assets/consolidate-icon.png')
                        : require('../assets/bitcoin-icon.png')
                    }
                    style={[
                      iconBase,
                      {tintColor: isOurs ? accentColor : theme.colors.textSecondary},
                    ]}
                    resizeMode="contain"
                  />
                  <View style={{flex: 1}}>
                    <Text
                      style={[
                        isOurs ? labelOurs : labelStyle,
                        {textDecorationLine: 'underline'},
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="middle">
                      {shortenAddress(output.address)}
                    </Text>
                    <Text style={subLabel}>{derivePathHint}</Text>
                    {outputPath ? (
                      <Text style={pathText}>{outputPath}</Text>
                    ) : null}
                  </View>
                  <Text style={isOurs ? amtBTCOurs : amtBTC}>
                    {sat2btcStr(output.amount)} BTC
                  </Text>
                </View>
              );
            })}
            {psbtDetails.fee > 0 && (
              <View style={rowBase}>
                <Image
                  source={require('../assets/send-icon.png')}
                  style={[iconBase, {tintColor: theme.colors.textSecondary}]}
                  resizeMode="contain"
                />
                <View style={{flex: 1}}>
                  <Text style={labelStyle}>Fee</Text>
                </View>
                <Text style={amtBTC}>{sat2btcStr(psbtDetails.fee)} BTC</Text>
              </View>
            )}
          </>
        )}
      </View>
    );
  }

  // send variant
  const {
    sendParams,
    txPreview,
    loading,
    error,
    formatFiat = (p?: string) =>
      new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(p || 0)),
  } = props;

  const net = sendParams.network || '';
  const explorerBase = sendExplorerBase;

  const totalSats =
    Number(sendParams.satoshiAmount) + Number(sendParams.satoshiFees);
  const toAddr = sendParams.toAddress || '';
  const changeSats = computeChangeSats(
    txPreview,
    sendParams.satoshiAmount,
    sendParams.satoshiFees,
  );

  const headerTitle = `Spending ${sat2btcStr(String(totalSats))} BTC`;

  return (
    <View style={[cardStyles(theme).card, props.cardStyle]}>
      {expandable ? renderExpandHeader(headerTitle) : null}
      {showCollapsedStrip && (
        <View style={cardStyles(theme).summaryStrip}>
          <Text style={cardStyles(theme).summaryLine}>
            To {shortenAddress(toAddr)} ·{' '}
            <Text style={{fontFamily: theme.fontFamilies?.monospaceBold}}>
              {sat2btcStr(sendParams.satoshiAmount)} BTC
            </Text>
            {sendParams.selectedCurrency && sendParams.fiatAmount != null
              ? ` (${sendParams.selectedCurrency} ${formatFiat(sendParams.fiatAmount)})`
              : ''}
          </Text>
          <View style={cardStyles(theme).summaryRow2}>
            <Text style={cardStyles(theme).summaryMuted}>
              Fee {sat2btcStr(sendParams.satoshiFees)} BTC
              {sendParams.fiatFees != null && sendParams.selectedCurrency
                ? ` · ${sendParams.selectedCurrency} ${formatFiat(sendParams.fiatFees)}`
                : ''}
            </Text>
            <NetworkBadge network={net} />
          </View>
        </View>
      )}
      {error && !loading ? (
        <Text style={[cardStyles(theme).muted, {marginBottom: 8}]}>{error}</Text>
      ) : null}
      {showExpandedBody && (
        <>
          <Text style={sectionTitle}>
            Inputs
            {txPreview && txPreview.utxos.length > 0
              ? ` (${txPreview.utxos.length})`
              : ''}
          </Text>
          {loading ? (
            renderLoadingInputs()
          ) : txPreview && txPreview.utxos.length > 0 ? (
            txPreview.utxos.map((u, idx) => (
              <AppPressable
                key={`${u.address}-${idx}`}
                style={[
                  rowOurs,
                  {
                    marginBottom:
                      idx < txPreview.utxos.length - 1 ? 3 : 4,
                  },
                ]}
                onPress={() =>
                  Linking.openURL(`${explorerBase}/address/${u.address}`)
                }>
                {accentBar}
                <Image
                  source={require('../assets/in-icon.png')}
                  style={[iconBase, {tintColor: accentColor}]}
                  resizeMode="contain"
                />
                <View style={{flex: 1}}>
                  <Text
                    style={[labelOurs, {textDecorationLine: 'underline'}]}
                    numberOfLines={1}
                    ellipsizeMode="middle">
                    {shortenAddress(u.address)}
                  </Text>
                  <Text style={pathText}>{u.derivationPath}</Text>
                </View>
                <View style={{alignItems: 'flex-end'}}>
                  <Text style={amtBTCOurs}>{sat2btcStr(String(u.value))} BTC</Text>
                </View>
              </AppPressable>
            ))
          ) : !loading ? (
            <View style={rowOurs}>
              {accentBar}
              <Image
                source={require('../assets/in-icon.png')}
                style={[iconBase, {tintColor: accentColor}]}
                resizeMode="contain"
              />
              <View style={{flex: 1}}>
                <Text style={labelOurs} numberOfLines={1}>
                  HD Wallet
                </Text>
              </View>
              <View style={{alignItems: 'flex-end'}}>
                <Text style={amtBTCOurs}>{sat2btcStr(String(totalSats))} BTC</Text>
              </View>
            </View>
          ) : null}

          {renderHub()}

          <Text style={sectionTitle}>Outputs</Text>
          <AppPressable
            style={rowBase}
            onPress={() =>
              Linking.openURL(`${explorerBase}/address/${toAddr}`)
            }>
            <Image
              source={require('../assets/bitcoin-icon.png')}
              style={[iconBase, {tintColor: theme.colors.textSecondary}]}
              resizeMode="contain"
            />
            <View style={{flex: 1}}>
              <Text
                style={[labelStyle, {textDecorationLine: 'underline'}]}
                numberOfLines={1}
                ellipsizeMode="middle">
                {shortenAddress(toAddr)}
              </Text>
              <Text style={subLabel}>recipient</Text>
            </View>
            <View style={{alignItems: 'flex-end'}}>
              <Text style={amtBTC}>
                {sat2btcStr(sendParams.satoshiAmount)} BTC
              </Text>
              {sendParams.fiatAmount != null && (
                <Text style={amtFiat}>
                  {sendParams.selectedCurrency || ''}{' '}
                  {formatFiat(sendParams.fiatAmount)}
                </Text>
              )}
            </View>
          </AppPressable>
          <View
            style={{
              width: 1,
              height: 8,
              backgroundColor: theme.colors.border,
              marginLeft: 17,
              marginBottom: 2,
            }}
          />
          <View style={rowBase}>
            <Image
              source={require('../assets/send-icon.png')}
              style={[iconBase, {tintColor: theme.colors.textSecondary}]}
              resizeMode="contain"
            />
            <View style={{flex: 1}}>
              <Text style={labelStyle}>Fee</Text>
            </View>
            <View style={{alignItems: 'flex-end'}}>
              <Text style={amtBTC}>{sat2btcStr(sendParams.satoshiFees)} BTC</Text>
              {sendParams.fiatFees != null && (
                <Text style={amtFiat}>
                  {sendParams.selectedCurrency || ''}{' '}
                  {formatFiat(sendParams.fiatFees)}
                </Text>
              )}
            </View>
          </View>
          {txPreview?.changeAddress ? (
            <>
              <View
                style={{
                  width: 1,
                  height: 8,
                  backgroundColor: theme.colors.border,
                  marginLeft: 17,
                  marginBottom: 2,
                }}
              />
              <AppPressable
                style={[rowOurs, {marginBottom: 0}]}
                onPress={() =>
                  Linking.openURL(
                    `${explorerBase}/address/${txPreview.changeAddress}`,
                  )
                }>
                {accentBar}
                <Image
                  source={require('../assets/in-icon.png')}
                  style={[iconBase, {tintColor: accentColor}]}
                  resizeMode="contain"
                />
                <View style={{flex: 1}}>
                  <Text
                    style={[labelOurs, {textDecorationLine: 'underline'}]}
                    numberOfLines={1}
                    ellipsizeMode="middle">
                    {shortenAddress(txPreview.changeAddress)}
                  </Text>
                  <Text style={subLabel}>change</Text>
                  {txPreview.changeAddressPath ? (
                    <Text style={pathText}>{txPreview.changeAddressPath}</Text>
                  ) : null}
                </View>
                <View style={{alignItems: 'flex-end'}}>
                  {changeSats > 0 && (
                    <Text style={amtBTCOurs}>
                      {sat2btcStr(String(changeSats))} BTC
                    </Text>
                  )}
                </View>
              </AppPressable>
            </>
          ) : null}
        </>
      )}
    </View>
  );
};

function cardStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
    },
    title: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    muted: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    errorTitle: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 4,
    },
    errorBody: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
    },
    summaryStrip: {
      marginBottom: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border + '60',
    },
    summaryLine: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      marginBottom: 6,
    },
    summaryRow2: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    summaryMuted: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.textSecondary,
      flex: 1,
      marginRight: 8,
    },
  });
}

export default TransactionFlowDiagram;
