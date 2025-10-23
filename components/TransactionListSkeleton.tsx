import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions} from 'react-native';

const {width} = Dimensions.get('window');

interface ShimmerEffectProps {
  style: any;
  translateX: Animated.AnimatedInterpolation<string | number>;
}

const ShimmerEffect: React.FC<ShimmerEffectProps> = ({
  style,
  translateX,
}) => {
  
  // Create opacity animation for shimmer effect
  const opacityValue = useMemo(() => new Animated.Value(0.3), []);
  
  React.useEffect(() => {
    const opacityAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityValue, {
          toValue: 0.8,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    opacityAnimation.start();
    return () => opacityAnimation.stop();
  }, [opacityValue]);
  
  return (
    <View style={[style, styles.shimmerWrapper]}>
      <Animated.View
        style={[styles.shimmerContainer, {transform: [{translateX}]}]}>
        <Animated.View
          style={[
            styles.gradient,
            styles.gradientBackground,
            {opacity: opacityValue}
          ]}
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
    <View style={[styles.transactionItem, styles.transactionItemBackground]}>
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
            duration: 1500,
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
    outputRange: [-width * 1.5, width * 1.5],
  });

  return (
    <View style={styles.container}>
      {[1, 2, 3].map(i => (
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
  },
  transactionItem: {
    padding: 20,
    marginVertical: 6,
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
  },
  addressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIconSkeleton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 8,
  },
  statusTextSkeleton: {
    width: 80,
    height: 18,
    borderRadius: 9,
  },
  amountSkeleton: {
    width: 140,
    height: 28,
    borderRadius: 14,
  },
  addressSkeleton: {
    flex: 1,
    height: 20,
    borderRadius: 10,
    marginRight: 12,
  },
  usdAmountSkeleton: {
    width: 90,
    height: 20,
    borderRadius: 10,
  },
  txIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkIconSkeleton: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 8,
  },
  txIdSkeleton: {
    width: 120,
    height: 16,
    borderRadius: 8,
  },
  timestampSkeleton: {
    width: 110,
    height: 16,
    borderRadius: 8,
  },
  shimmerWrapper: {
    overflow: 'hidden',
    borderRadius: 8,
  },
  shimmerContainer: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    flex: 1,
    borderRadius: 8,
  },
  transactionItemBackground: {
    backgroundColor: '#ffffff',
  },
  gradientBackground: {
    backgroundColor: '#f0f0f0',
  },
});

export default TransactionListSkeleton;
