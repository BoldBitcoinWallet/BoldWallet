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
  if (!address) return false;
  // Basic format validation for Bitcoin addresses
  const validFormats = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/;
  return validFormats.test(address);
};

const validateApiUrl = (url: string): boolean => {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const validateNumber = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  try {
    new Big(value);
    return true;
  } catch {
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

  private constructor() {
    // Initialize by loading cached data
    this.loadCachedData();
  }

  private async loadCachedData() {
    try {
      const cachedData = await EncryptedStorage.getItem('walletCache');
      if (cachedData) {
        const parsed = JSON.parse(cachedData) as CachedData;
        const now = Date.now();

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
        }

        // Load all transactions if not expired
        if (parsed.transactions) {
          Object.entries(parsed.transactions).forEach(([key, data]) => {
            if (key.endsWith('-all')) {
              const address = key.replace('-all', '');
              this.allTransactions[address] = data.transactions;
              this.lastTxFetch[`${address}-initial`] = data.timestamp;
            } else {
              this.cachedTransactions[key] = data.transactions;
              this.lastTxFetch[key] = data.timestamp;

              // Also load into pages structure if it's a page
              const [address, page] = key.split('-');
              if (page) {
                if (!this.cachedTxPages[address]) {
                  this.cachedTxPages[address] = {};
                  this.lastTxPageFetch[address] = {};
                }
                this.cachedTxPages[address][page] = data.transactions;
                this.lastTxPageFetch[address][page] = data.timestamp;
              }
            }
          });
        }

        dbg('WalletService: Loaded cached data from storage');
      }
    } catch (error) {
      dbg('WalletService: Error loading cached data:', error);
    }
  }

  private async saveCachedData() {
    try {
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
      });

      // Save transaction pages
      Object.entries(this.cachedTxPages).forEach(([address, pages]) => {
        Object.entries(pages).forEach(([page, transactions]) => {
          const key = `${address}-${page}`;
          cacheData.transactions[key] = {
            transactions,
            timestamp: this.lastTxPageFetch[address]?.[page] || Date.now(),
          };
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
        },
      );

      await EncryptedStorage.setItem('walletCache', JSON.stringify(cacheData));
      dbg('WalletService: Saved data to persistent cache');
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

    return new Promise((resolve) => {
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
      const response = await fetch('https://mempool.space/api/v1/prices');
      const data = await response.json();

      if (!data || !data.USD || !validateNumber(data.USD)) {
        dbg('WalletService: Invalid price data received:', data);
        throw new Error('Invalid price data received');
      }

      const rate = parseFloat(data.USD);
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

  public async getWalletBalance(
    address: string,
    btcRate: number,
    pendingSent: number = 0,
    force: boolean = false,
  ): Promise<WalletBalance> {
    if (address !== this.currentAddress) {
      dbg('WalletService: Address changed from', this.currentAddress, 'to', address);
      this.currentAddress = address;
    }

    return this.debounceFetch(
      `balance-${address}`,
      async () => {
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

        try {
          dbg('WalletService: Fetching UTXO total from native module');
          const totalUTXO = await BBMTLibNativeModule.totalUTXO(address);
          dbg('WalletService: UTXO total received:', totalUTXO);

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

          const balance = Big(totalUTXO);
          const newBalance = balance.sub(pendingSent).div(1e8).toFixed(8);
          const hasNonZeroBalance = Number(newBalance) > 0;
          const usdAmount = btcRate
            ? this.formatUSD(Big(balance).mul(btcRate).div(1e8).toNumber())
            : '$0.00';

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
    baseApi: string,
    lastSeenTxId: string | null = null,
    retryCount: number = 0,
  ): Promise<{
    transactions: Transaction[];
    lastSeenTxId: string | null;
    hasMore: boolean;
  }> {
    return this.debounceFetch(
      `transactions-${address}-${lastSeenTxId || 'initial'}`,
      async () => {
        dbg('WalletService: Getting transactions for address:', address);
        dbg(
          'WalletService: Parameters - baseApi:',
          baseApi,
          'lastSeenTxId:',
          lastSeenTxId,
          'retryCount:',
          retryCount,
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
          if (this.allTransactions[address]?.length > 0) {
            const allTxs = this.allTransactions[address];
            const pageSize = allTxs.length;
            const startIndex = lastSeenTxId
              ? allTxs.findIndex(tx => tx.txid === lastSeenTxId) + 1
              : 0;
            const pageTxs = allTxs.slice(startIndex, startIndex + pageSize);

            dbg('WalletService: OFFLINE MODE - Using cached transactions');
            dbg('WalletService: OFFLINE MODE - Total cached:', allTxs.length);
            dbg('WalletService: OFFLINE MODE - Page size:', pageTxs.length);
            dbg('WalletService: OFFLINE MODE - Start index:', startIndex);
            dbg(
              'WalletService: OFFLINE MODE - Has more:',
              startIndex + pageSize < allTxs.length,
            );

            return {
              transactions: pageTxs,
              lastSeenTxId:
                pageTxs.length > 0 ? pageTxs[pageTxs.length - 1].txid : null,
              hasMore: startIndex + pageSize < allTxs.length,
            };
          }

          dbg('WalletService: No cached transactions available');

          // If no cache and retries left, try again
          if (retryCount < 3) {
            const retryDelay = 1000 * (retryCount + 1);
            dbg(
              'WalletService: Retrying fetch, attempt',
              retryCount + 1,
              'of 3, in',
              retryDelay,
              'ms',
            );
            return new Promise(resolve =>
              setTimeout(
                () =>
                  resolve(
                    this.getTransactions(
                      address,
                      baseApi,
                      lastSeenTxId,
                      retryCount + 1,
                    ),
                  ),
                retryDelay,
              ),
            );
          }

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
    const cacheKeys = Object.keys(this.cachedTransactions).filter(key =>
      key.startsWith(`${address}-`),
    );
    cacheKeys.forEach(key => {
      delete this.cachedTransactions[key];
      delete this.lastTxFetch[key];
    });
    // Update persistent storage after clearing cache
    await this.saveCachedData();
  }

  public async clearCache() {
    dbg('WalletService: Clearing all caches and resetting state');
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

    // Clear persistent storage
    try {
      await EncryptedStorage.removeItem('walletCache');
      dbg('WalletService: Cleared persistent cache');
    } catch (error) {
      dbg('WalletService: Error clearing persistent cache:', error);
    }

    // Reset the instance
    WalletService.instance = new WalletService();
    return WalletService.instance;
  }
}
