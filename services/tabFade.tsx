import React, {useEffect, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {useTheme} from '../theme';
import {DISSOLVE_FADE} from '../components/DissolveFade';

export const TAB_ENTER_MS = 380;
export const TAB_GLIDE_MS = 440;
const TAB_SHIFT_PX = 28;
const ENTER_EASE = Easing.out(Easing.cubic);

type PrepareListener = (direction: -1 | 1) => void;
const prepareListeners = new Set<PrepareListener>();

let notedIndex = -1;
let switchCount = 0;
let lastDirection: -1 | 1 = 1;

function subscribePrepare(listener: PrepareListener): () => void {
  prepareListeners.add(listener);
  return () => {
    prepareListeners.delete(listener);
  };
}

export function noteTabEnter(from: number, to: number) {
  if (from === to || to < 0) {
    return;
  }
  notedIndex = to;
  switchCount += 1;
  lastDirection = to > from ? 1 : -1;
  prepareListeners.forEach(listener => listener(lastDirection));
}

export function consumeNotedTabEnter(index: number): boolean {
  if (notedIndex !== index) {
    return false;
  }
  notedIndex = -1;
  return true;
}

/**
 * Wraps each tab screen. The navigator switches with animation: 'none'
 * so only one native screen is ever mounted. When a tab becomes focused,
 * its content fades in smoothly on the UI thread.
 */
export function TabEnterView({children}: {children: React.ReactNode}) {
  const {theme} = useTheme();
  const isFocused = useIsFocused();
  const isEnteredSwitch = switchCount > 0;
  const opacity = useSharedValue(DISSOLVE_FADE || !isEnteredSwitch ? 1 : 0);
  const cover = useSharedValue(DISSOLVE_FADE && isEnteredSwitch ? 1 : 0);
  const shift = useSharedValue(
    isEnteredSwitch ? lastDirection * TAB_SHIFT_PX : 0,
  );
  const preparedRef = useRef(isEnteredSwitch);
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;

  useEffect(() => {
    return subscribePrepare(direction => {
      if (!focusedRef.current) {
        preparedRef.current = true;
        shift.value = direction * TAB_SHIFT_PX;
        if (DISSOLVE_FADE) {
          cover.value = 1;
        } else {
          opacity.value = 0;
        }
      }
    });
  }, [cover, opacity, shift]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }
    if (switchCount === 0) {
      opacity.value = 1;
      cover.value = 0;
      shift.value = 0;
      return;
    }
    if (!preparedRef.current) {
      shift.value = lastDirection * TAB_SHIFT_PX;
      if (DISSOLVE_FADE) {
        cover.value = 1;
      } else {
        opacity.value = 0;
      }
    }
    preparedRef.current = false;
    if (DISSOLVE_FADE) {
      cover.value = withTiming(0, {duration: TAB_ENTER_MS, easing: ENTER_EASE});
    } else {
      opacity.value = withTiming(1, {
        duration: TAB_ENTER_MS,
        easing: ENTER_EASE,
      });
    }
    shift.value = withTiming(0, {duration: TAB_GLIDE_MS, easing: ENTER_EASE});
  }, [cover, isFocused, opacity, shift]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{translateX: shift.value}],
  }));
  const coverStyle = useAnimatedStyle(() => ({
    opacity: cover.value,
  }));

  return (
    <View style={styles.fill}>
      <Animated.View style={[styles.fill, style]}>{children}</Animated.View>
      {DISSOLVE_FADE ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.cover,
            {backgroundColor: theme.colors.background},
            coverStyle,
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
  },
});
