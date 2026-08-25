/**
 * @format
 */

jest.mock('../utils', () => ({dbg: jest.fn()}));

const mockDiscover = jest.fn(async () => undefined);
const mockGetHd = jest.fn(async () => []);
const mockGetActive = jest.fn(async () => []);
jest.mock('../services/WalletService', () => ({
  WalletService: {
    getInstance: () => ({
      discoverHdIndexesForNetwork: (...args: unknown[]) => mockDiscover(...args),
      getHdAddressesWithPaths: (...args: unknown[]) => mockGetHd(...args),
      getActiveAddressesWithPaths: (...args: unknown[]) => mockGetActive(...args),
    }),
  },
}));

const mockGetHdState = jest.fn(() => ({
  restoreDone: true,
  discoveryLastAt: Date.now(),
}));
jest.mock('../services/repositories/WalletRepository', () => ({
  __esModule: true,
  default: {getHdState: () => mockGetHdState()},
}));

jest.mock('../services/sync/BalanceSyncer', () => ({
  __esModule: true,
  default: {syncAddresses: jest.fn(async () => undefined)},
}));
jest.mock('../services/sync/TransactionSyncer', () => ({
  __esModule: true,
  default: {syncAddress: jest.fn(async () => undefined)},
}));
jest.mock('../services/sync/UtxoSyncer', () => ({
  __esModule: true,
  default: {syncAddresses: jest.fn(async () => undefined)},
}));
jest.mock('../services/sync/PriceSyncer', () => ({
  __esModule: true,
  default: {syncCurrentPrice: jest.fn(async () => undefined)},
}));

jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: () => true,
  subscribeWalletOnline: (fn: (online: boolean) => void) => {
    fn(true);
    return () => undefined;
  },
}));

jest.mock('../services/MempoolClient', () => ({
  __esModule: true,
  default: {abortAll: jest.fn(), syncPoolConcurrency: () => 1},
}));

import {SyncCoordinator} from '../services/sync/SyncCoordinator';

const baseConfig = {
  addresses: [{address: 'addr1', network: 'mainnet'}],
  network: 'mainnet',
  addressType: 'segwit-native',
  apiBase: 'https://mempool.space/api',
};

describe('SyncCoordinator.start', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not force HD discovery when restoreDone and discovery is fresh', async () => {
    const coord = new SyncCoordinator();
    coord.start(baseConfig);
    await new Promise(r => setImmediate(r));
    expect(mockDiscover).not.toHaveBeenCalled();
    coord.stop();
  });

  it('updates config in place on a second start for the same network and type', () => {
    const coord = new SyncCoordinator();
    const updateSpy = jest.spyOn(coord, 'updateConfig');
    coord.start(baseConfig);
    coord.start({
      ...baseConfig,
      addresses: [
        {address: 'addr1', network: 'mainnet'},
        {address: 'addr2', network: 'mainnet'},
      ],
      onSyncComplete: jest.fn(),
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].addresses).toHaveLength(2);
    coord.stop();
  });
});
