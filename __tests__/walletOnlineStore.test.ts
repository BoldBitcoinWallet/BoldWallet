/**
 * @format
 */

const mockStore: Record<string, string> = {};
const mockAbortAll = jest.fn();
const mockPostTx = jest.fn(async () => 'txid');
const mockFetchData = jest.fn(async () => 'ok');
const mockSha256 = jest.fn(async () => 'hash');

jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn((key: string) =>
      Object.prototype.hasOwnProperty.call(mockStore, key)
        ? mockStore[key]
        : null,
    ),
    getBool: jest.fn((key: string, defaultValue = false) => {
      if (!Object.prototype.hasOwnProperty.call(mockStore, key)) {
        return defaultValue;
      }
      return mockStore[key] === 'true';
    }),
    setBool: jest.fn((key: string, value: boolean) => {
      mockStore[key] = value ? 'true' : 'false';
    }),
  },
  CONFIG_KEYS: {WALLET_ONLINE: 'wallet_online'},
}));

jest.mock('../services/MempoolClient', () => ({
  mempoolClient: {abortAll: mockAbortAll},
}));

jest.mock('../utils', () => ({dbg: jest.fn()}));

jest.mock('react-native', () => ({
  NativeModules: {
    BBMTLibNativeModule: {
      postTx: mockPostTx,
      fetchData: mockFetchData,
      sha256: mockSha256,
    },
  },
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {show: jest.fn()},
}));

import {
  WalletOfflineError,
  guardOnlineAction,
  installWalletOnlineNetworkGuard,
  isWalletOfflineError,
  isWalletOnline,
  resetWalletOnlineForTests,
  setWalletOnline,
  subscribeWalletOnline,
} from '../services/walletOnlineStore';

describe('walletOnlineStore', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.keys(mockStore).forEach(k => {
      delete mockStore[k];
    });
    resetWalletOnlineForTests();
    mockAbortAll.mockClear();
    mockPostTx.mockClear();
    mockFetchData.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('defaults to online when the key is absent', () => {
    expect(isWalletOnline()).toBe(true);
  });

  it('persists and notifies subscribers', () => {
    const seen: boolean[] = [];
    const unsub = subscribeWalletOnline(v => seen.push(v));
    expect(seen).toEqual([true]);
    setWalletOnline(false);
    expect(isWalletOnline()).toBe(false);
    expect(mockStore.wallet_online).toBe('false');
    expect(seen).toEqual([true, false]);
    expect(mockAbortAll).toHaveBeenCalled();
    setWalletOnline(true);
    expect(seen).toEqual([true, false, true]);
    unsub();
  });

  it('does not abort when staying online', () => {
    setWalletOnline(true);
    mockAbortAll.mockClear();
    setWalletOnline(true);
    expect(mockAbortAll).not.toHaveBeenCalled();
  });

  it('guardOnlineAction is false when offline', () => {
    setWalletOnline(false);
    expect(guardOnlineAction()).toBe(false);
    setWalletOnline(true);
    expect(guardOnlineAction()).toBe(true);
  });

  it('identifies WalletOfflineError', () => {
    const err = new WalletOfflineError();
    expect(isWalletOfflineError(err)).toBe(true);
    expect(isWalletOfflineError(new Error('nope'))).toBe(false);
  });

  it('native postTx and fetchData reject when offline', async () => {
    const nativeMod = {
      postTx: mockPostTx,
      fetchData: mockFetchData,
      sha256: mockSha256,
    };
    installWalletOnlineNetworkGuard(nativeMod);
    setWalletOnline(false);
    await expect(nativeMod.postTx('aa')).rejects.toMatchObject({
      name: 'WalletOfflineError',
      code: 'WALLET_OFFLINE',
    });
    await expect(
      nativeMod.fetchData('http://x', '', ''),
    ).rejects.toMatchObject({name: 'WalletOfflineError'});
    expect(mockPostTx).not.toHaveBeenCalled();
    expect(mockFetchData).not.toHaveBeenCalled();
    expect(nativeMod.sha256).toBe(mockSha256);
  });
});
