/**
 * @format
 */

jest.mock('../utils', () => ({dbg: jest.fn()}));

const mockInvalidate = jest.fn();
jest.mock('../services/repositories/SyncRepository', () => ({
  __esModule: true,
  default: {invalidate: (...args: unknown[]) => mockInvalidate(...args)},
}));

const mockEnqueue = jest.fn(
  async (_label: string, job: (setProgress: (c: number, t: number) => void) => Promise<unknown>) =>
    job(jest.fn()),
);
jest.mock('../services/ApiQueue', () => ({
  __esModule: true,
  default: {enqueue: (...args: unknown[]) => mockEnqueue(...args)},
}));

const mockSyncAddressesAtomic = jest.fn(async () => undefined);
jest.mock('../services/sync/TransactionSyncer', () => ({
  __esModule: true,
  default: {syncAddressesAtomic: (...args: unknown[]) => mockSyncAddressesAtomic(...args)},
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

const mockGetWalletBalanceAggregate = jest.fn(async () => ({btc: '0'}));
const mockGetBitcoinPrice = jest.fn(async () => ({}));
const mockGetActive = jest.fn(async () => [
  {address: 'addr1'},
  {address: 'addr2'},
]);
const mockGetHd = jest.fn(async () => [{address: 'addr1'}]);
jest.mock('../services/WalletService', () => ({
  WalletService: {
    getInstance: () => ({
      getWalletBalanceAggregate: (...args: unknown[]) =>
        mockGetWalletBalanceAggregate(...args),
      getBitcoinPrice: (...args: unknown[]) => mockGetBitcoinPrice(...args),
      getActiveAddressesWithPaths: (...args: unknown[]) => mockGetActive(...args),
      getHdAddressesWithPaths: (...args: unknown[]) => mockGetHd(...args),
    }),
  },
}));

import {runWalletRefreshSession} from '../services/sync/walletRefreshSession';

describe('runWalletRefreshSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBitcoinPrice.mockResolvedValue({});
    mockGetWalletBalanceAggregate.mockResolvedValue({btc: '0'});
    mockGetActive.mockResolvedValue([{address: 'addr1'}, {address: 'addr2'}]);
  });

  it('pauses the coordinator, then resumes even when balance fails', async () => {
    mockGetWalletBalanceAggregate.mockRejectedValueOnce(new Error('net'));
    await expect(
      runWalletRefreshSession({
        network: 'mainnet',
        addressType: 'segwit-native',
        apiBase: 'https://mempool.space/api',
        btcRate: 0,
      }),
    ).rejects.toThrow('net');
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockPause.mock.invocationCallOrder[0]).toBeLessThan(
      mockResume.mock.invocationCallOrder[0],
    );
  });

  it('invalidates only the aggregate DB key, not the HTTP address cache', async () => {
    await runWalletRefreshSession({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space/api',
      btcRate: 1,
    });
    expect(mockInvalidate).toHaveBeenCalledWith(
      'balance',
      'aggregate_mainnet_segwit-native',
    );
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it('syncs active-set txs after balance when includeTx is true', async () => {
    await runWalletRefreshSession({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space',
      btcRate: 0,
      includeTx: true,
      activeOnly: true,
    });
    expect(mockGetActive).toHaveBeenCalled();
    expect(mockSyncAddressesAtomic).toHaveBeenCalledWith(
      [
        {address: 'addr1', network: 'mainnet'},
        {address: 'addr2', network: 'mainnet'},
      ],
      'https://mempool.space/api',
      expect.any(Function),
    );
  });
});
