/**
 * HistoricalPriceService — persistent cache + fetch for BTC price at a given timestamp.
 * Used by transaction list and details to show fiat at the time of the tx (not current rate).
 *
 * - Cache key: currency + timestamp rounded to UTC day (one rate per day per currency).
 * - In-memory map for fast lookups; LocalCache for persistence across app restarts.
 * - Fetches via MempoolClient (GET /api/v1/historical-price?currency=...&timestamp=...).
 */

import mempoolClient from './MempoolClient';
import LocalCache from './LocalCache';
import {dbg} from '../utils';

const CACHE_KEY_PREFIX = 'historical_price_';
/** Round timestamp to UTC day (Unix seconds) to reduce cache keys. */
const SEC_PER_DAY = 86400;

function cacheKey(currency: string, timestampUnixSec: number): string {
  const day = Math.floor(timestampUnixSec / SEC_PER_DAY) * SEC_PER_DAY;
  return `${CACHE_KEY_PREFIX}${currency}_${day}`;
}

/** In-memory cache: key -> rate (price per 1 BTC). */
const memoryCache = new Map<string, number>();

export interface HistoricalPriceResponse {
  prices?: Array<{ time?: number; [currency: string]: number | undefined }>;
}

class HistoricalPriceService {
  private static _instance: HistoricalPriceService;

  static getInstance(): HistoricalPriceService {
    if (!HistoricalPriceService._instance) {
      HistoricalPriceService._instance = new HistoricalPriceService();
    }
    return HistoricalPriceService._instance;
  }

  /**
   * Returns the BTC rate (fiat per 1 BTC) at the given timestamp, or null if unavailable.
   * Uses in-memory cache then LocalCache, then fetches via API and persists.
   * Timestamp is rounded to UTC day for cache key (one rate per day).
   */
  async getHistoricalRate(
    currency: string,
    timestampUnixSec: number,
    baseApi: string,
  ): Promise<number | null> {
    const key = cacheKey(currency, timestampUnixSec);
    const mem = memoryCache.get(key);
    if (mem != null && mem > 0) {
      return mem;
    }
    const persisted = await LocalCache.getItem(key);
    if (persisted != null) {
      const rate = parseFloat(persisted);
      if (Number.isFinite(rate) && rate > 0) {
        memoryCache.set(key, rate);
        return rate;
      }
    }
    const base = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const url = `${base}/api/v1/historical-price?currency=${encodeURIComponent(currency)}&timestamp=${Math.floor(timestampUnixSec)}`;
    try {
      const res = await mempoolClient.get<HistoricalPriceResponse>(url);
      if (!res.ok || !res.data?.prices?.length) {
        return null;
      }
      const first = res.data.prices[0];
      const rate = first[currency] ?? first.USD ?? first.EUR;
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        return null;
      }
      memoryCache.set(key, rate);
      await LocalCache.setItem(key, String(rate));
      return rate;
    } catch (e) {
      dbg('HistoricalPriceService: fetch failed', url.slice(-60), e);
      return null;
    }
  }

  /**
   * Sync get for in-memory/local cache only. Returns null if not cached (no network).
   * Use when rendering to avoid flashing; background fetch can fill in later.
   */
  getCachedRateSync(currency: string, timestampUnixSec: number): number | null {
    const key = cacheKey(currency, timestampUnixSec);
    return memoryCache.get(key) ?? null;
  }

  /** Preload rates from LocalCache into memory for the given keys (e.g. on app start). */
  async hydrateKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      if (memoryCache.has(key)) continue;
      const val = await LocalCache.getItem(key);
      if (val != null) {
        const rate = parseFloat(val);
        if (Number.isFinite(rate) && rate > 0) memoryCache.set(key, rate);
      }
    }
  }
}

export function getHistoricalRateKey(
  currency: string,
  timestampUnixSec: number,
): string {
  return cacheKey(currency, timestampUnixSec);
}

export default HistoricalPriceService.getInstance();
