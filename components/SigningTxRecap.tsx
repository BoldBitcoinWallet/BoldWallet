import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTheme} from '../theme';
import {shortenAddress} from '../utils';
import type {PsbtFlowDetails} from '../types/transactionFlow';
import {
  networkLabel,
  psbtCollapsedSummaryLine,
  sat2btcStr,
  sendCollapsedRecapLine,
} from './transactionFlowUtils';

type SendRecapProps = {
  mode: 'send';
  satoshiAmount: string | number;
  toAddress: string;
  network?: string;
};

type PsbtRecapProps = {
  mode: 'psbt';
  psbtDetails: PsbtFlowDetails;
  network?: string;
};

export type SigningTxRecapProps = SendRecapProps | PsbtRecapProps;

const SigningTxRecap: React.FC<SigningTxRecapProps> = props => {
  const {theme} = useTheme();
  const net = props.network;
  const isTestnet = net === 'testnet3' || net === 'testnet';

  const line =
    props.mode === 'send'
      ? sendCollapsedRecapLine(
          props.satoshiAmount,
          props.toAddress,
          shortenAddress,
        )
      : psbtCollapsedSummaryLine(props.psbtDetails);

  const styles = StyleSheet.create({
    wrap: {
      marginTop: 12,
      marginBottom: 4,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '08'
          : theme.colors.bitcoinOrange + '14',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    line: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.monospace,
      color: theme.colors.text,
      textAlign: 'center',
    },
    badge: {
      alignSelf: 'center',
      marginTop: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: isTestnet
        ? theme.colors.bitcoinOrange + '22'
        : theme.colors.primary + '18',
    },
    badgeText: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.bold,
      color: isTestnet ? theme.colors.bitcoinOrange : theme.colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
  });

  return (
    <View style={styles.wrap}>
      <Text style={styles.line}>{line}</Text>
      {net ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{networkLabel(net)}</Text>
        </View>
      ) : null}
    </View>
  );
};

export default SigningTxRecap;
