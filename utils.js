import {Platform} from 'react-native';

let ip = '';

export const pinRemoteIP = addr => (ip = addr);

export const getPinnedRemoteIP = () => ip;

export const dbg = (message, ...optionalParams) => {
  let args = optionalParams.length === 0 ? '' : optionalParams;
  if (Platform.OS === 'android') {
    console.log(`[android] [${new Date().toLocaleTimeString()}] ${message}`, args);
  } else if (Platform.OS === 'ios') {
    console.log(`[iphone] [${new Date().toLocaleTimeString()}] ${message}`, args);
  } else {
    console.log(message, args);
  }
};

export const shorten = (x, y = 12) => `${x.slice(0, y)}...${x.slice(-y)}`;

export const capitalizeWords = str => {
  if (!str) {
    return '';
  }
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

export const presentFiat = (amount, decimals = 2) => {
  if (amount === undefined || amount === null) {
    return '0.00';
  }

  // Convert to number and handle invalid inputs
  const num = Number(amount);
  if (isNaN(num)) {
    return '0.00';
  }

  // Format with thousand separators and fixed decimal places
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

// Add currency symbol mapping
export const getCurrencySymbol = currency => {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
    INR: '₹',
    KRW: '₩',
    RUB: '₽',
    BRL: 'R$',
    CAD: 'C$',
    AUD: 'A$',
    CHF: 'Fr',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    PLN: 'zł',
    TRY: '₺',
    ZAR: 'R',
    MXN: '$',
    SGD: 'S$',
    HKD: 'HK$',
    NZD: 'NZ$',
  };
  return symbols[currency] || currency;
};
