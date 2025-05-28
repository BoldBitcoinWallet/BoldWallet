import React from 'react';
import {View, StyleSheet, Animated} from 'react-native';
import {useTheme} from '../theme';

const WalletSkeleton: React.FC = () => {
  const {theme} = useTheme();
  const animatedValue = new Animated.Value(0);

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={styles.container}>
      <View style={[styles.header, {backgroundColor: theme.colors.primary}]}>
        <View style={styles.headerTop}>
          <Animated.View
            style={[
              styles.btcLogo,
              {backgroundColor: theme.colors.background, opacity},
            ]}
          />
          <Animated.View
            style={[
              styles.priceSkeleton,
              {backgroundColor: theme.colors.background, opacity},
            ]}
          />
        </View>
        <Animated.View
          style={[
            styles.balanceSkeleton,
            {backgroundColor: theme.colors.background, opacity},
          ]}
        />
        <Animated.View
          style={[
            styles.usdSkeleton,
            {backgroundColor: theme.colors.background, opacity},
          ]}
        />
        <View style={styles.actions}>
          <Animated.View
            style={[
              styles.actionButton,
              {backgroundColor: theme.colors.background, opacity},
            ]}
          />
          <Animated.View
            style={[
              styles.actionButton,
              {backgroundColor: theme.colors.background, opacity},
            ]}
          />
          <Animated.View
            style={[
              styles.actionButton,
              {backgroundColor: theme.colors.background, opacity},
            ]}
          />
        </View>
      </View>
      <View style={styles.transactionsContainer}>
        {[1, 2, 3, 4, 5].map(i => (
          <Animated.View
            key={i}
            style={[
              styles.transactionSkeleton,
              {backgroundColor: theme.colors.cardBackground, opacity},
            ]}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderRadius: 8,
    margin: 16,
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
    borderRadius: 4,
  },
  balanceSkeleton: {
    width: 200,
    height: 32,
    borderRadius: 4,
    marginTop: 16,
    alignSelf: 'center',
  },
  usdSkeleton: {
    width: 150,
    height: 24,
    borderRadius: 4,
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
  transactionsContainer: {
    padding: 16,
  },
  transactionSkeleton: {
    height: 72,
    borderRadius: 8,
    marginBottom: 12,
  },
});

export default WalletSkeleton;
