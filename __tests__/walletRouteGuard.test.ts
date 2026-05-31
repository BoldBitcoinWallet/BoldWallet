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
}));

import {BBMTLibNativeModule} from '../native_modules';
import {hasUsableWalletKeyshare} from '../utils';

const nativeHas = BBMTLibNativeModule.hasKeyshareInSecureStorage as jest.Mock;

describe('wallet route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hasUsableWalletKeyshare requires secure blob', async () => {
    nativeHas.mockResolvedValue(false);
    await expect(hasUsableWalletKeyshare()).resolves.toBe(false);
    nativeHas.mockResolvedValue(true);
    await expect(hasUsableWalletKeyshare()).resolves.toBe(true);
  });
});
