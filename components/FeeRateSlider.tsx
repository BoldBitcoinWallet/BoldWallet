import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';

type Props = {
  value: number;
  min: number;
  max: number;
  accent: string;
  trackColor: string;
  thumbBorder: string;
  /** Live while dragging (does not commit fee estimate). */
  onDrag?: (next: number) => void;
  /** Integer value after drag or tap on track. */
  onCommit: (next: number) => void;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Integer sat/vB track. No native slider dependency.
 * Commits on release so fee estimation is not hammered mid-drag.
 */
export default function FeeRateSlider({
  value,
  min,
  max,
  accent,
  trackColor,
  thumbBorder,
  onDrag,
  onCommit,
}: Props) {
  const trackWidth = useRef(1);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState(value);
  const liveRef = useRef(live);
  liveRef.current = live;
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const minRef = useRef(min);
  minRef.current = min;
  const maxRef = useRef(max);
  maxRef.current = max;

  const display = dragging ? live : value;
  const span = Math.max(1, max - min);

  const ratioToValue = useCallback((x: number) => {
    const w = trackWidth.current;
    const lo = minRef.current;
    const hi = maxRef.current;
    const r = clamp(x / w, 0, 1);
    return Math.round(lo + r * Math.max(1, hi - lo));
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: evt => {
          setDragging(true);
          const next = ratioToValue(evt.nativeEvent.locationX);
          setLive(next);
          onDragRef.current?.(next);
        },
        onPanResponderMove: evt => {
          const next = ratioToValue(evt.nativeEvent.locationX);
          setLive(next);
          onDragRef.current?.(next);
        },
        onPanResponderRelease: evt => {
          const next = ratioToValue(evt.nativeEvent.locationX);
          setDragging(false);
          setLive(next);
          onCommitRef.current(next);
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          onCommitRef.current(liveRef.current);
        },
      }),
    [ratioToValue],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    trackWidth.current = Math.max(1, e.nativeEvent.layout.width);
  };

  const fillPct = ((clamp(display, min, max) - min) / span) * 100;

  return (
    <View
      style={styles.wrap}
      onLayout={onLayout}
      {...pan.panHandlers}
      accessibilityRole="adjustable"
      accessibilityValue={{min, max, now: display}}>
      <View style={[styles.track, {backgroundColor: trackColor}]}>
        <View
          style={[
            styles.fill,
            {width: `${fillPct}%`, backgroundColor: accent},
          ]}
        />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            left: `${fillPct}%`,
            backgroundColor: accent,
            borderColor: thumbBorder,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 28,
    justifyContent: 'center',
    marginVertical: 4,
    position: 'relative',
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    borderWidth: 2,
  },
});
