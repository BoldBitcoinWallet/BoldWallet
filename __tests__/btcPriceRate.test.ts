/**
 * @format
 *
 * BTC/fiat rates always come from mainnet GET /api/v1/prices.
 * A testnet4 prices body returns USD:-1, so the URL must leave /testnet4
 * behind and the parser must drop non-positive and non-currency fields.
 */

jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {get: () => null},
  CONFIG_KEYS: {},
}));

jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: () => true,
}));

jest.mock('../utils', () => ({
  dbg: () => {},
  getMainnetAPIList: jest.fn(async () => []),
}));

jest.mock('../services/MempoolClient', () => ({
  __esModule: true,
  default: {get: jest.fn()},
}));

jest.mock('../services/repositories/PriceRepository', () => ({
  __esModule: true,
  default: {
    getCachedPrice: jest.fn(),
    setCurrentRates: jest.fn(),
  },
}));

import {getMainnetAPIList} from '../utils';
import {
  fiatRatesFromPrices,
  mainnetPricesUrl,
} from '../services/mempoolApiBase';
import mempoolClient from '../services/MempoolClient';
import priceRepository from '../services/repositories/PriceRepository';
import priceSyncer from '../services/sync/PriceSyncer';

const mainnetList = getMainnetAPIList as jest.Mock;
const get = mempoolClient.get as jest.Mock;
const getCachedPrice = priceRepository.getCachedPrice as jest.Mock;
const setCurrentRates = priceRepository.setCurrentRates as jest.Mock;

const liveBody = {
  time: 1793008804,
  USD: 80448,
  EUR: 71784,
  GBP: 60338,
  JPY: -1,
};

beforeEach(() => {
  get.mockReset();
  getCachedPrice.mockReset();
  setCurrentRates.mockReset();
  mainnetList.mockReset();
  mainnetList.mockResolvedValue([]);
});

describe('mainnet price URL', () => {
  it('rewrites a testnet4 API base onto the mainnet prices route', () => {
    expect(mainnetPricesUrl('https://mempool.space/testnet4/api')).toBe(
      'https://mempool.space/api/v1/prices',
    );
    expect(mainnetPricesUrl('https://mempool.space/testnet4/api/')).toBe(
      'https://mempool.space/api/v1/prices',
    );
  });

  it('keeps a mainnet API base on the same host', () => {
    expect(mainnetPricesUrl('https://mempool.space/api')).toBe(
      'https://mempool.space/api/v1/prices',
    );
    expect(mainnetPricesUrl('https://mempool.emzy.de/api')).toBe(
      'https://mempool.emzy.de/api/v1/prices',
    );
  });

  it('does not glue the host to the word api', () => {
    const url = mainnetPricesUrl('https://mempool.space/testnet4/api');
    expect(url).not.toContain('spaceapi');
    expect(url.startsWith('https://')).toBe(true);
  });
});

describe('fiat rate parsing', () => {
  it('keeps positive 3-letter codes and drops time and rejected quotes', () => {
    expect(fiatRatesFromPrices(liveBody)).toEqual({
      USD: 80448,
      EUR: 71784,
      GBP: 60338,
    });
  });

  it('drops a testnet prices body that answers USD -1', () => {
    expect(fiatRatesFromPrices({time: 1, USD: -1, EUR: -1})).toEqual({});
  });

  it('drops zeros, non-finite numbers, strings, and lowercase keys', () => {
    expect(
      fiatRatesFromPrices({
        USD: 0,
        EUR: Number.POSITIVE_INFINITY,
        GBP: Number.NaN,
        JPY: '12632581',
        usd: 80448,
        US: 1,
        USDT: 1,
      }),
    ).toEqual({});
  });

  it('returns an empty map for a missing body', () => {
    expect(fiatRatesFromPrices(null)).toEqual({});
    expect(fiatRatesFromPrices(undefined)).toEqual({});
  });

  it('keeps the unit rate numeric so a formatted price is not parsed back', () => {
    const rates = fiatRatesFromPrices(liveBody);
    expect(rates.USD).toBe(80448);
    // "80,448" is what the header shows. Number() of that string is NaN,
    // so the balance line must multiply the numeric rate, then format once.
    expect(Number('80,448')).toBeNaN();
  });

  it('prices a 0.004 BTC balance from the unit rate, not from the visible tail', () => {
    const rate = fiatRatesFromPrices(liveBody).USD;
    const holdings = (400_000 / 1e8) * rate;
    expect(holdings).toBeCloseTo(321.792, 3);
  });
});

describe('PriceSyncer', () => {
  it('skips the network while the cached USD rate is inside 2 minutes', async () => {
    getCachedPrice.mockReturnValue({
      price: '$80,448.00',
      rate: 80448,
      rates: {USD: 80448},
      timestamp: Date.now(),
    });

    await priceSyncer.syncCurrentPrice('https://mempool.space/testnet4/api');

    expect(get).not.toHaveBeenCalled();
    expect(setCurrentRates).not.toHaveBeenCalled();
  });

  it('fetches mainnet prices from a testnet4 base and stores the filtered rates', async () => {
    getCachedPrice.mockReturnValue(null);
    get.mockResolvedValue({ok: true, data: liveBody});

    await priceSyncer.syncCurrentPrice('https://mempool.space/testnet4/api');

    expect(get).toHaveBeenCalledWith('https://mempool.space/api/v1/prices');
    expect(setCurrentRates).toHaveBeenCalledWith({
      USD: 80448,
      EUR: 71784,
      GBP: 60338,
    });
  });

  it('keeps a quote that is still inside the 2 minute window', async () => {
    getCachedPrice.mockReturnValue({
      price: '$1.00',
      rate: 1,
      rates: {USD: 1},
      timestamp: Date.now() - 90_000,
    });

    await priceSyncer.syncCurrentPrice('https://mempool.space/api');

    expect(get).not.toHaveBeenCalled();
  });

  it('fetches again when the cached rate is older than 2 minutes', async () => {
    getCachedPrice.mockReturnValue({
      price: '$1.00',
      rate: 1,
      rates: {USD: 1},
      timestamp: Date.now() - 121_000,
    });
    get.mockResolvedValue({ok: true, data: {USD: 80448}});

    await priceSyncer.syncCurrentPrice('https://mempool.space/api');

    expect(get).toHaveBeenCalledTimes(1);
    expect(setCurrentRates).toHaveBeenCalledWith({USD: 80448});
  });

  it('does not store anything when the price request fails', async () => {
    getCachedPrice.mockReturnValue(null);
    get.mockResolvedValue({ok: false, data: null});

    await priceSyncer.syncCurrentPrice('https://mempool.space/api');

    expect(setCurrentRates).not.toHaveBeenCalled();
  });

  it('does not store a body whose only quotes are rejected', async () => {
    getCachedPrice.mockReturnValue(null);
    get.mockResolvedValue({ok: true, data: {time: 1, USD: -1}});

    await priceSyncer.syncCurrentPrice('https://mempool.space/api');

    expect(setCurrentRates).not.toHaveBeenCalled();
  });

  it('quotes a custom testnet host from the public mainnet list', async () => {
    getCachedPrice.mockReturnValue(null);
    mainnetList.mockResolvedValue([
      'https://mempool.space/api',
      'https://mempool.ninja/api',
    ]);
    get.mockImplementation(async (url: string) => {
      if (url.includes('mempool.space')) {
        return {ok: false, data: null};
      }
      return {ok: true, data: liveBody};
    });

    await priceSyncer.syncCurrentPrice('https://user.example/testnet4/api');

    expect(get).toHaveBeenNthCalledWith(1, 'https://mempool.space/api/v1/prices');
    expect(get).toHaveBeenNthCalledWith(2, 'https://mempool.ninja/api/v1/prices');
    expect(get).not.toHaveBeenCalledWith(
      expect.stringContaining('user.example'),
    );
    expect(setCurrentRates).toHaveBeenCalledWith({
      USD: 80448,
      EUR: 71784,
      GBP: 60338,
    });
  });

  it('does not store when every public mainnet quote is rejected', async () => {
    getCachedPrice.mockReturnValue(null);
    mainnetList.mockResolvedValue(['https://mempool.space/api']);
    get.mockResolvedValue({ok: true, data: {time: 1, USD: -1}});

    await priceSyncer.syncCurrentPrice('https://user.example/testnet4/api');

    expect(get).toHaveBeenCalledWith('https://mempool.space/api/v1/prices');
    expect(setCurrentRates).not.toHaveBeenCalled();
  });
});
