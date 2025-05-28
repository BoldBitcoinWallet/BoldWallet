import Big from 'big.js';
import {BBMTLibNativeModule} from '../native_modules';
import {dbg} from '../utils';

export interface WalletBalance {
  btc: string;
  usd: string;
  hasNonZeroBalance: boolean;
}

export interface Transaction {
  txid: string;
  timestamp: number;
  amount: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
  type: 'send' | 'receive';
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

export class WalletService {
  private static instance: WalletService;
  private lastPriceFetch: number = 0;
  private lastBalanceFetch: number = 0;
  private lastTxFetch: number = 0;
  private readonly PRICE_CACHE_TIME = 5 * 60 * 1000; // 5 minutes
  private readonly BALANCE_CACHE_TIME = 30 * 1000; // 30 seconds
  private readonly TX_CACHE_TIME = 60 * 1000; // 1 minute

  private constructor() {}

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

      return {price, rate};
    } catch (error) {
      dbg('Error fetching BTC price:', error);
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
      const totalUTXO = await BBMTLibNativeModule.totalUTXO(address);

      if (!totalUTXO) {
        const balance = {
          btc: '0.00000000',
          usd: '$0.00',
          hasNonZeroBalance: false,
        };
        this.cachedBalance = balance;
        this.lastBalanceFetch = now;
        return balance;
      }

      const balance = Big(totalUTXO);
      const newBalance = balance.sub(pendingSent).div(1e8).toFixed(8);
      const hasNonZeroBalance = Number(newBalance) > 0;
      const usdAmount = btcRate
        ? `$${this.formatUSD(Big(balance).mul(btcRate).div(1e8).toNumber())}`
        : '$0.00';

      const result = {
        btc: newBalance,
        usd: usdAmount,
        hasNonZeroBalance,
      };

      this.cachedBalance = result;
      this.lastBalanceFetch = now;
      return result;
    } catch (error) {
      dbg('Error fetching wallet balance:', error);
      throw new Error('Failed to fetch wallet balance');
    }
  }

  public async getTransactions(
    address: string,
    baseApi: string,
    force: boolean = false,
  ): Promise<Transaction[]> {
    const now = Date.now();
    if (!force && now - this.lastTxFetch < this.TX_CACHE_TIME) {
      return this.cachedTransactions;
    }

    try {
      const url = `${baseApi}address/${address}/txs`;
      dbg('getTransactions:', url);
      const response = await fetch(`${baseApi}address/${address}/txs`);
      const data = await response.json();

      const transactions = data.map((tx: any) => ({
        txid: tx.txid,
        timestamp: tx.time * 1000,
        amount: tx.value / 1e8,
        fee: tx.fee / 1e8,
        status: {
          confirmed: tx.status === 'confirmed',
          block_height: tx.status.block_height,
          block_time: tx.status.block_time,
        },
        type: tx.value > 0 ? 'receive' : 'send',
        address: tx.address,
        vin: tx.vin,
        vout: tx.vout,
      }));

      this.cachedTransactions = transactions;
      this.lastTxFetch = now;

      dbg('txs', transactions);
      return transactions;
    } catch (error) {
      dbg('Error fetching transactions:', error);
      throw new Error('Failed to fetch transactions');
    }
  }

  private formatUSD(price: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  }

  private cachedPrice: {price: string; rate: number} = {
    price: '$0.00',
    rate: 0,
  };
  private cachedBalance: WalletBalance = {
    btc: '0.00000000',
    usd: '$0.00',
    hasNonZeroBalance: false,
  };
  private cachedTransactions: Transaction[] = [];
}
