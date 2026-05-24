import React, {useEffect, useState} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import * as Progress from 'react-native-progress';
import {useTheme} from '../theme';
import type {MpcTransportSubprogressState} from '../services/mpcTransportProgress';

type Props = {
  subprogress: MpcTransportSubprogressState | null | undefined;
  /** Only show after upload has been active this long (ms). */
  debounceMs?: number;
};

/** Thin upload sub-bar under MPC status during LAN/Nostr outbound sends. */
export function MpcTransportSubprogress({
  subprogress,
  debounceMs = 300,
}: Props) {
  const {theme} = useTheme();
  const [debouncedVisible, setDebouncedVisible] = useState(false);
  const indeterminate = useState(() => new Animated.Value(0))[0];

  const active = subprogress?.active === true && subprogress.visible;

  useEffect(() => {
    if (!active) {
      setDebouncedVisible(false);
      return;
    }
    const timer = setTimeout(() => setDebouncedVisible(true), debounceMs);
    return () => clearTimeout(timer);
  }, [active, debounceMs, subprogress?.chunk, subprogress?.total]);

  useEffect(() => {
    if (!debouncedVisible || subprogress?.fraction !== null) {
      indeterminate.stopAnimation();
      indeterminate.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.timing(indeterminate, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [debouncedVisible, subprogress?.fraction, indeterminate]);

  if (!debouncedVisible || !subprogress?.label) {
    return null;
  }

  const accent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;

  const barWidth = 180;
  const fraction = subprogress.fraction;

  return (
    <View style={styles.wrap} accessibilityLabel={subprogress.label}>
      <Text
        style={[
          styles.label,
          {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSizes?.sm || 12,
          },
        ]}
        numberOfLines={1}>
        {subprogress.label}
      </Text>
      {fraction !== null ? (
        <Progress.Bar
          progress={Math.min(1, Math.max(0, fraction))}
          width={barWidth}
          height={4}
          borderWidth={0}
          unfilledColor={theme.colors.border ?? 'rgba(128,128,128,0.25)'}
          color={accent}
        />
      ) : (
        <View
          style={[
            styles.indeterminateTrack,
            {width: barWidth, backgroundColor: theme.colors.border ?? 'rgba(128,128,128,0.25)'},
          ]}>
          <Animated.View
            style={[
              styles.indeterminateFill,
              {
                backgroundColor: accent,
                transform: [
                  {
                    translateX: indeterminate.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-barWidth * 0.35, barWidth],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginBottom: 6,
    marginTop: 2,
  },
  label: {
    marginBottom: 4,
    textAlign: 'center',
  },
  indeterminateTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  indeterminateFill: {
    width: '35%',
    height: 4,
    borderRadius: 2,
  },
});

export default MpcTransportSubprogress;
