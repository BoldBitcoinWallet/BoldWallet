import Big from 'big.js';
import {BBMTLibNativeModule} from '../native_modules';
import {dbg} from '../utils';
import axios from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';

export interface WalletBalance {
  btc: string;
  usd: string;
  hasNonZeroBalance: boolean;
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

interface CachedData {
  price: {
    price: string;
    rate: number;
    timestamp: number;
  };
  balance: {
    btc: string;
    usd: string;
    hasNonZeroBalance: boolean;
    timestamp: number;
  };
  transactions: {
    [key: string]: CachedTransactionData;
  };
}

export const waitMS = (ms = 2000) =>
  new Promise(resolve => setTimeout(resolve, ms));

// Add validation functions
const validateBitcoinAddress = (address: string): boolean => {
  if (!address) {
    dbg('WalletService: Bitcoin address validation failed - empty address');
    return false;
  }
  dbg('WalletService: Bitcoin address validation passed:', address);
  return true;
};

const validateApiUrl = (url: string): boolean => {
  if (!url) {
    dbg('WalletService: API URL validation failed - empty URL');
    return false;
  }
  try {
    const urlObj = new URL(url);
    const isValid = !!urlObj;
    dbg(
      'WalletService: API URL validation',
      isValid ? 'passed' : 'failed',
      'for URL:',
      url,
    );
    return isValid;
  } catch (error) {
    dbg(
      'WalletService: API URL validation failed - invalid URL format:',
      url,
      'Error:',
      error,
    );
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
  private lastPriceFetch: number = 0;
  private lastBalanceFetch: number = 0;
  private readonly PRICE_CACHE_TIME = 5 * 60 * 1000; // 5 minutes
  private readonly BALANCE_CACHE_TIME = 30 * 1000; // 30 seconds
  private cachedTransactions: {[key: string]: Transaction[]} = {};
  private lastTxFetch: {[key: string]: number} = {};
  private cachedTxPages: {[key: string]: {[page: string]: Transaction[]}} = {};
  private lastTxPageFetch: {[key: string]: {[page: string]: number}} = {};
  private allTransactions: {[key: string]: Transaction[]} = {};
  private abortController = new AbortController();
  private isInitialized: boolean = false;
  private currentAddress: string | null = null;
  private currentNetwork: string = 'mainnet'; // Default to mainnet
  private currentAddressType: string = 'legacy'; // Default to legacy
  private currentApiUrl: string = 'https://mempool.space/api';
  private fetchInProgress: {[key: string]: boolean} = {};
  private fetchTimeout: {[key: string]: NodeJS.Timeout} = {};
  private cachedPrice: {price: string; rate: number} = {
    price: '$0.00',
    rate: 0,
  };
  private cachedBalance: WalletBalance = {
    btc: '0.00000000',
    usd: '$0.00',
    hasNonZeroBalance: false,
  };

  // Add network state tracker
  private networkState = {
    isTransitioning: false,
    lastNetwork: null as string | null,
    lastAddress: null as string | null,
    pendingAddress: null as string | null,
  };

  private constructor() {
    // Initialize by loading cached data
    this.loadCachedData();
    // Initialize network state from storage
    this.initializeNetworkState();
  }

  private async getStoredState() {
    try {
      const network = (await EncryptedStorage.getItem('network')) || 'mainnet';
      const addressType =
        (await EncryptedStorage.getItem('addressType')) || 'legacy';
      const api =
        network === 'mainnet'
          ? 'https://mempool.space/api'
          : 'https://mempool.space/testnet/api';
      const address = await EncryptedStorage.getItem('currentAddress');

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
        await EncryptedStorage.setItem('network', state.network);
      }
      if (state.addressType) {
        await EncryptedStorage.setItem('addressType', state.addressType);
      }
      if (state.api) {
        await EncryptedStorage.setItem('api', state.api);
      }
      if (state.address) {
        await EncryptedStorage.setItem('currentAddress', state.address);
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

  private async loadCachedData() {
    try {
      dbg('WalletService: Loading cached data from storage...');
      const cachedData = await EncryptedStorage.getItem('walletCache');
      if (cachedData) {
        const parsed = JSON.parse(cachedData) as CachedData;
        const now = Date.now();
        dbg('WalletService: Found cached data, timestamp:', now);

        // Load price if not expired
        if (
          parsed.price &&
          now - parsed.price.timestamp < this.PRICE_CACHE_TIME
        ) {
          this.cachedPrice = {
            price: parsed.price.price,
            rate: parsed.price.rate,
          };
          this.lastPriceFetch = parsed.price.timestamp;
          dbg('WalletService: Loaded cached price:', this.cachedPrice);
        } else {
          dbg('WalletService: Price cache expired or not found');
        }

        // Load balance if not expired
        if (
          parsed.balance &&
          now - parsed.balance.timestamp < this.BALANCE_CACHE_TIME
        ) {
          this.cachedBalance = {
            btc: parsed.balance.btc,
            usd: parsed.balance.usd,
            hasNonZeroBalance: parsed.balance.hasNonZeroBalance,
          };
          this.lastBalanceFetch = parsed.balance.timestamp;
          dbg('WalletService: Loaded cached balance:', this.cachedBalance);
        } else {
          dbg('WalletService: Balance cache expired or not found');
        }

        // Load all transactions if not expired
        if (parsed.transactions) {
          dbg('WalletService: Loading cached transactions...');
          Object.entries(parsed.transactions).forEach(([key, data]) => {
            if (key.endsWith('-all')) {
              const address = key.replace('-all', '');
              this.allTransactions[address] = data.transactions;
              this.lastTxFetch[`${address}-initial`] = data.timestamp;
              dbg(
                'WalletService: Loaded all transactions for address:',
                address,
              );
            } else {
              this.cachedTransactions[key] = data.transactions;
              this.lastTxFetch[key] = data.timestamp;
              dbg('WalletService: Loaded cached transactions for key:', key);

              // Also load into pages structure if it's a page
              const [address, page] = key.split('-');
              if (page) {
                if (!this.cachedTxPages[address]) {
                  this.cachedTxPages[address] = {};
                  this.lastTxPageFetch[address] = {};
                }
                this.cachedTxPages[address][page] = data.transactions;
                this.lastTxPageFetch[address][page] = data.timestamp;
                dbg(
                  'WalletService: Loaded transaction page:',
                  page,
                  'for address:',
                  address,
                );
              }
            }
          });
        } else {
          dbg('WalletService: No cached transactions found');
        }

        dbg('WalletService: Finished loading cached data');
      } else {
        dbg('WalletService: No cached data found in storage');
      }
    } catch (error) {
      dbg('WalletService: Error loading cached data:', error);
    }
  }

  private async saveCachedData() {
    try {
      dbg('WalletService: Saving data to cache...');
      const cacheData: CachedData = {
        price: {
          ...this.cachedPrice,
          timestamp: this.lastPriceFetch,
        },
        balance: {
          ...this.cachedBalance,
          timestamp: this.lastBalanceFetch,
        },
        transactions: {},
      };

      // Save all cached transactions
      Object.entries(this.cachedTransactions).forEach(([key, transactions]) => {
        cacheData.transactions[key] = {
          transactions,
          timestamp: this.lastTxFetch[key] || Date.now(),
        };
        dbg('WalletService: Saving transactions for key:', key);
      });

      // Save transaction pages
      Object.entries(this.cachedTxPages).forEach(([address, pages]) => {
        Object.entries(pages).forEach(([page, transactions]) => {
          const key = `${address}-${page}`;
          cacheData.transactions[key] = {
            transactions,
            timestamp: this.lastTxPageFetch[address]?.[page] || Date.now(),
          };
          dbg(
            'WalletService: Saving transaction page:',
            page,
            'for address:',
            address,
          );
        });
      });

      // Save all transactions
      Object.entries(this.allTransactions).forEach(
        ([address, transactions]) => {
          const key = `${address}-all`;
          cacheData.transactions[key] = {
            transactions,
            timestamp: Date.now(),
          };
          dbg('WalletService: Saving all transactions for address:', address);
        },
      );

      await EncryptedStorage.setItem('walletCache', JSON.stringify(cacheData));
      dbg('WalletService: Successfully saved all data to persistent cache');
    } catch (error) {
      dbg('WalletService: Error saving cached data:', error);
    }
  }

  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  private async debounceFetch(
    key: string,
    fetchFn: () => Promise<any>,
    delay: number = 1000,
  ): Promise<any> {
    if (this.fetchInProgress[key]) {
      dbg('WalletService: Fetch already in progress for:', key);
      return null;
    }

    if (this.fetchTimeout[key]) {
      clearTimeout(this.fetchTimeout[key]);
    }

    return new Promise(resolve => {
      this.fetchTimeout[key] = setTimeout(async () => {
        try {
          this.fetchInProgress[key] = true;
          const result = await fetchFn();
          resolve(result);
        } finally {
          this.fetchInProgress[key] = false;
          delete this.fetchTimeout[key];
        }
      }, delay);
    });
  }

  public async getBitcoinPrice(): Promise<{price: string; rate: number}> {
    const now = Date.now();
    dbg(
      'WalletService: Checking price cache, last fetch:',
      now - this.lastPriceFetch,
      'ms ago',
    );

    if (now - this.lastPriceFetch < this.PRICE_CACHE_TIME) {
      dbg('WalletService: Using cached price:', this.cachedPrice);
      return this.cachedPrice;
    }

    try {
      dbg('WalletService: Fetching fresh BTC price from mempool.space');

      // Always use main mempool.space API for price data
      const priceUrl = 'https://mempool.space/api/v1/prices';

      dbg('WalletService: Using price API URL:', priceUrl);
      const response = await fetch(priceUrl);
      const data = await response.json();
      dbg('WalletService: Raw price data received:', data);

      if (!data || !data.USD || !validateNumber(data.USD)) {
        dbg('WalletService: Invalid price data received:', data);
        throw new Error('Invalid price data received');
      }

      const rate = parseFloat(data.USD);
      dbg('WalletService: Parsed rate:', rate);

      if (isNaN(rate) || rate <= 0) {
        dbg('WalletService: Invalid rate value:', rate);
        throw new Error('Invalid rate value');
      }

      const price = this.formatUSD(data.USD);
      dbg('WalletService: New price fetched - Rate:', rate, 'Price:', price);

      this.cachedPrice = {price, rate};
      this.lastPriceFetch = now;
      await this.saveCachedData();
      dbg('WalletService: Price cache updated');

      return {price, rate};
    } catch (error) {
      dbg('WalletService: Error fetching BTC price:', error);
      if (this.cachedPrice.rate > 0) {
        dbg('WalletService: Using expired cached price due to error');
        return this.cachedPrice;
      }
      throw new Error('Failed to fetch Bitcoin price');
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
      this.isInitialized = false;
      this.currentAddress = null;
      this.currentNetwork = network;
      this.currentApiUrl = apiUrl;
      this.fetchInProgress = {};
      Object.values(this.fetchTimeout).forEach(timeout =>
        clearTimeout(timeout),
      );
      this.fetchTimeout = {};

      // Clear all cached data
      this.lastPriceFetch = 0;
      this.lastBalanceFetch = 0;
      this.cachedTransactions = {};
      this.lastTxFetch = {};
      this.cachedTxPages = {};
      this.lastTxPageFetch = {};
      this.allTransactions = {};
      this.cachedPrice = {
        price: '$0.00',
        rate: 0,
      };
      this.cachedBalance = {
        btc: '0.00000000',
        usd: '$0.00',
        hasNonZeroBalance: false,
      };

      // Clear persistent storage
      try {
        await EncryptedStorage.removeItem('walletCache');
        dbg('WalletService: Cleared persistent cache');
      } catch (error) {
        dbg('WalletService: Error clearing persistent cache:', error);
      }

      // Generate new address for the current network
      try {
        const jks = await EncryptedStorage.getItem('keyshare');
        const ks = JSON.parse(jks || '{}');
        const path = "m/44'/0'/0'/0/0";
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
      // Get current state
      const state = await this.getStoredState();

      // Generate new address for current network and type
      const jks = await EncryptedStorage.getItem('keyshare');
      const ks = JSON.parse(jks || '{}');
      const path = "m/44'/0'/0'/0/0";
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

      // Clear address-specific caches
      await this.clearTransactionCache(newAddress);

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
    // Get current state
    const state = await this.getStoredState();
    dbg('WalletService: Current network:', state.network);

    // Ensure network state is synchronized
    if (!state.network) {
      try {
        await this.saveStoredState({network: 'mainnet'});
        dbg('WalletService: Restored network state from storage: mainnet');

        // Also update native module if needed
        await BBMTLibNativeModule.setBtcNetwork('mainnet');
        dbg('WalletService: Synchronized native module network state');
      } catch (error) {
        dbg('WalletService: Error restoring network state:', error);
      }
    }

    if (address !== this.currentAddress) {
      dbg(
        'WalletService: Address changed from',
        this.currentAddress,
        'to',
        address,
      );
      this.currentAddress = address;
      await this.saveStoredState({address});
      // Clear address-specific caches when address changes
      await this.clearTransactionCache(address);
      // Force refresh when address changes
      force = true;
    }

    return this.debounceFetch(
      `balance-${address}`,
      async () => {
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

          if (!validateBitcoinAddress(address)) {
            dbg('WalletService: Invalid Bitcoin address format:', address);
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

          const now = Date.now();
          if (!force && now - this.lastBalanceFetch < this.BALANCE_CACHE_TIME) {
            dbg('WalletService: Using cached balance:', this.cachedBalance);
            return this.cachedBalance;
          }

          dbg('WalletService: Fetching UTXO total from native module');
          const totalUTXO = await BBMTLibNativeModule.totalUTXO(address);

          if (!totalUTXO || !validateNumber(totalUTXO)) {
            dbg('WalletService: Invalid UTXO total received:', totalUTXO);
            const balance = {
              btc: '0.00000000',
              usd: '$0.00',
              hasNonZeroBalance: false,
            };
            this.cachedBalance = balance;
            this.lastBalanceFetch = now;
            await this.saveCachedData();
            return balance;
          }

          dbg('WalletService: Raw UTXO total received:', totalUTXO);

          // Convert satoshis to BTC
          const balance = Big(totalUTXO);
          dbg('WalletService: Raw balance in satoshis:', balance.toString());

          const newBalance = balance.sub(pendingSent).div(1e8).toFixed(8);
          dbg('WalletService: Balance after pending subtraction:', newBalance);

          const hasNonZeroBalance = Number(newBalance) > 0;
          dbg('WalletService: Has non-zero balance:', hasNonZeroBalance);

          // Calculate USD value using current price rate
          let usdAmount = '$0.00';
          if (btcRate > 0) {
            const usdValue = Big(balance).mul(btcRate).div(1e8).toNumber();
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
          };

          dbg('WalletService: New balance calculated:', result);
          this.cachedBalance = result;
          this.lastBalanceFetch = now;
          await this.saveCachedData();
          dbg('WalletService: Balance cache updated');

          return result;
        } catch (error) {
          dbg('WalletService: Error fetching wallet balance:', error);
          if (this.cachedBalance.btc !== '0.00000000') {
            dbg('WalletService: Using expired cached balance due to error');
            return this.cachedBalance;
          }
          throw new Error('Failed to fetch wallet balance');
        }
      },
      500,
    );
  }

  public async getTransactions(
    address: string,
    baseApi: string = this.currentApiUrl,
    lastSeenTxId: string | null = null,
  ): Promise<{
    transactions: Transaction[];
    lastSeenTxId: string | null;
    hasMore: boolean;
  }> {
    dbg('WalletService: Current network:', this.currentNetwork);

    // Validate address format based on network
    if (this.currentNetwork === 'testnet3') {
      if (
        !address.startsWith('m') &&
        !address.startsWith('n') &&
        !address.startsWith('2') &&
        !address.startsWith('tb1')
      ) {
        dbg('WalletService: Invalid testnet address format:', address);
        throw new Error('Invalid testnet address format');
      }
    } else {
      if (
        !address.startsWith('1') &&
        !address.startsWith('3') &&
        !address.startsWith('bc1')
      ) {
        dbg('WalletService: Invalid mainnet address format:', address);
        throw new Error('Invalid mainnet address format');
      }
    }

    if (address !== this.currentAddress) {
      dbg(
        'WalletService: Address changed from',
        this.currentAddress,
        'to',
        address,
      );
      this.currentAddress = address;
      await this.clearCache();
    }

    // Always use the current API URL
    baseApi = this.currentApiUrl;
    dbg('WalletService: Using current API URL:', baseApi);

    // Check for cached transactions first
    const cacheKey = `${address}-${lastSeenTxId || 'initial'}`;
    const cachedData = this.cachedTransactions[cacheKey];
    const lastFetch = this.lastTxFetch[cacheKey];
    const now = Date.now();

    // If we have cached data and it's not too old (5 minutes), use it
    if (cachedData && lastFetch && now - lastFetch < 5 * 60 * 1000) {
      dbg('WalletService: Using cached transactions for key:', cacheKey);
      return {
        transactions: cachedData,
        lastSeenTxId:
          cachedData.length > 0 ? cachedData[cachedData.length - 1].txid : null,
        hasMore: false, // We don't know if there are more, so assume no
      };
    }

    return this.debounceFetch(
      `transactions-${address}-${lastSeenTxId || 'initial'}`,
      async () => {
        dbg('WalletService: Getting transactions for address:', address);
        dbg(
          'WalletService: Parameters - baseApi:',
          baseApi,
          'lastSeenTxId:',
          lastSeenTxId,
        );

        if (!validateBitcoinAddress(address)) {
          dbg('WalletService: Invalid Bitcoin address format:', address);
          throw new Error('Invalid Bitcoin address');
        }

        if (!validateApiUrl(baseApi)) {
          dbg('WalletService: Invalid API URL:', baseApi);
          throw new Error('Invalid API URL');
        }

        if (lastSeenTxId && !/^[a-fA-F0-9]{64}$/.test(lastSeenTxId)) {
          dbg('WalletService: Invalid transaction ID format:', lastSeenTxId);
          throw new Error('Invalid transaction ID format');
        }

        try {
          const url = lastSeenTxId
            ? `${baseApi}/address/${address}/txs/chain/${lastSeenTxId}`
            : `${baseApi}/address/${address}/txs`;

          dbg('WalletService: Fetching transactions from:', url);
          const response = await axios.get(url, {
            signal: this.abortController.signal,
            timeout: 5000,
          });
          const data = response.data;
          dbg('WalletService: Received', data.length, 'transactions');

          if (!Array.isArray(data)) {
            dbg('WalletService: Invalid response format:', data);
            throw new Error('Invalid response format from API');
          }

          // Process transactions with validation
          const transactions = data
            .map((tx: any) => {
              if (!tx || !tx.txid || !tx.vin || !tx.vout) {
                dbg('WalletService: Skipping invalid transaction:', tx);
                return null;
              }
              // Validate transaction data
              if (!/^[a-fA-F0-9]{64}$/.test(tx.txid)) {
                dbg(
                  'WalletService: Skipping transaction with invalid txid:',
                  tx.txid,
                );
                return null;
              }
              return {
                ...tx,
                status: {
                  confirmed: tx.status?.confirmed || false,
                  block_height: tx.status?.block_height,
                  block_time: tx.status?.block_time,
                },
              };
            })
            .filter(Boolean);

          dbg(
            'WalletService: Processed',
            transactions.length,
            'valid transactions',
          );

          // Sort transactions by block height (newest first)
          const sortedTransactions = transactions.sort(
            (a: any, b: any) =>
              (b.status.block_height || 0) - (a.status.block_height || 0),
          );

          // Cache the transactions
          this.cachedTransactions[cacheKey] = sortedTransactions;
          this.lastTxFetch[cacheKey] = now;
          await this.saveCachedData();

          const result = {
            transactions: sortedTransactions,
            lastSeenTxId:
              sortedTransactions.length > 0
                ? sortedTransactions[sortedTransactions.length - 1].txid
                : null,
            hasMore: data.length === 25,
          };

          dbg('WalletService: Returning transactions result:', {
            count: result.transactions.length,
            lastSeenTxId: result.lastSeenTxId,
            hasMore: result.hasMore,
          });

          return result;
        } catch (error: any) {
          dbg('WalletService: Error fetching transactions:', error);
          dbg('WalletService: Error details:', error.message);

          // If we have any cached transactions, return them
          if (this.cachedTransactions[cacheKey]?.length > 0) {
            const cachedTxs = this.cachedTransactions[cacheKey];
            dbg('WalletService: Using cached transactions for key:', cacheKey);
            dbg('WalletService: Cached transactions count:', cachedTxs.length);

            return {
              transactions: cachedTxs,
              lastSeenTxId:
                cachedTxs.length > 0
                  ? cachedTxs[cachedTxs.length - 1].txid
                  : null,
              hasMore: false,
            };
          }

          // If no specific cache, try to use all transactions cache
          if (this.allTransactions[address]?.length > 0) {
            const allTxs = this.allTransactions[address];
            dbg(
              'WalletService: Using all cached transactions for address:',
              address,
            );
            dbg('WalletService: All cached transactions count:', allTxs.length);

            return {
              transactions: allTxs,
              lastSeenTxId:
                allTxs.length > 0 ? allTxs[allTxs.length - 1].txid : null,
              hasMore: false,
            };
          }

          dbg('WalletService: No cached transactions available');
          throw error;
        }
      },
      500,
    );
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

  public getLastPriceFetch(): number {
    return this.lastPriceFetch;
  }

  public getLastBalanceFetch(): number {
    return this.lastBalanceFetch;
  }

  public getLastTxFetch(address: string): number {
    const cacheKey = `${address}-initial`;
    return this.lastTxFetch[cacheKey] || 0;
  }

  public abortTransactionFetch() {
    this.abortController.abort();
  }

  public async updateTransactionsCache(address: string, txs: Transaction[]) {
    this.cachedTransactions[address] = txs;
    dbg('txs cache updated');
  }

  public async clearTransactionCache(address: string) {
    dbg('WalletService: Clearing transaction cache for address:', address);
    const cacheKeys = Object.keys(this.cachedTransactions).filter(key =>
      key.startsWith(`${address}-`),
    );
    cacheKeys.forEach(key => {
      delete this.cachedTransactions[key];
      delete this.lastTxFetch[key];
      dbg('WalletService: Cleared cache for key:', key);
    });
    // Update persistent storage after clearing cache
    await this.saveCachedData();
    dbg('WalletService: Transaction cache clear completed');
  }

  public async clearCache() {
    dbg('WalletService: Starting cache clear...');
    this.isInitialized = false;
    this.currentAddress = null;
    this.fetchInProgress = {};
    Object.values(this.fetchTimeout).forEach(timeout => clearTimeout(timeout));
    this.fetchTimeout = {};

    // Clear all cached data
    this.lastPriceFetch = 0;
    this.lastBalanceFetch = 0;
    this.cachedTransactions = {};
    this.lastTxFetch = {};
    this.cachedTxPages = {};
    this.lastTxPageFetch = {};
    this.allTransactions = {};
    this.cachedPrice = {
      price: '$0.00',
      rate: 0,
    };
    this.cachedBalance = {
      btc: '0.00000000',
      usd: '$0.00',
      hasNonZeroBalance: false,
    };
    dbg('WalletService: Cleared all in-memory caches');

    // Clear persistent storage
    try {
      await EncryptedStorage.removeItem('walletCache');
      dbg('WalletService: Cleared persistent cache');
    } catch (error) {
      dbg('WalletService: Error clearing persistent cache:', error);
    }

    // Reset the instance
    dbg('WalletService: Creating new instance after cache clear');
    WalletService.instance = new WalletService();
    return WalletService.instance;
  }
}
