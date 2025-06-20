import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import {themes} from '../theme';
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
  const {height} = useWindowDimensions();

  // Convert available currencies object to array of Currency objects
  const currencies: Currency[] = Object.keys(availableCurrencies)
    .filter(code => currencyNames[code]) // Only include currencies in our whitelist
    .map(code => ({
      code,
      name: currencyNames[code],
      symbol: currencySymbols[code] || code,
    }));

  const renderCurrencyItem = ({item}: {item: Currency}) => (
    <TouchableOpacity
      style={[
        styles.currencyItem,
        item.code === currentCurrency && styles.selectedCurrency,
      ]}
      onPress={() => {
        HapticFeedback.selection();
        onSelect(item);
        onClose();
      }}>
      <Text style={styles.currencyCode}>{item.code}</Text>
      <Text style={styles.currencyName}>{item.name}</Text>
      <Text style={styles.currencySymbol}>{item.symbol}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={[styles.modalContent, {maxHeight: height * 0.8}]}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Currency</Text>
            <TouchableOpacity 
              onPress={() => {
                HapticFeedback.light();
                onClose();
              }} 
              style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={currencies}
            renderItem={renderCurrencyItem}
            keyExtractor={item => item.code}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: themes.lightPolished.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: themes.lightPolished.colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 20,
    color: themes.lightPolished.colors.text,
  },
  listContent: {
    padding: 16,
  },
  currencyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: themes.lightPolished.colors.cardBackground,
  },
  selectedCurrency: {
    backgroundColor: themes.lightPolished.colors.accent,
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
    width: 60,
  },
  currencyName: {
    flex: 1,
    fontSize: 16,
    color: themes.lightPolished.colors.text,
  },
  currencySymbol: {
    fontSize: 16,
    color: themes.lightPolished.colors.textSecondary,
    marginLeft: 8,
  },
});

export default CurrencySelector;
