import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions} from 'react-native';
import {useTheme} from '../theme';

const {width} = Dimensions.get('window');

interface ShimmerEffectProps {
  style: any;
  translateX: Animated.AnimatedInterpolation<string | number>;
}

const ShimmerEffect: React.FC<ShimmerEffectProps> = ({
  style,
  translateX,
}) => {
  const {theme} = useTheme();
  
  return (
    <View style={[style, styles.shimmerWrapper]}>
      <Animated.View
        style={[styles.shimmerContainer, {transform: [{translateX}]}]}>
        <View
          style={[styles.gradient, {backgroundColor: theme.colors.background}]}
        />
      </Animated.View>
    </View>
  );
};

interface TransactionSkeletonItemProps {
  translateX: Animated.AnimatedInterpolation<string | number>;
}

const TransactionSkeletonItem: React.FC<TransactionSkeletonItemProps> = ({
  translateX,
}) => {
  
  return (
    <View style={styles.transactionItem}>
      {/* Top row with status and amount */}
      <View style={styles.transactionRow}>
        <View style={styles.statusContainer}>
          <ShimmerEffect
            style={styles.statusIconSkeleton}
            translateX={translateX}
          />
          <ShimmerEffect
            style={styles.statusTextSkeleton}
            translateX={translateX}
          />
        </View>
        <ShimmerEffect
          style={styles.amountSkeleton}
          translateX={translateX}
        />
      </View>
      
      {/* Address row */}
      <View style={styles.addressRow}>
        <ShimmerEffect
          style={styles.addressSkeleton}
          translateX={translateX}
        />
        <ShimmerEffect
          style={styles.usdAmountSkeleton}
          translateX={translateX}
        />
      </View>
      
      {/* Bottom row with transaction ID and timestamp */}
      <View style={styles.transactionRow}>
        <View style={styles.txIdContainer}>
          <ShimmerEffect
            style={styles.linkIconSkeleton}
            translateX={translateX}
          />
          <ShimmerEffect
            style={styles.txIdSkeleton}
            translateX={translateX}
          />
        </View>
        <ShimmerEffect
          style={styles.timestampSkeleton}
          translateX={translateX}
        />
      </View>
    </View>
  );
};

const TransactionListSkeleton: React.FC = () => {
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

  return (
    <View style={styles.container}>
      {[1, 2, 3, 4].map(i => (
        <TransactionSkeletonItem
          key={i}
          translateX={translateX}
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
    backgroundColor: '#ffffff',
  },
  transactionItem: {
    padding: 16,
    marginVertical: 4,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
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
    width: '100%',
    height: '100%',
  },
  gradient: {
    flex: 1,
    borderRadius: 6,
    backgroundColor: '#e9ecef',
  },
});

export default TransactionListSkeleton;
