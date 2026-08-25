jest.mock('../services/mempoolApiBase', () => ({
  normalizeNetworkKey: (n: string) => (n === 'testnet' ? 'testnet3' : n),
  resolveStoredMempoolApiBase: () => 'https://mempool.space/testnet/api',
}));

jest.mock('../services/repositories/UtxoRepository', () => ({
  __esModule: true,
  default: {
    getUtxosForNetwork: jest.fn(() => []),
  },
}));

import {prepareSendBtcMultiPathInputs} from '../services/sendBtcPrepare';
import {WalletService} from '../services/WalletService';
import utxoRepository from '../services/repositories/UtxoRepository';

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

const compactRouteUtxo = {
  txid: 'aa'.repeat(32),
  vout: 0,
  value: 100000,
  address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  derivation_path: "m/84'/1'/0'/0/0",
};

beforeEach(() => {
  jest.clearAllMocks();
  (WalletService.getInstance as jest.Mock).mockReturnValue(mockWs);
  mockWs.getNextChangeAddress.mockResolvedValue('tb1qchange');
  (utxoRepository.getUtxosForNetwork as jest.Mock).mockReturnValue([]);
  mockWs.enrichUtxosWithScriptpubkey.mockImplementation(async utxos =>
    utxos.map((u: {scriptpubkey?: string}) => ({
      ...u,
      scriptpubkey: u.scriptpubkey || '5120ab',
    })),
  );
});

describe('prepareSendBtcMultiPathInputs', () => {
  it('uses route utxos and change when provided with scriptpubkey', async () => {
    const utxosJson = JSON.stringify([
      {
        ...compactRouteUtxo,
        scriptpubkey: '0014aabb',
      },
    ]);
    const result = await prepareSendBtcMultiPathInputs({
      network: 'testnet',
      addressType: 'segwit-native',
      utxosJsonFromRoute: utxosJson,
      changeAddressFromRoute: 'tb1qchg',
    });
    expect(result.changeAddress).toBe('tb1qchg');
    expect(JSON.parse(result.utxosWithPathsJSON)).toEqual([
      expect.objectContaining({
        txid: compactRouteUtxo.txid,
        vout: 0,
        scriptpubkey: '0014aabb',
      }),
    ]);
    expect(mockWs.fetchUtxosWithPaths).not.toHaveBeenCalled();
    expect(mockWs.enrichUtxosWithScriptpubkey).not.toHaveBeenCalled();
  });

  it('derives scriptpubkey from compact QR addresses without network hydrate', async () => {
    const result = await prepareSendBtcMultiPathInputs({
      network: 'testnet',
      addressType: 'segwit-native',
      utxosJsonFromRoute: JSON.stringify([compactRouteUtxo]),
      changeAddressFromRoute: 'tb1qchg',
    });
    const native = JSON.parse(result.utxosWithPathsJSON);
    expect(native).toHaveLength(1);
    expect(native[0].txid).toBe(compactRouteUtxo.txid);
    expect(native[0].scriptpubkey).toBe(
      '0014751e76e8199196d454941c45d1b3a323f1433bd6',
    );
    expect(mockWs.fetchUtxosWithPaths).not.toHaveBeenCalled();
    expect(mockWs.enrichUtxosWithScriptpubkey).not.toHaveBeenCalled();
  });

  it('hydrates compact QR utxos from the local DB before deriving from address', async () => {
    (utxoRepository.getUtxosForNetwork as jest.Mock).mockReturnValue([
      {
        txid: compactRouteUtxo.txid,
        vout: 0,
        address: compactRouteUtxo.address,
        network: 'testnet3',
        valueSats: 100000,
        scriptPubkey: '0014fromdb',
        derivationPath: "m/84'/1'/0'/0/0",
        isConfirmed: true,
        blockHeight: 1,
        blockTime: 1,
        fetchedAt: 1,
      },
    ]);
    const result = await prepareSendBtcMultiPathInputs({
      network: 'testnet',
      addressType: 'segwit-native',
      utxosJsonFromRoute: JSON.stringify([compactRouteUtxo]),
      changeAddressFromRoute: 'tb1qchg',
    });
    expect(JSON.parse(result.utxosWithPathsJSON)[0].scriptpubkey).toBe(
      '0014fromdb',
    );
    expect(mockWs.fetchUtxosWithPaths).not.toHaveBeenCalled();
    expect(mockWs.enrichUtxosWithScriptpubkey).not.toHaveBeenCalled();
  });

  it('falls back to sender path when HD scan is empty', async () => {
    mockWs.fetchUtxosWithPaths.mockResolvedValue([]);
    mockWs.fetchUtxosAtPath.mockResolvedValue([
      {
        txid: 'bb'.repeat(32),
        vout: 1,
        value: 50000,
        address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
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
    expect(JSON.parse(result.utxosWithPathsJSON)[0].scriptpubkey).toBe(
      '0014751e76e8199196d454941c45d1b3a323f1433bd6',
    );
    expect(mockWs.enrichUtxosWithScriptpubkey).not.toHaveBeenCalled();
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

  it('does not expand a 1-coin route pool with extra wallet UTXOs', async () => {
    mockWs.fetchUtxosWithPaths.mockResolvedValue([
      {
        ...compactRouteUtxo,
        derivationPath: compactRouteUtxo.derivation_path,
        chain: 'receive',
        chainIndex: 0,
      },
      {
        txid: 'bb'.repeat(32),
        vout: 1,
        value: 50000,
        address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        derivationPath: "m/84'/1'/0'/0/1",
        chain: 'receive',
        chainIndex: 1,
      },
    ]);
    (utxoRepository.getUtxosForNetwork as jest.Mock).mockReturnValue([
      {
        txid: compactRouteUtxo.txid,
        vout: 0,
        address: compactRouteUtxo.address,
        network: 'testnet3',
        valueSats: 100000,
        scriptPubkey: '0014fromdb',
        derivationPath: compactRouteUtxo.derivation_path,
        isConfirmed: true,
        blockHeight: 1,
        blockTime: 1,
        fetchedAt: 1,
      },
      {
        txid: 'bb'.repeat(32),
        vout: 1,
        address: compactRouteUtxo.address,
        network: 'testnet3',
        valueSats: 50000,
        scriptPubkey: '0014extra',
        derivationPath: "m/84'/1'/0'/0/1",
        isConfirmed: true,
        blockHeight: 1,
        blockTime: 1,
        fetchedAt: 1,
      },
    ]);
    const result = await prepareSendBtcMultiPathInputs({
      network: 'testnet',
      addressType: 'segwit-native',
      utxosJsonFromRoute: JSON.stringify([compactRouteUtxo]),
      changeAddressFromRoute: 'tb1qchg',
    });
    const native = JSON.parse(result.utxosWithPathsJSON);
    expect(native).toHaveLength(1);
    expect(native[0].txid).toBe(compactRouteUtxo.txid);
    expect(mockWs.fetchUtxosWithPaths).not.toHaveBeenCalled();
  });
});
