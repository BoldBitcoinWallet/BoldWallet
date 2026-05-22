jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
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
    hasKeyshareInSecureStorage: jest.fn(),
  },
}));
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
  CONFIG_KEYS: {KEYSHARE_META_JSON: 'keyshare_meta_json'},
}));

import EncryptedStorage from 'react-native-encrypted-storage';
import {BBMTLibNativeModule} from '../native_modules';
import {
  hasWalletKeyshareInSecureStorage,
  resolveInitialWalletRoute,
} from '../utils';

const nativeHas = BBMTLibNativeModule.hasKeyshareInSecureStorage as jest.Mock;
const getItem = EncryptedStorage.getItem as jest.Mock;
const removeItem = EncryptedStorage.removeItem as jest.Mock;

describe('wallet keyshare presence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nativeHas.mockResolvedValue(true);
    getItem.mockResolvedValue(null);
    removeItem.mockResolvedValue(undefined);
  });

  it('hasWalletKeyshareInSecureStorage uses native bridge when available', async () => {
    nativeHas.mockResolvedValue(true);
    await expect(hasWalletKeyshareInSecureStorage()).resolves.toBe(true);
    expect(nativeHas).toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('hasWalletKeyshareInSecureStorage returns false when native reports missing', async () => {
    nativeHas.mockResolvedValue(false);
    await expect(hasWalletKeyshareInSecureStorage()).resolves.toBe(false);
  });

  it('resolveInitialWalletRoute returns Welcome and clears meta when blob missing', async () => {
    nativeHas.mockResolvedValue(false);
    getItem.mockImplementation((key: string) =>
      key === 'keyshare_meta' ? Promise.resolve('{"pub_key":"x"}') : Promise.resolve(null),
    );
    await expect(resolveInitialWalletRoute()).resolves.toBe('Welcome');
    expect(removeItem).toHaveBeenCalledWith('keyshare_meta');
  });

  it('resolveInitialWalletRoute returns MainTabs when blob exists', async () => {
    nativeHas.mockResolvedValue(true);
    await expect(resolveInitialWalletRoute()).resolves.toBe('MainTabs');
    expect(removeItem).not.toHaveBeenCalled();
  });

});
