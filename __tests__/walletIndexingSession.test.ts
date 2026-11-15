/**
 * @format
 */

jest.mock('../utils', () => ({dbg: jest.fn()}));

const mockGetHdState = jest.fn();
jest.mock('../services/repositories/WalletRepository', () => ({
  __esModule: true,
  default: {
    getHdState: (...args: unknown[]) => mockGetHdState(...args),
  },
}));

jest.mock('../services/mempoolApiBase', () => ({
  getStoredNetworkKey: jest.fn(() => 'mainnet'),
}));

const mockAppConfigGet = jest.fn((key: string) =>
  key === 'address_type' ? 'segwit-native' : null,
);
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  CONFIG_KEYS: {ADDRESS_TYPE: 'address_type', NETWORK: 'network'},
  default: {get: (key: string) => mockAppConfigGet(key)},
}));

const mockOnlineState = {
  online: true,
  subs: new Set<(v: boolean) => void>(),
};
jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: () => mockOnlineState.online,
  subscribeWalletOnline: (fn: (v: boolean) => void) => {
    mockOnlineState.subs.add(fn);
    fn(mockOnlineState.online);
    return () => mockOnlineState.subs.delete(fn);
  },
}));

const mockPause = jest.fn();
const mockResume = jest.fn();
jest.mock('../services/sync/SyncCoordinator', () => ({
  __esModule: true,
  default: {
    pause: () => mockPause(),
    resume: () => mockResume(),
  },
}));

const mockRefresh = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../services/sync/walletRefreshSession', () => ({
  runWalletRefreshSession: (...args: unknown[]) => mockRefresh(...args),
}));

jest.mock('../services/MempoolClient', () => ({
  __esModule: true,
  default: {abortAll: jest.fn()},
}));

const mockDiscover = jest.fn(
  async (
    _n?: unknown,
    _t?: unknown,
    _a?: unknown,
    _p?: unknown,
    _opts?: {signal?: AbortSignal},
  ) => undefined,
);
jest.mock('../services/WalletService', () => ({
  WalletService: {
    getInstance: () => ({
      discoverHdIndexesForNetwork: (
        ...args: [
          unknown?,
          unknown?,
          unknown?,
          unknown?,
          {signal?: AbortSignal}?,
        ]
      ) => mockDiscover(...args),
    }),
  },
}));

import {
  cancelWalletIndexing,
  getIndexingStatus,
  requestWalletIndexing,
  resetWalletIndexingSessionForTests,
} from '../services/sync/walletIndexingSession';
import {getStoredNetworkKey} from '../services/mempoolApiBase';

function setOnline(next: boolean) {
  mockOnlineState.online = next;
  mockOnlineState.subs.forEach(fn => fn(next));
}

describe('walletIndexingSession', () => {
  beforeEach(() => {
    resetWalletIndexingSessionForTests();
    mockOnlineState.online = true;
    mockOnlineState.subs.clear();
    mockGetHdState.mockReset();
    mockDiscover.mockReset();
    mockRefresh.mockReset();
    mockPause.mockReset();
    mockResume.mockReset();
    mockDiscover.mockImplementation(async () => undefined);
    mockRefresh.mockImplementation(async () => undefined);
    (getStoredNetworkKey as jest.Mock).mockReturnValue('mainnet');
    mockAppConfigGet.mockImplementation((key: string) =>
      key === 'address_type' ? 'segwit-native' : null,
    );
  });

  it('no-ops when restoreDone and not forced', async () => {
    mockGetHdState.mockReturnValue({restoreDone: true});
    const result = await requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    expect(result).toBe('ok');
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it('dedupes concurrent requests for the same network/type', async () => {
    mockGetHdState.mockReturnValue({restoreDone: false});
    let finish!: () => void;
    mockDiscover.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );

    const a = requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    const b = requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    expect(mockDiscover).toHaveBeenCalledTimes(1);

    mockGetHdState.mockReturnValue({restoreDone: true});
    finish();
    await expect(Promise.all([a, b])).resolves.toEqual(['ok', 'ok']);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('cancel aborts an in-flight scan', async () => {
    mockGetHdState.mockReturnValue({restoreDone: false});
    mockDiscover.mockImplementation(
      (_n, _t, _a, _p, opts?: {signal?: AbortSignal}) =>
        new Promise<void>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const p = requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    cancelWalletIndexing();
    await expect(p).resolves.toBe('cancelled');
    expect(getIndexingStatus().phase).toBe('idle');
  });

  it('parks offline as waitingOnline then scans when online', async () => {
    mockGetHdState.mockReturnValue({restoreDone: false});
    setOnline(false);

    const parked = await requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    expect(parked).toBe('waitingOnline');
    expect(getIndexingStatus().phase).toBe('waitingOnline');
    expect(mockDiscover).not.toHaveBeenCalled();

    mockGetHdState.mockReturnValue({restoreDone: true});
    setOnline(true);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(mockDiscover).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(getIndexingStatus().phase).toBe('idle');
  });

  it('drops stale result when active network changed mid-scan', async () => {
    mockGetHdState.mockReturnValue({restoreDone: false});
    let finish!: () => void;
    mockDiscover.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );

    const p = requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    (getStoredNetworkKey as jest.Mock).mockReturnValue('testnet4');
    mockGetHdState.mockReturnValue({restoreDone: true});
    finish();
    await expect(p).resolves.toBe('cancelled');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('runs refresh only after a successful scan', async () => {
    mockGetHdState.mockReturnValue({restoreDone: false});
    mockDiscover.mockImplementation(async () => undefined);
    const failed = await requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    expect(failed).toBe('failed');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(getIndexingStatus().phase).toBe('failed');

    resetWalletIndexingSessionForTests();
    mockGetHdState
      .mockReturnValueOnce({restoreDone: false})
      .mockReturnValue({restoreDone: true});
    const ok = await requestWalletIndexing({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
    });
    expect(ok).toBe('ok');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
