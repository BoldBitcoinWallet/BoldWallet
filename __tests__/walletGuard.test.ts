jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  copyFile: jest.fn(),
  readFile: jest.fn(),
  exists: jest.fn(),
  unlink: jest.fn(),
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));
jest.mock('../services/tssBackend', () => ({}));
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
  CONFIG_KEYS: {KEYSHARE_META_JSON: 'keyshare_meta_json'},
}));
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    hasKeyshareInSecureStorage: jest.fn(),
  },
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {
  assertNoExistingWallet,
  hasLoadedWallet,
  WalletAlreadyLoadedError,
} from '../services/walletGuard';

const nativeHas = BBMTLibNativeModule.hasKeyshareInSecureStorage as jest.Mock;

describe('walletGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nativeHas.mockResolvedValue(false);
  });

  it('assertNoExistingWallet throws when keyshare exists', async () => {
    nativeHas.mockResolvedValue(true);
    await expect(assertNoExistingWallet()).rejects.toBeInstanceOf(
      WalletAlreadyLoadedError,
    );
  });

  it('assertNoExistingWallet passes when no keyshare', async () => {
    await expect(assertNoExistingWallet()).resolves.toBeUndefined();
  });

  it('hasLoadedWallet reflects native presence', async () => {
    nativeHas.mockResolvedValue(true);
    await expect(hasLoadedWallet()).resolves.toBe(true);
  });
});
