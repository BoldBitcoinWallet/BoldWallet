/**
 * PriceSyncer — fetches live BTC/fiat rates from mempool.space.
 *
 * Sync schedule: every 60 s.
 * Endpoint: GET /v1/prices
 */
import mempoolClient from '../MempoolClient';
import priceRepository from '../repositories/PriceRepository';
import {dbg} from '../../utils';

/** Skip API call if the DB price was fetched within this window. */
const PRICE_DB_TTL_MS = 45_000; // 45 s

class PriceSyncer {
  async syncCurrentPrice(apiBase: string): Promise<void> {
    // Check DB freshness before hitting the API.
    const cached = priceRepository.getCachedPrice('USD');
    if (cached && cached.timestamp > 0 && Date.now() - cached.timestamp < PRICE_DB_TTL_MS) {
      dbg('PriceSyncer: price fresh in DB — skipped');
      return;
    }

    // Always use mainnet /api/v1/prices. Never strip `/testnet/` with a naive
    // replace on the full URL — e.g. .../testnet/api becomes ...api and the host
    // becomes "mempool.spaceapi" (invalid DNS).
    const base = apiBase
      .replace(/\/+$/, '')
      .replace(/\/testnet(?=\/api\/?$)/, '');
    const url = `${base}/v1/prices`;
    try {
      const res = await mempoolClient.get<Record<string, number>>(url);
      if (!res.ok || !res.data) return;

      const rates: Record<string, number> = {};
      for (const [currency, value] of Object.entries(res.data)) {
        if (typeof value === 'number' && isFinite(value) && value > 0) {
          rates[currency] = value;
        }
      }

      if (Object.keys(rates).length) {
        priceRepository.setCurrentRates(rates);
        dbg('PriceSyncer: rates updated', Object.keys(rates));
      }
    } catch (err) {
      dbg('PriceSyncer: error fetching prices', err);
    }
  }
}

const priceSyncer = new PriceSyncer();
export default priceSyncer;
