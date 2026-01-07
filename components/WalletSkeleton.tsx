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
          {/* Party Container - Device, Sign PSBT, Address Type */}
          <View style={[styles.partyContainer, styles.rowFullWidth]}>
            <View
              style={[styles.addressTypeContainer, styles.flexOneMinWidthZero]}>
              <View style={styles.columnCenter}>
                <ShimmerEffect
                  style={skeletonStyles.partyLabelSkeleton}
                  translateX={translateX}
                />
                <View style={styles.rowCenterMarginTop2}>
                  <ShimmerEffect
                    style={skeletonStyles.partyIconSkeleton}
                    translateX={translateX}
                  />
                  <ShimmerEffect
                    style={skeletonStyles.partyValueSkeleton}
                    translateX={translateX}
                  />
                </View>
              </View>
            </View>
            <View
              style={[styles.addressTypeContainer, styles.flexOneMinWidthZero]}>
              <View style={styles.columnCenter}>
                <ShimmerEffect
                  style={skeletonStyles.partyLabelSkeleton}
                  translateX={translateX}
                />
                <View style={styles.rowCenterMarginTop2}>
                  <ShimmerEffect
                    style={skeletonStyles.partyIconSkeleton}
                    translateX={translateX}
                  />
                  <ShimmerEffect
                    style={skeletonStyles.partyValueSkeleton}
                    translateX={translateX}
                  />
                </View>
              </View>
            </View>
            <View
              style={[styles.addressTypeContainer, styles.flexOneMinWidthZero]}>
              <View style={styles.columnCenter}>
                <ShimmerEffect
                  style={skeletonStyles.partyLabelSkeleton}
                  translateX={translateX}
                />
                <View style={styles.rowCenterMarginTop2}>
                  <ShimmerEffect
                    style={skeletonStyles.partyIconSkeleton}
                    translateX={translateX}
                  />
                  <ShimmerEffect
                    style={skeletonStyles.partyValueSkeleton}
                    translateX={translateX}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Balance Container */}
          <View style={styles.balanceContainer}>
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
      <TransactionListSkeleton />
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
  partyLabelSkeleton: {
    width: 50,
    height: 10,
    borderRadius: 5,
    marginBottom: 4,
  },
  partyIconSkeleton: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 4,
  },
  partyValueSkeleton: {
    width: 60,
    height: 14,
    borderRadius: 7,
  },
  balanceSkeleton: {
    width: 180,
    height: 28,
    borderRadius: 6,
  },
  usdSkeleton: {
    width: 140,
    height: 20,
    borderRadius: 6,
  },
  actionIconSkeleton: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  actionTextSkeleton: {
    width: 50,
    height: 16,
    borderRadius: 8,
  },
  actionMiddleIconSkeleton: {
    width: 24,
    height: 24,
    borderRadius: 12,
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
