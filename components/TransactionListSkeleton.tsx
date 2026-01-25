import React, {useMemo} from 'react';
import {View, StyleSheet, Animated, Dimensions, Platform} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
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
        <View style={styles.addressContainer}>
          <ShimmerEffect
            style={styles.addressSkeleton}
            translateX={translateX}
            dynamicStyles={dynamicStyles}
          />
        </View>
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
interface TransactionListSkeletonProps {
  /** If true, removes container padding (used when wrapped in transactionListContainer) */
  noContainerPadding?: boolean;
}

const TransactionListSkeleton: React.FC<TransactionListSkeletonProps> = ({
  noContainerPadding = false,
}) => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
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
  // Match the exact styling from TransactionList
  const isDarkMode = theme.colors.background === '#ffffff' ? false : true;
  const itemBg = isDarkMode ? theme.colors.cardBackground : '#ffffff';
  const borderColor = isDarkMode
    ? theme.colors.border + '40'
    : theme.colors.blackOverlay05;
  const shimmerColor = isDarkMode
    ? theme.colors.disabled + '60'
    : '#e9ecef';
  const dynamicStyles = {
    container: {
      ...styles.container,
      backgroundColor: theme.colors.background,
    },
    transactionItem: {
      ...styles.transactionItem,
      backgroundColor: itemBg,
      borderColor: borderColor,
      elevation: 1,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.05,
      shadowRadius: 1,
    },
    gradient: {
      ...styles.gradient,
      backgroundColor: shimmerColor,
    },
  };
  // Match the safe area style from TransactionList (only if not wrapped)
  const safeAreaStyle = noContainerPadding
    ? {}
    : {
        paddingTop: Platform.OS === 'android' ? 0 : insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      };
  return (
    <View style={[dynamicStyles.container, safeAreaStyle]}>
      <View style={styles.listContent}>
        {[1, 2, 3, 4].map(i => (
          <TransactionSkeletonItem
            key={i}
            translateX={translateX}
            dynamicStyles={dynamicStyles}
          />
        ))}
      </View>
    </View>
  );
};
const styles = StyleSheet.create({
  container: {
    flex: 1,
    // No horizontal padding - matches TransactionList container
    // No margin - spacing handled by parent transactionListContainer
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 20, // Match listContent paddingBottom from TransactionList
    // No horizontal padding - items are full width
  },
  transactionItem: {
    padding: 10, // Match TransactionList transactionItem padding
    marginVertical: 3, // Match TransactionList transactionItem marginVertical
    borderRadius: 10, // Match TransactionList transactionItem borderRadius
    borderWidth: 1,
    // backgroundColor and borderColor set dynamically
    // elevation and shadow set dynamically
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2, // Match TransactionList transactionRow marginVertical
  },
  addressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2, // Match TransactionList addressRow marginVertical
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIconSkeleton: {
    width: 20, // Match statusIcon width
    height: 20, // Match statusIcon height
    borderRadius: 10,
    marginRight: 8, // Match statusIcon marginRight
  },
  statusTextSkeleton: {
    width: 70,
    height: 16, // Match status fontSize (lg = 16)
    borderRadius: 8,
  },
  amountSkeleton: {
    width: 120,
    height: 24, // Approximate for monospace amount text
    borderRadius: 12,
  },
  addressSkeleton: {
    flex: 1,
    height: 18, // Approximate for address text
    borderRadius: 9,
    marginRight: 4, // Match address marginRight
  },
  usdAmountSkeleton: {
    width: 80,
    height: 18, // Approximate for fiatAmount text
    borderRadius: 9,
  },
  txIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkIconSkeleton: {
    width: 16, // Match linkIcon width
    height: 16, // Match linkIcon height
    borderRadius: 8,
    marginRight: 4, // Match linkIcon marginRight
  },
  txIdSkeleton: {
    width: 100,
    height: 14, // Approximate for txId text
    borderRadius: 7,
  },
  timestampSkeleton: {
    width: 90,
    height: 14, // Match timestamp fontSize (xs = 11, but visually ~14)
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
