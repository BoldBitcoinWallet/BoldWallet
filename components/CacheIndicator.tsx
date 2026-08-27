import React, {
  useEffect,
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  View,
  Text,
  Image,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import AppPressable from './AppPressable';
import {createStyles} from './Styles';
import {HapticFeedback} from '../utils';
import {getFetchTimeoutMs} from '../services/HdOptionsConfig';
import {
  syncFillFailureKind,
  syncFillWarmth,
  formatSyncFillProgress,
  syncFillWindow,
  type SyncFillWarmth,
} from '../services/syncFillWindow';

export interface CacheTimestamp {
  price: number;
  balance: number;
}

const clockIcon = require('../assets/clock-icon.png');

const FILL_OPACITY = 0.2;
const FILL_PULSE_MIN = 0.16;
const FILL_PULSE_MAX = 0.34;
const SUCCESS_FF_MS = 280;
const SUCCESS_HOLD_MS = 450;
const OUTCOME_FADE_MS = 400;
const FAILURE_FLASH_OPACITY = 0.28;
const FAILURE_PERSIST_OPACITY = 0.18;
const LEADING_EDGE_PX = 24;
const PULSE_MS = 700;

interface CacheIndicatorProps {
  timestamps: CacheTimestamp;
  onRefresh: () => void;
  /** Long-press triggers a deep refresh (e.g. HD re-discovery + normal refresh). */
  onLongPress?: () => void;
  /** When pressed while isRefreshing, called to abort all in-flight API/sync work (e.g. mempoolClient.abortAll()). */
  onAbortRequested?: () => void;
  theme: any;
  isRefreshing?: boolean;
  usingCache?: boolean; // explicitly indicate cached mode (e.g., offline)
  /** When isRefreshing, show this instead of generic "Refreshing..." (e.g. "Fetching balance…"). */
  statusMessage?: string;
  /** When isRefreshing and set, append address progress (e.g. "3 of 5 addresses"). */
  progress?: {current: number; total: number};
  /** Temporary message after sync failure (e.g. "Sync failed — cached data"); parent clears after ~4s. */
  syncErrorMessage?: string | null;
  /** When true and not refreshing, show "Tap to retry" instead of "Tap to refresh". */
  lastSyncFailed?: boolean;
  /** Optional extra line (e.g. "Network is slow"); ignored while syncErrorMessage is set. */
  healthHint?: string | null;
  /** Per-request timeout window for the fill. Defaults to the user-facing fetch timeout. */
  timeoutMs?: number;
}

export interface CacheIndicatorHandle {
  press: () => void;
}

function warmthColor(
  warmth: SyncFillWarmth,
  colors: {
    accent: string;
    secondary: string;
    bitcoinOrange: string;
    danger: string;
    background: string;
  },
): string {
  if (warmth === 'danger') {
    return colors.danger;
  }
  if (warmth === 'patience') {
    return colors.bitcoinOrange;
  }
  return colors.background === '#ffffff' ? colors.accent : colors.secondary;
}

export const CacheIndicator = forwardRef<
  CacheIndicatorHandle,
  CacheIndicatorProps
>(
  (
    {
      timestamps,
      onRefresh,
      onLongPress,
      onAbortRequested,
      theme,
      isRefreshing = false,
      usingCache = false,
      statusMessage,
      progress,
      syncErrorMessage,
      lastSyncFailed = false,
      healthHint,
      timeoutMs: timeoutMsProp,
    },
    ref,
  ) => {
    const latestTimestamp = Math.max(timestamps.price, timestamps.balance);
    const progressLabel = formatSyncFillProgress(progress);
    const timeoutMs = timeoutMsProp ?? getFetchTimeoutMs();
    const fillProgress = useRef(new Animated.Value(0)).current;
    const fillOpacity = useRef(new Animated.Value(0)).current;
    const windowElapsed = useRef(new Animated.Value(0)).current;
    const successOpacity = useRef(new Animated.Value(0)).current;
    const timeoutOpacity = useRef(new Animated.Value(0)).current;
    const errorOpacity = useRef(new Animated.Value(0)).current;
    const fillAnimRef = useRef<Animated.CompositeAnimation | null>(null);
    const warmthAnimRef = useRef<Animated.CompositeAnimation | null>(null);
    const pulseAnimRef = useRef<Animated.CompositeAnimation | null>(null);
    const outcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wasRefreshingRef = useRef(false);
    const lastFailureKindRef = useRef<'timeout' | 'error' | null>(null);
    const syncErrorRef = useRef(syncErrorMessage);
    const lastSyncFailedRef = useRef(lastSyncFailed);
    const progressRef = useRef(progress);
    const warmthRef = useRef<SyncFillWarmth>('calm');
    const justFinishedRefreshRef = useRef(false);
    const themeColorsRef = useRef(theme.colors);
    syncErrorRef.current = syncErrorMessage;
    lastSyncFailedRef.current = lastSyncFailed;
    progressRef.current = progress;
    themeColorsRef.current = theme.colors;
    const [barWidth, setBarWidth] = useState(0);
    const [edgeColor, setEdgeColor] = useState(() =>
      warmthColor('calm', theme.colors),
    );
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [isUsingCache, setIsUsingCache] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        press: () => {
          if (isRefreshing) {
            onAbortRequested?.();
          } else {
            onRefresh();
          }
        },
      }),
      [onRefresh, onAbortRequested, isRefreshing],
    );

    useEffect(() => {
      if (syncErrorMessage) {
        lastFailureKindRef.current = syncFillFailureKind(syncErrorMessage);
      } else if (!lastSyncFailed) {
        lastFailureKindRef.current = null;
      }
    }, [syncErrorMessage, lastSyncFailed]);

    const windowKey = `${statusMessage ?? ''}|${progress?.current ?? ''}|${
      progress?.total ?? ''
    }`;

    useEffect(() => {
      let cancelled = false;
      const stopFillAnims = () => {
        fillAnimRef.current?.stop();
        fillAnimRef.current = null;
        warmthAnimRef.current?.stop();
        warmthAnimRef.current = null;
        pulseAnimRef.current?.stop();
        pulseAnimRef.current = null;
      };
      const clearOutcomeTimer = () => {
        if (outcomeTimerRef.current) {
          clearTimeout(outcomeTimerRef.current);
          outcomeTimerRef.current = null;
        }
      };

      if (isRefreshing) {
        wasRefreshingRef.current = true;
        if (barWidth <= 0) {
          return;
        }
        stopFillAnims();
        clearOutcomeTimer();
        successOpacity.setValue(0);
        timeoutOpacity.setValue(0);
        errorOpacity.setValue(0);

        const start = syncFillWindow({
          elapsedMs: 0,
          timeoutMs,
          progress: progressRef.current,
        });
        fillProgress.setValue(start.sliceStart);
        windowElapsed.setValue(0);
        fillOpacity.setValue(FILL_OPACITY);
        warmthRef.current = start.warmth;
        setEdgeColor(warmthColor(start.warmth, themeColorsRef.current));

        const duration = Math.max(1, timeoutMs);
        const warmthAnim = Animated.timing(windowElapsed, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: false,
        });
        const fillAnim = Animated.timing(fillProgress, {
          toValue: start.sliceEnd,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        });
        warmthAnimRef.current = warmthAnim;
        fillAnimRef.current = fillAnim;
        warmthAnim.start();
        fillAnim.start(({finished}) => {
          if (!finished || cancelled) {
            return;
          }
          fillProgress.setValue(1);
          windowElapsed.setValue(1);
          warmthRef.current = 'danger';
          setEdgeColor(warmthColor('danger', themeColorsRef.current));
          const pulse = Animated.loop(
            Animated.sequence([
              Animated.timing(fillOpacity, {
                toValue: FILL_PULSE_MAX,
                duration: PULSE_MS,
                useNativeDriver: true,
              }),
              Animated.timing(fillOpacity, {
                toValue: FILL_PULSE_MIN,
                duration: PULSE_MS,
                useNativeDriver: true,
              }),
            ]),
          );
          pulseAnimRef.current = pulse;
          pulse.start();
        });

        return () => {
          cancelled = true;
          stopFillAnims();
        };
      }

      if (wasRefreshingRef.current) {
        wasRefreshingRef.current = false;
        justFinishedRefreshRef.current = true;
        stopFillAnims();
        clearOutcomeTimer();
        const kind =
          syncFillFailureKind(syncErrorRef.current) ??
          (lastSyncFailedRef.current
            ? lastFailureKindRef.current ?? 'error'
            : null);

        if (kind === 'timeout' || kind === 'error') {
          const overlay = kind === 'timeout' ? timeoutOpacity : errorOpacity;
          Animated.parallel([
            Animated.timing(fillProgress, {
              toValue: 1,
              duration: 200,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(fillOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(overlay, {
              toValue: FAILURE_FLASH_OPACITY,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(({finished}) => {
            if (!finished || cancelled) {
              return;
            }
            Animated.timing(overlay, {
              toValue: FAILURE_PERSIST_OPACITY,
              duration: 300,
              useNativeDriver: true,
            }).start();
          });
        } else {
          Animated.parallel([
            Animated.timing(fillProgress, {
              toValue: 1,
              duration: SUCCESS_FF_MS,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(fillOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(successOpacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(({finished}) => {
            if (!finished || cancelled) {
              return;
            }
            outcomeTimerRef.current = setTimeout(() => {
              Animated.timing(successOpacity, {
                toValue: 0,
                duration: OUTCOME_FADE_MS,
                useNativeDriver: true,
              }).start(() => {
                if (!cancelled) {
                  fillProgress.setValue(0);
                }
              });
            }, SUCCESS_HOLD_MS);
          });
        }

        return () => {
          cancelled = true;
          clearOutcomeTimer();
        };
      }

      return () => {
        cancelled = true;
        clearOutcomeTimer();
      };
    }, [
      isRefreshing,
      windowKey,
      barWidth,
      timeoutMs,
      fillProgress,
      fillOpacity,
      windowElapsed,
      successOpacity,
      timeoutOpacity,
      errorOpacity,
    ]);

    useEffect(() => {
      if (isRefreshing) {
        return;
      }
      if (justFinishedRefreshRef.current) {
        justFinishedRefreshRef.current = false;
        return;
      }
      if (lastSyncFailed) {
        const kind =
          lastFailureKindRef.current ??
          syncFillFailureKind(syncErrorMessage) ??
          'error';
        if (kind === 'timeout') {
          timeoutOpacity.setValue(FAILURE_PERSIST_OPACITY);
          errorOpacity.setValue(0);
        } else {
          errorOpacity.setValue(FAILURE_PERSIST_OPACITY);
          timeoutOpacity.setValue(0);
        }
        return;
      }
      timeoutOpacity.setValue(0);
      errorOpacity.setValue(0);
    }, [
      lastSyncFailed,
      isRefreshing,
      syncErrorMessage,
      timeoutOpacity,
      errorOpacity,
    ]);

    useEffect(() => {
      const id = windowElapsed.addListener(({value}) => {
        const next = syncFillWarmth(value);
        if (next === warmthRef.current) {
          return;
        }
        warmthRef.current = next;
        setEdgeColor(warmthColor(next, themeColorsRef.current));
      });
      return () => {
        windowElapsed.removeListener(id);
      };
    }, [windowElapsed]);

    // Update "time ago" without recreating intervals every tick
    useEffect(() => {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const scheduleNext = () => {
        if (cancelled) {
          return;
        }
        const now = Date.now();
        const diff = now - latestTimestamp;
        const delay = diff < 60000 ? 1000 : 60000; // 1s if < 1 min, else 1 min
        timer = setTimeout(() => {
          setCurrentTime(Date.now());
          scheduleNext();
        }, delay);
      };

      setCurrentTime(Date.now());
      scheduleNext();

      return () => {
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
        }
      };
    }, [latestTimestamp]);
    useEffect(() => {
      const timeDiff = Date.now() - latestTimestamp;
      const isCache = usingCache || timeDiff > 60000;
      setIsUsingCache(isCache);
    }, [latestTimestamp, usingCache]);
    const getTimeAgo = (timestamp: number) => {
      if (timestamp === 0) {
        return 'No data';
      }
      const diffInSeconds = Math.floor((currentTime - timestamp) / 1000);
      if (diffInSeconds < 0) {
        return 'Just updated';
      }
      if (diffInSeconds < 10) {
        return 'Just updated';
      }
      if (diffInSeconds < 60) {
        return `${diffInSeconds} seconds ago`;
      }
      const diffInMinutes = Math.floor(diffInSeconds / 60);
      if (diffInMinutes < 60) {
        return `${diffInMinutes} ${
          diffInMinutes === 1 ? 'minute' : 'minutes'
        } ago`;
      }
      const diffInHours = Math.floor(diffInMinutes / 60);
      if (diffInHours < 24) {
        const remainingMinutes = diffInMinutes % 60;
        if (remainingMinutes === 0) {
          return `${diffInHours} ${diffInHours === 1 ? 'hour' : 'hours'} ago`;
        }
        return `${diffInHours} ${
          diffInHours === 1 ? 'hour' : 'hours'
        } ${remainingMinutes} ${
          remainingMinutes === 1 ? 'minute' : 'minutes'
        } ago`;
      }
      const diffInDays = Math.floor(diffInHours / 24);
      if (diffInDays < 7) {
        return `${diffInDays} ${diffInDays === 1 ? 'day' : 'days'} ago`;
      }
      const diffInWeeks = Math.floor(diffInDays / 7);
      if (diffInWeeks < 4) {
        return `${diffInWeeks} ${diffInWeeks === 1 ? 'week' : 'weeks'} ago`;
      }
      const diffInMonths = Math.floor(diffInDays / 30);
      if (diffInMonths < 12) {
        return `${diffInMonths} ${diffInMonths === 1 ? 'month' : 'months'} ago`;
      }
      const diffInYears = Math.floor(diffInDays / 365);
      return `${diffInYears} ${diffInYears === 1 ? 'year' : 'years'} ago`;
    };
    const timeAgo = getTimeAgo(latestTimestamp);
    const shownHealthHint =
      healthHint && !syncErrorMessage ? healthHint : null;
    const isLight = theme.colors.background === '#ffffff';
    const barBg = isRefreshing
      ? theme.colors.cardBackground
      : isLight
      ? theme.colors.background
      : theme.colors.whiteOverlay08;
    const calmColor = warmthColor('calm', theme.colors);
    const patienceColor = warmthColor('patience', theme.colors);
    const dangerColor = warmthColor('danger', theme.colors);
    const fillTranslateX =
      barWidth > 0
        ? fillProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [-barWidth, 0],
          })
        : 0;
    const fillBackground = windowElapsed.interpolate({
      inputRange: [0, 0.6, 0.9, 1],
      outputRange: [calmColor, patienceColor, dangerColor, dangerColor],
    });

    return (
      <AppPressable
        id="cacheRefresher"
        style={[
          createStyles(theme).cacheIndicator,
          styles.pressableClip,
          {backgroundColor: barBg},
        ]}
        onPress={() => {
          if (isRefreshing) {
            onAbortRequested?.();
          } else {
            onRefresh();
          }
        }}
        onLongPress={() => {
          HapticFeedback.medium();
          onLongPress?.();
        }}
        disabled={false}>
        <View
          pointerEvents="none"
          style={styles.fillClip}
          onLayout={e => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - barWidth) > 0.5) {
              setBarWidth(w);
            }
          }}>
          <Animated.View
            style={[
              styles.fillWipe,
              barWidth > 0 ? {width: barWidth} : null,
              {
                opacity: fillOpacity,
                transform: [{translateX: fillTranslateX}],
              },
            ]}>
            <Animated.View
              style={[styles.fillBody, {backgroundColor: fillBackground}]}
            />
            <LinearGradient
              pointerEvents="none"
              colors={[edgeColor, 'transparent']}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={styles.fillLeadingEdge}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.outcomeFill,
              {
                backgroundColor: theme.colors.receivedOverlay15,
                opacity: successOpacity,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.outcomeFill,
              {
                backgroundColor: theme.colors.warning,
                opacity: timeoutOpacity,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.outcomeFill,
              {
                backgroundColor: theme.colors.danger,
                opacity: errorOpacity,
              },
            ]}
          />
        </View>
        <View style={styles.indicatorBody}>
          <View style={styles.indicatorRow}>
            <View
              style={[
                createStyles(theme).refreshText,
                isRefreshing && styles.flexFill,
              ]}>
              <Image
                source={require('../assets/refresh-icon.png')}
                style={[
                  createStyles(theme).refreshIcon,
                  isRefreshing && {transform: [{rotate: '45deg'}]},
                ]}
                resizeMode="contain"
              />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
                style={{
                  color: isRefreshing
                    ? theme.colors.textSecondary
                    : syncErrorMessage
                    ? (theme.colors.warning ?? theme.colors.bitcoinOrange)
                    : theme.colors.background === '#ffffff'
                    ? theme.colors.accent
                    : theme.colors.bitcoinOrange,
                }}>
                {isRefreshing
                  ? statusMessage ?? 'Refreshing...'
                  : syncErrorMessage
                  ? syncErrorMessage
                  : lastSyncFailed
                  ? 'Tap to retry'
                  : 'Tap to refresh'}
              </Text>
              {isRefreshing && progressLabel ? (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                  style={[
                    styles.progressText,
                    {
                      color: theme.colors.textSecondary,
                      fontSize: theme.fontSizes?.xs || 11,
                      fontFamily: theme.fontFamilies?.medium,
                    },
                  ]}>
                  {progressLabel}
                </Text>
              ) : null}
            </View>
            {!isRefreshing && (
              <View style={styles.timeContainer}>
                <View style={styles.timeTextWrap}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.5}
                    style={[
                      createStyles(theme).cacheText,
                      {color: theme.colors.textSecondary},
                    ]}>
                    {latestTimestamp === 0
                      ? 'No data available'
                      : isUsingCache
                      ? `Cached • ${timeAgo}`
                      : timeAgo}
                  </Text>
                </View>
                <Image
                  source={clockIcon}
                  style={[
                    styles.clockIcon,
                    {tintColor: theme.colors.textSecondary},
                  ]}
                />
              </View>
            )}
          </View>
          {shownHealthHint ? (
            <Text
              numberOfLines={1}
              style={[
                createStyles(theme).cacheText,
                styles.healthHint,
                {color: theme.colors.textSecondary},
              ]}>
              {shownHealthHint}
            </Text>
          ) : null}
        </View>
      </AppPressable>
    );
  },
);
const styles = StyleSheet.create({
  pressableClip: {
    overflow: 'hidden',
  },
  fillClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
    overflow: 'hidden',
  },
  fillWipe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  fillBody: {
    flex: 1,
  },
  fillLeadingEdge: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: LEADING_EDGE_PX,
  },
  outcomeFill: {
    ...StyleSheet.absoluteFillObject,
  },
  indicatorBody: {
    flex: 1,
    minWidth: 0,
    zIndex: 1,
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  healthHint: {
    textAlign: 'left',
    marginTop: 2,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  timeTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  clockIcon: {
    width: 16,
    height: 16,
    marginLeft: 4,
  },
  flexFill: {
    flex: 1,
  },
  progressText: {
    marginLeft: 'auto',
    paddingLeft: 6,
  },
});
