import React, {useEffect} from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  Image,
} from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  withSpring,
  useAnimatedStyle,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import {useTheme} from '../theme';
import {HapticFeedback} from '../utils';
interface Currency {
  code: string;
  name: string;
  symbol: string;
}
interface CurrencySelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (currency: Currency) => void;
  currentCurrency: string;
  availableCurrencies: {[key: string]: number};
}
const currencyNames: {[key: string]: string} = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  CNY: 'Chinese Yuan',
  INR: 'Indian Rupee',
  SGD: 'Singapore Dollar',
};
const currencySymbols: {[key: string]: string} = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'Fr',
  CNY: '¥',
  INR: '₹',
  SGD: 'S$',
};
const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  visible,
  onClose,
  onSelect,
  currentCurrency,
  availableCurrencies,
}) => {
  const {theme} = useTheme();
  const {height} = useWindowDimensions();
  const modalAnimation = useSharedValue(0);

  // Animate modal on open/close
  useEffect(() => {
    if (visible) {
      // Reset and animate modal entrance
      modalAnimation.value = 0;
      modalAnimation.value = withSpring(1, {
        damping: 11,
        stiffness: 65,
      });
    } else {
      // Reset animation when modal closes
      modalAnimation.value = 0;
    }
  }, [visible, modalAnimation]);

  // Animated style for modal
  const modalAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(modalAnimation.value, [0, 1], [100, 0]);
    return {
      opacity: modalAnimation.value,
      transform: [{translateY}],
    };
  });

  const handleClose = () => {
    HapticFeedback.light();
    // Animate modal exit
    const finishCallback = () => {
      onClose();
    };
    modalAnimation.value = withTiming(0, {duration: 200}, () => {
      runOnJS(finishCallback)();
    });
  };
  // Convert available currencies object to array of Currency objects
  const currencies: Currency[] = Object.keys(availableCurrencies)
    .filter(code => currencyNames[code]) // Only include currencies in our whitelist
    .map(code => ({
      code,
      name: currencyNames[code],
      symbol: currencySymbols[code] || code,
    }));
  const renderCurrencyItem = ({item}: {item: Currency}) => (
    <Pressable
      style={[
        styles.currencyItem,
        item.code === currentCurrency && styles.selectedCurrency,
      ]}
      onPress={() => {
        HapticFeedback.selection();
        onSelect(item);
        onClose();
      }}
      android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
      <Text style={styles.currencyCode}>{item.code}</Text>
      <Text style={styles.currencyName}>{item.name}</Text>
      <Text style={styles.currencySymbol}>{item.symbol}</Text>
    </Pressable>
  );
  const styles = StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: theme.colors.modalBackdrop,
      justifyContent: 'flex-end',
      paddingHorizontal: 10,
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
      borderLeftWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderRightWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderLeftColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
      borderRightColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
      paddingBottom: 20,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: theme.colors.background === '#ffffff' ? 1 : 1.5,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay30, // Dark mode: more visible light border
    },
    headerTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    headerIcon: {
      width: 24,
      height: 24,
      marginRight: 10,
      tintColor: theme.colors.text,
    },
    title: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    closeButton: {
      padding: 8,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      color: theme.colors.text,
    },
    listContent: {
      padding: 0,
      paddingBottom: 20,
    },
    currencyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      marginBottom: 0,
      marginHorizontal: 0,
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 0,
    },
    selectedCurrency: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent
          : theme.colors.bitcoinOrange,
    },
    currencyCode: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      width: 60,
    },
    currencyName: {
      fontSize: theme.fontSizes?.lg || 16,
      flex: 1,
      color: theme.colors.text,
    },
    currencySymbol: {
      fontSize: theme.fontSizes?.lg || 16,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.textSecondary
          : theme.colors.text,
      marginLeft: 8,
    },
  });
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}>
      <View style={styles.modalContainer}>
        <Animated.View
          style={[
            styles.modalContent,
            {maxHeight: height * 0.8},
            modalAnimatedStyle,
          ]}>
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Image
                source={require('../assets/currency-icon.png')}
                style={styles.headerIcon}
                resizeMode="contain"
              />
              <Text style={styles.title}>Select Currency</Text>
            </View>
            <Pressable
              onPress={handleClose}
              style={styles.closeButton}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>
          <FlatList
            data={currencies}
            renderItem={renderCurrencyItem}
            keyExtractor={item => item.code}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        </Animated.View>
      </View>
    </Modal>
  );
};
export default CurrencySelector;
