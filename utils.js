import {Platform} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import LocalCache from './services/LocalCache';

let ips = [];

export const pinRemoteIP = addr => {
  if (!addr || typeof addr !== 'string') return ips;
  if (addr.split('.').length !== 4) return ips; // only IPv4
  if (!ips.includes(addr)) {
    ips.push(addr);
  }
  return ips;
};

export const getPinnedRemoteIP = () => (ips.length ? ips[ips.length - 1] : '');

export const getPinnedRemoteIPs = () => [...ips];

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

let hapticsEnabled = true;

export const initializeHaptics = async () => {
  try {
    const storedSetting = await LocalCache.getItem('hapticsEnabled');
    if (storedSetting !== null) {
      hapticsEnabled = storedSetting === 'true';
    }
  } catch (error) {
    dbg('Failed to initialize haptics setting', error);
  }
};

export const setHapticsEnabled = async enabled => {
  hapticsEnabled = enabled;
  await LocalCache.setItem('hapticsEnabled', String(enabled));
};

export const areHapticsEnabled = () => hapticsEnabled;

// Haptic Feedback Configuration
const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

// Global Haptic Feedback Service
export const HapticFeedback = {
  // Light feedback for subtle interactions
  light: () => {
    if (!hapticsEnabled) {
      return;
    }
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('soft', hapticOptions);
    }
  },

  // Medium feedback for standard interactions
  medium: () => {
    if (!hapticsEnabled) {
      return;
    }
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('rigid', hapticOptions);
    }
  },

  // Heavy feedback for important actions
  heavy: () => {
    if (!hapticsEnabled) {
      return;
    }
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('impactHeavy', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('heavy', hapticOptions);
    }
  },

  // Success feedback
  success: () => {
    if (!hapticsEnabled) {
      return;
    }
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('notificationSuccess', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('soft', hapticOptions);
    }
  },

  // Warning feedback
  warning: () => {
    if (!hapticsEnabled) {
      return;
    }
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('notificationWarning', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('rigid', hapticOptions);
    }
  },

  // Error feedback
  error: () => {
    if (!hapticsEnabled) {
      return;
    }
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('notificationError', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('heavy', hapticOptions);
    }
  },

  // Selection feedback
  selection: () => {
    if (!hapticsEnabled) {
      return;
    }
    if (Platform.OS === 'ios') {
      ReactNativeHapticFeedback.trigger('selection', hapticOptions);
    } else {
      ReactNativeHapticFeedback.trigger('soft', hapticOptions);
    }
  },
};

// API Endpoints Configuration
const MAINNET_APIS = [
  'https://mempool.space/api'
];
const TESTNET_APIS = ['https://mempool.space/testnet/api'];

// Function to fetch dynamic API endpoints from GitHub
export const fetchDynamicAPIEndpoints = async () => {
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/BoldBitcoinWallet/mempool-space-hosts/refs/heads/main/README.md',
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const markdownText = await response.text();

    // Parse markdown to extract URLs
    const urlRegex = /https:\/\/[^\s\]]+/g;
    const urls = markdownText.match(urlRegex) || [];

    // Filter and format URLs to ensure they have /api suffix
    const apiEndpoints = urls
      .filter(url => url.includes('mempool'))
      .map(url => {
        // Remove trailing slash if present
        const cleanUrl = url.replace(/\/$/, '');
        // Add /api suffix if not already present
        return cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;
      })
      .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates

    return apiEndpoints;
  } catch (error) {
    dbg('Failed to fetch dynamic API endpoints:', error);
    return [];
  }
};

// Helper function to get mainnet API endpoints (dynamic + fallback)
export const getMainnetAPIList = async () => {
  const dynamicEndpoints = await fetchDynamicAPIEndpoints();
  return dynamicEndpoints.length > 0 ? dynamicEndpoints : MAINNET_APIS;
};

// Helper function to get testnet API endpoints (dynamic + fallback)
export const getTestnetAPIList = async () => {
  const dynamicEndpoints = await fetchDynamicAPIEndpoints();
  return dynamicEndpoints.length > 0 ? dynamicEndpoints : TESTNET_APIS;
};
