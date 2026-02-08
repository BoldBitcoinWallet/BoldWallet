import React, {useCallback} from 'react';
import {Switch, type SwitchProps} from 'react-native';
import {useTheme} from '../theme';
import {HapticFeedback} from '../utils';

export interface AppSwitchProps extends Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'> {
  /** Trigger haptic feedback on toggle. Default true. Set false to opt out. */
  haptic?: boolean;
  /** Override track color when off (default: theme.colors.switchTrackFalse) */
  trackColorFalse?: string;
  /** Override track color when on (default: theme.colors.switchTrackTrue) */
  trackColorTrue?: string;
  /** Override thumb color (default: theme.colors.switchThumb) */
  thumbColorOverride?: string;
  /** Override iOS background color (default: theme.colors.switchIosBackground) */
  iosBackgroundColorOverride?: string;
}

/**
 * Unified Switch: theme-aware colors and haptic feedback on toggle by default.
 */
const AppSwitch: React.FC<AppSwitchProps> = ({
  haptic = true,
  onValueChange,
  trackColorFalse,
  trackColorTrue,
  thumbColorOverride,
  iosBackgroundColorOverride,
  ...rest
}) => {
  const {theme} = useTheme();
  const trackFalse = trackColorFalse ?? theme.colors.switchTrackFalse;
  const trackTrue = trackColorTrue ?? theme.colors.switchTrackTrue;
  const thumb = thumbColorOverride ?? theme.colors.switchThumb;
  const iosBg = iosBackgroundColorOverride ?? theme.colors.switchIosBackground;

  const handleValueChange = useCallback(
    (value: boolean) => {
      if (haptic) {
        HapticFeedback.light();
      }
      onValueChange?.(value);
    },
    [haptic, onValueChange],
  );

  return (
    <Switch
      {...rest}
      onValueChange={handleValueChange}
      trackColor={{
        false: trackFalse,
        true: trackTrue,
      }}
      thumbColor={thumb}
      ios_backgroundColor={iosBg}
    />
  );
};

export default AppSwitch;
