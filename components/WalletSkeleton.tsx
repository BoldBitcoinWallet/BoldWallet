import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions, Image} from 'react-native';
import {useTheme} from '../theme';
import LinearGradient from 'react-native-linear-gradient';
import TransactionListSkeleton from './TransactionListSkeleton';

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
          colors={[
            backgroundColor,
            theme.colors.disabled,
            theme.colors.border,
            theme.colors.disabled,
            backgroundColor,
          ]}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          style={styles.gradient}
        />
      </Animated.View>
    </View>
  );
};

const WalletSkeleton: React.FC = () => {
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
      <View style={[styles.header, {backgroundColor: theme.colors.primary}]}>
        <View style={styles.headerTop}>
          <Image
            source={require('../assets/bitcoin-logo.png')}
            style={styles.btcLogo}
          />
          <ShimmerEffect
            style={styles.priceSkeleton}
            translateX={translateX}
            backgroundColor={theme.colors.accent}
          />
        </View>
        <ShimmerEffect
          style={styles.balanceSkeleton}
          translateX={translateX}
          backgroundColor={theme.colors.cardBackground}
        />
        <ShimmerEffect
          style={styles.usdSkeleton}
          translateX={translateX}
          backgroundColor={theme.colors.cardBackground}
        />
        <View style={styles.actions}>
          <ShimmerEffect
            style={styles.actionButton}
            translateX={translateX}
            backgroundColor={theme.colors.accent}
          />
          <ShimmerEffect
            style={styles.actionMiddleButton}
            translateX={translateX}
            backgroundColor={theme.colors.cardBackground}
          />
          <ShimmerEffect
            style={styles.actionButton}
            translateX={translateX}
            backgroundColor={theme.colors.secondary}
          />
        </View>
      </View>
      <TransactionListSkeleton />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderRadius: 16,
    margin: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 1,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btcLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  priceSkeleton: {
    width: 100,
    height: 24,
    borderRadius: 8,
  },
  balanceSkeleton: {
    width: 180,
    height: 32,
    borderRadius: 8,
    marginTop: 16,
    alignSelf: 'center',
  },
  usdSkeleton: {
    width: 140,
    height: 24,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  actionMiddleButton: {
    flex: 1,
    height: 48,
    maxWidth: 48,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  transactionsContainer: {
    padding: 16,
  },
  transactionSkeleton: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 0.05,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 0.05},
    shadowOpacity: 0.01,
    shadowRadius: 0.1,
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
    borderRadius: 6,
  },
  amountSkeleton: {
    width: 120,
    height: 24,
    borderRadius: 6,
  },
  addressSkeleton: {
    flex: 1,
    height: 18,
    borderRadius: 6,
    marginRight: 8,
  },
  usdAmountSkeleton: {
    width: 80,
    height: 18,
    borderRadius: 6,
  },
  txIdSkeleton: {
    width: 140,
    height: 16,
    borderRadius: 6,
  },
  timestampSkeleton: {
    width: 100,
    height: 16,
    borderRadius: 6,
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

export default WalletSkeleton;
