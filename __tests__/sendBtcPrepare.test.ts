jest.mock('../services/mempoolApiBase', () => ({
  normalizeNetworkKey: (n: string) => (n === 'testnet' ? 'testnet3' : n),
  resolveStoredMempoolApiBase: () => 'https://mempool.space/testnet/api',
}));

import {prepareSendBtcMultiPathInputs} from '../services/sendBtcPrepare';
import {WalletService} from '../services/WalletService';

jest.mock('../services/WalletService', () => ({
  WalletService: {
    getInstance: jest.fn(),
  },
}));

const mockWs = {
  getNextChangeAddress: jest.fn(),
  fetchUtxosWithPaths: jest.fn(),
  fetchUtxosAtPath: jest.fn(),
  enrichUtxosWithScriptpubkey: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (WalletService.getInstance as jest.Mock).mockReturnValue(mockWs);
  mockWs.getNextChangeAddress.mockResolvedValue('tb1qchange');
  mockWs.enrichUtxosWithScriptpubkey.mockImplementation(async utxos =>
    utxos.map((u: {scriptpubkey?: string}) => ({
      ...u,
      scriptpubkey: u.scriptpubkey || '5120ab',
    })),
  );
});

describe('prepareSendBtcMultiPathInputs', () => {
  it('uses route utxos and change when provided', async () => {
    const utxosJson = JSON.stringify([
      {
        txid: 'aa'.repeat(32),
        vout: 0,
        value: 100000,
        address: 'tb1qrecv',
        derivation_path: "m/84'/1'/0'/0/0",
      },
    ]);
    const result = await prepareSendBtcMultiPathInputs({
      network: 'testnet',
      addressType: 'segwit-native',
      utxosJsonFromRoute: utxosJson,
      changeAddressFromRoute: 'tb1qchg',
    });
    expect(result.changeAddress).toBe('tb1qchg');
    expect(JSON.parse(result.utxosWithPathsJSON)).toHaveLength(1);
    expect(mockWs.fetchUtxosWithPaths).not.toHaveBeenCalled();
  });

  it('falls back to sender path when HD scan is empty', async () => {
    mockWs.fetchUtxosWithPaths.mockResolvedValue([]);
    mockWs.fetchUtxosAtPath.mockResolvedValue([
      {
        txid: 'bb'.repeat(32),
        vout: 1,
        value: 50000,
        address: 'tb1qsender',
        derivationPath: "m/84'/1'/0'/0/0",
        chain: 'receive',
        chainIndex: 0,
      },
    ]);
    const result = await prepareSendBtcMultiPathInputs({
      network: 'testnet3',
      addressType: 'segwit-native',
      senderDerivationPath: "m/84'/1'/0'/0/0",
    });
    expect(mockWs.fetchUtxosAtPath).toHaveBeenCalled();
    expect(JSON.parse(result.utxosWithPathsJSON)[0].value).toBe(50000);
  });

  it('throws when no utxos anywhere', async () => {
    mockWs.fetchUtxosWithPaths.mockResolvedValue([]);
    mockWs.fetchUtxosAtPath.mockResolvedValue([]);
    await expect(
      prepareSendBtcMultiPathInputs({
        network: 'testnet3',
        addressType: 'segwit-native',
        senderDerivationPath: "m/84'/1'/0'/0/0",
      }),
    ).rejects.toThrow(/No spendable UTXOs/);
  });
});
