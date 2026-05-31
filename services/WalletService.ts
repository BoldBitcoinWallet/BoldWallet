import Big from 'big.js';
import {DeviceEventEmitter} from 'react-native';
import {BBMTLibNativeModule} from '../native_modules';
import {
  dbg,
  getChangePath,
  getMainnetAPIList,
  getReceivePath,
  resolveUseLegacyDerivationPaths,
  getKeyshareMetadata,
  hasWalletKeyshareInSecureStorage,
} from '../utils';
import {
  getGapLimit,
  getApiTimeoutMs,
  getUtxoEmptyCacheTtlMs,
} from './HdOptionsConfig';
import mempoolClient from './MempoolClient';
import {with429Retry} from './sync/rateLimitRetry';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';
import {
  normalizeNetworkKey,
  resolveStoredMempoolApiBase,
} from './mempoolApiBase';
import balanceRepository from './repositories/BalanceRepository';
import transactionRepository from './repositories/TransactionRepository';
import utxoRepository from './repositories/UtxoRepository';
import priceRepository from './repositories/PriceRepository';
import walletRepository, {type WalletAddress} from './repositories/WalletRepository';
import syncRepository from './repositories/SyncRepository';
import balanceSyncer from './sync/BalanceSyncer';
import utxoSyncer from './sync/UtxoSyncer';
import {
  getChangeIndex,
  getExternalIndex,
  getMaxUsedExternal,
  incrementChangeIndexAfterSend as hdIncrementChangeIndexAfterSend,
  setChangeIndex,
  setExternalIndex,
  setMaxUsedExternal,
} from './HdIndexService';
import {validate as validateBitcoinAddress} from 'bitcoin-address-validation';
export interface WalletBalance {
  btc: string;
  usd: string;
  hasNonZeroBalance: boolean;
  timestamp: number;
  /** Net mempool balance in satoshis across all HD addresses.
   *  Positive = incoming unconfirmed.  Negative = outgoing unconfirmed.
   *  Absent on legacy cached entries — treat as 0. */
  pendingSats?: number;
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
export const validateBitcoinAddressEnhanced = (
  address: string,
  network: string = 'mainnet',
): boolean => {
  if (!address || typeof address !== 'string') {
    dbg(
      'WalletService: Bitcoin address validation failed - empty or invalid type',
    );
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
      if (
        !(
          address.startsWith('m') ||
          address.startsWith('n') ||
          address.startsWith('2') ||
          address.startsWith('tb1')
        )
      ) {
        dbg(
          'WalletService: Bitcoin address validation failed - testnet address expected',
        );
        return false;
      }
    } else {
      // Mainnet addresses: 1, 3, bc1 prefixes
      if (
        !(
          address.startsWith('1') ||
          address.startsWith('3') ||
          address.startsWith('bc1')
        )
      ) {
        dbg(
          'WalletService: Bitcoin address validation failed - mainnet address expected',
        );
        return false;
      }
    }
    dbg(
      'WalletService: Bitcoin address validation passed:',
      address,
      'for network:',
      network,
    );
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
  private static keyshareReadyListenerRegistered = false;
  private abortControllers: Map<string, AbortController> = new Map();
  private currentAddress: string | null = null;
  private currentNetwork: string = 'mainnet'; // Default to mainnet
  private currentAddressType: string = 'legacy'; // Default to legacy
  private currentApiUrl: string = 'https://mempool.space/api';
  private fetchInProgress: {[key: string]: boolean} = {};
  private fetchTimeout: {[key: string]: NodeJS.Timeout} = {};
  // In-memory cache for derived HD address lists. Keyed by
  // "<network>_<addressType>_<externalEnd>_<internalEnd>".
  // Invalidated explicitly via invalidateAddressCache() whenever indexes change.
  private hdAddressCache: Map<string, HdAddressWithPath[]> = new Map();
  // Per-address UTXO result cache. Keyed by address string.
  // Only empty results are used to short-circuit future fetches (TTL-gated).
  // Addresses with UTXOs are always re-fetched so spent coins are detected.
  private utxoEmptyCache: Map<string, number> = new Map(); // address → fetchedAt timestamp
  private constructor() {
    // Don't auto-initialize, wait for explicit initialize call
  }
  public async initialize() {
    try {
      const hasBlob = await hasWalletKeyshareInSecureStorage();
      if (!hasBlob) {
        dbg(
          'WalletService: No keyshare blob in secure storage, skipping initialization',
        );
        return;
      }
      const keyshare = await getKeyshareMetadata();
      if (!keyshare) {
        dbg('WalletService: No keyshare metadata, skipping initialization');
        return;
      }
      // Initialize network state from storage
      await this.initializeNetworkState();
      // Seed MempoolClient's public host list for round-robin failover.
      // Fire-and-forget — get() uses the hardcoded default until this resolves.
      getMainnetAPIList()
        .then(bases => mempoolClient.setPublicBases(bases))
        .catch(() => {});
      dbg('WalletService: Initialization completed successfully');
    } catch (error) {
      dbg('WalletService: Error during initialization:', error);
      throw error;
    }
  }
  private async setBal(address: string, balance: WalletBalance) {
    const sats = Math.round((parseFloat(balance.btc) || 0) * 100_000_000);
    balanceRepository.setBalance({
      address,
      network: this.currentNetwork,
      balanceSats: sats,
      pendingSats: balance.pendingSats ?? 0,
      hasNonzero: balance.hasNonZeroBalance,
      fetchedAt: balance.timestamp ?? Date.now(),
    });
  }
  private async setTxs(address: string, transactions: Transaction[]) {
    const now = Date.now();
    for (const tx of transactions) {
      const status = tx.status ?? {};
      transactionRepository.upsertTransaction(
        {
          txid: tx.txid,
          network: this.currentNetwork,
          blockHeight: status.block_height ?? null,
          blockHash: null,
          blockTime: status.block_time ?? tx.timestamp ?? null,
          isConfirmed: status.confirmed === true,
          feeSats: tx.fee ?? null,
          size: null,
          weight: null,
          version: null,
          locktime: null,
          rawJson: JSON.stringify(tx),
          fetchedAt: now,
        },
        [{txid: tx.txid, network: this.currentNetwork, address, netSats: null}],
      );
    }
  }
  public async getBal(address: string): Promise<WalletBalance> {
    const stored = balanceRepository.getBalance(address, this.currentNetwork);
    if (!stored) {
      return {
        btc: '0.00000000',
        usd: '$0.00',
        hasNonZeroBalance: false,
        timestamp: 0,
      };
    }
    return {
      btc: (stored.balanceSats / 1e8).toFixed(8),
      usd: '$0.00',
      hasNonZeroBalance: stored.hasNonzero,
      timestamp: stored.fetchedAt,
      pendingSats: stored.pendingSats,
    };
  }
  public async getTxs(address: string): Promise<CachedTransactionData> {
    const txs = transactionRepository.getTransactionsForAddress(
      address,
      this.currentNetwork,
    );
    if (!txs.length) return {transactions: [], timestamp: 0};
    const transactions: Transaction[] = txs.map(r => {
      try {
        const parsed = JSON.parse(r.rawJson) as Transaction;
        if (r.isConfirmed && parsed.status) {
          parsed.status.confirmed = true;
          if (r.blockHeight) parsed.status.block_height = r.blockHeight;
          if (r.blockTime) parsed.status.block_time = r.blockTime;
        }
        return parsed;
      } catch {
        return {
          txid: r.txid,
          timestamp: r.blockTime ?? undefined,
          amount: 0,
          fee: r.feeSats ?? 0,
          status: {
            confirmed: r.isConfirmed,
            block_height: r.blockHeight ?? undefined,
            block_time: r.blockTime ?? undefined,
          },
          type: 'receive',
          address,
        };
      }
    });
    return {transactions, timestamp: Date.now()};
  }
  private async setPrice(price: {
    price: string;
    rate: number;
    rates: {[key: string]: number};
  }) {
    priceRepository.setCurrentRates(price.rates);
    if (!price.rates.USD && price.rate) {
      priceRepository.setCurrentRate('USD', price.rate);
    }
  }
  public async getCachePrice(): Promise<{
    price: string;
    rate: number;
    rates: {[key: string]: number};
    timestamp: number;
  }> {
    const cached = priceRepository.getCachedPrice('USD');
    return cached ? cached : {price: '$0.00', rate: 0, rates: {}, timestamp: 0};
  }
  private async getStoredState() {
    try {
      const network = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
      const addressType =
        appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || 'legacy';
      const api = resolveStoredMempoolApiBase(network);
      const address = appConfigRepository.get(CONFIG_KEYS.CURRENT_ADDRESS);
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
        appConfigRepository.set(CONFIG_KEYS.NETWORK, state.network);
      }
      if (state.addressType) {
        appConfigRepository.set(CONFIG_KEYS.ADDRESS_TYPE, state.addressType);
      }
      if (state.api) {
        appConfigRepository.set('api', state.api);
      }
      if (state.address) {
        appConfigRepository.set(CONFIG_KEYS.CURRENT_ADDRESS, state.address);
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

  /**
   * Re-read keyshare metadata and network prefs after setup or import.
   * Subscribed to `wallet:keyshare-ready` (emitted by saveKeyshareMetadata).
   */
  public async refreshAfterKeyshareReady(): Promise<void> {
    dbg('WalletService: refreshAfterKeyshareReady');
    this.invalidateAddressCache();
    this.currentAddress = null;
    await this.initialize();
  }

  private static ensureKeyshareReadyListener(): void {
    if (WalletService.keyshareReadyListenerRegistered) {
      return;
    }
    WalletService.keyshareReadyListenerRegistered = true;
    DeviceEventEmitter.addListener('wallet:keyshare-ready', () => {
      WalletService.getInstance()
        .refreshAfterKeyshareReady()
        .catch(() => {});
    });
  }

  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    WalletService.ensureKeyshareReadyListener();
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
    return (await this.getNextChangeAddressWithPath(network, addressType))
      .address;
  }

  public async getNextChangeAddressWithPath(
    network: string,
    addressType: string,
  ): Promise<{address: string; path: string}> {
    const ks = await getKeyshareMetadata();
    if (!ks) throw new Error('No keyshare found');
    const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
    const changeIdx = await getChangeIndex(network, addressType);
    const path = getChangePath(network, addressType, useLegacyPath, changeIdx);
    const btcPub = await BBMTLibNativeModule.derivePubkey(
      ks.pub_key,
      ks.chain_code_hex,
      path,
    );
    const address = await BBMTLibNativeModule.btcAddress(
      btcPub,
      network,
      addressType,
    );
    dbg('WalletService: getNextChangeAddressWithPath', {
      network,
      addressType,
      changeIdx,
      address: address?.slice(0, 12) + '...',
      path,
    });
    return {address, path};
  }

  /** Call after a send has been successfully broadcast to advance the change index. */
  public async incrementChangeIndexAfterSend(
    network: string,
    addressType: string,
  ): Promise<void> {
    await hdIncrementChangeIndexAfterSend(network, addressType);
    this.invalidateAddressCache(network, addressType);
  }

  /**
   * Force balance + UTXO refresh after broadcast so self-sends do not leave stale
   * per-address rows (double balance) or duplicate UTXOs in SQLite.
   */
  public async refreshSpendStateAfterBroadcast(
    network: string,
    addressType: string,
  ): Promise<void> {
    const apiBase = resolveStoredMempoolApiBase(network);
    if (!apiBase) {
      dbg('WalletService: refreshSpendStateAfterBroadcast — no api base');
      return;
    }
    const active = await this.getActiveAddressesWithPaths(network, addressType);
    if (!active.length) {
      dbg('WalletService: refreshSpendStateAfterBroadcast — no active addresses');
      return;
    }
    syncRepository.invalidate('balance', `aggregate_${network}_${addressType}`);
    const balanceEntries = active.map(a => {
      syncRepository.invalidate('balance', `${a.address}_${network}`);
      syncRepository.invalidate('utxos', `${a.address}_${network}`);
      return {address: a.address, network};
    });
    const utxoEntries = active.map(a => ({
      address: a.address,
      network,
      derivationPath: a.derivationPath,
    }));
    try {
      await balanceSyncer.syncAddresses(balanceEntries, apiBase);
    } catch (e) {
      dbg('WalletService: refreshSpendStateAfterBroadcast balance error', e);
    }
    try {
      await utxoSyncer.syncAddresses(utxoEntries, apiBase);
    } catch (e) {
      dbg('WalletService: refreshSpendStateAfterBroadcast utxo error', e);
    }
    dbg(
      'WalletService: refreshSpendStateAfterBroadcast done for',
      active.length,
      'addresses',
    );
  }

  /**
   * Derive the next receive (external) address and persist it as current.
   * Call when user requests "Get new address" to avoid address reuse.
   */
  public async getNextReceiveAddress(
    network: string,
    addressType: string,
  ): Promise<string> {
    const ks = await getKeyshareMetadata();
    if (!ks) throw new Error('No keyshare found');
    const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
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
    dbg('WalletService: getNextReceiveAddress', {
      network,
      addressType,
      nextIndex,
    });
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
    options?: {skipEmptyCache?: boolean},
  ): Promise<UtxoWithPath[]> {
    const net = normalizeNetworkKey(network);
    const addressesWithPaths = await this.getHdAddressesWithPaths(
      net,
      addressType || 'segwit-native',
    );
    if (addressesWithPaths.length === 0) {
      return [];
    }
    return this.fetchUtxosForAddresses(
      addressesWithPaths,
      apiUrl,
      signal,
      options,
    );
  }

  /** Live UTXO fetch for a single derivation path (send fallback when HD scan is empty). */
  public async fetchUtxosAtPath(
    network: string,
    addressType: string,
    derivationPath: string,
    apiUrl: string,
    chain: 'receive' | 'change' = 'receive',
    chainIndex: number = 0,
    options?: {skipEmptyCache?: boolean},
  ): Promise<UtxoWithPath[]> {
    const net = normalizeNetworkKey(network);
    const ks = await getKeyshareMetadata();
    if (!ks) {
      return [];
    }
    const pub = await BBMTLibNativeModule.derivePubkey(
      ks.pub_key,
      ks.chain_code_hex,
      derivationPath,
    );
    const address = await BBMTLibNativeModule.btcAddress(
      pub,
      net,
      addressType || 'segwit-native',
    );
    return this.fetchUtxosForAddresses(
      [{address, derivationPath, chain, index: chainIndex}],
      apiUrl,
      undefined,
      options,
    );
  }

  private async fetchUtxosForAddresses(
    addressesWithPaths: HdAddressWithPath[],
    apiUrl: string,
    signal?: AbortSignal,
    options?: {skipEmptyCache?: boolean},
  ): Promise<UtxoWithPath[]> {
    const baseUrl = apiUrl.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const fullApiUrl = `${baseUrl}/api`;
    const isTestnetApi = /\/testnet(\/|$)/.test(fullApiUrl);
    const skipEmptyCache = options?.skipEmptyCache === true;

    const merged: UtxoWithPath[] = [];
    const controller = signal ? undefined : new AbortController();
    const fetchSignal = signal ?? controller?.signal;
    if (controller) {
      setTimeout(() => controller.abort(), 20000);
    }

    for (const {address, derivationPath, chain, index} of addressesWithPaths) {
      if (!this.addressMatchesNetwork(address, isTestnetApi)) {
        continue;
      }
      if (fetchSignal?.aborted) {
        dbg('WalletService: fetchUtxosForAddresses aborted', {
          address: address.slice(0, 12),
        });
        break;
      }
      if (!skipEmptyCache) {
        const emptyAt = this.utxoEmptyCache.get(address);
        if (emptyAt && Date.now() - emptyAt < getUtxoEmptyCacheTtlMs()) {
          continue;
        }
      }

      try {
        const utxoUrl = `${fullApiUrl}/address/${encodeURIComponent(
          address,
        )}/utxo`;
        const res = await this.withTimeout(
          `utxo-${address.slice(0, 12)}`,
          mempoolClient.get<ApiUtxo[]>(utxoUrl, {signal: fetchSignal}),
          8000,
        );
        if (!res.ok) {
          continue;
        }
        const rawList: ApiUtxo[] = res.data;
        if (!Array.isArray(rawList)) {
          continue;
        }
        if (rawList.length === 0) {
          if (!skipEmptyCache) {
            this.utxoEmptyCache.set(address, Date.now());
          }
          continue;
        }
        for (const u of rawList) {
          merged.push({
            ...u,
            address,
            derivationPath,
            chain,
            chainIndex: index,
          });
        }
      } catch (e) {
        dbg('WalletService: fetchUtxosForAddresses failed for address', {
          address: address.slice(0, 12),
          error: e,
        });
      }
    }

    merged.sort((a, b) => {
      if (a.chain !== b.chain) {
        return a.chain === 'receive' ? -1 : 1;
      }
      if (a.chainIndex !== b.chainIndex) {
        return a.chainIndex - b.chainIndex;
      }
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
   * Clears the in-memory HD address cache for the given network+addressType combination.
   * Call this after any index advance (e.g. after a send, after bumpExternalIndexIfCurrentUsed).
   */
  public invalidateAddressCache(network?: string, addressType?: string): void {
    if (!network && !addressType) {
      this.hdAddressCache.clear();
      this.utxoEmptyCache.clear();
      return;
    }
    const prefix = `${network}_${addressType}_`;
    for (const key of this.hdAddressCache.keys()) {
      if (key.startsWith(prefix)) {
        this.hdAddressCache.delete(key);
      }
    }
    // Also clear the UTXO empty-skip cache so newly-active addresses are not skipped
    this.utxoEmptyCache.clear();
  }

  /**
   * Derives and persists receive + change rows for each index in
   * [startIdx, endIdxInclusive]. Skips slots already in wallet_addresses.
   * Used by the Addresses tab when expanding the list beyond discovery range.
   */
  public async ensureWalletAddressPairIndices(
    network: string,
    addressType: string,
    useLegacyPath: boolean,
    startIdx: number,
    endIdxInclusive: number,
  ): Promise<void> {
    if (endIdxInclusive < startIdx || startIdx < 0) {
      return;
    }
    const ks = await getKeyshareMetadata();
    if (!ks) {
      dbg('WalletService.ensureWalletAddressPairIndices: no keyshare');
      return;
    }
    const batch: WalletAddress[] = [];
    for (let idx = startIdx; idx <= endIdxInclusive; idx++) {
      for (const chain of [0, 1] as const) {
        if (walletRepository.getAddressAt(network, addressType, chain, idx)) {
          continue;
        }
        const path =
          chain === 0
            ? getReceivePath(network, addressType, useLegacyPath, idx)
            : getChangePath(network, addressType, useLegacyPath, idx);
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
        batch.push({
          network,
          addressType,
          chain,
          idx,
          address,
          isUsed: false,
        });
      }
    }
    if (batch.length) {
      walletRepository.upsertAddressBatch(batch);
      dbg(
        'WalletService.ensureWalletAddressPairIndices upserted',
        batch.length,
        'rows',
        {network, addressType, startIdx, endIdxInclusive},
      );
      this.invalidateAddressCache(network, addressType);
    }
  }

  /**
   * Returns all in-scope HD addresses with derivation path and chain (receive vs change).
   * Results are memoized in-memory for the lifetime of the app session — re-derivation only
   * happens when the indexes change (i.e. after the cache is explicitly invalidated).
   */
  public async getHdAddressesWithPaths(
    network: string,
    addressType: string,
  ): Promise<HdAddressWithPath[]> {
    const ks = await getKeyshareMetadata();
    if (!ks) {
      dbg(
        '[BALANCE] getHdAddressesWithPaths: keyshare not in EncryptedStorage — returning [].',
        'network:',
        network,
        'addressType:',
        addressType,
        '(iOS Keychain may still be initialising after device unlock)',
      );
      return [];
    }
    const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
    const externalIdx = await getExternalIndex(network, addressType);
    const maxUsedExternal = await getMaxUsedExternal(network, addressType);
    const changeIdx = await getChangeIndex(network, addressType);
    // Include addresses up to highest + GAP_LIMIT so sync (and tap-to-refresh) catches the next
    // receive/change addresses and we don't miss incoming txs to gap indices.
    const externalEnd = Math.max(externalIdx, maxUsedExternal) + getGapLimit();
    const internalEnd = changeIdx + getGapLimit();

    const cacheKey = `${network}_${addressType}_${externalEnd}_${internalEnd}`;
    const cached = this.hdAddressCache.get(cacheKey);
    if (cached) {
      dbg(
        'WalletService: getHdAddressesWithPaths cache hit',
        cacheKey,
        cached.length,
        'addresses',
      );
      return cached;
    }

    dbg(
      'WalletService: getHdAddressesWithPaths deriving',
      externalEnd + 1,
      'receive +',
      internalEnd + 1,
      'change addresses',
    );
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

    this.hdAddressCache.set(cacheKey, results);
    return results;
  }

  /**
   * Returns the subset of HD addresses that are "active" and worth querying on
   * tap-to-refresh.  An address is active if any of:
   *   - Its receive index is within [highestUsed - gap .. highestUsed + gap]
   *   - Its change index is within [changeIdx - gap .. changeIdx + gap]
   *   - It currently holds UTXOs in the DB
   *   - It has a pending (unconfirmed) transaction in the DB
   *   - It is the current receive address (externalIdx)
   *
   * Builds from the already-derived full list (cached), so no extra native calls.
   * Background SyncCoordinator still scans the full range on its timer.
   */
  public async getActiveAddressesWithPaths(
    network: string,
    addressType: string,
  ): Promise<HdAddressWithPath[]> {
    const all = await this.getHdAddressesWithPaths(network, addressType);
    if (all.length === 0) return [];

    const gap = getGapLimit();
    const externalIdx = await getExternalIndex(network, addressType);
    const maxUsedExternal = await getMaxUsedExternal(network, addressType);
    const changeIdx = await getChangeIndex(network, addressType);

    const highestUsed = Math.max(externalIdx, maxUsedExternal);
    const receiveMin = Math.max(0, highestUsed - gap);
    const receiveMax = highestUsed + gap;
    const changeMin = Math.max(0, changeIdx - gap);
    const changeMax = changeIdx + gap;

    const allAddresses = all.map(a => a.address);

    // Addresses holding UTXOs
    const utxosInDb = utxoRepository.getUtxosForAddresses(
      allAddresses,
      network,
    );
    const utxoAddrSet = new Set(utxosInDb.map(u => u.address));

    // Addresses with pending (unconfirmed) transactions
    const pendingAddrSet = new Set<string>(
      transactionRepository.getAddressesWithPendingTxs(network),
    );

    const active = all.filter(a => {
      if (utxoAddrSet.has(a.address)) return true;
      if (pendingAddrSet.has(a.address)) return true;
      if (a.chain === 'receive') {
        return (
          a.index === externalIdx ||
          (a.index >= receiveMin && a.index <= receiveMax)
        );
      }
      // change chain
      return a.index >= changeMin && a.index <= changeMax;
    });

    dbg(
      'WalletService: getActiveAddressesWithPaths',
      active.length,
      '/',
      all.length,
      'active addresses',
      {receiveMin, receiveMax, changeMin, changeMax},
    );
    return active;
  }

  /**
   * Returns the current receive address, derivation path, and index for display (e.g. ReceiveModal).
   *
   * All three values are derived together in one call so the returned object is
   * always internally consistent — the address is guaranteed to match the path
   * and index, eliminating the stale-state flicker that arises when address and
   * path info are fetched from separate state variables.
   */
  public async getCurrentReceivePathInfo(
    network: string,
    addressType: string,
  ): Promise<{path: string; index: number; address: string} | null> {
    const ks = await getKeyshareMetadata();
    if (!ks) {
      dbg('WalletService: getCurrentReceivePathInfo - no keyshare');
      return null;
    }
    const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
    const index = await getExternalIndex(network, addressType);
    const path = getReceivePath(network, addressType, useLegacyPath, index);
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
    dbg('WalletService: getCurrentReceivePathInfo', {
      network,
      addressType,
      index,
      path,
      address: address.slice(0, 12),
    });
    return {path, index, address};
  }

  /**
   * If the current external (receive) address has ever been used (confirmed or mempool),
   * advance externalIndex to the next index and update maxUsedExternal accordingly.
   * This is a lightweight frontier bump, not a full restore scan.
   */
  public async bumpExternalIndexIfCurrentUsed(
    network: string,
    addressType: string,
    apiUrl: string,
  ): Promise<void> {
    try {
      const ks = await getKeyshareMetadata();
      if (!ks) {
        dbg('WalletService: bumpExternalIndexIfCurrentUsed - no keyshare');
        return;
      }
      const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
      const currentIndex = await getExternalIndex(network, addressType);
      const path = getReceivePath(
        network,
        addressType,
        useLegacyPath,
        currentIndex,
      );
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
      const used = await this.isAddressUsed(addr, apiUrl);
      if (!used) {
        dbg(
          'WalletService: bumpExternalIndexIfCurrentUsed - current address not used',
          {network, addressType, currentIndex, addr: addr.slice(0, 12)},
        );
        return;
      }
      const prevMaxUsed = await getMaxUsedExternal(network, addressType);
      const newMaxUsed = Math.max(prevMaxUsed, currentIndex, 0);
      await setMaxUsedExternal(network, addressType, newMaxUsed);
      const newIndex = newMaxUsed + 1;
      await setExternalIndex(network, addressType, newIndex);
      dbg('WalletService: bumpExternalIndexIfCurrentUsed advanced index', {
        network,
        addressType,
        currentIndex,
        newIndex,
        newMaxUsed,
        addr: addr.slice(0, 12),
      });
      this.invalidateAddressCache(network, addressType);
    } catch (error) {
      dbg('WalletService: bumpExternalIndexIfCurrentUsed error', {
        network,
        addressType,
        error,
      });
    }
  }

  /**
   * HD rule: An address is USED if it has EVER appeared in transaction history (confirmed or mempool),
   * regardless of current UTXO state. Used for restore discovery to prevent address reuse.
   */
  private async isAddressUsed(
    address: string,
    apiUrl: string,
    timeout: number = 10_000,
  ): Promise<boolean> {
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/address/${address}/txs`;
    try {
      const response = await this.withTimeout(
        `txs-${address.slice(0, 12)}`,
        signal => mempoolClient.get(url, {signal, timeoutMs: timeout}),
        timeout,
      );
      if (!response.ok) {
        dbg('WalletService: isAddressUsed fetch failed', {
          address: address.slice(0, 12),
          status: response.status,
        });
        throw new Error(`isAddressUsed HTTP ${response.status}`);
      }
      const data = response.data as unknown;
      const hasTxs = Array.isArray(data) && data.length > 0;
      dbg('WalletService: isAddressUsed', {
        address: address.slice(0, 12),
        hasTxs,
      });
      return hasTxs;
    } catch (error) {
      dbg('WalletService: isAddressUsed error', {
        address: address.slice(0, 12),
        error,
      });
      throw error;
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
    onProgress?: (
      chain: 'external' | 'internal',
      index: number,
      gapIndex: number,
    ) => void,
  ): Promise<void> {
    dbg('WalletService: discoverHdIndexesForNetwork START', {
      network,
      addressType,
      apiUrl: apiUrl?.slice(0, 40) + '...',
    });
    const ks = await getKeyshareMetadata();
    if (!ks) {
      dbg('WalletService: No keyshare, skipping restore discovery');
      return;
    }
    const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
    BBMTLibNativeModule.setAPI(network, apiUrl);

    const prevExternalIndex = await getExternalIndex(network, addressType);
    const prevMaxUsedExternal = await getMaxUsedExternal(network, addressType);
    const prevChangeIndex = await getChangeIndex(network, addressType);

    let discoveredMaxUsedExternal = -1;
    let discoveredMaxUsedChange = -1;
    let discoveryStatus: 'ok' | 'partial' | 'failed' = 'ok';
    const startedAt = Date.now();

    // Load previously scanned addresses. We only skip network checks when the
    // row says isUsed=true — a cached false may be wrong (wrong mempool host,
    // timeout, or aborted run). Counting false toward the gap limit caused iOS
    // to stop after ~2 indices while Android had a clean DB and scanned to 36+.
    const knownExternal = new Map<number, boolean>();
    for (const a of walletRepository.getAddresses(network, addressType, 0)) {
      knownExternal.set(a.idx, a.isUsed);
    }
    const knownChange = new Map<number, boolean>();
    for (const a of walletRepository.getAddresses(network, addressType, 1)) {
      knownChange.set(a.idx, a.isUsed);
    }

    dbg('WalletService: Restore discovery - scanning external chain', {
      network,
      addressType,
      useLegacyPath,
      cachedExternal: knownExternal.size,
      cachedChange: knownChange.size,
    });

    // External chain: scan until GAP_LIMIT consecutive unused.
    // Each address check gets one retry on timeout before aborting the chain.
    try {
      let consecutiveUnused = 0;
      for (let i = 0; consecutiveUnused < getGapLimit(); i++) {
        const cachedUsed = knownExternal.get(i);
        if (cachedUsed === true) {
          discoveredMaxUsedExternal = i;
          consecutiveUnused = 0;
          onProgress?.('external', i, consecutiveUnused);
          continue;
        }

        // Missing row or cached isUsed=false — derive and verify via API.
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
          walletRepository.upsertAddress({
            network,
            addressType,
            chain: 0,
            idx: i,
            address: addr,
            isUsed: used,
          });
          if (used) {
            discoveredMaxUsedExternal = i;
            consecutiveUnused = 0;
          } else {
            consecutiveUnused++;
          }
        } catch {
          dbg('WalletService: Restore discovery external error, retrying', {
            network,
            addressType,
            index: i,
          });
          try {
            await waitMS(1500);
            const retryUrl = `${apiUrl.replace(
              /\/+$/,
              '',
            )}/address/${addr}/txs`;
            mempoolClient.evictInflight(retryUrl);
            const used = await this.isAddressUsed(addr, apiUrl);
            walletRepository.upsertAddress({
              network,
              addressType,
              chain: 0,
              idx: i,
              address: addr,
              isUsed: used,
            });
            if (used) {
              discoveredMaxUsedExternal = i;
              consecutiveUnused = 0;
            } else {
              consecutiveUnused++;
            }
          } catch (retryError) {
            dbg('WalletService: Restore discovery external error after retry', {
              network,
              addressType,
              index: i,
              error: retryError,
            });
            discoveryStatus = 'partial';
            break;
          }
        }
      }
    } catch (error) {
      dbg('WalletService: Restore discovery external FAILED', {
        network,
        addressType,
        error,
      });
      discoveryStatus = 'failed';
    }

    // Internal (change) chain: only scan if external completed successfully
    if (discoveryStatus === 'ok') {
      dbg(
        'WalletService: Restore discovery - scanning internal (change) chain',
        {
          network,
          addressType,
        },
      );
      try {
        let consecutiveUnused = 0;
        for (let i = 0; consecutiveUnused < getGapLimit(); i++) {
          const cachedUsed = knownChange.get(i);
          if (cachedUsed === true) {
            discoveredMaxUsedChange = i;
            consecutiveUnused = 0;
            onProgress?.('internal', i, consecutiveUnused);
            continue;
          }

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
            walletRepository.upsertAddress({
              network,
              addressType,
              chain: 1,
              idx: i,
              address: addr,
              isUsed: used,
            });
            if (used) {
              discoveredMaxUsedChange = i;
              consecutiveUnused = 0;
            } else {
              consecutiveUnused++;
            }
          } catch {
            dbg('WalletService: Restore discovery internal error, retrying', {
              network,
              addressType,
              index: i,
            });
            try {
              await waitMS(1500);
              const retryUrl = `${apiUrl.replace(
                /\/+$/,
                '',
              )}/address/${addr}/txs`;
              mempoolClient.evictInflight(retryUrl);
              const used = await this.isAddressUsed(addr, apiUrl);
              walletRepository.upsertAddress({
                network,
                addressType,
                chain: 1,
                idx: i,
                address: addr,
                isUsed: used,
              });
              if (used) {
                discoveredMaxUsedChange = i;
                consecutiveUnused = 0;
              } else {
                consecutiveUnused++;
              }
            } catch (retryError) {
              dbg(
                'WalletService: Restore discovery internal error after retry',
                {
                  network,
                  addressType,
                  index: i,
                  error: retryError,
                },
              );
              discoveryStatus = 'partial';
              break;
            }
          }
        }
      } catch (error) {
        dbg('WalletService: Restore discovery internal FAILED', {
          network,
          addressType,
          error,
        });
        discoveryStatus = 'failed';
      }
    }

    const durationMs = Date.now() - startedAt;

    // Commit discovered indexes even for partial results.
    // Previously, partial discovery threw away everything — meaning if the API
    // timed out at index 5 but we found used addresses at indexes 0-3, those
    // results were lost and the wallet showed 0 balance.
    if (
      discoveryStatus === 'ok' ||
      (discoveryStatus === 'partial' && discoveredMaxUsedExternal >= 0)
    ) {
      const externalNext = Math.max(
        0,
        discoveredMaxUsedExternal + 1,
        prevExternalIndex,
      );
      await setExternalIndex(network, addressType, externalNext);
      if (discoveredMaxUsedExternal >= 0) {
        await setMaxUsedExternal(
          network,
          addressType,
          Math.max(prevMaxUsedExternal, discoveredMaxUsedExternal, 0),
        );
      }
      if (discoveryStatus === 'ok') {
        const changeNext = Math.max(
          0,
          discoveredMaxUsedChange + 1,
          prevChangeIndex,
        );
        await setChangeIndex(network, addressType, changeNext);
      }
      dbg('WalletService: Restore discovery committed indexes', {
        network,
        addressType,
        discoveryStatus,
        discoveredMaxUsedExternal,
        externalNext,
        discoveredMaxUsedChange,
        durationMs,
      });
      if (discoveryStatus === 'ok') {
        walletRepository.setRestoreDone(network, addressType, true);
      }
      walletRepository.setDiscoveryStatus(
        network,
        addressType,
        discoveryStatus,
        Date.now(),
      );
    } else {
      dbg(
        'WalletService: Restore discovery aborted, keeping previous HD indexes',
        {
          network,
          addressType,
          discoveryStatus,
          prevExternalIndex,
          prevMaxUsedExternal,
          prevChangeIndex,
          durationMs,
        },
      );
      walletRepository.setDiscoveryStatus(
        network,
        addressType,
        discoveryStatus,
        Date.now(),
      );
    }

    dbg('WalletService: discoverHdIndexesForNetwork COMPLETE', {
      network,
      addressType,
      discoveryStatus,
      durationMs,
    });
    // Indexes may have changed — drop the cached address list
    this.invalidateAddressCache(network, addressType);
  }

  private cancelOngoingFetches(key: string) {
    const ctrl = this.abortControllers.get(key);
    if (ctrl) {
      ctrl.abort();
      this.abortControllers.delete(key);
    }
    this.fetchInProgress[key] = false;
    if (this.fetchTimeout[key]) {
      clearTimeout(this.fetchTimeout[key]);
      delete this.fetchTimeout[key];
    }
  }
  /**
   * Run a promise factory with a per-key AbortController and timeout.
   * The factory receives an AbortSignal scoped to this key — aborting one
   * key does NOT cancel requests for other keys (fixes the shared-controller
   * cascade where e.g. a price fetch aborting would kill discovery fetches).
   */
  private async withTimeout<T>(
    key: string,
    factory: Promise<T> | ((signal: AbortSignal) => Promise<T>),
    timeout: number = getApiTimeoutMs(),
  ): Promise<T> {
    this.cancelOngoingFetches(key);
    this.fetchInProgress[key] = true;
    const ctrl = new AbortController();
    this.abortControllers.set(key, ctrl);
    const promise =
      typeof factory === 'function' ? factory(ctrl.signal) : factory;
    const timeoutPromise = new Promise<T>((_, reject) => {
      this.fetchTimeout[key] = setTimeout(() => {
        ctrl.abort();
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
      // DB-level TTL: return cached price when it was written recently.
      const cachedPrice = priceRepository.getCachedPrice('USD');
      if (
        cachedPrice &&
        cachedPrice.timestamp &&
        Date.now() - cachedPrice.timestamp < 45_000
      ) {
        dbg('WalletService.getBitcoinPrice: DB fresh — returning cached');
        return {
          price: this.formatUSD(cachedPrice.rate),
          rate: cachedPrice.rate,
          rates: cachedPrice.rates,
          timestamp: cachedPrice.timestamp,
        };
      }

      // Price is always fetched from mainnet (even in testnet mode).
      const network = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
      const userMainnetApi =
        appConfigRepository.get('api_mainnet') ||
        (network === 'mainnet' ? appConfigRepository.get('api') : null) ||
        '';
      const apiEndpoints = await getMainnetAPIList();
      mempoolClient.setPublicBases(apiEndpoints);

      const normalizeBase = (url: string) =>
        (url || '').replace(/\/+$/, '').replace(/\/api\/?$/, '');
      const publicBases = new Set(apiEndpoints.map(normalizeBase));
      const userBase = normalizeBase(userMainnetApi);

      // Use failover (public list) only when the user's mainnet API is one of the offered public ones.
      // When the user has a custom mainnet host for privacy, hit only that host — no public round-robin.
      const basesToTry: string[] =
        userMainnetApi && !publicBases.has(userBase)
          ? [userMainnetApi]
          : apiEndpoints;

      if (userMainnetApi && !publicBases.has(userBase)) {
        dbg(
          'WalletService: Using custom mainnet API only for price (no public failover):',
          userMainnetApi,
        );
      } else {
        dbg(
          'WalletService: Attempting to fetch BTC price using round-robin from APIs:',
          basesToTry,
        );
      }
      let lastError: any = null;
      for (const baseApiUrl of basesToTry) {
        try {
          // Always use mainnet price endpoint (remove any testnet suffix)
          const priceUrl =
            baseApiUrl.replace(/\/testnet\/?$/, '') + '/v1/prices';
          dbg('WalletService: Trying price API URL:', priceUrl);
          const response = await this.withTimeout('price', signal =>
            mempoolClient.get(priceUrl, {signal}),
          );
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const data = response.data as any;
          dbg(
            'WalletService: Raw price data received from',
            priceUrl,
            ':',
            data,
          );
          if (!data || !data.USD || !validateNumber(data.USD)) {
            dbg(
              'WalletService: Invalid price data received from',
              priceUrl,
              ':',
              data,
            );
            throw new Error('Invalid price data received');
          }
          const rate = parseFloat(data.USD);
          dbg('WalletService: Parsed rate:', rate);
          if (isNaN(rate) || rate <= 0) {
            dbg('WalletService: Invalid rate value:', rate);
            throw new Error('Invalid rate value');
          }
          const price = this.formatUSD(data.USD);
          dbg(
            'WalletService: New price fetched from',
            priceUrl,
            '- Rate:',
            rate,
            'Price:',
            price,
          );
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
      for (const ctrl of this.abortControllers.values()) {
        ctrl.abort();
      }
      this.abortControllers.clear();
      // Clear persistent storage
      try {
        dbg(
          'WalletService: Cleared persistent cache (walletCache key deprecated)',
        );
      } catch (error) {
        dbg('WalletService: Error clearing persistent cache:', error);
      }
      // Generate address for the current network at current external index (HD)
      try {
        const ks = await getKeyshareMetadata();
        if (!ks) throw new Error('No keyshare metadata');
        const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
        const externalIndex = await getExternalIndex(
          network,
          state.addressType,
        );
        const path = getReceivePath(
          network,
          state.addressType,
          useLegacyPath,
          externalIndex,
        );
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
      const ks = await getKeyshareMetadata();
      if (!ks) throw new Error('No keyshare metadata');
      const useLegacyPath = resolveUseLegacyDerivationPaths(ks);
      const externalIndex = await getExternalIndex(state.network, addressType);
      const path = getReceivePath(
        state.network,
        addressType,
        useLegacyPath,
        externalIndex,
      );
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
      const normalizedNetwork =
        this.currentNetwork === 'testnet3' ? 'testnet' : this.currentNetwork;
      if (!validateBitcoinAddressEnhanced(address, normalizedNetwork)) {
        dbg(
          'WalletService: Invalid Bitcoin address format:',
          address,
          'for network:',
          this.currentNetwork,
        );
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
      const api = appConfigRepository.get('api') || this.currentApiUrl;
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
      const finalBalance = balanceAfterPending.gte(0)
        ? balanceAfterPending
        : new Big(0);
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
   *
   * Uses GET /api/address/{addr} instead of /api/address/{addr}/utxo so that:
   *   - Responses are ~50× smaller (6 integers vs a full UTXO array)
   *   - All calls go through mempoolClient (30 s cache + in-flight dedup)
   *   - The formula is equivalent: confirmed + unconfirmed funded minus spent
   *
   * balance_sats = (chain_stats.funded_txo_sum  - chain_stats.spent_txo_sum)
   *             + (mempool_stats.funded_txo_sum - mempool_stats.spent_txo_sum)
   *
   * The UTXO list for transaction construction is fetched separately via
   * fetchUtxosWithPaths (also mempoolClient-cached) and is not affected here.
   */
  public async getWalletBalanceAggregate(
    network: string,
    addressType: string,
    btcRate: number,
    pendingSent: number = 0,
    _force: boolean = false,
    onProgress?: (current: number, total: number) => void,
    activeOnly: boolean = false,
  ): Promise<WalletBalance> {
    try {
      dbg('WalletService: getWalletBalanceAggregate', {
        network,
        addressType,
        btcRate,
        pendingSent,
        _force,
      });

      const _ksCheck = await getKeyshareMetadata();
      if (!_ksCheck) {
        dbg('WalletService: No keyshare for aggregate balance');
        return {
          btc: '0.00000000',
          usd: '$0.00',
          hasNonZeroBalance: false,
          timestamp: Date.now(),
        };
      }

      // DB-level TTL: if the aggregate was written recently, return it
      // without touching the network. Both this method and BalanceSyncer
      // stamp sync_metadata on success, so they share freshness state.
      const aggKey = `aggregate_${network}_${addressType}`;
      if (!_force && syncRepository.isFresh('balance', aggKey, 20_000)) {
        const cached = await this.getCachedAggregateBalance(
          network,
          addressType,
        );
        if (cached) {
          dbg(
            '[BALANCE] getWalletBalanceAggregate: DB fresh — returning cached',
          );
          return cached;
        }
      }

      const api = appConfigRepository.get('api') || this.currentApiUrl;
      if (!api) throw new Error('No API URL found');
      const cleanApi = api.replace(/\/+$/, '');

      if (_force) {
        mempoolClient.invalidate(`${cleanApi}/api/address/`);
      }

      // Reuse the cached address list — no re-derivation if indexes haven't changed.
      // When activeOnly is true (tap-to-refresh) only query the active address set:
      // recent-index window + UTXO holders + pending-tx addresses + current receive.
      // Background SyncCoordinator continues to scan the full range.
      const addressesWithPaths = activeOnly
        ? await this.getActiveAddressesWithPaths(network, addressType)
        : await this.getHdAddressesWithPaths(network, addressType);
      const addresses = addressesWithPaths.map(a => a.address);

      // Guard: if the address list is empty the keyshare was not accessible
      // (e.g. iOS Keychain still initialising immediately after device unlock).
      // Fall back to the stored aggregate rather than returning 0.
      if (addresses.length === 0) {
        dbg(
          '[BALANCE] getWalletBalanceAggregate: address list is EMPTY — keyshare unavailable.',
          'network:',
          network,
          'addressType:',
          addressType,
          'Falling back to cached aggregate instead of returning 0.',
        );
        const cached = await this.getCachedAggregateBalance(
          network,
          addressType,
        );
        dbg(
          '[BALANCE] getWalletBalanceAggregate: cached aggregate =',
          cached ? cached.btc + ' BTC' : 'NOT FOUND',
        );
        if (cached) return cached;
      }

      // ATOMIC: collect all in memory; only write when every address succeeds.
      const perAddressBalances: Array<{
        address: string;
        balanceSats: number;
        pendingSats: number;
        hasNonzero: boolean;
        fetchedAt: number;
      }> = [];
      let confirmedSats = new Big(0);
      let mempoolSats = new Big(0);
      const total = addresses.length;

      for (let i = 0; i < addresses.length; i++) {
        const addr = addresses[i];
        onProgress?.(i + 1, total);
        try {
          const res = await mempoolClient.get<{
            chain_stats: {funded_txo_sum: number; spent_txo_sum: number};
            mempool_stats: {funded_txo_sum: number; spent_txo_sum: number};
          }>(`${cleanApi}/address/${encodeURIComponent(addr)}`);

          if (!res.ok || !res.data) {
            dbg(
              '[BALANCE] getWalletBalanceAggregate: address failed',
              addr.slice(0, 10),
              res.status,
            );
            const cached = await this.getCachedAggregateBalance(
              network,
              addressType,
            );
            if (cached) return cached;
            return {
              btc: '0.00000000',
              usd: '$0.00',
              hasNonZeroBalance: false,
              timestamp: Date.now(),
              pendingSats: 0,
            };
          }

          const {chain_stats, mempool_stats} = res.data;
          const addrConfirmed =
            chain_stats.funded_txo_sum - chain_stats.spent_txo_sum;
          const addrMempool =
            mempool_stats.funded_txo_sum - mempool_stats.spent_txo_sum;
          // Match BalanceSyncer: confirmed in balanceSats, mempool delta in pendingSats.
          // Do not add max(0, mempool) to balanceSats — that double-counts self-sends
          // (source still confirmed + destination pending incoming).
          const balanceSats = Math.max(0, addrConfirmed);
          const now = Date.now();

          if (Number.isFinite(addrConfirmed) && addrConfirmed > 0) {
            confirmedSats = confirmedSats.add(addrConfirmed);
          }
          if (Number.isFinite(addrMempool) && addrMempool !== 0) {
            mempoolSats = mempoolSats.add(addrMempool);
          }

          perAddressBalances.push({
            address: addr,
            balanceSats,
            pendingSats: addrMempool,
            hasNonzero: addrConfirmed > 0 || addrMempool > 0,
            fetchedAt: now,
          });
        } catch (err) {
          dbg(
            '[BALANCE] getWalletBalanceAggregate: network error for',
            addr.slice(0, 10),
            err,
          );
          const cached = await this.getCachedAggregateBalance(
            network,
            addressType,
          );
          if (cached) return cached;
          return {
            btc: '0.00000000',
            usd: '$0.00',
            hasNonZeroBalance: false,
            timestamp: Date.now(),
            pendingSats: 0,
          };
        }
      }

      // All addresses succeeded — write per-address + aggregate in one go
      const bals = perAddressBalances.map(b => ({
        address: b.address,
        network,
        balanceSats: b.balanceSats,
        pendingSats: b.pendingSats,
        hasNonzero: b.hasNonzero,
        fetchedAt: b.fetchedAt,
      }));
      balanceRepository.setBalances(bals);
      // Stamp sync_metadata so BalanceSyncer knows these addresses are fresh.
      for (const b of bals) {
        syncRepository.updateCursor(
          'balance',
          `${b.address}_${network}`,
          null,
          'ok',
        );
      }
      syncRepository.updateCursor(
        'balance',
        `aggregate_${network}_${addressType}`,
        null,
        'ok',
      );

      dbg(
        '[BALANCE] getWalletBalanceAggregate: API result (atomic write) —',
        'addresses:',
        addresses.length,
        'confirmed:',
        confirmedSats.toFixed(0),
        'sats',
        'mempool:',
        mempoolSats.toFixed(0),
        'sats',
        'network:',
        network,
        'addressType:',
        addressType,
      );

      const totalSats = confirmedSats.add(mempoolSats);
      const balanceAfterPending = totalSats.sub(pendingSent);
      const finalBalance = balanceAfterPending.gte(0)
        ? balanceAfterPending
        : new Big(0);
      const newBalance = finalBalance.div(1e8).toFixed(8);
      const hasNonZeroBalance = Number(newBalance) > 0;
      let usdAmount = '';
      if (btcRate > 0) {
        usdAmount = this.formatUSD(totalSats.mul(btcRate).div(1e8).toNumber());
      }
      const pendingSatsValue = mempoolSats.toNumber();
      const result: WalletBalance = {
        btc: newBalance,
        usd: usdAmount,
        hasNonZeroBalance,
        timestamp: Date.now(),
        pendingSats: pendingSatsValue,
      };
      const aggAddress = `aggregate_${network}_${addressType}`;
      balanceRepository.setBalance({
        address: aggAddress,
        network,
        balanceSats: Math.round(Number(newBalance) * 1e8),
        pendingSats: pendingSatsValue,
        hasNonzero: hasNonZeroBalance,
        fetchedAt: result.timestamp,
      });
      dbg('WalletService: getWalletBalanceAggregate result:', result);
      return result;
    } catch (error) {
      dbg('WalletService: getWalletBalanceAggregate error:', error);
      const cached = await this.getCachedAggregateBalance(network, addressType);
      dbg('WalletService: getWalletBalanceAggregate cached:', cached);
      return (
        cached ?? {
          btc: '0.00000000',
          usd: '$0.00',
          hasNonZeroBalance: false,
          timestamp: Date.now(),
        }
      );
    }
  }

  /** Returns cached aggregate balance for HD wallet (network + addressType). */
  public async getCachedAggregateBalance(
    network: string,
    addressType: string,
  ): Promise<WalletBalance | null> {
    const aggAddress = `aggregate_${network}_${addressType}`;
    const stored = balanceRepository.getBalance(aggAddress, network);
    if (!stored) return null;
    return {
      btc: (stored.balanceSats / 1e8).toFixed(8),
      usd: '$0.00',
      hasNonZeroBalance: stored.hasNonzero,
      timestamp: stored.fetchedAt,
      pendingSats: stored.pendingSats,
    };
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
    for (const [key, ctrl] of this.abortControllers) {
      if (key.startsWith('txs-')) {
        ctrl.abort();
        this.abortControllers.delete(key);
      }
    }
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
  /**
   * mempool.space returns at most 25 txs per /txs call.
   * When exactly PAGE_SIZE are returned there may be more; store the last txid
   * as a cursor so callers can page with /txs/chain/{cursor}.
   */
  private static readonly TX_PAGE_SIZE = 25;

  /** Pending txs (no block_height) sort to the top; confirmed sort by block_height desc. */
  private static txSortKey(tx: any): number {
    if (!tx.status?.block_height) {
      return Number.MAX_SAFE_INTEGER; // pending → top
    }
    return tx.status.block_height;
  }

  /**
   * Initial fetch — calls /txs for every address sequentially.
   * Returns merged + deduped transactions sorted newest-first, plus a per-address
   * cursor map (null = address exhausted, string = last txid for next page).
   */
  public async fetchTransactionsForAddresses(
    apiBase: string,
    addresses: string[],
  ): Promise<{txs: any[]; cursors: Record<string, string | null>}> {
    if (addresses.length === 0) return {txs: [], cursors: {}};
    const cleanBase = apiBase.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const seen = new Set<string>();
    const merged: any[] = [];
    const cursors: Record<string, string | null> = {};
    // Fetch sequentially to avoid rate-limiting mempool.space.
    for (const addr of addresses) {
      try {
        const url = `${cleanBase}/api/address/${encodeURIComponent(addr)}/txs`;
        const res = await with429Retry<any[]>(
          'WalletService.fetchTransactionsForAddresses',
          () => mempoolClient.get<any[]>(url, {timeoutMs: 8000}),
        );
        if (!res.ok) {
          cursors[addr] = null;
          continue;
        }
        const data = res.data as any[];
        if (!Array.isArray(data)) {
          cursors[addr] = null;
          continue;
        }
        // Persist to DB immediately with the real Bitcoin address as the key.
        // This ensures loadFromCache() can serve offline reads keyed by address,
        // and aligns with TransactionSyncer's namespace.
        if (data.length > 0) {
          await this.setTxs(addr, data);
        }
        for (const tx of data) {
          if (!seen.has(tx.txid)) {
            seen.add(tx.txid);
            merged.push(tx);
          }
        }
        // Exactly PAGE_SIZE returned → there may be a next page
        cursors[addr] =
          data.length >= WalletService.TX_PAGE_SIZE
            ? data[data.length - 1].txid
            : null;
      } catch (e) {
        dbg(
          'WalletService: fetchTransactionsForAddresses failed for',
          addr.slice(0, 12),
          e,
        );
        cursors[addr] = null;
      }
    }
    merged.sort(
      (a, b) => WalletService.txSortKey(b) - WalletService.txSortKey(a),
    );
    dbg(
      'WalletService: fetchTransactionsForAddresses merged',
      merged.length,
      'txs from',
      addresses.length,
      'addresses',
    );
    return {txs: merged, cursors};
  }

  /**
   * Returns per-address transaction chain cursors from the sync repository
   * (e.g. after transactionSyncer.syncAddressesAtomic).
   */
  public getTransactionCursorsForAddresses(
    network: string,
    addresses: string[],
  ): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const addr of addresses) {
      const c = syncRepository.getCursor('transactions', `${addr}_${network}`);
      out[addr] = c ?? null;
    }
    return out;
  }

  /**
   * Paginated fetch — calls /txs/chain/{cursor} for every address whose cursor
   * is non-null. Returns only the NEW transactions for this page plus updated
   * cursors (null out exhausted addresses).
   */
  public async fetchMoreTransactionsForAddresses(
    apiBase: string,
    cursors: Record<string, string | null>,
  ): Promise<{txs: any[]; cursors: Record<string, string | null>}> {
    const cleanBase = apiBase.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const seen = new Set<string>();
    const merged: any[] = [];
    const updatedCursors: Record<string, string | null> = {...cursors};
    for (const [addr, cursor] of Object.entries(cursors)) {
      if (!cursor) continue; // already exhausted
      try {
        const url = `${cleanBase}/api/address/${encodeURIComponent(
          addr,
        )}/txs/chain/${cursor}`;
        const res = await this.withTimeout(
          `txs-more-${addr.slice(0, 12)}`,
          mempoolClient.get(url),
          8000,
        );
        if (!res.ok) {
          updatedCursors[addr] = null;
          continue;
        }
        const data = res.data as any[];
        if (!Array.isArray(data) || data.length === 0) {
          updatedCursors[addr] = null;
          continue;
        }
        // Persist each page to DB with the real Bitcoin address key.
        await this.setTxs(addr, data);
        for (const tx of data) {
          if (!seen.has(tx.txid)) {
            seen.add(tx.txid);
            merged.push(tx);
          }
        }
        updatedCursors[addr] =
          data.length >= WalletService.TX_PAGE_SIZE
            ? data[data.length - 1].txid
            : null;
      } catch (e) {
        dbg(
          'WalletService: fetchMoreTransactionsForAddresses failed for',
          addr.slice(0, 12),
          e,
        );
        updatedCursors[addr] = null;
      }
    }
    merged.sort(
      (a, b) => WalletService.txSortKey(b) - WalletService.txSortKey(a),
    );
    dbg(
      'WalletService: fetchMoreTransactionsForAddresses page yielded',
      merged.length,
      'new txs',
    );
    return {txs: merged, cursors: updatedCursors};
  }

  /**
   * Enriches a UTXO list with the scriptpubkey (hex locking script) for each output.
   * Fetches /tx/{txid} for each unique txid and reads vout[n].scriptpubkey.
   * Called before passing UTXOs to the native bridge so Go's signing loop needs
   * no network calls (FetchUTXODetails is skipped when scriptpubkey is present).
   *
   * UTXOs for which the fetch fails get an empty scriptpubkey string; Go will
   * fall back to FetchUTXODetails for those inputs (safe, backward-compatible).
   */
  public async enrichUtxosWithScriptpubkey(
    utxos: UtxoWithPath[],
    apiUrl: string,
  ): Promise<(UtxoWithPath & {scriptpubkey: string})[]> {
    const base = apiUrl.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    // mempoolClient deduplicates concurrent fetches for the same txid and caches
    // the result for 5 min (immutable confirmed tx content), so no local txCache needed.
    const results: (UtxoWithPath & {scriptpubkey: string})[] = [];
    for (const u of utxos) {
      let scriptpubkey = '';
      try {
        const res = await mempoolClient.get<any>(`${base}/api/tx/${u.txid}`);
        const txData = res.ok ? res.data : undefined;
        scriptpubkey = txData?.vout?.[u.vout]?.scriptpubkey ?? '';
      } catch (e) {
        dbg('WalletService: enrichUtxosWithScriptpubkey failed for', u.txid, e);
      }
      results.push({...u, scriptpubkey});
    }
    return results;
  }

  /** Cache key for wallet-level (multi-address) transactions. */
  private walletTxsCacheKey(network: string, addressType: string) {
    return `wallet_txs_${network}_${addressType}`;
  }

  public async transactionsFromCacheForWallet(
    network: string,
    addressType: string,
  ): Promise<any[]> {
    // Primary path: query by real HD addresses — this is the authoritative source
    // because TransactionSyncer writes here on every sync cycle.
    try {
      const addrs = await this.getHdAddressesWithPaths(network, addressType);
      if (addrs.length > 0) {
        const rows = transactionRepository.getTransactionsForAddresses(
          addrs.map(a => a.address),
          network,
        );
        if (rows.length > 0) {
          return rows
            .map(r => {
              try {
                const parsed = JSON.parse(r.rawJson);
                if (r.isConfirmed && parsed.status) {
                  parsed.status.confirmed = true;
                  if (r.blockHeight) parsed.status.block_height = r.blockHeight;
                  if (r.blockTime) parsed.status.block_time = r.blockTime;
                }
                return parsed;
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        }
      }
    } catch {
      // Fall through to synthetic cache below.
    }
    // Fallback: synthetic wallet-level key written by updateTransactionsCacheForWallet.
    // Used when keyshare is unavailable (e.g. during early launch before Keychain unlocks).
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
