/**
 * Compact keygen progress card. Same metrics as the tall modal:
 * percent, status, session, connection, transport, elapsed, abort.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import * as Progress from 'react-native-progress';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';
import {MpcKeepAliveHints} from './MpcKeepAliveHints';
import {MpcModalStatusRow} from './MpcModalStatusRow';
import {MpcConnectionQuality} from './MpcConnectionQuality';
import {MpcTransportSubprogress} from './MpcTransportSubprogress';
import type {ConnectionQualityState} from '../services/mpcConnectionQuality';
import type {MpcTransportSubprogressState} from '../services/mpcTransportProgress';

type Props = {
  title: string;
  hint?: string;
  percent: number;
  status: string;
  sessionShort?: string | null;
  pulseIndicator?: boolean;
  quality?: ConnectionQualityState | null;
  subprogress?: MpcTransportSubprogressState | null;
  staleHint?: string | null;
  elapsedSeconds: number;
  onAbort: () => void;
};

function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function KeygenFinalizePanel({
  title,
  hint,
  percent,
  status,
  sessionShort,
  pulseIndicator,
  quality,
  subprogress,
  staleHint,
  elapsedSeconds,
  onAbort,
}: Props) {
  const {theme} = useTheme();
  const tokens = theme.colors;
  const accent =
    tokens.background === '#ffffff' ? tokens.primary : tokens.bitcoinOrange;
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.ringWrap}>
          <Progress.Circle
            size={52}
            progress={clamped / 100}
            thickness={4}
            borderWidth={0}
            showsText={false}
            color={accent}
            unfilledColor={tokens.border}
          />
          <View style={styles.ringLabel} pointerEvents="none">
            <Text style={[styles.percent, {color: tokens.text}]}>{clamped}%</Text>
          </View>
        </View>
        <View style={styles.headCopy}>
          <Text
            style={[
              styles.title,
              {color: tokens.text, fontFamily: theme.fontFamilies?.bold},
            ]}
            numberOfLines={1}>
            {title}
          </Text>
          {hint ? (
            <Text
              style={[
                styles.hint,
                {
                  color: tokens.textSecondary,
                  fontFamily: theme.fontFamilies?.regular,
                },
              ]}
              numberOfLines={2}>
              {hint}
            </Text>
          ) : null}
        </View>
      </View>
      <MpcKeepAliveHints />
      <MpcModalStatusRow
        status={status}
        sessionShort={sessionShort}
        pulseIndicator={pulseIndicator}
        style={styles.status}
      />
      <View style={styles.metrics}>
        <MpcConnectionQuality quality={quality} />
        <Text
          style={[
            styles.elapsed,
            {
              color: tokens.textSecondary,
              fontFamily: theme.fontFamilies?.medium,
            },
          ]}>
          {formatElapsed(elapsedSeconds)}
        </Text>
      </View>
      <MpcTransportSubprogress subprogress={subprogress} />
      {staleHint ? (
        <Text
          style={[styles.stale, {color: tokens.textSecondary}]}
          numberOfLines={2}>
          {staleHint}
        </Text>
      ) : null}
      <AppPressable style={[styles.abort, {borderColor: tokens.border}]} onPress={onAbort}>
        <Text style={[styles.abortText, {color: tokens.textSecondary}]}>Abort</Text>
      </AppPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {alignSelf: 'stretch', width: '100%'},
  head: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10},
  ringWrap: {width: 52, height: 52, alignItems: 'center', justifyContent: 'center'},
  ringLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {fontSize: 12, fontWeight: '700'},
  headCopy: {flex: 1, minWidth: 0},
  title: {fontSize: 17, lineHeight: 22},
  hint: {fontSize: 12, lineHeight: 16, marginTop: 2},
  status: {marginBottom: 4},
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  elapsed: {fontSize: 12},
  stale: {fontSize: 12, lineHeight: 16, marginTop: 4},
  abort: {
    marginTop: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  abortText: {fontSize: 14, fontWeight: '600'},
});
