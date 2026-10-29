jest.mock('../utils', () => ({
  getKeyshareMetadata: jest.fn(),
  getKeyshareSecureMetadata: jest.fn(),
}));

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn()},
}));

import EncryptedStorage from 'react-native-encrypted-storage';
import {
  getChaincodeFromBlob,
  resolveChaincodeForDerivation,
  resolveChaincodeHex,
} from '../services/chaincodeReader';
import {getKeyshareMetadata, getKeyshareSecureMetadata} from '../utils';

const secureMock = getKeyshareSecureMetadata as jest.Mock;
const metaMock = getKeyshareMetadata as jest.Mock;
const storage = EncryptedStorage as any;

const CHAINCODE =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeEach(() => {
  jest.clearAllMocks();
  metaMock.mockResolvedValue({pub_key: 'aa', chain_code_hex: ''});
});

describe('F15b-1 secure chaincode reads (C5/C6)', () => {
  test('resolveChaincodeHex reads chaincode from secure fields', async () => {
    secureMock.mockResolvedValue({pub_key: 'aa', chain_code_hex: CHAINCODE});
    await expect(resolveChaincodeHex()).resolves.toBe(CHAINCODE);
    expect(secureMock).toHaveBeenCalled();
  });

  test('resolveChaincodeHex throws when chaincode is missing', async () => {
    secureMock.mockResolvedValue(null);
    await expect(resolveChaincodeHex()).rejects.toThrow(
      'Chain code missing from keyshare',
    );
  });

  test('resolveChaincodeForDerivation prefers secure, falls back to meta', async () => {
    secureMock.mockResolvedValue({pub_key: 'aa', chain_code_hex: CHAINCODE});
    const full = await resolveChaincodeForDerivation();
    expect(full).toEqual({
      pubKey: 'aa',
      chainCode: CHAINCODE,
      keyshare: {pub_key: 'aa', chain_code_hex: CHAINCODE},
    });
    secureMock.mockResolvedValue(null);
    const fallback = await resolveChaincodeForDerivation();
    expect(fallback.pubKey).toBe('aa');
    expect(fallback.chainCode).toBe('');
  });

  test('getChaincodeFromBlob never reads the raw RNES blob', async () => {
    secureMock.mockResolvedValue({chain_code_hex: CHAINCODE});
    await expect(getChaincodeFromBlob()).resolves.toBe(CHAINCODE);
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  test('no read path touches EncryptedStorage for the keyshare', async () => {
    secureMock.mockResolvedValue({pub_key: 'aa', chain_code_hex: CHAINCODE});
    await resolveChaincodeHex();
    await resolveChaincodeForDerivation();
    await getChaincodeFromBlob();
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});
