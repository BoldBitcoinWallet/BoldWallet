import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions} from 'react-native';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import TransactionListSkeleton from './TransactionListSkeleton';
const {width} = Dimensions.get('window');
interface ShimmerEffectProps {
  style: any;
  translateX: Animated.AnimatedInterpolation<string | number>;
}
const ShimmerEffect: React.FC<ShimmerEffectProps> = ({style, translateX}) => {
  const {theme} = useTheme();
  const isDarkMode = theme.colors.background !== '#ffffff';
  const shimmerColor = isDarkMode
    ? theme.colors.disabled + '60'
    : '#e9ecef';
  return (
    <View style={[style, skeletonStyles.shimmerWrapper]}>
      <Animated.View
        style={[
          skeletonStyles.shimmerContainer,
          {transform: [{translateX}]},
        ]}>
        <View
          style={[
            skeletonStyles.gradient,
            {backgroundColor: shimmerColor},
          ]}
        />
      </Animated.View>
    </View>
  );
};
const WalletSkeleton: React.FC = () => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const animatedValue = useMemo(() => new Animated.Value(0), []);
  React.useEffect(() => {
    const startAnimation = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    };
    startAnimation();
    return () => {
      animatedValue.stopAnimation();
    };
  }, [animatedValue]);
  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 1.2, width * 1.2],
  });
  // Always use theme background - never white in dark mode
  const containerBgColor = theme.colors.background;
  return (
    <View
      style={[skeletonStyles.container, {backgroundColor: containerBgColor}]}>
      <View style={styles.contentContainer}>
        <View
          style={[styles.walletHeader, skeletonStyles.walletHeaderOverride]}>
          {/* Balance Container - matches WalletHome header order */}
          <View style={styles.balanceContainer}>
            {/* Eye icon placeholder on left */}
            <View style={styles.balanceEyeIcon}>
              <ShimmerEffect
                style={skeletonStyles.eyeIconSkeleton}
                translateX={translateX}
              />
            </View>
            {/* Balance content in center */}
            <View style={styles.balanceContentContainer}>
              <View style={styles.balanceRowWithMargin}>
                <ShimmerEffect
                  style={skeletonStyles.balanceSkeleton}
                  translateX={translateX}
                />
              </View>
              <View style={styles.balanceRowWithMargin}>
                <ShimmerEffect
                  style={skeletonStyles.usdSkeleton}
                  translateX={translateX}
                />
              </View>
            </View>
            {/* Unit toggle placeholder on right */}
            <View style={styles.balanceUnitToggleContainer}>
              <View style={styles.balanceUnitToggle}>
                <ShimmerEffect
                  style={skeletonStyles.unitToggleSkeleton}
                  translateX={translateX}
                />
              </View>
            </View>
          </View>
          {/* Action Buttons */}
          <View style={styles.actions} collapsable={false}>
            <View
              style={[
                styles.actionButton,
                styles.sendButton,
                styles.flexOneMinWidthZero,
              ]}>
              <ShimmerEffect
                style={skeletonStyles.actionIconSkeleton}
                translateX={translateX}
              />
              <ShimmerEffect
                style={skeletonStyles.actionTextSkeleton}
                translateX={translateX}
              />
            </View>
            <View style={[styles.addressTypeModalButton]}>
              <ShimmerEffect
                style={skeletonStyles.actionMiddleIconSkeleton}
                translateX={translateX}
              />
            </View>
            <View
              style={[
                styles.actionButton,
                styles.receiveButton,
                styles.flexOneMinWidthZero,
              ]}>
              <ShimmerEffect
                style={skeletonStyles.actionIconSkeleton}
                translateX={translateX}
              />
              <ShimmerEffect
                style={skeletonStyles.actionTextSkeleton}
                translateX={translateX}
              />
            </View>
          </View>
        </View>
      </View>
      {/* Cache Indicator Skeleton */}
      <View style={styles.cacheIndicator}>
        <View style={styles.refreshText}>
          <ShimmerEffect
            style={skeletonStyles.refreshIconSkeleton}
            translateX={translateX}
          />
          <ShimmerEffect
            style={skeletonStyles.refreshTextSkeleton}
            translateX={translateX}
          />
        </View>
        <View style={skeletonStyles.timeContainer}>
          <ShimmerEffect
            style={skeletonStyles.cacheTextSkeleton}
            translateX={translateX}
          />
          <ShimmerEffect
            style={skeletonStyles.clockIconSkeleton}
            translateX={translateX}
          />
        </View>
      </View>
      {/* Transaction List Container - match spacing from WalletHome */}
      <View style={styles.transactionListContainer}>
        <TransactionListSkeleton noContainerPadding={true} />
      </View>
    </View>
  );
};
const skeletonStyles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor will be set dynamically based on theme
  },
  walletHeaderOverride: {
    elevation: 0,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  balanceSkeleton: {
    width: 180,
    height: 29, // Match lineHeight from balanceBTC (24 * 1.2 = 28.8, rounded to 29)
    borderRadius: 6,
  },
  usdSkeleton: {
    width: 140,
    height: 19, // Match lineHeight from balanceFiat (16 * 1.2 = 19.2, rounded to 19)
    borderRadius: 6,
  },
  actionIconSkeleton: {
    width: 18, // Match actionButtonIcon width
    height: 18, // Match actionButtonIcon height
    borderRadius: 9,
  },
  actionTextSkeleton: {
    width: 50,
    height: 14, // Match actionButtonText fontSize (base = 14)
    borderRadius: 7,
  },
  actionMiddleIconSkeleton: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  eyeIconSkeleton: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  unitToggleSkeleton: {
    width: 30,
    height: 14,
    borderRadius: 7,
  },
  refreshIconSkeleton: {
    width: 16, // Match refreshIcon width
    height: 16, // Match refreshIcon height
    borderRadius: 8,
    marginRight: 6, // Match gap from refreshText
  },
  refreshTextSkeleton: {
    width: 120, // Approximate width for "Tap to refresh"
    height: 14, // Match refreshText fontSize (base = 14)
    borderRadius: 7,
  },
  cacheTextSkeleton: {
    width: 100, // Approximate width for time text
    height: 13, // Match cacheText fontSize (base = 13)
    borderRadius: 6.5,
    marginRight: 4, // Match clockIcon marginLeft
  },
  clockIconSkeleton: {
    width: 16, // Match clockIcon width
    height: 16, // Match clockIcon height
    borderRadius: 8,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shimmerWrapper: {
    overflow: 'hidden',
    borderRadius: 6,
  },
  shimmerContainer: {
    width: '200%', // Wider container for smoother effect on Android
    height: '100%',
  },
  gradient: {
    flex: 1,
    width: '50%', // Half of the container width for smoother gradient
    height: '100%',
    // Background color will be set dynamically
  },
});
export default WalletSkeleton;
