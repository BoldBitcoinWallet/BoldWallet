import {Platform} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import LocalCache from './services/LocalCache';
import {isDebugLoggingEnabled} from './App';

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

/**
 * Reset navigation config to MainTabs with Wallet tab selected (or Device when Wallet hidden).
 * Options: showPlay, showUtxos, showPsbt, showWallet (default true for Wallet).
 */
export const getResetToMainTabsWallet = (params = {}, options = {}) => {
  const showPlay = options.showPlay !== false;
  const showUtxos = options.showUtxos === true;
  const showPsbt = options.showPsbt === true;
  const showWallet = options.showWallet !== false;
  const routes = [
    {name: 'Device'},
    ...(showPsbt ? [{name: 'PSBT'}] : []),
    ...(showWallet ? [{name: 'Wallet', params}] : []),
    ...(showPlay ? [{name: 'Playground'}] : []),
    ...(showUtxos ? [{name: 'Utxos'}] : []),
    {name: 'Settings'},
  ];
  let selectedIndex = 0;
  if (showWallet) {
    selectedIndex = showPsbt ? 2 : 1;
  } else if (showPsbt) {
    selectedIndex = 1;
  }
  return {
    index: 0,
    routes: [
      {
        name: 'MainTabs',
        state: {
          routes,
          index: selectedIndex,
        },
      },
    ],
  };
};

/**
 * Reset navigation config to MainTabs with PSBT tab selected (or Device when PSBT hidden).
 * When showWallet is false, Wallet tab is omitted.
 */
export const getResetToMainTabsPSBT = (options = {}) => {
  const showPlay = options.showPlay !== false;
  const showUtxos = options.showUtxos === true;
  const showPsbt = options.showPsbt === true;
  const showWallet = options.showWallet !== false;
  const routes = [
    {name: 'Device'},
    ...(showPsbt ? [{name: 'PSBT'}] : []),
    ...(showWallet ? [{name: 'Wallet'}] : []),
    ...(showPlay ? [{name: 'Playground'}] : []),
    ...(showUtxos ? [{name: 'Utxos'}] : []),
    {name: 'Settings'},
  ];
  let selectedIndex = 0;
  if (showPsbt) {
    selectedIndex = 1;
  } else if (showWallet) {
    selectedIndex = 1;
  }
  return {
    index: 0,
    routes: [
      {
        name: 'MainTabs',
        state: {
          routes,
          index: selectedIndex,
        },
      },
    ],
  };
};

export const dbg = (message, ...optionalParams) => {
  // In __DEV__, always show dbg logs (so they appear on iOS/Android without toggling Settings).
  // In production, only log if user enabled the debug setting in WalletSettings.
  if (!__DEV__ && !isDebugLoggingEnabled()) {
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
 * Generate all output descriptors (legacy, segwit-native, segwit-compatible)
 * @param {Object} nativeModule - The BBMTLibNativeModule instance
 * @param {string} pubKey - Compressed master public key in hex
 * @param {string} chainCode - Master chain code in hex
 * @param {string} network - Network: 'mainnet' or 'testnet3'
 * @param {number|string|null|undefined} createdAt - Timestamp from keyshare.created_at
 * @param {string} addressType - Optional: current address type for primary descriptor selection
 * @returns {Promise<{legacy: string, segwitNative: string, segwitCompatible: string, primary: string}>}
 */
export const generateAllOutputDescriptors = async (
  nativeModule,
  pubKey,
  chainCode,
  network,
  createdAt,
  addressType = 'legacy',
) => {
  const useLegacyPath = isLegacyWallet(createdAt);
  const outputDescriptors = {
    legacy: '',
    segwitNative: '',
    segwitCompatible: '',
  };

  try {
    if (useLegacyPath) {
      // Old wallets: generate legacy descriptor once, then construct others
      const legacyDesc =
        (await nativeModule
          .getOutputDescriptor(pubKey, chainCode, network, 'legacy')
          .catch(() => '')) || '';

      outputDescriptors.legacy = legacyDesc;

      if (legacyDesc) {
        // For old wallets, all descriptors use BIP44 path (44') but different formats
        // Legacy: pkh, SegWit Native: wpkh, SegWit Compatible: sh(wpkh)
        // Simple string replacement
        outputDescriptors.segwitNative = legacyDesc.replace(/^pkh\(/, 'wpkh(');
        outputDescriptors.segwitCompatible = legacyDesc.replace(
          /^pkh\(/,
          'sh(wpkh(',
        );
      }
    } else {
      // New wallets: generate proper descriptors for each address type
      const [legacyDesc, segwitNativeDesc, segwitCompatibleDesc] =
        await Promise.all([
          nativeModule
            .getOutputDescriptor(pubKey, chainCode, network, 'legacy')
            .catch(() => ''),
          nativeModule
            .getOutputDescriptor(pubKey, chainCode, network, 'segwit-native')
            .catch(() => ''),
          nativeModule
            .getOutputDescriptor(
              pubKey,
              chainCode,
              network,
              'segwit-compatible',
            )
            .catch(() => ''),
        ]);

      outputDescriptors.legacy = legacyDesc || '';
      outputDescriptors.segwitNative = segwitNativeDesc || '';
      outputDescriptors.segwitCompatible = segwitCompatibleDesc || '';
    }

    // Determine primary descriptor based on address type
    let primary = outputDescriptors.legacy;
    if (addressType === 'segwit-native') {
      primary =
        outputDescriptors.segwitNative || outputDescriptors.legacy;
    } else if (addressType === 'segwit-compatible') {
      primary =
        outputDescriptors.segwitCompatible || outputDescriptors.legacy;
    }

    return {
      ...outputDescriptors,
      primary,
    };
  } catch (error) {
    // Return empty descriptors on error
    return {
      legacy: '',
      segwitNative: '',
      segwitCompatible: '',
      primary: '',
    };
  }
};

/**
 * Check if a wallet is a legacy wallet (created before the optimized path migration)
 * @param {number|string|null|undefined} createdAt - Timestamp from keyshare.created_at
 * @returns {boolean} - true if legacy wallet (should use BIP44 for all address types)
 */
export const isLegacyWallet = (createdAt) => {
  if (!createdAt) {
    // If no timestamp, assume legacy for safety
    return true;
  }
  const timestamp = typeof createdAt === 'string' ? parseInt(createdAt, 10) : createdAt;
  // Wallets created after 1765894825732 use optimized paths (BIP84/BIP49)
  // Wallets created before or equal to this timestamp use BIP44 for all address types
  return timestamp <= 1765894825732;
};

/**
 * Get the default derivation path for a given network and address type
 * @param {string} network - Network: 'mainnet' or 'testnet3'
 * @param {string} addressType - Address type: 'legacy', 'segwit-native', or 'segwit-compatible' (defaults to 'legacy' for backward compatibility)
 * @param {boolean} useLegacyPath - If true, always use BIP44 regardless of address type (for backward compatibility)
 * @param {number} account - Account index (default: 0)
 * @param {number} change - Change index (0 = external, 1 = internal, default: 0)
 * @param {number} index - Address index (default: 0)
 * @returns {string} - Derivation path
 *   - Legacy wallets or useLegacyPath=true: Always "m/44'/coinType'/account'/change/index" (BIP44)
 *   - New wallets with legacy address type: "m/44'/coinType'/account'/change/index" (BIP44)
 *   - New wallets with segwit-native: "m/84'/coinType'/account'/change/index" (BIP84)
 *   - New wallets with segwit-compatible: "m/49'/coinType'/account'/change/index" (BIP49)
 */
export const getDerivePathForNetwork = (network, addressType = 'legacy', useLegacyPath = false, account = 0, change = 0, index = 0) => {
  const coinType = network === 'mainnet' ? "0'" : "1'";
  
  // Legacy wallets always use BIP44 for all address types (backward compatibility)
  if (useLegacyPath) {
    return `m/44'/${coinType}/${account}'/${change}/${index}`;
  }
  
  // Determine BIP path based on address type for new wallets
  let bipPath;
  switch (addressType) {
    case 'segwit-native':
      bipPath = "84'"; // BIP84
      break;
    case 'segwit-compatible':
      bipPath = "49'"; // BIP49
      break;
    case 'legacy':
    default:
      bipPath = "44'"; // BIP44
      break;
  }
  
  return `m/${bipPath}/${coinType}/${account}'/${change}/${index}`;
};

/** Standard BIP44/BIP84/BIP49 gap limit for address discovery (e.g. restore). */
export const GAP_LIMIT = 5;

/** Minimum indices to always scan for both receive and change chains. Ensures path 0 and old paths are never missed. */
export const MIN_SCAN_INDEX = 20;

/**
 * Derivation path for receive (external) address at given index.
 * @param {string} network - 'mainnet' or 'testnet3'
 * @param {string} addressType - 'legacy' | 'segwit-native' | 'segwit-compatible'
 * @param {boolean} useLegacyPath - legacy wallet path
 * @param {number} index - address index (default 0)
 */
export const getReceivePath = (network, addressType, useLegacyPath, index = 0) =>
  getDerivePathForNetwork(network, addressType, useLegacyPath, 0, 0, index);

/**
 * Derivation path for change (internal) address at given index.
 * @param {string} network - 'mainnet' or 'testnet3'
 * @param {string} addressType - 'legacy' | 'segwit-native' | 'segwit-compatible'
 * @param {boolean} useLegacyPath - legacy wallet path
 * @param {number} index - change address index (default 0)
 */
export const getChangePath = (network, addressType, useLegacyPath, index = 0) =>
  getDerivePathForNetwork(network, addressType, useLegacyPath, 0, 1, index);

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
    return '0';
  }

  // Convert to number and handle invalid inputs
  const num = Number(amount);
  if (isNaN(num)) {
    return '0';
  }

  // Ensure non-negative (handle -0 case)
  const positiveNum = num < 0 ? 0 : num;

  // Format with thousand separators and fixed decimal places
  const formatted = positiveNum.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  // Remove .00 if it's a whole number
  if (formatted.endsWith('.00')) {
    return formatted.slice(0, -3);
  }
  
  return formatted;
};

/**
 * Formats BTC balance with custom formatting:
 * - Left of decimal: standard thousand separators (every 3 digits)
 * - Right of decimal: first comma after 2 digits, then every 3 digits
 * Example: 54324.54620005 -> 54,324.54,630,006
 */
/**
 * Smart Bitcoin balance formatter with conditional precision based on amount size
 * @param {string|number} btcAmount - The Bitcoin amount to format
 * @param {object} options - Formatting options
 * @param {boolean} options.compact - Use compact mode (fewer decimals for large amounts)
 * @param {number} options.maxDecimals - Maximum decimal places to show (overrides smart precision)
 * @param {boolean} options.showTrailingZeros - Whether to show trailing zeros
 * @returns {string} Formatted Bitcoin amount
 */
export const formatBTC = (btcAmount, options = {}) => {
  const {
    compact = false,
    maxDecimals = null,
    showTrailingZeros = false,
  } = options;

  if (btcAmount === undefined || btcAmount === null || btcAmount === '') {
    return '0';
  }

  // Convert to string and handle invalid inputs
  const amountStr = String(btcAmount);
  if (amountStr === '0' || amountStr === '0.0' || amountStr === '0.00') {
    return '0';
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < 0) {
    return '0';
  }
  
  // Handle zero amount
  if (amount === 0) {
    return '0';
  }

  // Split into whole and decimal parts
  const [wholePart, decimalPart = ''] = amountStr.split('.');

  const thinSpace = ',';

  // Format whole part: standard thousand separators (every 3 digits from right) using thin space
  const formattedWhole = Number(wholePart).toLocaleString('en-US').replace(/,/g, thinSpace);

  // Determine smart precision based on amount size
  let targetDecimals = 8; // Default to full precision
  if (maxDecimals !== null) {
    targetDecimals = maxDecimals;
  } else if (compact) {
    // Compact mode: fewer decimals for larger amounts
    if (amount >= 1000) {
      targetDecimals = 2;
    } else if (amount >= 1) {
      targetDecimals = 4;
    } else if (amount >= 0.01) {
      targetDecimals = 6;
    } else if (amount >= 0.0001) {
      targetDecimals = 8;
    } else {
      targetDecimals = 8; // Very small amounts: show full precision
    }
  } else {
    // Smart precision mode: balance readability with precision
    if (amount >= 1000) {
      targetDecimals = 2; // Large amounts: 2 decimals (e.g., 1,234.56)
    } else if (amount >= 1) {
      targetDecimals = 4; // Medium-large: 4 decimals (e.g., 123.4567)
    } else if (amount >= 0.01) {
      targetDecimals = 6; // Small-medium: 6 decimals (e.g., 0.123456)
    } else if (amount >= 0.0001) {
      targetDecimals = 8; // Very small: full precision (e.g., 0.00012345)
    } else {
      targetDecimals = 8; // Extremely small: full precision
    }
  }

  // Format decimal part with custom comma formatting
  let formattedDecimal = '';
  if (decimalPart) {
    // Pad to target decimals (or 8 if more precision needed)
    const paddedDecimal = decimalPart.padEnd(Math.max(targetDecimals, 8), '0').slice(0, Math.max(targetDecimals, 8));
    
    // Truncate to target decimals
    const truncatedDecimal = paddedDecimal.slice(0, targetDecimals);
    
    // Apply custom comma formatting: first comma after 2 digits, then every 3 digits
    if (truncatedDecimal.length > 2) {
      const firstTwo = truncatedDecimal.slice(0, 2);
      const remaining = truncatedDecimal.slice(2);
      
      // Group remaining digits in groups of 3
      const groups = [];
      for (let i = 0; i < remaining.length; i += 3) {
        groups.push(remaining.slice(i, i + 3));
      }
      
      // Combine: first 2 digits, then thin space, then groups of 3 separated by thin spaces
      formattedDecimal = firstTwo + (groups.length > 0 ? thinSpace + groups.join(thinSpace) : '');
    } else {
      formattedDecimal = truncatedDecimal;
    }

    // Remove trailing zeros if not requested
    if (!showTrailingZeros) {
      formattedDecimal = formattedDecimal.replace(/0+$/, '').replace(new RegExp(thinSpace + '$'), '');
      // If all decimals removed, ensure we have at least the first two digits for consistency
      if (formattedDecimal === '' && truncatedDecimal.length > 0) {
        formattedDecimal = truncatedDecimal.slice(0, Math.min(2, truncatedDecimal.length));
      }
    }
  } else if (targetDecimals > 0 && showTrailingZeros) {
    // If no decimal part but we want to show decimals, pad with zeros
    formattedDecimal = '00';
    if (targetDecimals > 2) {
      const remainingZeros = '0'.repeat(Math.min(targetDecimals - 2, 6));
      formattedDecimal += thinSpace + remainingZeros.match(/.{1,3}/g)?.join(thinSpace) || '';
    }
  }

  // If formattedDecimal is empty and we have a whole number, don't show decimal point
  if (formattedDecimal === '' && !showTrailingZeros) {
    return formattedWhole;
  }

  return `${formattedWhole}.${formattedDecimal}`;
};

/**
 * Formats satoshis with thousand separators
 * @param {string|number} satsAmount - The satoshi amount to format
 * @returns {string} Formatted satoshi amount
 */
export const formatSats = (satsAmount) => {
  if (satsAmount === undefined || satsAmount === null || satsAmount === '') {
    return '0';
  }

  const amountStr = String(satsAmount);
  const amount = parseFloat(amountStr);
  
  if (isNaN(amount) || amount < 0) {
    return '0';
  }

  // Handle zero amount explicitly
  if (amount === 0) {
    return '0';
  }

  const thinSpace = ',';
  return Math.floor(amount).toLocaleString('en-US').replace(/,/g, thinSpace);
};

/**
 * Cash App–style Bitcoin display: ₿ for sats (< 1 BTC), "X BTC" for 1+ BTC.
 * @param {string|number} amountBtc - Amount in BTC
 * @param {{ inSats: boolean, formatted: boolean }} options - inSats: true = show in sats (₿X,XXX when < 1 BTC, X BTC when >= 1); false = show in BTC. formatted: true = thousand separators; false = raw numbers (Settings: Raw Numbers).
 * @returns {string} Display string (e.g. "₿50,000" or "1.5 BTC" or raw "₿50000" / "0.00050000 BTC")
 */
export const formatBitcoinDisplay = (amountBtc, options = {}) => {
  const {inSats = true, formatted = true} = options;
  if (amountBtc === undefined || amountBtc === null || amountBtc === '') {
    return inSats ? '₿0' : '0 BTC';
  }
  const amount = parseFloat(String(amountBtc));
  if (isNaN(amount) || amount < 0) {
    return inSats ? '₿0' : '0 BTC';
  }
  if (amount === 0) {
    return inSats ? '₿0' : '0 BTC';
  }
  if (inSats) {
    if (amount >= 1) {
      if (formatted) {
        return `${formatBTC(amount, {compact: true, maxDecimals: 2})} BTC`;
      }
      return `${amount.toFixed(2)} BTC`;
    }
    const sats = Math.floor(amount * 1e8);
    if (formatted) {
      return `₿${formatSats(sats)}`;
    }
    return `₿${sats}`;
  }
  if (formatted) {
    return `${formatBTC(amountBtc, {compact: false, maxDecimals: 8})} BTC`;
  }
  return `${amount.toFixed(8)} BTC`;
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

/**
 * Encode send bitcoin data into QR code format
 * Format: <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>
 * @param {string} toAddress - Bitcoin address to send to
 * @param {string|number} amountSats - Amount in satoshis
 * @param {string|number} feeSats - Fee in satoshis
 * @param {string} spendingHash - Spending hash (can be empty)
 * @param {string} addressType - Address type (e.g., 'segwit-native', 'legacy', 'segwit-compatible')
 * @param {string} derivationPath - Derivation path (e.g., "m/84'/0'/0'/0/0")
 * @param {string} network - Network identifier (e.g., 'mainnet', 'testnet3')
 * @param {string} utxosJson - Optional JSON string of utxosWithPaths used for spending/fee (may be large)
 * @returns {string} - Encoded QR data string
 */
export const encodeSendBitcoinQR = (
  toAddress,
  amountSats,
  feeSats,
  spendingHash = '',
  addressType = '',
  derivationPath = '',
  network = '',
  utxosJson = '',
) => {
  const amount = typeof amountSats === 'string' ? amountSats : amountSats.toString();
  const fee = typeof feeSats === 'string' ? feeSats : feeSats.toString();
  return `${toAddress}|${amount}|${fee}|${spendingHash || ''}|${addressType || ''}|${derivationPath || ''}|${network || ''}|${utxosJson || ''}`;
};

/**
 * Decode send bitcoin data from QR code format
 * Format (newest): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>|<network>|<utxosJson>
 * Format (new): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>
 * Format (old): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>
 * @param {string} qrData - QR code data string
 * @returns {Object|null} - Decoded data object or null if invalid
 */
export const decodeSendBitcoinQR = (qrData) => {
  if (!qrData || typeof qrData !== 'string') {
    return null;
  }

  const parts = qrData.split('|');
  // Support old format (3-4 parts), new format (6 parts), newest format (7 parts), and extended (8 parts with utxosJson)
  if (parts.length < 3 || parts.length > 8) {
    return null;
  }

  // Old format: <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>
  // New format: <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>
  // Newest format: <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>|<network>
  // Extended: <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>|<network>|<utxosJson>
  const [
    toAddress,
    amountSats,
    feeSats,
    spendingHash = '',
    addressType = '',
    derivationPath = '',
    network = '',
    utxosJson = '',
  ] = parts;

  // Validate address is not empty
  if (!toAddress || toAddress.trim() === '') {
    return null;
  }

  // Validate amounts are valid numbers
  const amount = parseInt(amountSats, 10);
  const fee = parseInt(feeSats, 10);
  if (isNaN(amount) || isNaN(fee) || amount < 0 || fee < 0) {
    return null;
  }

  return {
    toAddress: toAddress.trim(),
    amountSats: amount.toString(),
    feeSats: fee.toString(),
    spendingHash: spendingHash || '',
    addressType: addressType || '',
    derivationPath: derivationPath || '',
    network: network || '',
    utxosJson: utxosJson || '',
  };
};
