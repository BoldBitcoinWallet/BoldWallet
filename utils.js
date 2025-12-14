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
  // Disable debug logging in production builds to prevent information leakage
  if (!__DEV__) {
    return;
  }
  let args = optionalParams.length === 0 ? '' : optionalParams;
  if (Platform.OS === 'android') {
    console.log(
      `[android] [${new Date().toLocaleString()}] ${message}`,
      ...args,
    );
  } else if (Platform.OS === 'ios') {
    console.log(
      `[iphone] [${new Date().toLocaleString()}] ${message}`,
      ...args,
    );
  } else {
    console.log(message, ...args);
  }
};

export const shorten = (x, y = 12) => `${x.slice(0, y)}...${x.slice(-y)}`;

/**
 * Get the default derivation path for a given network
 * @param {string} network - Network: 'mainnet' or 'testnet3'
 * @returns {string} - Derivation path (e.g., "m/44'/0'/0'/0/0" for mainnet, "m/44'/1'/0'/0/0" for testnet)
 */
export const getDerivePathForNetwork = (network, account = 0, change = 0, index = 0) => {
  const coinType = network === 'mainnet' ? "0'" : "1'";
  return `m/44'/${coinType}/${account}'/${change}/${index}`;
};

/**
 * Convert a hex string to a regular string
 * @param {string} hex - The hex string to convert
 * @returns {string} - The decoded string
 */
export const hexToString = hex => {
  if (!hex) return '';
  return (hex.match(/.{1,2}/g) || [])
    .map(byte => String.fromCharCode(parseInt(byte, 16)))
    .join('');
};

export const isCanceledError = error => {
  return (
    error && (String(error) === 'canceled' || error?.name === 'CanceledError')
  );
};

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
const MAINNET_APIS = ['https://mempool.space/api'];
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

// Helper function to get testnet API endpoints (only hardcoded endpoint)
export const getTestnetAPIList = async () => {
  return TESTNET_APIS;
};

// Default Nostr relays
const DEFAULT_NOSTR_RELAYS = [
  'wss://bbw-nostr.xyz',
  'wss://nostr.hifish.org',
  'wss://nostr.xxi.quest',
];

// Function to fetch dynamic Nostr relays from GitHub
export const fetchDynamicNostrRelays = async () => {
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/BoldBitcoinWallet/mempool-space-hosts/refs/heads/main/NOSTR.md',
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const markdownText = await response.text();

    // Parse markdown to extract relay URLs (lines starting with "- wss://")
    const relayRegex = /^-\s*(wss:\/\/[^\s]+)/gm;
    const matches = markdownText.match(relayRegex) || [];

    // Extract URLs from matches
    const relays = matches
      .map(match => {
        // Extract URL from "- wss://..." format
        const urlMatch = match.match(/wss:\/\/[^\s]+/);
        return urlMatch ? urlMatch[0].trim() : null;
      })
      .filter(
        url =>
          url !== null && typeof url === 'string' && url.startsWith('wss://'),
      )
      .map(url => String(url)); // Ensure all are strings

    if (relays.length > 0) {
      dbg('Fetched dynamic Nostr relays:', relays);
      return relays;
    } else {
      dbg('No valid relays found in fetched content, using defaults');
      return DEFAULT_NOSTR_RELAYS;
    }
  } catch (error) {
    dbg('Failed to fetch dynamic Nostr relays:', error);
    return DEFAULT_NOSTR_RELAYS;
  }
};

// Helper function to get Nostr relays (dynamic + fallback)
export const getNostrRelays = async (forceFetch = false) => {
  // Check cache first (unless forceFetch is true)
  if (!forceFetch) {
    try {
      const cachedRelays = await LocalCache.getItem('nostr_relays');
      if (cachedRelays) {
        const relaysArray = cachedRelays
          .split(',')
          .map(r => r.trim())
          .filter(Boolean);
        if (relaysArray.length > 0) {
          dbg('Using cached Nostr relays:', relaysArray);
          return relaysArray;
        }
      }
    } catch (error) {
      dbg('Error reading cached relays:', error);
    }
  }

  // If not cached or forceFetch, fetch from GitHub
  const dynamicRelays = await fetchDynamicNostrRelays();

  // Cache the result (either fetched or defaults)
  const relaysCSV = dynamicRelays.join(',');
  try {
    await LocalCache.setItem('nostr_relays', relaysCSV);
    dbg('Cached Nostr relays:', relaysCSV);
  } catch (error) {
    dbg('Error caching relays:', error);
  }

  return dynamicRelays;
};

/**
 * Get the keyshare label (KeyShare1, KeyShare2, KeyShare3) from a keyshare JSON object.
 * Computes from local_party_key position in sorted keygen_committee_keys array.
 * Each device checks its local_party_key and finds where it sits in the sorted keygen_committee_keys
 * to determine its placement (1, 2, or 3).
 * @param {Object} keyshare - The keyshare JSON object
 * @returns {string} - The keyshare label (e.g., "KeyShare1", "KeyShare2", "KeyShare3") or empty string
 */
export const getKeyshareLabel = keyshare => {
  if (!keyshare) {
    return '';
  }

  // Compute from keygen_committee_keys: find local_party_key's position in sorted array
  if (keyshare.local_party_key && keyshare.keygen_committee_keys) {
    // Sort keygen_committee_keys to ensure consistent ordering
    const sortedKeys = [...keyshare.keygen_committee_keys].sort();
    const index = sortedKeys.indexOf(keyshare.local_party_key);
    if (index >= 0) {
      return `KeyShare${index + 1}`;
    }
  }

  // Fallback: return empty string
  return '';
};
