/**
 * HistoricalPriceService — persistent cache + fetch for BTC price at a given timestamp.
 * Used by transaction list and details to show fiat at the time of the tx (not current rate).
 *
 * - Cache key: currency + timestamp rounded to UTC day (one rate per day per currency).
 * - In-memory map for fast lookups; PriceRepository (SQLite) for persistence.
 * - Fetches via MempoolClient (GET /api/v1/historical-price?currency=...&timestamp=...).
 */

import mempoolClient from './MempoolClient';
import priceRepository, {toDayTimestamp} from './repositories/PriceRepository';
import {dbg} from '../utils';

/** In-memory cache: "<currency>_<dayTimestamp>" -> rate */
const memoryCache = new Map<string, number>();

function memKey(currency: string, timestampUnixSec: number): string {
  return `${currency}_${toDayTimestamp(timestampUnixSec)}`;
}

export interface HistoricalPriceResponse {
  prices?: Array<{time?: number; [currency: string]: number | undefined}>;
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
   * Uses in-memory cache → SQLite → API.
   */
  async getHistoricalRate(
    currency: string,
    timestampUnixSec: number,
    baseApi: string,
  ): Promise<number | null> {
    const key = memKey(currency, timestampUnixSec);

    // 1. In-memory cache
    const mem = memoryCache.get(key);
    if (mem != null && mem > 0) {
      return mem;
    }

    // 2. SQLite persistence
    const persisted = priceRepository.getHistoricalRate(currency, timestampUnixSec);
    if (persisted != null && persisted > 0) {
      memoryCache.set(key, persisted);
      return persisted;
    }

    // 3. Fetch from API
    const base = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
    const url = `${base}/api/v1/historical-price?currency=${encodeURIComponent(
      currency,
    )}&timestamp=${Math.floor(timestampUnixSec)}`;
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
      priceRepository.setHistoricalRate(currency, timestampUnixSec, rate);
      return rate;
    } catch (e) {
      dbg('HistoricalPriceService: fetch failed', url.slice(-60), e);
      return null;
    }
  }

  /**
   * Sync get from in-memory cache only. Returns null if not cached.
   */
  getCachedRateSync(currency: string, timestampUnixSec: number): number | null {
    const key = memKey(currency, timestampUnixSec);
    // Try memory first, then SQLite synchronously
    const mem = memoryCache.get(key);
    if (mem != null) return mem;
    const db = priceRepository.getHistoricalRate(currency, timestampUnixSec);
    if (db != null) {
      memoryCache.set(key, db);
    }
    return db;
  }

  /** Pre-warm in-memory cache from SQLite for the given currency × timestamps. */
  hydrateKeys(currency: string, timestampsUnixSec: number[]): void {
    for (const ts of timestampsUnixSec) {
      const key = memKey(currency, ts);
      if (memoryCache.has(key)) continue;
      const rate = priceRepository.getHistoricalRate(currency, ts);
      if (rate != null && rate > 0) {
        memoryCache.set(key, rate);
      }
    }
  }
}

export function getHistoricalRateKey(
  currency: string,
  timestampUnixSec: number,
): string {
  return memKey(currency, timestampUnixSec);
}

export default HistoricalPriceService.getInstance();
