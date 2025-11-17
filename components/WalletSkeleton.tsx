import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions, Image} from 'react-native';
import {useTheme} from '../theme';
import TransactionListSkeleton from './TransactionListSkeleton';

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

const WalletSkeleton: React.FC = () => {
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
      <View style={styles.contentContainer}>
        <View style={styles.walletHeader}>
          <View style={styles.headerTop}>
            <Image
              source={require('../assets/bitcoin-logo.png')}
              style={styles.btcLogo}
            />
            <View style={styles.priceContainer}>
              <ShimmerEffect
                style={styles.priceSkeleton}
                translateX={translateX}
              />
            </View>
          </View>
          
          <View style={styles.balanceContainer}>
            <View style={styles.balanceRow}>
              <ShimmerEffect
                style={styles.balanceSkeleton}
                translateX={translateX}
              />
            </View>
            <View style={styles.balanceRow}>
              <ShimmerEffect
                style={styles.usdSkeleton}
                translateX={translateX}
              />
            </View>
            <View style={styles.balanceHint}>
              <ShimmerEffect
                style={styles.hintSkeleton}
                translateX={translateX}
              />
            </View>
          </View>

          <View style={styles.partyContainer}>
            <View style={styles.partyItem}>
              <ShimmerEffect
                style={styles.partyLabelSkeleton}
                translateX={translateX}
              />
              <View style={styles.partyValueRow}>
                <ShimmerEffect
                  style={styles.partyIconSkeleton}
                  translateX={translateX}
                />
                <ShimmerEffect
                  style={styles.partyValueSkeleton}
                  translateX={translateX}
                />
              </View>
            </View>
            <View style={styles.partyItem}>
              <ShimmerEffect
                style={styles.partyLabelSkeleton}
                translateX={translateX}
              />
              <View style={styles.partyValueRow}>
                <ShimmerEffect
                  style={styles.partyIconSkeleton}
                  translateX={translateX}
                />
                <ShimmerEffect
                  style={styles.partyValueSkeleton}
                  translateX={translateX}
                />
              </View>
            </View>
            <View style={styles.partyItem}>
              <ShimmerEffect
                style={styles.partyLabelSkeleton}
                translateX={translateX}
              />
              <View style={styles.partyValueRow}>
                <ShimmerEffect
                  style={styles.partyIconSkeleton}
                  translateX={translateX}
                />
                <ShimmerEffect
                  style={styles.partyValueSkeleton}
                  translateX={translateX}
                />
              </View>
            </View>
          </View>

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <ShimmerEffect
                style={styles.actionIconSkeleton}
                translateX={translateX}
              />
              <ShimmerEffect
                style={styles.actionTextSkeleton}
                translateX={translateX}
              />
            </View>
            <View style={styles.actionMiddleButton}>
              <ShimmerEffect
                style={styles.actionMiddleIconSkeleton}
                translateX={translateX}
              />
            </View>
            <View style={styles.actionButton}>
              <ShimmerEffect
                style={styles.actionIconSkeleton}
                translateX={translateX}
              />
              <ShimmerEffect
                style={styles.actionTextSkeleton}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  contentContainer: {
    paddingTop: 12,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 0,
  },
  walletHeader: {
    padding: 12,
    backgroundColor: '#f0f2f5',
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 0,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  btcLogo: {
    width: 32,
    height: 32,
    resizeMode: 'contain',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priceSkeleton: {
    width: 80,
    height: 16,
    borderRadius: 4,
  },
  balanceContainer: {
    alignItems: 'center',
    width: '100%',
    paddingVertical: 4,
    marginBottom: 4,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    width: '100%',
    justifyContent: 'center',
    marginTop: 4,
  },
  balanceSkeleton: {
    width: 160,
    height: 24,
    borderRadius: 6,
  },
  usdSkeleton: {
    width: 120,
    height: 18,
    borderRadius: 6,
  },
  balanceHint: {
    marginTop: 4,
  },
  hintSkeleton: {
    width: 120,
    height: 10,
    borderRadius: 5,
  },
  partyContainer: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 8,
  },
  partyItem: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    marginHorizontal: 4,
  },
  partyLabelSkeleton: {
    width: 50,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  partyValueRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  partyIconSkeleton: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 4,
  },
  partyValueSkeleton: {
    width: 40,
    height: 12,
    borderRadius: 6,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    width: '100%',
    gap: 6,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  actionMiddleButton: {
    width: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
  },
  actionIconSkeleton: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  actionTextSkeleton: {
    width: 40,
    height: 14,
    borderRadius: 7,
  },
  actionMiddleIconSkeleton: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  shimmerWrapper: {
    overflow: 'hidden',
    borderRadius: 4,
  },
  shimmerContainer: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    flex: 1,
    backgroundColor: '#e9ecef',
  },
});

export default WalletSkeleton;
