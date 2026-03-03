import Big from 'big.js';
import {BBMTLibNativeModule} from '../native_modules';
import {dbg, getChangePath, getMainnetAPIList, getReceivePath, GAP_LIMIT, isLegacyWallet, MIN_SCAN_INDEX} from '../utils';
import LocalCache from './LocalCache';
import EncryptedStorage from 'react-native-encrypted-storage';
import {
  getChangeIndex,
  getExternalIndex,
  getMaxUsedExternal,
  incrementChangeIndexAfterSend as hdIncrementChangeIndexAfterSend,
  setChangeIndex,
  setExternalIndex,
  setMaxUsedExternal,
} from './HdIndexService';
import { validate as validateBitcoinAddress } from 'bitcoin-address-validation';
export interface WalletBalance {
  btc: string;
  usd: string;
  hasNonZeroBalance: boolean;
  timestamp: number;
}

/** In-scope HD address with derivation path and chain (for UTXO tab and multi-address send). */
export interface HdAddressWithPath {
  address: string;
  derivationPath: string;
  chain: 'receive' | 'change';
  index: number;
}

/** Mempool.space UTXO item: txid, vout, value (sats), status. */
export interface ApiUtxo {
  txid: string;
  vout: number;
  value: number;
  status?: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

/** UTXO with HD context: address, derivation path, and chain (receive vs change). */
export interface UtxoWithPath extends ApiUtxo {
  address: string;
  derivationPath: string;
  chain: 'receive' | 'change';
  chainIndex: number;
}

export interface Transaction {
  txid: string;
  timestamp?: number;
  amount: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
  type: 'send' | 'receive' | 'consolidation' | 'pending';
  address: string;
  from?: string;
  to?: string;
  sentAt?: number;
  vin?: Array<{
    prevout: {
      scriptpubkey_address: string;
      value: number;
    };
  }>;
  vout?: Array<{
    scriptpubkey_address: string;
    value: number;
  }>;
}
interface CachedTransactionData {
  transactions: Transaction[];
  timestamp: number;
}
export const waitMS = (ms = 2000) =>
  new Promise(resolve => setTimeout(resolve, ms));
// Add validation functions (exported for address-for-network checks, e.g. QR scan)
export const validateBitcoinAddressEnhanced = (address: string, network: string = 'mainnet'): boolean => {
  if (!address || typeof address !== 'string') {
    dbg('WalletService: Bitcoin address validation failed - empty or invalid type');
    return false;
  }
  try {
    // Use the bitcoin-address-validation library for comprehensive validation
    const result = validateBitcoinAddress(address);
    if (!result) {
      dbg('WalletService: Bitcoin address validation failed - invalid format');
      return false;
    }
    // Additional network-specific validation
    const isTestnet = network === 'testnet';
    // Check address type based on network
    if (isTestnet) {
      // Testnet addresses: m, n, 2, tb1 prefixes
      if (!(address.startsWith('m') || address.startsWith('n') ||
            address.startsWith('2') || address.startsWith('tb1'))) {
        dbg('WalletService: Bitcoin address validation failed - testnet address expected');
        return false;
      }
    } else {
      // Mainnet addresses: 1, 3, bc1 prefixes
      if (!(address.startsWith('1') || address.startsWith('3') || address.startsWith('bc1'))) {
        dbg('WalletService: Bitcoin address validation failed - mainnet address expected');
        return false;
      }
    }
    dbg('WalletService: Bitcoin address validation passed:', address, 'for network:', network);
    return true;
  } catch (error) {
    dbg('WalletService: Bitcoin address validation error:', error);
    return false;
  }
};
const validateNumber = (value: any): boolean => {
  if (value === null || value === undefined) {
    dbg('WalletService: Number validation failed - null/undefined value');
    return false;
  }
  try {
    const num = new Big(value);
    const isValid = num.gte(0) || num.lt(0);
    dbg(
      'WalletService: Number validation',
      isValid ? 'passed' : 'failed',
      'for value:',
      value,
    );
    return isValid;
  } catch (error) {
    dbg(
      'WalletService: Number validation failed - invalid number format:',
      value,
      'Error:',
      error,
    );
    return false;
  }
};
export class WalletService {
  private static instance: WalletService;
  private readonly API_TIMEOUT = 5000; // 5 seconds timeout
  private abortController = new AbortController();
  private currentAddress: string | null = null;
  private currentNetwork: string = 'mainnet'; // Default to mainnet
  private currentAddressType: string = 'legacy'; // Default to legacy
  private currentApiUrl: string = 'https://mempool.space/api';
  private fetchInProgress: {[key: string]: boolean} = {};
  private fetchTimeout: {[key: string]: NodeJS.Timeout} = {};
  private constructor() {
    // Don't auto-initialize, wait for explicit initialize call
  }
  public async initialize() {
    try {
      // Check for keyshare first
      const keyshare = await EncryptedStorage.getItem('keyshare');
      if (!keyshare) {
        dbg('WalletService: No keyshare found, skipping initialization');
        return;
      }
      // Initialize network state from storage
      await this.initializeNetworkState();
      dbg('WalletService: Initialization completed successfully');
    } catch (error) {
      dbg('WalletService: Error during initialization:', error);
      throw error;
    }
  }
  private async setBal(address: string, balance: WalletBalance) {
    await LocalCache.setItem(
      `wallet_balance_${address}`,
      JSON.stringify({...balance, timestamp: balance.timestamp ?? Date.now()}),
    );
  }
  private async setTxs(address: string, transactions: Transaction[]) {
    await LocalCache.setItem(
      `wallet_transactions_${address}`,
      JSON.stringify({transactions, timestamp: Date.now()}),
    );
  }
  public async getBal(address: string): Promise<WalletBalance> {
    const balance = await LocalCache.getItem(`wallet_balance_${address}`);
    return JSON.parse(
      balance ||
        '{"btc":"0.00000000","usd":"$0.00","hasNonZeroBalance":false,"timestamp":0}',
    );
  }
  public async getTxs(address: string): Promise<CachedTransactionData> {
    const txs = await LocalCache.getItem(`wallet_transactions_${address}`);
    return txs ? JSON.parse(txs) : {transactions: [], timestamp: 0};
  }
  private async setPrice(price: {
    price: string;
    rate: number;
    rates: {[key: string]: number};
  }) {
    await LocalCache.setItem(
      'price',
      JSON.stringify({...price, timestamp: Date.now()}),
    );
  }
  public async getCachePrice(): Promise<{
    price: string;
    rate: number;
    rates: {[key: string]: number};
    timestamp: number;
  }> {
    const price = await LocalCache.getItem('price');
    return price
      ? JSON.parse(price)
      : {price: '$0.00', rate: 0, rates: {}, timestamp: 0};
  }
  private async getStoredState() {
    try {
      const network = (await LocalCache.getItem('network')) || 'mainnet';
      const addressType = (await LocalCache.getItem('addressType')) || 'legacy';
      let api = await LocalCache.getItem('api');
      if (!api) {
        api =
          network === 'mainnet'
            ? 'https://mempool.space/api'
            : 'https://mempool.space/testnet/api';
      }
      const address = await LocalCache.getItem('currentAddress');
      return {
        network,
        addressType,
        api,
        address,
      };
    } catch (error) {
      dbg('WalletService: Error getting stored state:', error);
      throw error;
    }
  }
  private async saveStoredState(state: {
    network?: string;
    addressType?: string;
    api?: string;
    address?: string;
  }) {
    try {
      if (state.network) {
        await LocalCache.setItem('network', state.network);
      }
      if (state.addressType) {
        await LocalCache.setItem('addressType', state.addressType);
      }
      if (state.api) {
        await LocalCache.setItem('api', state.api);
      }
      if (state.address) {
        await LocalCache.setItem('currentAddress', state.address);
      }
      dbg('WalletService: Saved state to storage:', state);
    } catch (error) {
      dbg('WalletService: Error saving state:', error);
      throw error;
    }
  }
  private async initializeNetworkState() {
    try {
      const state = await this.getStoredState();
      this.currentNetwork = state.network;
      this.currentAddressType = state.addressType;
      this.currentApiUrl = state.api;
      this.currentAddress = state.address;
      dbg('WalletService: Initialized network state:', {
        network: this.currentNetwork,
        addressType: this.currentAddressType,
        api: this.currentApiUrl,
        address: this.currentAddress,
      });
    } catch (error) {
      dbg('WalletService: Error initializing network state:', error);
      throw error;
    }
  }
  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  /**
   * Returns the next change (internal chain) address for the given network and address type.
   * Does not increment the change index; call incrementChangeIndexAfterSend() after successful broadcast.
   */
  public async getNextChangeAddress(
    network: string,
    addressType: string,
  ): Promise<string> {
    const jks = await EncryptedStorage.getItem('keyshare');
    if (!jks) throw new Error('No keyshare found');
    const ks = JSON.parse(jks);
    const useLegacyPath = isLegacyWallet(ks.created_at);
    const changeIdx = await getChangeIndex(network, addressType);
    const path = getChangePath(network, addressType, useLegacyPath, changeIdx);
    const btcPub = await BBMTLibNativeModule.derivePubkey(
      ks.pub_key,
      ks.chain_code_hex,
      path,
    );
    const changeAddress = await BBMTLibNativeModule.btcAddress(
      btcPub,
      network,
      addressType,
    );
    dbg('WalletService: getNextChangeAddress', {network, addressType, changeIdx, changeAddress: changeAddress?.slice(0, 12) + '...'});
    return changeAddress;
  }

  /** Call after a send has been successfully broadcast to advance the change index. */
  public async incrementChangeIndexAfterSend(
    network: string,
    addressType: string,
  ): Promise<void> {
    await hdIncrementChangeIndexAfterSend(network, addressType);
  }

  /**
   * Derive the next receive (external) address and persist it as current.
   * Call when user requests "Get new address" to avoid address reuse.
   */
  public async getNextReceiveAddress(
    network: string,
    addressType: string,
  ): Promise<string> {
    const jks = await EncryptedStorage.getItem('keyshare');
    if (!jks) throw new Error('No keyshare found');
    const ks = JSON.parse(jks);
    const useLegacyPath = isLegacyWallet(ks.created_at);
    const nextIndex = (await getExternalIndex(network, addressType)) + 1;
    await setExternalIndex(network, addressType, nextIndex);
    const path = getReceivePath(network, addressType, useLegacyPath, nextIndex);
    const btcPub = await BBMTLibNativeModule.derivePubkey(
      ks.pub_key,
      ks.chain_code_hex,
      path,
    );
    const newAddress = await BBMTLibNativeModule.btcAddress(
      btcPub,
      network,
      addressType,
    );
    await this.saveStoredState({address: newAddress});
    this.currentAddress = newAddress;
    dbg('WalletService: getNextReceiveAddress', {network, addressType, nextIndex});
    return newAddress;
  }

  /**
   * Fetches UTXOs for all in-scope HD addresses (receive + change) and tags each with its derivation path.
   * Used by multi-path send flow and can be reused by UtxosScreen.
   * @param network - 'mainnet' | 'testnet'
   * @param addressType - e.g. 'segwit-native'
   * @param apiUrl - base API URL (e.g. https://mempool.space/api)
   * @param signal - optional AbortSignal for cancellation
   */
  public async fetchUtxosWithPaths(
    network: string,
    addressType: string,
    apiUrl: string,
    signal?: AbortSignal,
  ): Promise<UtxoWithPath[]> {
    const baseUrl = apiUrl.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const fullApiUrl = `${baseUrl}/api`;
    const isTestnetApi = /\/testnet(\/|$)/.test(fullApiUrl);

    const addressesWithPaths = await this.getHdAddressesWithPaths(
      network,
      addressType || 'segwit-native',
    );
    if (addressesWithPaths.length === 0) return [];

    const merged: UtxoWithPath[] = [];
    const controller = signal ? undefined : new AbortController();
    const fetchSignal = signal ?? controller?.signal;
    if (controller) {
      setTimeout(() => controller.abort(), 20000);
    }

    await Promise.all(
      addressesWithPaths.map(async ({address, derivationPath, chain, index}) => {
        if (!this.addressMatchesNetwork(address, isTestnetApi)) return;
        try {
          const utxoUrl = `${fullApiUrl}/address/${encodeURIComponent(address)}/utxo`;
          const res = await this.withTimeout(
            `utxo-${address.slice(0, 12)}`,
            fetch(utxoUrl, {signal: fetchSignal}),
            8000,
          );
          if (!res.ok) return;
          const rawList: ApiUtxo[] = await res.json();
          if (!Array.isArray(rawList)) return;
          for (const u of rawList) {
            merged.push({
              ...u,
              address,
              derivationPath,
              chain,
              chainIndex: index,
            });
          }
        } catch {
          // skip failed address
        }
      }),
    );

    // Sort: receive first, then change; by chain index; then by block_time desc (newest first)
    merged.sort((a, b) => {
      if (a.chain !== b.chain) return a.chain === 'receive' ? -1 : 1;
      if (a.chainIndex !== b.chainIndex) return a.chainIndex - b.chainIndex;
      const ta = a.status?.block_time ?? 0;
      const tb = b.status?.block_time ?? 0;
      return tb - ta;
    });

    return merged;
  }

  private addressMatchesNetwork(addr: string, isTestnetApi: boolean): boolean {
    if (!addr) return false;
    if (isTestnetApi) {
      return (
        ['m', 'n', '2', 't'].some(p => addr.startsWith(p)) ||
        addr.startsWith('tb1')
      );
    }
    return (
      ['1', '3', 'b'].some(p => addr.startsWith(p)) || addr.startsWith('bc1')
    );
  }

  /**
   * Returns all in-scope HD addresses with derivation path and chain (receive vs change).
   * Used by UTXOs tab and multi-address send to fetch UTXOs per address and show path in UI.
   */
  public async getHdAddressesWithPaths(
    network: string,
    addressType: string,
  ): Promise<HdAddressWithPath[]> {
    const jks = await EncryptedStorage.getItem('keyshare');
    if (!jks) return [];
    const ks = JSON.parse(jks);
    const useLegacyPath = isLegacyWallet(ks.created_at);
    const externalIdx = await getExternalIndex(network, addressType);
    const maxUsedExternal = await getMaxUsedExternal(network, addressType);
    const changeIdx = await getChangeIndex(network, addressType);
    // Always scan at least 0..MIN_SCAN_INDEX so path 0 and old paths are never missed
    const externalEnd = Math.max(MIN_SCAN_INDEX, Math.max(externalIdx, maxUsedExternal) + GAP_LIMIT);
    const internalEnd = Math.max(MIN_SCAN_INDEX, changeIdx + GAP_LIMIT);
    const results: HdAddressWithPath[] = [];
    for (let i = 0; i <= externalEnd; i++) {
      const path = getReceivePath(network, addressType, useLegacyPath, i);
      const pub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      const address = await BBMTLibNativeModule.btcAddress(
        pub,
        network,
        addressType,
      );
      results.push({address, derivationPath: path, chain: 'receive', index: i});
    }
    for (let i = 0; i <= internalEnd; i++) {
      const path = getChangePath(network, addressType, useLegacyPath, i);
      const pub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      const address = await BBMTLibNativeModule.btcAddress(
        pub,
        network,
        addressType,
      );
      results.push({address, derivationPath: path, chain: 'change', index: i});
    }
    return results;
  }

  /**
   * Returns the current receive address derivation path and index for display (e.g. ReceiveModal).
   */
  public async getCurrentReceivePathInfo(
    network: string,
    addressType: string,
  ): Promise<{path: string; index: number} | null> {
    const jks = await EncryptedStorage.getItem('keyshare');
    if (!jks) {
      dbg('WalletService: getCurrentReceivePathInfo - no keyshare');
      return null;
    }
    const ks = JSON.parse(jks);
    const useLegacyPath = isLegacyWallet(ks.created_at);
    const index = await getExternalIndex(network, addressType);
    const path = getReceivePath(network, addressType, useLegacyPath, index);
    dbg('WalletService: getCurrentReceivePathInfo', {
      network,
      addressType,
      index,
      path,
    });
    return {path, index};
  }

  /**
   * HD rule: An address is USED if it has EVER appeared in transaction history (confirmed or mempool),
   * regardless of current UTXO state. Used for restore discovery to prevent address reuse.
   */
  private async isAddressUsed(address: string, apiUrl: string): Promise<boolean> {
    try {
      const baseUrl = apiUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/address/${address}/txs`;
      const response = await this.withTimeout(
        `txs-${address.slice(0, 12)}`,
        fetch(url, {signal: this.abortController.signal}),
        5000,
      );
      if (!response.ok) {
        dbg('WalletService: isAddressUsed fetch failed', {address: address.slice(0, 12), status: response.status});
        return true; // Conservative: treat as used to avoid reuse
      }
      const data = (await response.json()) as unknown;
      const hasTxs = Array.isArray(data) && data.length > 0;
      dbg('WalletService: isAddressUsed', {address: address.slice(0, 12), hasTxs});
      return hasTxs;
    } catch (error) {
      dbg('WalletService: isAddressUsed error', {address: address.slice(0, 12), error});
      return true; // Conservative: treat as used to avoid reuse
    }
  }

  /**
   * Restore discovery: scan external and internal chains until GAP_LIMIT consecutive
   * unused addresses, then set externalIndex, maxUsedExternal, and changeIndex from chain state.
   * Uses transaction history (not UTXO-only) per HD rule: address is used if it has EVER appeared in a tx.
   * Call after LocalCache.clear() (storage clear) or keyshare import.
   */
  /** Progress: chain, current index, consecutive unused count */
  public async discoverHdIndexesForNetwork(
    network: string,
    addressType: string,
    apiUrl: string,
    onProgress?: (chain: 'external' | 'internal', index: number, gapIndex: number) => void,
  ): Promise<void> {
    dbg('WalletService: discoverHdIndexesForNetwork START', {
      network,
      addressType,
      apiUrl: apiUrl?.slice(0, 40) + '...',
    });
    const jks = await EncryptedStorage.getItem('keyshare');
    if (!jks) {
      dbg('WalletService: No keyshare, skipping restore discovery');
      return;
    }
    const ks = JSON.parse(jks);
    const useLegacyPath = isLegacyWallet(ks.created_at);
    BBMTLibNativeModule.setAPI(network, apiUrl);
    dbg('WalletService: Restore discovery - scanning external chain', {
      network,
      addressType,
      useLegacyPath,
    });

    // External chain: scan until GAP_LIMIT consecutive unused
    let maxUsedExternal = -1;
    let consecutiveUnused = 0;
    for (let i = 0; consecutiveUnused < GAP_LIMIT; i++) {
      const path = getReceivePath(network, addressType, useLegacyPath, i);
      const pub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      const addr = await BBMTLibNativeModule.btcAddress(
        pub,
        network,
        addressType,
      );
      try {
        onProgress?.('external', i, consecutiveUnused);
        const used = await this.isAddressUsed(addr, apiUrl);
        if (used) {
          maxUsedExternal = i;
          consecutiveUnused = 0;
        } else {
          consecutiveUnused++;
        }
      } catch {
        maxUsedExternal = i; // Conservative: treat as used on error
        consecutiveUnused = 0;
      }
    }
    const externalNext = maxUsedExternal + 1;
    await setExternalIndex(network, addressType, externalNext);
    await setMaxUsedExternal(network, addressType, Math.max(0, maxUsedExternal));
    dbg('WalletService: Restore discovery external chain DONE', {
      network,
      addressType,
      maxUsedExternal,
      externalNext,
    });

    // Internal (change) chain: same logic
    dbg('WalletService: Restore discovery - scanning internal (change) chain', {
      network,
      addressType,
    });
    let maxUsedChange = -1;
    consecutiveUnused = 0;
    for (let i = 0; consecutiveUnused < GAP_LIMIT; i++) {
      const path = getChangePath(network, addressType, useLegacyPath, i);
      const pub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      const addr = await BBMTLibNativeModule.btcAddress(
        pub,
        network,
        addressType,
      );
      try {
        onProgress?.('internal', i, consecutiveUnused);
        const used = await this.isAddressUsed(addr, apiUrl);
        if (used) {
          maxUsedChange = i;
          consecutiveUnused = 0;
        } else {
          consecutiveUnused++;
        }
      } catch {
        maxUsedChange = i; // Conservative: treat as used on error
        consecutiveUnused = 0;
      }
    }
    const changeNext = maxUsedChange + 1;
    await setChangeIndex(network, addressType, changeNext);
    dbg('WalletService: Restore discovery internal chain DONE', {
      network,
      addressType,
      maxUsedChange,
      changeNext,
    });
    // Mark restore discovery as completed for this (network, addressType) pair
    await LocalCache.setItem(
      `hd_restore_done_${network}_${addressType}`,
      'yes',
    );
    dbg('WalletService: discoverHdIndexesForNetwork COMPLETE', {
      network,
      addressType,
    });
  }

  // Add method to cancel ongoing fetches
  private cancelOngoingFetches(key: string) {
    if (this.fetchInProgress[key]) {
      this.abortController.abort();
      this.abortController = new AbortController();
      this.fetchInProgress[key] = false;
      if (this.fetchTimeout[key]) {
        clearTimeout(this.fetchTimeout[key]);
        delete this.fetchTimeout[key];
      }
    }
  }
  // Add method to handle API timeouts
  private async withTimeout<T>(
    key: string,
    promise: Promise<T>,
    timeout: number = this.API_TIMEOUT,
  ): Promise<T> {
    this.cancelOngoingFetches(key);
    this.fetchInProgress[key] = true;
    const timeoutPromise = new Promise<T>((_, reject) => {
      this.fetchTimeout[key] = setTimeout(() => {
        this.fetchInProgress[key] = false;
        reject(new Error(`API call timed out after ${timeout}ms`));
      }, timeout);
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(this.fetchTimeout[key]);
      delete this.fetchTimeout[key];
      this.fetchInProgress[key] = false;
      return result;
    } catch (error) {
      this.fetchInProgress[key] = false;
      throw error;
    }
  }
  public async getBitcoinPrice(): Promise<{
    price: string;
    rate: number;
    rates: {[key: string]: number};
    timestamp: number;
  }> {
    try {
      // Get the list of mainnet API endpoints
      const apiEndpoints = await getMainnetAPIList();
      dbg('WalletService: Attempting to fetch BTC price using round-robin from APIs:', apiEndpoints);
      let lastError: any = null;
      // Try each API endpoint in sequence until one succeeds
      for (const baseApiUrl of apiEndpoints) {
        try {
          // Always use mainnet price endpoint (remove any testnet suffix)
          const priceUrl = baseApiUrl.replace(/\/testnet\/?$/, '') + '/v1/prices';
          dbg('WalletService: Trying price API URL:', priceUrl);
          const response = await this.withTimeout(
            'price',
            fetch(priceUrl, {signal: this.abortController.signal}),
          );
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          const data = await response.json();
          dbg('WalletService: Raw price data received from', priceUrl, ':', data);
          if (!data || !data.USD || !validateNumber(data.USD)) {
            dbg('WalletService: Invalid price data received from', priceUrl, ':', data);
            throw new Error('Invalid price data received');
          }
          const rate = parseFloat(data.USD);
          dbg('WalletService: Parsed rate:', rate);
          if (isNaN(rate) || rate <= 0) {
            dbg('WalletService: Invalid rate value:', rate);
            throw new Error('Invalid rate value');
          }
          const price = this.formatUSD(data.USD);
          dbg('WalletService: New price fetched from', priceUrl, '- Rate:', rate, 'Price:', price);
          // Use all available rates from the API response
          const rates: {[key: string]: number} = {};
          Object.entries(data).forEach(([currency, value]) => {
            if (typeof value === 'number' && !isNaN(value) && value > 0) {
              rates[currency] = value;
            }
          });
          dbg('WalletService: Available currencies:', Object.keys(rates));
          await this.setPrice({price, rate, rates});
          dbg('WalletService: Price cache updated');
          return {price, rate, rates, timestamp: Date.now()};
        } catch (error) {
          dbg('WalletService: Failed to fetch from', baseApiUrl, ':', error);
          lastError = error;
          // Continue to next API endpoint
          continue;
        }
      }
      // If all endpoints failed, throw the last error
      throw lastError || new Error('All price API endpoints failed');
    } catch (error) {
      dbg('WalletService: Error fetching BTC price from all endpoints:', error);
      return await this.getCachePrice();
    }
  }
  public async handleNetworkChange(network: string, apiUrl: string) {
    dbg('WalletService: Network changed to:', network, 'with API:', apiUrl);
    try {
      // Update native module network state first
      await BBMTLibNativeModule.setBtcNetwork(network);
      dbg('WalletService: Updated native module network state');
      // Get current state
      const state = await this.getStoredState();
      // Clear all state and caches
      this.currentAddress = null;
      this.currentNetwork = network;
      this.currentApiUrl = apiUrl;
      this.fetchInProgress = {};
      Object.values(this.fetchTimeout).forEach(timeout =>
        clearTimeout(timeout),
      );
      this.fetchTimeout = {};
      // Clear persistent storage
      try {
        await LocalCache.removeItem('walletCache');
        dbg('WalletService: Cleared persistent cache');
      } catch (error) {
        dbg('WalletService: Error clearing persistent cache:', error);
      }
      // Generate address for the current network at current external index (HD)
      try {
        const jks = await EncryptedStorage.getItem('keyshare');
        const ks = JSON.parse(jks || '{}');
        const useLegacyPath = isLegacyWallet(ks.created_at);
        const externalIndex = await getExternalIndex(network, state.addressType);
        const path = getReceivePath(network, state.addressType, useLegacyPath, externalIndex);
        const btcPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        // Generate new address for current network and type
        const newAddress = await BBMTLibNativeModule.btcAddress(
          btcPub,
          network,
          state.addressType,
        );
        // Save all state changes at once
        await this.saveStoredState({
          network,
          api: apiUrl,
          address: newAddress,
        });
        this.currentAddress = newAddress;
        dbg('WalletService: Generated new address for network:', {
          network,
          addressType: state.addressType,
          address: newAddress,
        });
      } catch (error) {
        dbg('WalletService: Error generating new address:', error);
        throw error;
      }
      // Create new instance with network state
      const newInstance = new WalletService();
      newInstance.currentNetwork = network;
      newInstance.currentApiUrl = apiUrl;
      newInstance.currentAddress = this.currentAddress;
      WalletService.instance = newInstance;
      dbg('WalletService: Completely reset service for network change');
      return newInstance;
    } catch (error) {
      dbg('WalletService: Error during network change:', error);
      throw error;
    }
  }
  public async handleAddressTypeChange(addressType: string) {
    dbg('WalletService: Address type changed to:', addressType);
    try {
      const state = await this.getStoredState();
      const jks = await EncryptedStorage.getItem('keyshare');
      const ks = JSON.parse(jks || '{}');
      const useLegacyPath = isLegacyWallet(ks.created_at);
      const externalIndex = await getExternalIndex(state.network, addressType);
      const path = getReceivePath(state.network, addressType, useLegacyPath, externalIndex);
      const btcPub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      const newAddress = await BBMTLibNativeModule.btcAddress(
        btcPub,
        state.network,
        addressType,
      );
      // Save all state changes at once
      await this.saveStoredState({
        addressType,
        address: newAddress,
      });
      this.currentAddressType = addressType;
      this.currentAddress = newAddress;
      dbg('WalletService: Address type updated:', {
        addressType,
        address: newAddress,
      });
    } catch (error) {
      dbg('WalletService: Error during address type change:', error);
      throw error;
    }
  }
  public async getWalletBalance(
    address: string,
    btcRate: number,
    pendingSent: number = 0,
    force: boolean = false,
  ): Promise<WalletBalance> {
    try {
      dbg('WalletService: Getting wallet balance for address:', address);
      dbg(
        'WalletService: Parameters - btcRate:',
        btcRate,
        'pendingSent:',
        pendingSent,
        'force:',
        force,
      );
      // Normalize network parameter for validation (testnet3 -> testnet)
      const normalizedNetwork = this.currentNetwork === 'testnet3' ? 'testnet' : this.currentNetwork;
      if (!validateBitcoinAddressEnhanced(address, normalizedNetwork)) {
        dbg('WalletService: Invalid Bitcoin address format:', address, 'for network:', this.currentNetwork);
        throw new Error('Invalid Bitcoin address');
      }
      if (!validateNumber(btcRate)) {
        dbg('WalletService: Invalid BTC rate:', btcRate);
        throw new Error('Invalid BTC rate');
      }
      if (!validateNumber(pendingSent)) {
        dbg('WalletService: Invalid pending amount:', pendingSent);
        throw new Error('Invalid pending amount');
      }
      BBMTLibNativeModule.setAPI(this.currentNetwork, this.currentApiUrl);
      const api = await LocalCache.getItem('api');
      if (!api) {
        dbg('WalletService: No API URL found');
        throw new Error('No API URL found');
      }
      BBMTLibNativeModule.setAPI(this.currentNetwork, api);
      dbg('WalletService: Fetching UTXO total from native module');
      const totalUTXO = (await this.withTimeout(
        `utxo-${address}`,
        BBMTLibNativeModule.totalUTXO(address),
      )) as number;
      if (!totalUTXO || !validateNumber(totalUTXO)) {
        dbg('WalletService: Invalid UTXO total received:', totalUTXO);
        const balance = await this.getBal(address);
        dbg('WalletService: fallback to cached balance');
        return balance;
      }
      dbg('WalletService: Raw UTXO total received:', totalUTXO);
      // Convert satoshis to BTC
      const balance = new Big(totalUTXO);
      dbg('WalletService: Raw balance in satoshis:', balance.toString());
      // Calculate balance after pending sent, ensuring it's never negative
      const balanceAfterPending = balance.sub(pendingSent);
      const finalBalance = balanceAfterPending.gte(0) ? balanceAfterPending : new Big(0);
      const newBalance = finalBalance.div(1e8).toFixed(8);
      dbg('WalletService: Balance after pending subtraction:', newBalance);
      const hasNonZeroBalance = Number(newBalance) > 0;
      dbg('WalletService: Has non-zero balance:', hasNonZeroBalance);
      // Calculate USD value using current price rate
      let usdAmount = '';
      if (btcRate > 0) {
        const usdValue = balance.mul(btcRate).div(1e8).toNumber();
        dbg('WalletService: USD value calculation:', {
          balance: balance.toString(),
          btcRate,
          usdValue,
        });
        usdAmount = this.formatUSD(usdValue);
      }
      dbg('WalletService: Final USD amount:', usdAmount);
      const result = {
        btc: newBalance,
        usd: usdAmount,
        hasNonZeroBalance,
        timestamp: Date.now(),
      };
      await this.setBal(address, result);
      dbg('WalletService: Balance cache updated', result);
      return result;
    } catch (error) {
      dbg('WalletService: Error fetching wallet balance:', error);
      // Return zero balance if no cache
      return await this.getBal(address);
    }
  }

  /**
   * Aggregated balance over all HD addresses (external chain 0..maxUsed+GAP, internal 0..changeIndex+GAP).
   * Use this for HD wallets to include receive and change addresses.
   */
  public async getWalletBalanceAggregate(
    network: string,
    addressType: string,
    btcRate: number,
    pendingSent: number = 0,
    _force: boolean = false,
  ): Promise<WalletBalance> {
    try {
      const jks = await EncryptedStorage.getItem('keyshare');
      if (!jks) {
        dbg('WalletService: No keyshare for aggregate balance');
        return {
          btc: '0.00000000',
          usd: '$0.00',
          hasNonZeroBalance: false,
          timestamp: Date.now(),
        };
      }
      const ks = JSON.parse(jks);
      const useLegacyPath = isLegacyWallet(ks.created_at);
      const externalIdx = await getExternalIndex(network, addressType);
      const maxUsedExternal = await getMaxUsedExternal(network, addressType);
      const changeIdx = await getChangeIndex(network, addressType);
      const externalEnd = Math.max(MIN_SCAN_INDEX, Math.max(externalIdx, maxUsedExternal) + GAP_LIMIT);
      const internalEnd = Math.max(MIN_SCAN_INDEX, changeIdx + GAP_LIMIT);
      const addresses: string[] = [];
      for (let i = 0; i <= externalEnd; i++) {
        const path = getReceivePath(network, addressType, useLegacyPath, i);
        const pub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        const addr = await BBMTLibNativeModule.btcAddress(
          pub,
          network,
          addressType,
        );
        addresses.push(addr);
      }
      for (let i = 0; i <= internalEnd; i++) {
        const path = getChangePath(network, addressType, useLegacyPath, i);
        const pub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        const addr = await BBMTLibNativeModule.btcAddress(
          pub,
          network,
          addressType,
        );
        addresses.push(addr);
      }
      BBMTLibNativeModule.setAPI(network, this.currentApiUrl);
      const api = await LocalCache.getItem('api');
      if (!api) throw new Error('No API URL found');
      BBMTLibNativeModule.setAPI(network, api);
      let totalSats = new Big(0);
      for (const addr of addresses) {
        try {
          const n = (await this.withTimeout(
            `utxo-${addr}`,
            BBMTLibNativeModule.totalUTXO(addr),
          )) as number;
          if (validateNumber(n)) totalSats = totalSats.add(n);
        } catch {
          // skip failed address
        }
      }
      const balanceAfterPending = totalSats.sub(pendingSent);
      const finalBalance = balanceAfterPending.gte(0) ? balanceAfterPending : new Big(0);
      const newBalance = finalBalance.div(1e8).toFixed(8);
      const hasNonZeroBalance = Number(newBalance) > 0;
      let usdAmount = '';
      if (btcRate > 0) {
        usdAmount = this.formatUSD(totalSats.mul(btcRate).div(1e8).toNumber());
      }
      const result: WalletBalance = {
        btc: newBalance,
        usd: usdAmount,
        hasNonZeroBalance,
        timestamp: Date.now(),
      };
      const cacheKey = `wallet_balance_aggregate_${network}_${addressType}`;
      await LocalCache.setItem(cacheKey, JSON.stringify(result));
      return result;
    } catch (error) {
      dbg('WalletService: getWalletBalanceAggregate error:', error);
      const cached = await this.getCachedAggregateBalance(network, addressType);
      return cached ?? {
        btc: '0.00000000',
        usd: '$0.00',
        hasNonZeroBalance: false,
        timestamp: Date.now(),
      };
    }
  }

  /** Returns cached aggregate balance for HD wallet (network + addressType). */
  public async getCachedAggregateBalance(
    network: string,
    addressType: string,
  ): Promise<WalletBalance | null> {
    const cacheKey = `wallet_balance_aggregate_${network}_${addressType}`;
    const raw = await LocalCache.getItem(cacheKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as WalletBalance;
    } catch {
      return null;
    }
  }

  public getTransactionDetails(
    tx: any,
    address: string,
  ): {
    amount: number;
    fee: number;
    type: 'send' | 'receive' | 'consolidation' | 'pending';
    timestamp?: number;
  } {
    if (tx.sentAt) {
      return {
        amount: tx.amount / 1e8,
        fee: 0,
        type: 'pending',
        timestamp: tx.sentAt,
      };
    }
    const sentAmount = tx.vin.reduce((total: number, input: any) => {
      return input.prevout.scriptpubkey_address === address
        ? total + input.prevout.value
        : total;
    }, 0);
    const receivedAmount = tx.vout.reduce((total: number, output: any) => {
      return output.scriptpubkey_address === address
        ? total + output.value
        : total;
    }, 0);
    const fee = tx.fee || 0;
    let type: 'send' | 'receive' | 'consolidation';
    let amount: number;
    if (sentAmount > 0 && receivedAmount > 0) {
      const changeAmount = tx.vout.reduce((total: number, output: any) => {
        return sentAmount > 0 && output.scriptpubkey_address === address
          ? total + output.value
          : 0;
      }, 0);
      if (sentAmount > receivedAmount) {
        type = 'send';
        amount = (sentAmount - changeAmount - fee) / 1e8;
      } else if (receivedAmount > sentAmount) {
        type = 'receive';
        amount = (receivedAmount - sentAmount + fee) / 1e8;
      } else {
        const totalInputValue = tx.vin.reduce(
          (total: number, input: any) => input.prevout.value,
          0,
        );
        const totalOutputValue = tx.vout.reduce(
          (total: number, output: any) => output.value,
          0,
        );
        if (Math.abs(totalInputValue - totalOutputValue - fee) < 1000) {
          type = 'consolidation';
          amount = receivedAmount / 1e8;
        } else {
          type = 'receive';
          amount = receivedAmount / 1e8;
        }
      }
    } else if (sentAmount > 0) {
      type = 'send';
      amount = (sentAmount - fee) / 1e8;
    } else if (receivedAmount > 0) {
      type = 'receive';
      amount = receivedAmount / 1e8;
    } else {
      type = 'receive';
      amount = 0;
    }
    return {
      amount,
      fee: fee / 1e8,
      type,
      timestamp: tx.status?.block_time
        ? tx.status.block_time * 1000
        : undefined,
    };
  }
  private formatUSD(price: number): string {
    return price.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
    });
  }
  public abortTransactionFetch() {
    this.abortController.abort();
  }
  public async updateTransactionsCache(
    address: string,
    txs: Transaction[],
    isFromCache: boolean = false,
  ) {
    const cacheKey = `${address}-initial`;
    if (!isFromCache) {
      await this.setTxs(cacheKey, txs);
    }
    dbg('txs cache updated', isFromCache ? '(from cache)' : '(fresh data)');
  }
  public async transactionsFromCache(address: string) {
    const cacheKey = `${address}-initial`;
    dbg('searching tx cache for :', cacheKey);
    const txs = await this.getTxs(cacheKey);
    dbg('found cached txs:', txs.transactions.length);
    return txs.transactions;
  }

  /**
   * Fetches transactions for multiple HD addresses, merges by txid, dedupes, sorts by block_time desc.
   * Used for wallet-level transaction list (all receive + change addresses).
   */
  public async fetchTransactionsForAddresses(
    apiBase: string,
    addresses: string[],
  ): Promise<any[]> {
    if (addresses.length === 0) return [];
    const cleanBase = apiBase.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const seen = new Set<string>();
    const merged: any[] = [];
    await Promise.all(
      addresses.map(async addr => {
        try {
          const url = `${cleanBase}/api/address/${encodeURIComponent(addr)}/txs`;
          const res = await this.withTimeout(
            `txs-${addr.slice(0, 12)}`,
            fetch(url),
            8000,
          );
          if (!res.ok) return;
          const data = (await res.json()) as any[];
          if (!Array.isArray(data)) return;
          for (const tx of data) {
            if (!seen.has(tx.txid)) {
              seen.add(tx.txid);
              merged.push(tx);
            }
          }
        } catch (e) {
          dbg(
            'WalletService: fetchTransactionsForAddresses failed for',
            addr.slice(0, 12),
            e,
          );
        }
      }),
    );
    const blockTime = (tx: any) => tx.status?.block_time ?? 0;
    merged.sort((a, b) => blockTime(b) - blockTime(a));
    dbg('WalletService: fetchTransactionsForAddresses merged', merged.length, 'txs from', addresses.length, 'addresses');
    return merged;
  }

  /** Cache key for wallet-level (multi-address) transactions. */
  private walletTxsCacheKey(network: string, addressType: string) {
    return `wallet_txs_${network}_${addressType}`;
  }

  public async transactionsFromCacheForWallet(
    network: string,
    addressType: string,
  ): Promise<any[]> {
    const cacheKey = this.walletTxsCacheKey(network, addressType);
    const txs = await this.getTxs(cacheKey);
    return txs.transactions;
  }

  public async updateTransactionsCacheForWallet(
    network: string,
    addressType: string,
    txs: any[],
  ) {
    const cacheKey = this.walletTxsCacheKey(network, addressType);
    await this.setTxs(cacheKey, txs);
    dbg('WalletService: wallet txs cache updated', cacheKey, txs.length);
  }
}
