jest.mock('../services/mempoolApiBase', () => ({
  normalizeNetworkKey: (n: string) => (n === 'testnet' ? 'testnet3' : n),
  resolveStoredMempoolApiBase: () => 'https://mempool.space/testnet/api',
}));

jest.mock('../services/WalletService', () => ({
  WalletService: {
    getInstance: jest.fn(),
  },
}));

import {resolveChangeAddressDisplayPath} from '../hooks/useSendTxPreview';
import {WalletService} from '../services/WalletService';

const mockWs = {
  getHdAddressesWithPaths: jest.fn(),
  getNextChangeAddressWithPath: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (WalletService.getInstance as jest.Mock).mockReturnValue(mockWs);
});

describe('resolveChangeAddressDisplayPath', () => {
  it('returns the HD path that matches the QR change address, not the next unused index', async () => {
    mockWs.getHdAddressesWithPaths.mockResolvedValue([
      {
        address: 'tb1qrecv0',
        derivationPath: "m/84'/1'/0'/0/0",
        chain: 'receive',
        index: 0,
      },
      {
        address: 'tb1qchange2',
        derivationPath: "m/84'/1'/0'/1/2",
        chain: 'change',
        index: 2,
      },
      {
        address: 'tb1qchange3',
        derivationPath: "m/84'/1'/0'/1/3",
        chain: 'change',
        index: 3,
      },
    ]);
    await expect(
      resolveChangeAddressDisplayPath(
        'testnet3',
        'segwit-native',
        'tb1qchange2',
      ),
    ).resolves.toBe("m/84'/1'/0'/1/2");
    expect(mockWs.getNextChangeAddressWithPath).not.toHaveBeenCalled();
  });

  it('returns empty when the address is not in the HD list', async () => {
    mockWs.getHdAddressesWithPaths.mockResolvedValue([]);
    await expect(
      resolveChangeAddressDisplayPath(
        'testnet3',
        'segwit-native',
        'tb1qunknown',
      ),
    ).resolves.toBe('');
  });
});
