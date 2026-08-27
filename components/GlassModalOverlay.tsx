import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {BlurView} from '@sbaiahmed1/react-native-blur';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';

export type GlassModalOverlayProps = {
  children: React.ReactNode;
  /** Centered card (default) or bottom sheet. */
  contentPosition?: 'center' | 'bottom';
  /** When set, tapping the dimmed area outside the card dismisses. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Frosted glass backdrop for transparent RN Modals.
 * Blur sits behind the card; the card itself is not blurred.
 * Centered content sits in a full-width slot so nested wrappers
 * (e.g. KeyboardAvoidingView) still resolve percentage card widths.
 */
const GlassModalOverlay: React.FC<GlassModalOverlayProps> = ({
  children,
  contentPosition = 'center',
  onPress,
  style,
}) => {
  const {theme} = useTheme();

  return (
    <View
      style={[
        styles.fill,
        contentPosition === 'bottom' ? styles.bottom : undefined,
        style,
      ]}>
      <BlurView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        blurType="dark"
        blurAmount={20}
        overlayColor={theme.colors.modalBackdropGlass}
        reducedTransparencyFallbackColor={theme.colors.modalBackdrop}
      />
      {onPress ? (
        <AppPressable
          variant="none"
          haptic={false}
          onPress={onPress}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
      ) : null}
      {contentPosition === 'bottom' ? (
        children
      ) : (
        <View style={styles.centerSlot} pointerEvents="box-none">
          {children}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  centerSlot: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottom: {
    justifyContent: 'flex-end',
  },
});

export default GlassModalOverlay;
