import {DeviceEventEmitter, Platform} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import EncryptedStorage from 'react-native-encrypted-storage';
import LocalCache from './services/LocalCache';
import {isDebugLoggingEnabled} from './App';
import {detectKeyshareTssBackend} from './services/tssBackend';
import {BBMTLibNativeModule} from './native_modules';

/** EncryptedStorage / RNES account for the full MPC keyshare blob. */
export const KEYSHARE_STORAGE_KEY = 'keyshare';

export {detectKeyshareTssBackend};

/** Strip trailing `#checksum` from an output descriptor (BIP 380). */
const stripDescriptorChecksum = d => {
  if (!d || typeof d !== 'string') {
    return '';
  }
  const i = d.lastIndexOf('#');
  return i >= 0 ? d.slice(0, i) : d;
};

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
 * Options: showPlay, showUtxos, showAddresses, showPsbt, showWallet (default true for Wallet).
 */
export const getResetToMainTabsWallet = (params = {}, options = {}) => {
  const showPlay = options.showPlay !== false;
  const showUtxos = options.showUtxos === true;
  const showAddresses = options.showAddresses === true;
  const showPsbt = options.showPsbt === true;
  const showWallet = options.showWallet !== false;
  const routes = [
    {name: 'Device'},
    ...(showPsbt ? [{name: 'PSBT'}] : []),
    ...(showWallet ? [{name: 'Wallet', params}] : []),
    ...(showPlay ? [{name: 'Playground'}] : []),
    ...(showUtxos ? [{name: 'Utxos'}] : []),
    ...(showAddresses ? [{name: 'Addresses'}] : []),
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
  const showAddresses = options.showAddresses === true;
  const showPsbt = options.showPsbt === true;
  const showWallet = options.showWallet !== false;
  const routes = [
    {name: 'Device'},
    ...(showPsbt ? [{name: 'PSBT'}] : []),
    ...(showWallet ? [{name: 'Wallet'}] : []),
    ...(showPlay ? [{name: 'Playground'}] : []),
    ...(showUtxos ? [{name: 'Utxos'}] : []),
    ...(showAddresses ? [{name: 'Addresses'}] : []),
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

/** Shorten a Bitcoin address for display: first 4 + ... + last 4. */
export const shortenAddress = addr =>
  typeof addr === 'string' && addr.length > 8
    ? `${addr.slice(0, 4)}...${addr.slice(-4)}`
    : addr || '';

/**
 * Generate all output descriptors (legacy, segwit-native, segwit-compatible)
 * @param {Object} nativeModule - The BBMTLibNativeModule instance
 * @param {string} pubKey - Compressed master public key in hex
 * @param {string} chainCode - Master chain code in hex
 * @param {string} network - Network: 'mainnet' or 'testnet3'
 * @param {import('./types/keyshare').KeyshareMetadata|number|null|undefined} keyshareMeta - Metadata (preferred) or legacy created_at only
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
  const useLegacyPath = resolveUseLegacyDerivationPaths(
    typeof createdAt === 'object' && createdAt !== null
      ? createdAt
      : {created_at: createdAt, tss_backend: 'gg18'},
  );
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
        // Same BIP44 account key path as legacy pkh(); checksum must match transformed body (native).
        const legacyBody = stripDescriptorChecksum(legacyDesc);
        const segBody = legacyBody.replace(/^pkh\(/, 'wpkh(');
        const shBody = legacyBody.replace(/^pkh\(/, 'sh(wpkh(') + ')';
        const [segSum, shSum] = await Promise.all([
          nativeModule.appendOutputDescriptorChecksum(segBody).catch(() => ''),
          nativeModule.appendOutputDescriptorChecksum(shBody).catch(() => ''),
        ]);
        outputDescriptors.segwitNative = segSum || segBody;
        outputDescriptors.segwitCompatible = shSum || shBody;
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
      primary = outputDescriptors.segwitNative || outputDescriptors.legacy;
    } else if (addressType === 'segwit-compatible') {
      primary = outputDescriptors.segwitCompatible || outputDescriptors.legacy;
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
 * Normalize keyshare.created_at to milliseconds (GG18 uses ms; older DKLs exports used seconds).
 * @param {number|string|null|undefined} createdAt
 * @returns {number|null}
 */
export const normalizeCreatedAtMs = createdAt => {
  if (createdAt == null || createdAt === '') {
    return null;
  }
  const n =
    typeof createdAt === 'string' ? parseInt(createdAt, 10) : Number(createdAt);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  // Values below ~2001-09-09 in ms are treated as Unix seconds.
  if (n < 1e12) {
    return n * 1000;
  }
  return n;
};

/**
 * Check if a GG18-era wallet uses legacy BIP44-only paths (pre path-migration cutoff).
 * Not the same as MPC backend — use resolveUseLegacyDerivationPaths for routing.
 * @param {number|null|undefined} createdAtMs - created_at in milliseconds
 * @returns {boolean}
 */
export const isLegacyWallet = createdAtMs => {
  if (createdAtMs == null) {
    return true;
  }
  return createdAtMs <= 1765894825732;
};

/**
 * Whether to use BIP44 for all address types (legacy) vs BIP84/BIP49 by type (standard).
 *
 * - **DKLs23**: always standard paths (ignores created_at).
 * - **GG18** (legacy + post-cutoff): unchanged pre-migration behavior — timestamp
 *   cutoff `1765894825732` ms decides BIP44-only vs BIP84/BIP49 by address type.
 *
 * @param {import('./types/keyshare').KeyshareMetadata|null|undefined} meta
 * @returns {boolean}
 */
export const resolveUseLegacyDerivationPaths = meta => {
  if (!meta || typeof meta !== 'object') {
    return true;
  }
  const backend = detectKeyshareTssBackend(meta);
  if (backend === 'dkls23') {
    return false;
  }
  return isLegacyWallet(normalizeCreatedAtMs(meta.created_at));
};

/**
 * Human-readable wallet creation time for UI (from created_at, any unit).
 * @param {number|string|null|undefined} createdAt
 * @returns {string|null}
 */
export const formatKeyshareCreatedAt = createdAt => {
  const ms = normalizeCreatedAtMs(createdAt);
  if (ms == null) {
    return null;
  }
  return new Date(ms).toLocaleString();
};

/**
 * Full literal creation datetime for toasts / detail (locale-aware, includes timezone).
 * @param {number|string|null|undefined} createdAt
 * @returns {string|null}
 */
export const formatKeyshareCreatedAtLong = createdAt => {
  const ms = normalizeCreatedAtMs(createdAt);
  if (ms == null) {
    return null;
  }
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
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
export const getDerivePathForNetwork = (
  network,
  addressType = 'legacy',
  useLegacyPath = false,
  account = 0,
  change = 0,
  index = 0,
) => {
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

/**
 * Derivation path for receive (external) address at given index.
 * @param {string} network - 'mainnet' or 'testnet3'
 * @param {string} addressType - 'legacy' | 'segwit-native' | 'segwit-compatible'
 * @param {boolean} useLegacyPath - legacy wallet path
 * @param {number} index - address index (default 0)
 */
export const getReceivePath = (
  network,
  addressType,
  useLegacyPath,
  index = 0,
) => getDerivePathForNetwork(network, addressType, useLegacyPath, 0, 0, index);

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
  const formattedWhole = Number(wholePart)
    .toLocaleString('en-US')
    .replace(/,/g, thinSpace);

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
    const paddedDecimal = decimalPart
      .padEnd(Math.max(targetDecimals, 8), '0')
      .slice(0, Math.max(targetDecimals, 8));

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
      formattedDecimal =
        firstTwo +
        (groups.length > 0 ? thinSpace + groups.join(thinSpace) : '');
    } else {
      formattedDecimal = truncatedDecimal;
    }

    // Remove trailing zeros if not requested
    if (!showTrailingZeros) {
      formattedDecimal = formattedDecimal
        .replace(/0+$/, '')
        .replace(new RegExp(thinSpace + '$'), '');
      // If all decimals removed, ensure we have at least the first two digits for consistency
      if (formattedDecimal === '' && truncatedDecimal.length > 0) {
        formattedDecimal = truncatedDecimal.slice(
          0,
          Math.min(2, truncatedDecimal.length),
        );
      }
    }
  } else if (targetDecimals > 0 && showTrailingZeros) {
    // If no decimal part but we want to show decimals, pad with zeros
    formattedDecimal = '00';
    if (targetDecimals > 2) {
      const remainingZeros = '0'.repeat(Math.min(targetDecimals - 2, 6));
      formattedDecimal +=
        thinSpace + remainingZeros.match(/.{1,3}/g)?.join(thinSpace) || '';
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
export const formatSats = satsAmount => {
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

/**
 * Block explorer web UI base from a mempool REST API base (no wallet queries — links only).
 * e.g. https://mempool.space/testnet/api -> https://mempool.space/testnet
 */
export const explorerWebBaseFromApiUrl = apiUrl => {
  if (!apiUrl || typeof apiUrl !== 'string') {
    return '';
  }
  let s = apiUrl.trim().replace(/\/+$/, '');
  if (/\/signet\/api\/?$/i.test(s)) {
    return s.replace(/\/signet\/api\/?$/i, '/signet');
  }
  if (/\/testnet\/api\/?$/i.test(s)) {
    return s.replace(/\/testnet\/api\/?$/i, '/testnet');
  }
  if (/\/api\/?$/i.test(s)) {
    return s.replace(/\/api\/?$/i, '') || s;
  }
  return s;
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
 * Get the keyshare label (KeyShare1, KeyShare2, KeyShare3) from keyshare metadata
 * or full keyshare JSON. Uses the same rule everywhere: index of `local_party_key`
 * in **lexicographically sorted** `keygen_committee_keys` (local LAN and Nostr paths).
 * @param {Object|null|undefined} keyshare
 * @returns {string}
 */
export const getKeyshareLabel = keyshare => {
  if (!keyshare || typeof keyshare !== 'object') {
    return '';
  }

  const lp =
    typeof keyshare.local_party_key === 'string'
      ? keyshare.local_party_key.trim()
      : '';
  if (!lp) {
    return '';
  }

  const keysRaw = keyshare.keygen_committee_keys;
  if (!Array.isArray(keysRaw) || keysRaw.length === 0) {
    return '';
  }

  const committee = keysRaw
    .map(k =>
      typeof k === 'string' ? k.trim() : String(k == null ? '' : k).trim(),
    )
    .filter(Boolean);

  if (committee.length < 2) {
    return '';
  }

  const sortedKeys = [...committee].sort((a, b) =>
    a === b ? 0 : a < b ? -1 : 1,
  );
  const index = sortedKeys.indexOf(lp);
  if (index >= 0) {
    return `KeyShare${index + 1}`;
  }
  return '';
};

/**
 * Map any committee member (npub, hex, or KeyShare-style id) to KeyShareN using the
 * same sorted `keygen_committee_keys` order as DKG / getKeyshareLabel.
 * @param {Object|null|undefined} keyshare
 * @param {string} memberKey
 * @returns {string}
 */
export const getCommitteeKeyshareLabel = (keyshare, memberKey) => {
  if (!keyshare || typeof keyshare !== 'object') {
    return '';
  }
  const mk =
    typeof memberKey === 'string' ? memberKey.trim() : String(memberKey ?? '').trim();
  if (!mk) {
    return '';
  }
  const keysRaw = keyshare.keygen_committee_keys;
  if (!Array.isArray(keysRaw) || keysRaw.length === 0) {
    return '';
  }
  const committee = keysRaw
    .map(k =>
      typeof k === 'string' ? k.trim() : String(k == null ? '' : k).trim(),
    )
    .filter(Boolean);
  if (committee.length < 2) {
    return '';
  }
  const sortedKeys = [...committee].sort((a, b) =>
    a === b ? 0 : a < b ? -1 : 1,
  );
  const index = sortedKeys.indexOf(mk);
  if (index >= 0) {
    return `KeyShare${index + 1}`;
  }
  return '';
};

/**
 * UI label: KeyShareN when committee mapping exists; otherwise raw MPC party id.
 * @param {Object|null|undefined} keyshare
 * @returns {string}
 */
export const getKeyshareDisplayLabel = keyshare => {
  const label = getKeyshareLabel(keyshare);
  if (label) {
    return label;
  }
  if (!keyshare || typeof keyshare !== 'object') {
    return '';
  }
  const lp =
    typeof keyshare.local_party_key === 'string'
      ? keyshare.local_party_key.trim()
      : '';
  return lp || '';
};

/**
 * Encode send bitcoin data into QR code format
 * Format: <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>|<network>|<utxosJson>|<changeAddress>
 * @param {string} toAddress - Bitcoin address to send to
 * @param {string|number} amountSats - Amount in satoshis
 * @param {string|number} feeSats - Fee in satoshis
 * @param {string} spendingHash - Spending hash (can be empty)
 * @param {string} addressType - Address type (e.g., 'segwit-native', 'legacy', 'segwit-compatible')
 * @param {string} derivationPath - Derivation path (e.g., "m/84'/0'/0'/0/0")
 * @param {string} network - Network identifier (e.g., 'mainnet', 'testnet3')
 * @param {string} utxosJson - Optional JSON string of utxosWithPaths used for spending/fee (may be large)
 * @param {string} changeAddress - Optional pre-computed change address (ensures both devices use the same change output)
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
  changeAddress = '',
) => {
  const amount =
    typeof amountSats === 'string' ? amountSats : amountSats.toString();
  const fee = typeof feeSats === 'string' ? feeSats : feeSats.toString();
  return `${toAddress}|${amount}|${fee}|${spendingHash || ''}|${
    addressType || ''
  }|${derivationPath || ''}|${network || ''}|${utxosJson || ''}|${
    changeAddress || ''
  }`;
};

/**
 * Decode send bitcoin data from QR code format
 * Format (v5): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>|<network>|<utxosJson>|<changeAddress>
 * Format (v4): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>|<network>|<utxosJson>
 * Format (v3): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>|<network>
 * Format (v2): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>|<addressType>|<derivationPath>
 * Format (v1): <to_address>|<amount_satoshi>|<fee_satoshi>|<spendingHash>
 * @param {string} qrData - QR code data string
 * @returns {Object|null} - Decoded data object or null if invalid
 */
export const decodeSendBitcoinQR = qrData => {
  if (!qrData || typeof qrData !== 'string') {
    return null;
  }

  const parts = qrData.split('|');
  // Support all versions (3–9 parts)
  if (parts.length < 3 || parts.length > 9) {
    return null;
  }

  const [
    toAddress,
    amountSats,
    feeSats,
    spendingHash = '',
    addressType = '',
    derivationPath = '',
    network = '',
    utxosJson = '',
    changeAddress = '',
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
    changeAddress: changeAddress || '',
  };
};

// ---------------------------------------------------------------------------
// Keyshare metadata helpers
// Only the safe (non-secret) fields are stored in 'keyshare_meta'.
// The same JSON is mirrored in SQLite app_config (KEYSHARE_META_JSON) for
// offline/cache use when Encrypted `keyshare_meta` is missing (migration, etc.).
// The full MPC blob in 'keyshare' is only read when signing is required.
// Use runtime require() for AppConfigRepository to avoid a utils ↔ repository cycle.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} KeyshareMetadata
 * @property {string} pub_key
 * @property {string} chain_code_hex
 * @property {number|null} created_at
 * @property {string} local_party_key
 * @property {string[]} keygen_committee_keys
 * @property {string|null} nostr_npub
 */

function normalizeKeyshareMetaObject(parsed) {
  const tss_backend =
    parsed.tss_backend === 'dkls23' || parsed.tss_backend === 'gg18'
      ? parsed.tss_backend
      : detectKeyshareTssBackend(parsed);
  const rawCreated = parsed.created_at ?? null;
  const created_at =
    rawCreated != null ? normalizeCreatedAtMs(rawCreated) : null;
  return {
    pub_key: parsed.pub_key ?? '',
    chain_code_hex: parsed.chain_code_hex ?? '',
    created_at,
    local_party_key: parsed.local_party_key ?? '',
    keygen_committee_keys: parsed.keygen_committee_keys ?? [],
    nostr_npub: parsed.nostr_npub ?? null,
    tss_backend,
  };
}

function safeParseKeyshareMetaJson(raw) {
  if (raw == null || String(raw).trim() === '') {
    return null;
  }
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** Enough structure for routing/UI (co-signer list, local party id). */
function keyshareMetaLooksComplete(meta) {
  if (!meta || typeof meta !== 'object') {
    return false;
  }
  const lp = meta.local_party_key;
  const comm = meta.keygen_committee_keys;
  if (typeof lp !== 'string' || lp.trim() === '') {
    return false;
  }
  if (!Array.isArray(comm) || comm.length < 2) {
    return false;
  }
  return true;
}

function loadAppConfigRepository() {
  try {
    const mod = require('./services/repositories/AppConfigRepository');
    return {repo: mod.default, CONFIG_KEYS: mod.CONFIG_KEYS};
  } catch (e) {
    dbg('keyshare meta: AppConfigRepository unavailable', e);
    return {repo: null, CONFIG_KEYS: null};
  }
}

function keyshareMetaNeedsCreatedAtBackfill(raw, normalized) {
  if (!raw || !normalized) {
    return false;
  }
  const rawCa = raw.created_at;
  if (rawCa == null) {
    return false;
  }
  return normalizeCreatedAtMs(rawCa) !== rawCa;
}

async function persistNormalizedKeyshareMeta(meta, repo, CONFIG_KEYS) {
  const json = JSON.stringify(meta);
  await EncryptedStorage.setItem('keyshare_meta', json);
  if (repo && CONFIG_KEYS) {
    try {
      repo.set(CONFIG_KEYS.KEYSHARE_META_JSON, json);
    } catch (e) {
      dbg('persistNormalizedKeyshareMeta: DB mirror failed (non-fatal)', e);
    }
  }
}

/**
 * Metadata cache omits MPC secrets; re-infer tss_backend from full keyshare when missing
 * so DKLs wallets are not treated as GG18 for path policy.
 * @param {import('./types/keyshare').KeyshareMetadata} meta
 * @returns {Promise<import('./types/keyshare').KeyshareMetadata>}
 */
async function enrichMetaTssBackendFromFullKeyshare(meta) {
  if (meta.tss_backend === 'dkls23' || meta.tss_backend === 'gg18') {
    return meta;
  }
  try {
    const full = await EncryptedStorage.getItem('keyshare');
    if (!full || String(full).trim() === '') {
      return meta;
    }
    const parsed = JSON.parse(full);
    const backend = detectKeyshareTssBackend(parsed);
    if (backend === meta.tss_backend) {
      return meta;
    }
    return {...meta, tss_backend: backend};
  } catch (e) {
    dbg('enrichMetaTssBackendFromFullKeyshare: failed', e);
    return meta;
  }
}

function metaNeedsPersistAfterEnrich(before, after) {
  if (!before || !after) {
    return false;
  }
  return (
    before.tss_backend !== after.tss_backend ||
    before.created_at !== after.created_at
  );
}

/**
 * Extract and persist only the non-secret metadata fields from a keyshare JSON string.
 * Call this whenever EncryptedStorage.setItem('keyshare', …) is called.
 * @param {string} keyshareJson - Raw keyshare JSON string
 */
export const saveKeyshareMetadata = async keyshareJson => {
  try {
    const parsed = JSON.parse(keyshareJson);
    const meta = normalizeKeyshareMetaObject(parsed);
    const json = JSON.stringify(meta);
    await EncryptedStorage.setItem('keyshare_meta', json);
    const {repo, CONFIG_KEYS} = loadAppConfigRepository();
    if (repo && CONFIG_KEYS) {
      try {
        repo.set(CONFIG_KEYS.KEYSHARE_META_JSON, json);
      } catch (e) {
        dbg('saveKeyshareMetadata: DB mirror failed (non-fatal)', e);
      }
    }
    dbg('saveKeyshareMetadata: saved metadata');
    DeviceEventEmitter.emit('wallet:keyshare-ready');
  } catch (e) {
    dbg('saveKeyshareMetadata: failed', e);
  }
};

/**
 * True when secure storage has the full `keyshare` blob (wallet exists).
 * Uses native RNES key presence when available (no JSON load/decrypt through JS).
 */
export async function hasWalletKeyshareInSecureStorage() {
  const native = BBMTLibNativeModule?.hasKeyshareInSecureStorage;
  if (typeof native === 'function') {
    try {
      const result = await native();
      return result === true || result === 'true' || result === 1;
    } catch (e) {
      dbg('hasWalletKeyshareInSecureStorage: native check failed', e);
      return false;
    }
  }
  try {
    const raw = await EncryptedStorage.getItem(KEYSHARE_STORAGE_KEY);
    return !!(raw && String(raw).trim());
  } catch (e) {
    dbg('hasWalletKeyshareInSecureStorage: fallback failed', e);
    return false;
  }
}

/**
 * Initial stack route after unlock: MainTabs only when the keyshare blob exists.
 * Clears orphan `keyshare_meta` / DB mirror when metadata exists without a blob
 * (e.g. interrupted setup or debug keygen that saved meta only).
 */
/**
 * @param {{ clearOrphanMeta?: boolean }} [opts]
 * @returns {Promise<'MainTabs'|'Welcome'>}
 */
export async function resolveInitialWalletRoute(opts = {}) {
  const clearOrphanMeta = opts.clearOrphanMeta !== false;
  let hasKeyshare = await hasWalletKeyshareInSecureStorage();
  if (!hasKeyshare) {
    // Native presence check can be false on some builds; trust metadata mirror if present.
    const meta = await getKeyshareMetadata();
    if (meta && keyshareMetaLooksComplete(meta)) {
      dbg(
        'resolveInitialWalletRoute: no keyshare blob but metadata present — MainTabs',
      );
      hasKeyshare = true;
    }
  }
  if (!hasKeyshare) {
    if (clearOrphanMeta) {
      try {
        await clearKeyshareMetadata();
      } catch (e) {
        dbg('resolveInitialWalletRoute: clear orphan meta failed', e);
      }
    }
    dbg('resolveInitialWalletRoute: no keyshare → Welcome');
    return 'Welcome';
  }
  dbg('resolveInitialWalletRoute: keyshare present → MainTabs');
  return 'MainTabs';
}

/**
 * Read the non-secret keyshare metadata without loading the full MPC blob.
 * Prefers EncryptedStorage `keyshare_meta` (always written with `keyshare` saves)
 * so committee/npub data cannot drift from the keychain keyshare. SQLite is a
 * fallback when Encrypted is empty, then legacy `keyshare` parse.
 * @returns {Promise<import('./types/keyshare').KeyshareMetadata|null>} Metadata object or null if not available
 */
export const getKeyshareMetadata = async () => {
  const {repo, CONFIG_KEYS} = loadAppConfigRepository();

  const legacyInMemoryFallback = legacyJson => {
    try {
      const parsed = JSON.parse(legacyJson);
      return normalizeKeyshareMetaObject(parsed);
    } catch {
      return null;
    }
  };

  try {
    const rawEnc = await EncryptedStorage.getItem('keyshare_meta');
    const encParsed = safeParseKeyshareMetaJson(rawEnc);
    const encNorm = encParsed ? normalizeKeyshareMetaObject(encParsed) : null;
    const encOk = encNorm && keyshareMetaLooksComplete(encNorm);

    if (encOk) {
      let out = encNorm;
      const enriched = await enrichMetaTssBackendFromFullKeyshare(encNorm);
      if (metaNeedsPersistAfterEnrich(encNorm, enriched)) {
        out = enriched;
      }
      if (
        keyshareMetaNeedsCreatedAtBackfill(encParsed, out) ||
        metaNeedsPersistAfterEnrich(encNorm, out)
      ) {
        try {
          await persistNormalizedKeyshareMeta(out, repo, CONFIG_KEYS);
        } catch (e) {
          dbg('getKeyshareMetadata: meta backfill failed', e);
        }
      } else if (repo && CONFIG_KEYS) {
        try {
          repo.set(CONFIG_KEYS.KEYSHARE_META_JSON, JSON.stringify(out));
        } catch (e) {
          dbg('getKeyshareMetadata: sync DB from Encrypted failed', e);
        }
      }
      return out;
    }

    const dbRaw =
      repo && CONFIG_KEYS ? repo.get(CONFIG_KEYS.KEYSHARE_META_JSON) : null;
    const dbParsed = safeParseKeyshareMetaJson(dbRaw);
    const dbNorm = dbParsed ? normalizeKeyshareMetaObject(dbParsed) : null;
    const dbOk = dbNorm && keyshareMetaLooksComplete(dbNorm);

    if (dbOk) {
      if (keyshareMetaNeedsCreatedAtBackfill(dbParsed, dbNorm)) {
        try {
          await persistNormalizedKeyshareMeta(dbNorm, repo, CONFIG_KEYS);
        } catch (e) {
          dbg('getKeyshareMetadata: DB created_at backfill failed', e);
        }
      } else {
        try {
          await EncryptedStorage.setItem(
            'keyshare_meta',
            JSON.stringify(dbNorm),
          );
        } catch (e) {
          dbg('getKeyshareMetadata: backfill Encrypted from DB failed', e);
        }
      }
      return dbNorm;
    }

    const legacy = await EncryptedStorage.getItem('keyshare');
    if (!legacy || String(legacy).trim() === '') {
      return null;
    }
    await saveKeyshareMetadata(legacy);
    const rawAfter = await EncryptedStorage.getItem('keyshare_meta');
    if (rawAfter) {
      const again = safeParseKeyshareMetaJson(rawAfter);
      if (again && keyshareMetaLooksComplete(normalizeKeyshareMetaObject(again))) {
        return normalizeKeyshareMetaObject(again);
      }
    }
    const mem = legacyInMemoryFallback(legacy);
    if (mem && keyshareMetaLooksComplete(mem)) {
      return mem;
    }
    return null;
  } catch (e) {
    dbg('getKeyshareMetadata: failed', e);
    return null;
  }
};

/**
 * Remove the cached keyshare metadata (EncryptedStorage + SQLite mirror).
 * Call this whenever EncryptedStorage.removeItem('keyshare') is called.
 */
export const clearKeyshareMetadata = async () => {
  try {
    await EncryptedStorage.removeItem('keyshare_meta');
    const {repo, CONFIG_KEYS} = loadAppConfigRepository();
    if (repo && CONFIG_KEYS) {
      try {
        repo.remove(CONFIG_KEYS.KEYSHARE_META_JSON);
      } catch (e) {
        dbg('clearKeyshareMetadata: DB remove failed (non-fatal)', e);
      }
    }
    dbg('clearKeyshareMetadata: cleared');
  } catch (e) {
    dbg('clearKeyshareMetadata: failed', e);
  }
};
