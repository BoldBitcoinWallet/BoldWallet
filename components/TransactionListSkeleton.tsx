import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions} from 'react-native';
import {useTheme} from '../theme';
import LinearGradient from 'react-native-linear-gradient';

const {width} = Dimensions.get('window');

interface ShimmerEffectProps {
  style: any;
  translateX: Animated.AnimatedInterpolation<string | number>;
  backgroundColor: string;
}

const ShimmerEffect: React.FC<ShimmerEffectProps> = ({
  style,
  translateX,
  backgroundColor,
}) => {
  const {theme} = useTheme();
  const background = {overflow: 'hidden', backgroundColor};
  return (
    <View style={[style, styles.shimmerWrapper, background]}>
      <Animated.View
        style={[styles.shimmerContainer, {transform: [{translateX}]}]}>
        <LinearGradient
          colors={[backgroundColor, theme.colors.border, backgroundColor]}
          start={{x: 1, y: 0}}
          end={{x: 0, y: 0}}
          style={styles.gradient}
        />
      </Animated.View>
    </View>
  );
};

interface TransactionSkeletonItemProps {
  translateX: Animated.AnimatedInterpolation<string | number>;
  backgroundColor: string;
}

const TransactionSkeletonItem: React.FC<TransactionSkeletonItemProps> = ({
  translateX,
  backgroundColor,
}) => (
  <View style={[styles.transactionItem, {backgroundColor}]}>
    <View style={styles.transactionRow}>
      <ShimmerEffect
        style={styles.statusSkeleton}
        translateX={translateX}
        backgroundColor={backgroundColor}
      />
      <ShimmerEffect
        style={styles.amountSkeleton}
        translateX={translateX}
        backgroundColor={backgroundColor}
      />
    </View>
    <View style={styles.addressRow}>
      <ShimmerEffect
        style={styles.addressSkeleton}
        translateX={translateX}
        backgroundColor={backgroundColor}
      />
      <ShimmerEffect
        style={styles.usdAmountSkeleton}
        translateX={translateX}
        backgroundColor={backgroundColor}
      />
    </View>
    <View style={styles.transactionRow}>
      <ShimmerEffect
        style={styles.txIdSkeleton}
        translateX={translateX}
        backgroundColor={backgroundColor}
      />
      <ShimmerEffect
        style={styles.timestampSkeleton}
        translateX={translateX}
        backgroundColor={backgroundColor}
      />
    </View>
  </View>
);

const TransactionListSkeleton: React.FC = () => {
  const {theme} = useTheme();
  const animatedValue = useMemo(() => new Animated.Value(0), []);

  React.useEffect(() => {
    const startAnimation = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: 2000,
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
    outputRange: [-width * 2, width * 2],
  });

  return (
    <View style={styles.container}>
      {[1, 2, 3].map(i => (
        <TransactionSkeletonItem
          key={i}
          translateX={translateX}
          backgroundColor={theme.colors.cardBackground}
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
    padding: 16,
    marginVertical: 8,
    borderRadius: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 1,
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
    marginVertical: 4,
  },
  statusSkeleton: {
    width: 100,
    height: 20,
    borderRadius: 4,
  },
  amountSkeleton: {
    width: 120,
    height: 24,
    borderRadius: 4,
  },
  addressSkeleton: {
    flex: 1,
    height: 18,
    borderRadius: 4,
    marginRight: 8,
  },
  usdAmountSkeleton: {
    width: 80,
    height: 18,
    borderRadius: 4,
  },
  txIdSkeleton: {
    width: 140,
    height: 16,
    borderRadius: 4,
  },
  timestampSkeleton: {
    width: 100,
    height: 16,
    borderRadius: 4,
  },
  shimmerWrapper: {
    overflow: 'hidden',
  },
  shimmerContainer: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    flex: 1,
  },
});

export default TransactionListSkeleton;
