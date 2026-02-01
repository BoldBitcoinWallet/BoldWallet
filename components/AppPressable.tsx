import React from 'react';
import {
  Pressable,
  Platform,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const DEFAULT_RIPPLE = { color: 'rgba(0,0,0,0.1)' };
const STRONG_RIPPLE = { color: 'rgba(0,0,0,0.15)' };

export type AppPressableVariant = 'default' | 'strong' | 'none';

export interface AppPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  variant?: AppPressableVariant;
  /** Override default ripple on Android (ignored when variant="none") */
  android_ripple?: PressableProps['android_ripple'];
}

function resolveStyle(
  style: AppPressableProps['style'],
  state: { pressed: boolean },
): StyleProp<ViewStyle> {
  if (typeof style === 'function') {
    return style(state);
  }
  return style;
}

export default function AppPressable({
  style,
  variant = 'default',
  android_ripple,
  ...rest
}: AppPressableProps) {
  const isNone = variant === 'none';
  const ripple = isNone
    ? undefined
    : android_ripple ?? (variant === 'strong' ? STRONG_RIPPLE : DEFAULT_RIPPLE);

  const mergedStyle: PressableProps['style'] =
    isNone && typeof style !== 'function'
      ? style
      : ({ pressed }) => {
          const userResolved = resolveStyle(style, { pressed });
          const base = Array.isArray(userResolved) ? userResolved : [userResolved];
          if (isNone) return base;
          if (Platform.OS === 'ios' && pressed) {
            return [...base, { opacity: variant === 'strong' ? 0.6 : 0.7 }];
          }
          return base;
        };

  return (
    <Pressable
      {...rest}
      style={mergedStyle}
      android_ripple={ripple}
    />
  );
}
