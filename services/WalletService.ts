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

export class WalletService {
  private static instance: WalletService;
  private lastPriceFetch: number = 0;
  private lastBalanceFetch: number = 0;
  private readonly PRICE_CACHE_TIME = 5 * 60 * 1000; // 5 minutes
  private readonly BALANCE_CACHE_TIME = 30 * 1000; // 30 seconds
  private readonly TX_CACHE_TIME = 24 * 60 * 60 * 1000; // 24 hours cache for transactions
  private cachedTransactions: {[key: string]: Transaction[]} = {};
  private lastTxFetch: {[key: string]: number} = {};
  private cachedTxPages: {[key: string]: {[page: string]: Transaction[]}} = {};
  private lastTxPageFetch: {[key: string]: {[page: string]: number}} = {};
  private allTransactions: {[key: string]: Transaction[]} = {}; // New cache for all transactions
  private abortController = new AbortController();
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

  public async getBitcoinPrice(): Promise<{price: string; rate: number}> {
    const now = Date.now();
    if (now - this.lastPriceFetch < this.PRICE_CACHE_TIME) {
      return this.cachedPrice;
    }

    try {
      const response = await fetch('https://mempool.space/api/v1/prices');
      const data = await response.json();
      const rate = parseFloat(data.USD);
      const price = this.formatUSD(data.USD);

      this.cachedPrice = {price, rate};
      this.lastPriceFetch = now;
      await this.saveCachedData();

      return {price, rate};
    } catch (error) {
      dbg('Error fetching BTC price:', error);
      // Return cached price if available, even if expired
      if (this.cachedPrice.rate > 0) {
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
    const now = Date.now();
    if (!force && now - this.lastBalanceFetch < this.BALANCE_CACHE_TIME) {
      return this.cachedBalance;
    }

    try {
      // Clean the address to ensure no double slashes
      const totalUTXO = await BBMTLibNativeModule.totalUTXO(address);

      if (!totalUTXO) {
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

      this.cachedBalance = result;
      this.lastBalanceFetch = now;
      await this.saveCachedData();
      return result;
    } catch (error) {
      dbg('Error fetching wallet balance:', error);
      // Return cached balance if available, even if expired
      if (this.cachedBalance.btc !== '0.00000000') {
        return this.cachedBalance;
      }
      throw new Error('Failed to fetch wallet balance');
    }
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
    try {
      // Clean the baseApi to ensure no double slashes
      const url = lastSeenTxId
        ? `${baseApi}/address/${address}/txs/chain/${lastSeenTxId}`
        : `${baseApi}/address/${address}/txs`;

      dbg('WalletService: Fetching transactions from:', url);
      const response = await axios.get(url, {
        signal: this.abortController.signal,
        timeout: 5000,
      });
      const data = response.data;

      if (!Array.isArray(data)) {
        throw new Error('Invalid response format from API');
      }

      // Process transactions
      const transactions = data
        .map((tx: any) => {
          if (!tx || !tx.txid || !tx.vin || !tx.vout) {
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

      // Sort transactions by block height (newest first)
      const sortedTransactions = transactions.sort(
        (a: any, b: any) =>
          (b.status.block_height || 0) - (a.status.block_height || 0),
      );

      return {
        transactions: sortedTransactions,
        lastSeenTxId:
          sortedTransactions.length > 0
            ? sortedTransactions[sortedTransactions.length - 1].txid
            : null,
        hasMore: data.length === 25,
      };
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
        dbg(
          'WalletService: Retrying fetch, attempt of',
          retryCount + 1,
          ', in',
          1000 * (retryCount + 1),
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
            1000 * (retryCount + 1),
          ),
        );
      }

      throw error;
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
}
