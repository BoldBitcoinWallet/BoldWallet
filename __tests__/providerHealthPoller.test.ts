/**
 * @format
 */

jest.mock('../services/MempoolClient', () => ({
  __esModule: true,
  default: {get: jest.fn()},
}));

jest.mock('../utils', () => ({dbg: jest.fn()}));

const mockOnlineState = {value: true};
const mockSubscribers = new Set<(online: boolean) => void>();

jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: () => mockOnlineState.value,
  isWalletOfflineError: () => false,
  subscribeWalletOnline: (fn: (online: boolean) => void) => {
    mockSubscribers.add(fn);
    fn(mockOnlineState.value);
    return () => {
      mockSubscribers.delete(fn);
    };
  },
}));

import {
  PROVIDER_HEALTH_POLL_MS,
  probeMempoolApiBasesOnce,
  resetProviderHealthPollerForTests,
  startProviderHealthPoller,
  stopProviderHealthPoller,
} from '../services/providerHealthPoller';
import {
  resetMempoolHealthForTests,
  getMempoolHealth,
  getHostQuality,
} from '../services/mempoolHealth';

describe('providerHealthPoller', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    mockOnlineState.value = true;
    mockSubscribers.clear();
    resetProviderHealthPollerForTests();
    resetMempoolHealthForTests();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    resetProviderHealthPollerForTests();
    resetMempoolHealthForTests();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('probes tip/hash immediately when started online', async () => {
    startProviderHealthPoller('https://mempool.space/api');
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/blocks\/tip\/hash$/),
      expect.any(Object),
    );
    expect(getMempoolHealth()?.quality).toBe('fine');
  });

  it('does not fetch while offline', async () => {
    mockOnlineState.value = false;
    startProviderHealthPoller('https://mempool.space/api');
    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(PROVIDER_HEALTH_POLL_MS);
    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('probes when coming back online', async () => {
    mockOnlineState.value = false;
    startProviderHealthPoller('https://mempool.space/api');
    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
    mockOnlineState.value = true;
    mockSubscribers.forEach(fn => fn(true));
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalled();
    stopProviderHealthPoller();
  });

  it('probes each unique API root once and records per host', async () => {
    await probeMempoolApiBasesOnce([
      'https://mempool.space/api',
      'https://mempool.emzy.de/api',
      'https://mempool.space/api/',
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://mempool.space/api/blocks/tip/hash',
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://mempool.emzy.de/api/blocks/tip/hash',
      expect.any(Object),
    );
    expect(getHostQuality('https://mempool.space')).toBe('fine');
    expect(getHostQuality('https://mempool.emzy.de')).toBe('fine');
  });

  it('does not probe listed endpoints while offline', async () => {
    mockOnlineState.value = false;
    await probeMempoolApiBasesOnce(['https://mempool.space/api']);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
