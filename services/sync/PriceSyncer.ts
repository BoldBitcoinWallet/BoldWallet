/**
 * PriceSyncer — fetches live BTC/fiat rates from mempool.space.
 *
 * Sync schedule: every 60 s.
 * Endpoint: GET /v1/prices
 */
import mempoolClient from '../MempoolClient';
import priceRepository from '../repositories/PriceRepository';
import {dbg} from '../../utils';

class PriceSyncer {
  async syncCurrentPrice(apiBase: string): Promise<void> {
    // Always use mainnet price endpoint
    const base = apiBase.replace(/\/+$/, '').replace(/\/testnet\/?/, '');
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
