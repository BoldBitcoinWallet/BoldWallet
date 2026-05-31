import {useCallback, useEffect, useState} from 'react';
import {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export const MPC_CIRCLE_ANIM_MS = 400;

/** Smooth circular progress between sparse native hook updates. */
export function useMpcCircleProgress(active: boolean) {
  const circleAnim = useSharedValue(0);
  const [displayPercent, setDisplayPercent] = useState(0);

  const setCircleTarget = useCallback(
    (percent: number) => {
      const frac = Math.min(1, Math.max(0, percent / 100));
      circleAnim.value = withTiming(frac, {duration: MPC_CIRCLE_ANIM_MS});
    },
    [circleAnim],
  );

  const resetCircle = useCallback(() => {
    cancelAnimation(circleAnim);
    circleAnim.value = 0;
    setDisplayPercent(0);
  }, [circleAnim]);

  useAnimatedReaction(
    () => circleAnim.value,
    (v, prev) => {
      if (v !== prev) {
        runOnJS(setDisplayPercent)(Math.round(v * 100));
      }
    },
  );

  useEffect(() => {
    if (!active) {
      resetCircle();
    }
  }, [active, resetCircle]);

  return {displayPercent, setCircleTarget, resetCircle};
}
