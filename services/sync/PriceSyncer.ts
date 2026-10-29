/**
 * PriceSyncer — fetches live BTC/fiat rates from mempool.space.
 *
 * Freshness window: 2 minutes. The coordinator fetches once at start, then
 * on that same interval while the app is in the foreground.
 * Endpoint: GET /v1/prices
 */
import mempoolClient from '../MempoolClient';
import {fiatRatesFromPrices, mainnetPricesUrl, PRICE_FRESH_MS} from '../mempoolApiBase';
import {
  providerUrlMatchesNetwork,
  publicMainnetPriceUrls,
} from '../mempoolProvidersStore';
import priceRepository from '../repositories/PriceRepository';
import {dbg} from '../../utils';

class PriceSyncer {
  async syncCurrentPrice(apiBase: string): Promise<void> {
    // Check DB freshness before hitting the API.
    const cached = priceRepository.getCachedPrice('USD');
    if (cached && cached.timestamp > 0 && Date.now() - cached.timestamp < PRICE_FRESH_MS) {
      dbg('PriceSyncer: price fresh in DB — skipped');
      return;
    }

    if (providerUrlMatchesNetwork(apiBase, 'testnet4')) {
      // Quotes come from the public mainnet list, never the testnet host.
      const urls = await publicMainnetPriceUrls();
      for (const url of urls) {
        try {
          const res = await mempoolClient.get<Record<string, unknown>>(url);
          if (!res.ok || !res.data) {
            continue;
          }
          const rates = fiatRatesFromPrices(res.data);
          if (Object.keys(rates).length) {
            priceRepository.setCurrentRates(rates);
            dbg('PriceSyncer: rates updated', Object.keys(rates));
            return;
          }
        } catch (err) {
          dbg('PriceSyncer: error fetching prices', err);
        }
      }
      return;
    }

    const url = mainnetPricesUrl(apiBase);
    try {
      const res = await mempoolClient.get<Record<string, unknown>>(url);
      if (!res.ok || !res.data) return;

      const rates = fiatRatesFromPrices(res.data);

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
