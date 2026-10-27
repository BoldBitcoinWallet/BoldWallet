import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Pressable,
  Platform,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {HapticFeedback} from '../utils';

const DEFAULT_RIPPLE_COLOR = 'rgba(0,0,0,0.15)';
const STRONG_RIPPLE_COLOR = 'rgba(0,0,0,0.2)';

export type AppPressableVariant = 'default' | 'strong' | 'none';

export interface AppPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  variant?: AppPressableVariant;
  /** Override default ripple on Android (ignored when variant="none") */
  android_ripple?: PressableProps['android_ripple'];
  /** Trigger haptic feedback on press. Default true. Set false to opt out. */
  haptic?: boolean;
}

type Burst = {id: number; x: number; y: number; color: string};

function resolveStyle(
  style: AppPressableProps['style'],
  state: { pressed: boolean },
): StyleProp<ViewStyle> {
  if (typeof style === 'function') {
    return style(state);
  }
  return style;
}

function rippleColor(
  ripple: PressableProps['android_ripple'] | undefined,
  variant: AppPressableVariant,
): string {
  if (typeof ripple?.color === 'string') {
    return ripple.color;
  }
  return variant === 'strong' ? STRONG_RIPPLE_COLOR : DEFAULT_RIPPLE_COLOR;
}

/**
 * Android's native ripple is a rectangle on the pressable, so it paints
 * through rounded corners. A child circle is clipped by this view's own
 * border radius instead.
 */
function RippleBurst({
  x,
  y,
  color,
  onDone,
}: {
  x: number;
  y: number;
  color: string;
  onDone: () => void;
}) {
  const scale = useRef(new Animated.Value(0.04)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(scale, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 460,
        useNativeDriver: true,
      }),
    ]);
    anim.start(({finished}) => {
      if (finished) {
        onDoneRef.current();
      }
    });
    return () => anim.stop();
  }, [opacity, scale]);
  const size = 560;
  const burstStyle = [
    rippleBurstStyles.base,
    {
      left: x - size / 2,
      top: y - size / 2,
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      opacity,
      transform: [{scale}],
    },
  ];
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={burstStyle}
    />
  );
}

const rippleBurstStyles = StyleSheet.create({
  base: {position: 'absolute'},
});

export default function AppPressable({
  style,
  variant = 'default',
  android_ripple,
  haptic = true,
  onPress,
  onPressIn,
  children,
  ...rest
}: AppPressableProps) {
  const isNone = variant === 'none';
  const showRipple = Platform.OS === 'android' && !isNone;
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nextId = useRef(1);
  const color = rippleColor(android_ripple, variant);

  const handlePress: PressableProps['onPress'] = e => {
    if (haptic) {
      HapticFeedback.medium();
    }
    onPress?.(e);
  };
  const handlePressIn = (e: GestureResponderEvent) => {
    if (showRipple) {
      const id = nextId.current++;
      setBursts(prev => [
        ...prev,
        {
          id,
          x: e.nativeEvent.locationX ?? 0,
          y: e.nativeEvent.locationY ?? 0,
          color,
        },
      ]);
    }
    onPressIn?.(e);
  };
  const dismissBurst = (id: number) => {
    setBursts(prev => prev.filter(burst => burst.id !== id));
  };

  const mergedStyle: PressableProps['style'] =
    isNone && typeof style !== 'function'
      ? style
      : ({pressed}) => {
          const userResolved = resolveStyle(style, {pressed});
          const base = Array.isArray(userResolved)
            ? userResolved
            : [userResolved];
          if (isNone) {
            return base;
          }
          const extra: ViewStyle[] = [];
          if (showRipple) {
            extra.push({overflow: 'hidden'});
          }
          if (Platform.OS === 'ios' && pressed) {
            extra.push({opacity: variant === 'strong' ? 0.6 : 0.7});
          }
          return [...base, ...extra];
        };

  const rippleNodes = showRipple
    ? bursts.map(burst => (
        <RippleBurst
          key={burst.id}
          x={burst.x}
          y={burst.y}
          color={burst.color}
          onDone={() => dismissBurst(burst.id)}
        />
      ))
    : null;

  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      onPressIn={handlePressIn}
      style={mergedStyle}>
      {typeof children === 'function'
        ? (state: {pressed: boolean}) => (
            <>
              {children(state)}
              {rippleNodes}
            </>
          )
        : (
            <>
              {children}
              {rippleNodes}
            </>
          )}
    </Pressable>
  );
}
