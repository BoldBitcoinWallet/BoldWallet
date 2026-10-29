import React from 'react';
import {
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Android redraws a translucent parent as one layer, so text and card
 * edges look thick. iOS composites that fade softly. On Android the
 * children stay fully drawn and a flat cover dissolves instead.
 */
export const DISSOLVE_FADE = Platform.OS === 'android';

type Props = {
  /** 0 hides the children, 1 shows them. */
  shown: SharedValue<number>;
  coverColor: string;
  style?: StyleProp<ViewStyle> | AnimatedStyle<ViewStyle>;
  pointerEvents?: 'auto' | 'none' | 'box-none';
  children: React.ReactNode;
};

export function DissolveFade({
  shown,
  coverColor,
  style,
  pointerEvents,
  children,
}: Props) {
  const contentStyle = useAnimatedStyle(() => ({
    opacity: DISSOLVE_FADE ? 1 : shown.value,
  }));
  const coverStyle = useAnimatedStyle(() => ({
    opacity: DISSOLVE_FADE ? 1 - shown.value : 0,
  }));

  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[style, contentStyle, DISSOLVE_FADE ? styles.clip : null]}>
      {children}
      {DISSOLVE_FADE ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.cover, {backgroundColor: coverColor}, coverStyle]}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
  },
});
