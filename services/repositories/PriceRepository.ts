/**
 * PriceRepository — current BTC price and historical per-day rates.
 *
 * Replaces LocalCache keys:
 *   price                                (current snapshot)
 *   historical_price_<currency>_<day>    (per-day historical rates)
 *
 * Convention: day_timestamp = 0 means "live / current price".
 *             day_timestamp > 0 means UTC day start (Unix seconds).
 */
import database from '../Database';
import {dbg} from '../../utils';

export interface PriceRate {
  currency: string;
  dayTimestamp: number; // 0 = current
  rate: number;
  fetchedAt: number;
}

/** Shape stored under the old LocalCache 'price' key. */
export interface CachedPrice {
  price: string;
  rate: number;
  rates: Record<string, number>;
  timestamp: number;
}

const LIVE_DAY_TS = 0;
const SEC_PER_DAY = 86400;

/** Round a Unix-seconds timestamp down to the UTC day boundary. */
export function toDayTimestamp(unixSec: number): number {
  return Math.floor(unixSec / SEC_PER_DAY) * SEC_PER_DAY;
}

class PriceRepository {
  // ── Current / live price ─────────────────────────────────────────────────

  getCurrentRate(currency: string): number | null {
    try {
      const {rows} = database.execute(
        'SELECT rate FROM price_rates WHERE currency = ? AND day_timestamp = ?',
        [currency, LIVE_DAY_TS],
      );
      return rows.length ? (rows[0].rate as number) : null;
    } catch (err) {
      dbg('PriceRepository.getCurrentRate error', err);
      return null;
    }
  }

  setCurrentRate(currency: string, rate: number): void {
    try {
      database.execute(
        `INSERT INTO price_rates (currency, day_timestamp, rate, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(currency, day_timestamp) DO UPDATE SET
           rate       = excluded.rate,
           fetched_at = excluded.fetched_at`,
        [currency, LIVE_DAY_TS, rate, Date.now()],
      );
    } catch (err) {
      dbg('PriceRepository.setCurrentRate error', err);
    }
  }

  /** Write all currency rates from a single API response in one transaction. */
  setCurrentRates(rates: Record<string, number>): void {
    try {
      const now = Date.now();
      database.transaction(tx => {
        for (const [currency, rate] of Object.entries(rates)) {
          tx.execute(
            `INSERT INTO price_rates (currency, day_timestamp, rate, fetched_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(currency, day_timestamp) DO UPDATE SET
               rate       = excluded.rate,
               fetched_at = excluded.fetched_at`,
            [currency, LIVE_DAY_TS, rate, now],
          );
        }
      });
    } catch (err) {
      dbg('PriceRepository.setCurrentRates error', err);
    }
  }

  /**
   * Returns a legacy CachedPrice object compatible with WalletService consumers.
   * If no rate exists for the primary currency, returns null.
   */
  getCachedPrice(primaryCurrency: string): CachedPrice | null {
    try {
      const {rows} = database.execute(
        'SELECT currency, rate, fetched_at FROM price_rates WHERE day_timestamp = ?',
        [LIVE_DAY_TS],
      );
      if (!rows.length) return null;

      const rateMap: Record<string, number> = {};
      let primaryRate = 0;
      let fetchedAt = 0;

      for (const r of rows) {
        rateMap[r.currency as string] = r.rate as number;
        if (r.currency === primaryCurrency) {
          primaryRate = r.rate as number;
          fetchedAt = r.fetched_at as number;
        }
      }

      if (!primaryRate) return null;

      return {
        price: primaryRate.toFixed(2),
        rate: primaryRate,
        rates: rateMap,
        timestamp: fetchedAt,
      };
    } catch (err) {
      dbg('PriceRepository.getCachedPrice error', err);
      return null;
    }
  }

  // ── Historical rates ─────────────────────────────────────────────────────

  getHistoricalRate(currency: string, unixSec: number): number | null {
    try {
      const day = toDayTimestamp(unixSec);
      const {rows} = database.execute(
        'SELECT rate FROM price_rates WHERE currency = ? AND day_timestamp = ?',
        [currency, day],
      );
      return rows.length ? (rows[0].rate as number) : null;
    } catch (err) {
      dbg('PriceRepository.getHistoricalRate error', err);
      return null;
    }
  }

  setHistoricalRate(currency: string, unixSec: number, rate: number): void {
    try {
      const day = toDayTimestamp(unixSec);
      database.execute(
        `INSERT INTO price_rates (currency, day_timestamp, rate, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(currency, day_timestamp) DO UPDATE SET
           rate       = excluded.rate,
           fetched_at = excluded.fetched_at`,
        [currency, day, rate, Date.now()],
      );
    } catch (err) {
      dbg('PriceRepository.setHistoricalRate error', err);
    }
  }
}

const priceRepository = new PriceRepository();
export default priceRepository;
