/**
 * B3 — force-flag pass-through (test-only, no prod code).
 *
 * A1 verification, locked as a test: pull-refresh (forceTx) must reach
 * syncAddressesAtomic({force:true}) and utxoSyncer.syncAddresses({force:true}).
 */

jest.mock('../utils', () => ({dbg: jest.fn()}));

const mockInvalidate = jest.fn((..._args: unknown[]) => undefined);
jest.mock('../services/repositories/SyncRepository', () => ({
  __esModule: true,
  default: {invalidate: (...args: unknown[]) => mockInvalidate(...args)},
}));

jest.mock('../services/ApiQueue', () => ({
  __esModule: true,
  default: {
    enqueue: jest.fn(
      async (
        _label: string,
        job: (setProgress: (c: number, t: number) => void) => Promise<unknown>,
      ) => job(jest.fn()),
    ),
  },
}));

const mockSyncAddressesAtomic = jest.fn(
  async (..._args: unknown[]) => undefined,
);
jest.mock('../services/sync/TransactionSyncer', () => ({
  __esModule: true,
  default: {
    syncAddressesAtomic: (...args: unknown[]) =>
      mockSyncAddressesAtomic(...args),
  },
}));

const mockUtxoSyncAddresses = jest.fn(
  async (..._args: unknown[]) => undefined,
);
jest.mock('../services/sync/UtxoSyncer', () => ({
  __esModule: true,
  default: {
    syncAddresses: (...args: unknown[]) => mockUtxoSyncAddresses(...args),
  },
}));

jest.mock('../services/sync/SyncCoordinator', () => ({
  __esModule: true,
  default: {pause: jest.fn(), resume: jest.fn()},
}));

jest.mock('../services/WalletService', () => ({
  WalletService: {
    getInstance: () => ({
      getWalletBalanceAggregate: jest.fn(async () => ({btc: '0'})),
      getBitcoinPrice: jest.fn(async () => ({})),
      getActiveAddressesWithPaths: jest.fn(async () => [
        {address: 'addr1', derivationPath: "m/84'/0'/0'/0/0"},
      ]),
      getHdAddressesWithPaths: jest.fn(async () => [{address: 'addr1'}]),
    }),
  },
}));

import {runWalletRefreshSession} from '../services/sync/walletRefreshSession';

describe('runWalletRefreshSession force pass-through (A1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pull-refresh reaches tx and UTXO syncers with force:true', async () => {
    await runWalletRefreshSession({
      network: 'mainnet',
      addressType: 'segwit-native',
      apiBase: 'https://mempool.space',
      btcRate: 0,
      includeTx: true,
      activeOnly: true,
      forceTx: true,
    });

    expect(mockSyncAddressesAtomic).toHaveBeenCalledWith(
      [{address: 'addr1', network: 'mainnet'}],
      'https://mempool.space/api',
      expect.any(Function),
      {force: true},
    );
    expect(mockUtxoSyncAddresses).toHaveBeenCalledWith(
      [{address: 'addr1', network: 'mainnet', derivationPath: "m/84'/0'/0'/0/0"}],
      'https://mempool.space/api',
      expect.any(Function),
      {force: true},
    );
  });
});
