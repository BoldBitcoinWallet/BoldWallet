import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions} from 'react-native';
import {useTheme} from '../theme';

const {width} = Dimensions.get('window');

interface ShimmerEffectProps {
  style: any;
  translateX: Animated.AnimatedInterpolation<string | number>;
}

const ShimmerEffect: React.FC<ShimmerEffectProps & {dynamicStyles?: any}> = ({
  style,
  translateX,
  dynamicStyles,
}) => {
  const {theme} = useTheme();
  const isDarkMode = theme.colors.background !== '#ffffff';
  const shimmerColor = isDarkMode
    ? theme.colors.disabled + '60'
    : '#e9ecef';

  return (
    <View style={[style, styles.shimmerWrapper]}>
      <Animated.View
        style={[styles.shimmerContainer, {transform: [{translateX}]}]}>
        <View
          style={[
            dynamicStyles?.gradient || styles.gradient,
            {backgroundColor: shimmerColor},
          ]}
        />
      </Animated.View>
    </View>
  );
};

interface TransactionSkeletonItemProps {
  translateX: Animated.AnimatedInterpolation<string | number>;
  dynamicStyles?: any;
}

const TransactionSkeletonItem: React.FC<TransactionSkeletonItemProps> = ({
  translateX,
  dynamicStyles,
}) => {
  return (
    <View style={dynamicStyles?.transactionItem || styles.transactionItem}>
      {/* Top row with status and amount */}
      <View style={styles.transactionRow}>
        <View style={styles.statusContainer}>
          <ShimmerEffect
            style={styles.statusIconSkeleton}
            translateX={translateX}
            dynamicStyles={dynamicStyles}
          />
          <ShimmerEffect
            style={styles.statusTextSkeleton}
            translateX={translateX}
            dynamicStyles={dynamicStyles}
          />
        </View>
        <ShimmerEffect
          style={styles.amountSkeleton}
          translateX={translateX}
          dynamicStyles={dynamicStyles}
        />
      </View>

      {/* Address row */}
      <View style={styles.addressRow}>
        <ShimmerEffect
          style={styles.addressSkeleton}
          translateX={translateX}
          dynamicStyles={dynamicStyles}
        />
        <ShimmerEffect
          style={styles.usdAmountSkeleton}
          translateX={translateX}
          dynamicStyles={dynamicStyles}
        />
      </View>

      {/* Bottom row with transaction ID and timestamp */}
      <View style={styles.transactionRow}>
        <View style={styles.txIdContainer}>
          <ShimmerEffect
            style={styles.linkIconSkeleton}
            translateX={translateX}
            dynamicStyles={dynamicStyles}
          />
          <ShimmerEffect
            style={styles.txIdSkeleton}
            translateX={translateX}
            dynamicStyles={dynamicStyles}
          />
        </View>
        <ShimmerEffect
          style={styles.timestampSkeleton}
          translateX={translateX}
          dynamicStyles={dynamicStyles}
        />
      </View>
    </View>
  );
};

const TransactionListSkeleton: React.FC = () => {
  const {theme} = useTheme();
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

  // Ensure we never use white background in dark mode
  const isDarkMode =
    theme.colors.background === '#121212' ||
    theme.colors.background.includes('12');
  const containerBg = isDarkMode
    ? theme.colors.background
    : theme.colors.background;
  const itemBg = isDarkMode ? theme.colors.cardBackground : '#ffffff';
  const borderColor = isDarkMode
    ? theme.colors.border + '40'
    : theme.colors.blackOverlay03;
  const shimmerColor = isDarkMode
    ? theme.colors.disabled + '60'
    : '#e9ecef';

  const dynamicStyles = {
    container: {
      ...styles.container,
      backgroundColor: containerBg,
    },
    transactionItem: {
      ...styles.transactionItem,
      backgroundColor: itemBg,
      borderColor: borderColor,
    },
    gradient: {
      ...styles.gradient,
      backgroundColor: shimmerColor,
    },
  };

  return (
    <View style={dynamicStyles.container}>
      {[1, 2, 3, 4].map(i => (
        <TransactionSkeletonItem
          key={i}
          translateX={translateX}
          dynamicStyles={dynamicStyles}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 0,
    // backgroundColor will be set dynamically based on theme
  },
  transactionItem: {
    padding: 16,
    marginVertical: 4,
    borderRadius: 12,
    // backgroundColor and borderColor will be set dynamically based on theme
    borderWidth: 1,
    // borderColor will be set dynamically
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  addressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIconSkeleton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginRight: 6,
  },
  statusTextSkeleton: {
    width: 70,
    height: 16,
    borderRadius: 8,
  },
  amountSkeleton: {
    width: 120,
    height: 24,
    borderRadius: 12,
  },
  addressSkeleton: {
    flex: 1,
    height: 18,
    borderRadius: 9,
    marginRight: 10,
  },
  usdAmountSkeleton: {
    width: 80,
    height: 18,
    borderRadius: 9,
  },
  txIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkIconSkeleton: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 6,
  },
  txIdSkeleton: {
    width: 100,
    height: 14,
    borderRadius: 7,
  },
  timestampSkeleton: {
    width: 90,
    height: 14,
    borderRadius: 7,
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

export default TransactionListSkeleton;
