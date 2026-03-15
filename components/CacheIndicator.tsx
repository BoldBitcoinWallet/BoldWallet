import React, {
  useEffect,
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {View, Text, Image, Animated, StyleSheet} from 'react-native';
import AppPressable from './AppPressable';
import {createStyles} from './Styles';
import {HapticFeedback} from '../utils';
export interface CacheTimestamp {
  price: number;
  balance: number;
}
// Add clock icon import
const clockIcon = require('../assets/clock-icon.png');
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
  /** When isRefreshing and set, append " current/total" (e.g. "Fetching balance… 3/5"). */
  progress?: {current: number; total: number};
  /** Temporary message after sync failure (e.g. "Sync failed — cached data"); parent clears after ~4s. */
  syncErrorMessage?: string | null;
  /** When true and not refreshing, show "Tap to retry" instead of "Tap to refresh". */
  lastSyncFailed?: boolean;
}
export interface CacheIndicatorHandle {
  press: () => void;
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
    },
    ref,
  ) => {
    const latestTimestamp = Math.max(timestamps.price, timestamps.balance);
    const shimmerValue = useRef(new Animated.Value(-100)).current;
    const shimmerAnimationRef = useRef<Animated.CompositeAnimation | null>(
      null,
    );
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [isUsingCache, setIsUsingCache] = useState(false);
    // Expose a press() method to parent
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
      // Stop any prior loop (prevents stacked animations on rapid toggles)
      shimmerAnimationRef.current?.stop?.();
      shimmerAnimationRef.current = null;

      if (isRefreshing) {
        const anim = Animated.loop(
          Animated.sequence([
            Animated.timing(shimmerValue, {
              toValue: 100,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(shimmerValue, {
              toValue: -100,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        );
        shimmerAnimationRef.current = anim;
        anim.start();
      } else {
        shimmerValue.setValue(-100);
      }

      return () => {
        shimmerAnimationRef.current?.stop?.();
        shimmerAnimationRef.current = null;
      };
    }, [isRefreshing, shimmerValue]);

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

      // Ensure we render with a fresh "now" when timestamps change
      setCurrentTime(Date.now());
      scheduleNext();

      return () => {
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
        }
      };
    }, [latestTimestamp]);
    // Check if we're using cache
    useEffect(() => {
      const timeDiff = Date.now() - latestTimestamp;
      const isCache = usingCache || timeDiff > 60000; // Explicit or older than 1 minute
      setIsUsingCache(isCache);
    }, [latestTimestamp, usingCache]);
    const getTimeAgo = (timestamp: number) => {
      // Handle case when timestamp is 0
      if (timestamp === 0) {
        return 'No data';
      }
      const diffInSeconds = Math.floor((currentTime - timestamp) / 1000);
      // Handle edge cases
      if (diffInSeconds < 0) {
        return 'Just updated';
      }
      // Less than 10 seconds
      if (diffInSeconds < 10) {
        return 'Just updated';
      }
      // Less than a minute
      if (diffInSeconds < 60) {
        return `${diffInSeconds} seconds ago`;
      }
      // Less than an hour
      const diffInMinutes = Math.floor(diffInSeconds / 60);
      if (diffInMinutes < 60) {
        return `${diffInMinutes} ${
          diffInMinutes === 1 ? 'minute' : 'minutes'
        } ago`;
      }
      // Less than a day
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
      // Less than a week
      const diffInDays = Math.floor(diffInHours / 24);
      if (diffInDays < 7) {
        return `${diffInDays} ${diffInDays === 1 ? 'day' : 'days'} ago`;
      }
      // Less than a month
      const diffInWeeks = Math.floor(diffInDays / 7);
      if (diffInWeeks < 4) {
        return `${diffInWeeks} ${diffInWeeks === 1 ? 'week' : 'weeks'} ago`;
      }
      // Less than a year
      const diffInMonths = Math.floor(diffInDays / 30);
      if (diffInMonths < 12) {
        return `${diffInMonths} ${diffInMonths === 1 ? 'month' : 'months'} ago`;
      }
      // Years
      const diffInYears = Math.floor(diffInDays / 365);
      return `${diffInYears} ${diffInYears === 1 ? 'year' : 'years'} ago`;
    };
    const timeAgo = getTimeAgo(latestTimestamp);
    return (
      <AppPressable
        id="cacheRefresher"
        style={[
          createStyles(theme).cacheIndicator,
          {
            backgroundColor: isRefreshing
              ? theme.colors.cardBackground
              : theme.colors.background,
          },
          isRefreshing && createStyles(theme).disabled,
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
        {isRefreshing && (
          <View style={createStyles(theme).shimmerContainer}>
            <Animated.View
              style={[
                createStyles(theme).shimmer,
                {
                  transform: [{translateX: shimmerValue}],
                },
              ]}
            />
          </View>
        )}
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
          {isRefreshing && progress ? (
            <Text
              style={[
                styles.progressText,
                {
                  color: theme.colors.textSecondary,
                  fontSize: theme.fontSizes?.xs || 11,
                  fontFamily: theme.fontFamilies?.medium,
                },
              ]}>
              {progress.current}/{progress.total}
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
      </AppPressable>
    );
  },
);
const styles = StyleSheet.create({
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
