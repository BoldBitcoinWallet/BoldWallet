jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: jest.fn((payload: unknown) => payload),
  },
}));
jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  copyFile: jest.fn(),
  readFile: jest.fn(),
}));
jest.mock('../services/rnfsSafe', () => ({
  safeUnlink: jest.fn(),
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));
jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    aesDecrypt: jest.fn(),
    sha256: jest.fn(),
    hasKeyshareInSecureStorage: jest.fn(),
  },
}));
jest.mock('../services/walletSetupOrchestrator', () => ({
  persistWalletKeyshare: jest.fn(),
}));
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
  CONFIG_KEYS: {
    CURRENT_ADDRESS: 'current_address',
    LEGACY_WALLET_DO_NOT_REMIND: 'legacy_wallet_do_not_remind',
  },
}));

import {BBMTLibNativeModule} from '../native_modules';
import {
  decryptAndValidateKeyshare,
  InvalidKeyshareError,
  WrongKeysharePasswordError,
} from '../services/keyshareImport';

const aesDecrypt = BBMTLibNativeModule.aesDecrypt as jest.Mock;
const sha256 = BBMTLibNativeModule.sha256 as jest.Mock;

describe('keyshareImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sha256.mockResolvedValue('deadbeef');
  });

  it('decryptAndValidateKeyshare rejects wrong password', async () => {
    aesDecrypt.mockResolvedValue('not-json-without-pub-key');
    await expect(
      decryptAndValidateKeyshare('cipher', 'password'),
    ).rejects.toBeInstanceOf(WrongKeysharePasswordError);
  });

  it('decryptAndValidateKeyshare rejects invalid keyshare JSON', async () => {
    aesDecrypt.mockResolvedValue('{"pub_key":""}');
    await expect(
      decryptAndValidateKeyshare('cipher', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
  });

  it('decryptAndValidateKeyshare returns parsed keyshare on success', async () => {
    aesDecrypt.mockResolvedValue('{"pub_key":"abc","local_party_key":"KeyShare1"}');
    await expect(
      decryptAndValidateKeyshare('cipher', 'password'),
    ).resolves.toEqual({
      decryptedKeyshare: '{"pub_key":"abc","local_party_key":"KeyShare1"}',
      parsed: {pub_key: 'abc', local_party_key: 'KeyShare1'},
    });
    expect(sha256).toHaveBeenCalledWith('password');
  });
});
