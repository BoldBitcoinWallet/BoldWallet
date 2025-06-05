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
}

const currencies: Currency[] = [
  {code: 'USD', name: 'US Dollar', symbol: '$'},
  {code: 'EUR', name: 'Euro', symbol: '€'},
  {code: 'GBP', name: 'British Pound', symbol: '£'},
  {code: 'JPY', name: 'Japanese Yen', symbol: '¥'},
  {code: 'AUD', name: 'Australian Dollar', symbol: 'A$'},
  {code: 'CAD', name: 'Canadian Dollar', symbol: 'C$'},
  {code: 'CHF', name: 'Swiss Franc', symbol: 'Fr'},
  {code: 'CNY', name: 'Chinese Yuan', symbol: '¥'},
  {code: 'INR', name: 'Indian Rupee', symbol: '₹'},
  {code: 'SGD', name: 'Singapore Dollar', symbol: 'S$'},
];

const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  visible,
  onClose,
  onSelect,
  currentCurrency,
}) => {
  const {height} = useWindowDimensions();

  const renderCurrencyItem = ({item}: {item: Currency}) => (
    <TouchableOpacity
      style={[
        styles.currencyItem,
        item.code === currentCurrency && styles.selectedCurrency,
      ]}
      onPress={() => {
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
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
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