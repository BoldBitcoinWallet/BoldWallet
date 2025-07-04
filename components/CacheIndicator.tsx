import React, {useEffect, useState, useRef, forwardRef, useImperativeHandle} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Animated,
  StyleSheet,
} from 'react-native';
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
  theme: any;
  isRefreshing?: boolean;
}

export interface CacheIndicatorHandle {
  press: () => void;
}

export const CacheIndicator = forwardRef<CacheIndicatorHandle, CacheIndicatorProps>(
  ({timestamps, onRefresh, theme, isRefreshing = false}, ref) => {
    const latestTimestamp = Math.max(timestamps.price, timestamps.balance);
    const shimmerValue = useRef(new Animated.Value(-100)).current;
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [isUsingCache, setIsUsingCache] = useState(false);

    // Expose a press() method to parent
    useImperativeHandle(ref, () => ({
      press: () => {
        if (!isRefreshing) {
          HapticFeedback.medium();
          onRefresh();
        }
      },
    }), [onRefresh, isRefreshing]);

    useEffect(() => {
      if (isRefreshing) {
        Animated.loop(
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
        ).start();
      } else {
        shimmerValue.setValue(-100);
      }
    }, [isRefreshing, shimmerValue]);

    // Update current time based on time difference
    useEffect(() => {
      const timeDiff = currentTime - latestTimestamp;
      const interval = timeDiff < 60000 ? 1000 : 60000; // 1 second if < 1 minute, else 1 minute

      const timer = setInterval(() => {
        setCurrentTime(Date.now());
      }, interval);

      return () => clearInterval(timer);
    }, [latestTimestamp, currentTime]);

    // Check if we're using cache
    useEffect(() => {
      const timeDiff = Date.now() - latestTimestamp;
      const isCache = timeDiff > 60000; // More than 1 minute old
      setIsUsingCache(isCache);
    }, [latestTimestamp]);

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
      <TouchableOpacity
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
          HapticFeedback.medium();
          onRefresh();
        }}
        disabled={isRefreshing}>
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
        <View style={createStyles(theme).refreshText}>
          <Image
            source={require('../assets/refresh-icon.png')}
            style={[
              createStyles(theme).refreshIcon,
              isRefreshing && {transform: [{rotate: '45deg'}]},
            ]}
            resizeMode="contain"
          />
          <Text
            style={{
              color: isRefreshing
                ? theme.colors.textSecondary
                : theme.colors.accent,
            }}>
            {isRefreshing
              ? 'Refreshing...'
              : latestTimestamp === 0
              ? 'Tap to load data'
              : isUsingCache
              ? 'Tap to refresh data'
              : 'Tap to refresh'}
          </Text>
        </View>
        {!isRefreshing && (
          <View style={styles.timeContainer}>
            <Text
              style={[
                createStyles(theme).cacheText,
                {color: theme.colors.textSecondary},
              ]}>
              {latestTimestamp === 0 ? (
                'No data available'
              ) : isUsingCache ? (
                <>📱 Cached • {new Date(latestTimestamp).toLocaleTimeString()}</>
              ) : (
                timeAgo
              )}
            </Text>
            <Image source={clockIcon} style={styles.clockIcon} />
          </View>
        )}
      </TouchableOpacity>
    );
  }
);

const styles = StyleSheet.create({
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clockIcon: {
    width: 16,
    height: 16,
    marginLeft: 4,
  },
});
