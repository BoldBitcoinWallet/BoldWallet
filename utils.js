import {Platform} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

let ip = '';

export const pinRemoteIP = addr => (ip = addr);

export const getPinnedRemoteIP = () => ip;

export const dbg = (message, ...optionalParams) => {
  let args = optionalParams.length === 0 ? '' : optionalParams;
  if (Platform.OS === 'android') {
    console.log(`[android] [${new Date().toLocaleString()}] ${message}`, args);
  } else if (Platform.OS === 'ios') {
    console.log(`[iphone] [${new Date().toLocaleString()}] ${message}`, args);
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

// Haptic Feedback Configuration
const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

// Global Haptic Feedback Service
export const HapticFeedback = {
  // Light feedback for subtle interactions
  light: () => {
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('soft', hapticOptions);
    }
  },

  // Medium feedback for standard interactions
  medium: () => {
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('rigid', hapticOptions);
    }
  },

  // Heavy feedback for important actions
  heavy: () => {
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('impactHeavy', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('heavy', hapticOptions);
    }
  },

  // Success feedback
  success: () => {
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('notificationSuccess', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('soft', hapticOptions);
    }
  },

  // Warning feedback
  warning: () => {
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('notificationWarning', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('rigid', hapticOptions);
    }
  },

  // Error feedback
  error: () => {
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('notificationError', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('heavy', hapticOptions);
    }
  },

  // Selection feedback
  selection: () => {
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('selection', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('soft', hapticOptions);
    }
  },
};
