import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Transaction} from '../types/Transaction';
import {themes} from '../theme';
import {formatAmount} from '../utils';

interface TransactionItemProps {
  transaction: Transaction;
  onPress: () => void;
  _address: string; // Prefix with underscore to indicate unused
  selectedCurrency: string;
  btcRate: number;
  getCurrencySymbol: (currency: string) => string;
}

export const TransactionItem: React.FC<TransactionItemProps> = ({
  transaction,
  onPress,
  _address,
  selectedCurrency,
  btcRate,
  getCurrencySymbol,
}) => {
  const {sent, received} = transaction;
  const isIncoming = received > sent;
  const amount = isIncoming ? received - sent : sent - received;
  const formattedAmount = formatAmount(amount, selectedCurrency, btcRate);
  const symbol = getCurrencySymbol(selectedCurrency);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={styles.content}>
        <View style={styles.leftContent}>
          <Text style={styles.type}>
            {isIncoming ? '📥 Received' : '📤 Sent'}
          </Text>
          <Text style={styles.date}>
            {new Date(transaction.time * 1000).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.rightContent}>
          <Text
            style={[
              styles.amount,
              {
                color: isIncoming
                  ? themes.lightPolished.colors.success
                  : themes.lightPolished.colors.danger,
              },
            ]}>
            {isIncoming ? '+' : '-'} {symbol}
            {formattedAmount}
          </Text>
          <Text style={styles.status}>
            {transaction.status.confirmed ? '✓ Confirmed' : '⏳ Pending'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: themes.lightPolished.colors.cardBackground,
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftContent: {
    flex: 1,
  },
  rightContent: {
    alignItems: 'flex-end',
  },
  type: {
    fontSize: 16,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
    marginBottom: 4,
  },
  date: {
    fontSize: 14,
    color: themes.lightPolished.colors.textSecondary,
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  status: {
    fontSize: 14,
    color: themes.lightPolished.colors.textSecondary,
  },
});
