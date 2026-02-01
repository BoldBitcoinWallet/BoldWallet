import React from 'react';
import {
  Pressable,
  Platform,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const DEFAULT_RIPPLE = {
  color: 'rgba(0,0,0,0.15)',
  foreground: true,
};
const STRONG_RIPPLE = {
  color: 'rgba(0,0,0,0.2)',
  foreground: true,
};

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
    : (() => {
        const r = android_ripple ?? (variant === 'strong' ? STRONG_RIPPLE : DEFAULT_RIPPLE);
        if (!r || typeof r !== 'object') return r;
        return { ...r, foreground: true };
      })();

  const mergedStyle: PressableProps['style'] =
    isNone && typeof style !== 'function'
      ? style
      : ({ pressed }) => {
          const userResolved = resolveStyle(style, { pressed });
          const base = Array.isArray(userResolved) ? userResolved : [userResolved];
          if (isNone) return base;
          const extra: ViewStyle[] = [];
          if (Platform.OS === 'android' && ripple) {
            extra.push({ overflow: 'hidden' });
          }
          if (Platform.OS === 'ios' && pressed) {
            extra.push({ opacity: variant === 'strong' ? 0.6 : 0.7 });
          }
          return [...base, ...extra];
        };

  return (
    <Pressable
      {...rest}
      style={mergedStyle}
      android_ripple={ripple}
    />
  );
}
