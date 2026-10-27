jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => null),
    set: jest.fn(),
  },
  CONFIG_KEYS: {WALLET_AUTO_LOCK: 'wallet_auto_lock'},
}));

import {
  normalizeWalletAutoLock,
  resetWalletAutoLockForTests,
  shouldAutoLockOnResume,
  WALLET_AUTO_LOCK_DEFAULT,
  WALLET_AUTO_LOCK_MS,
} from '../services/walletAutoLock';

describe('walletAutoLock', () => {
  afterEach(() => {
    resetWalletAutoLockForTests();
  });

  it('defaults unknown values to After 1 min', () => {
    expect(normalizeWalletAutoLock(undefined)).toBe(WALLET_AUTO_LOCK_DEFAULT);
    expect(normalizeWalletAutoLock('')).toBe('1m');
    expect(normalizeWalletAutoLock('bogus')).toBe('1m');
    expect(normalizeWalletAutoLock('5m')).toBe('5m');
  });

  it('maps policies to thresholds', () => {
    expect(WALLET_AUTO_LOCK_MS.instant).toBe(0);
    expect(WALLET_AUTO_LOCK_MS['1m']).toBe(60_000);
    expect(WALLET_AUTO_LOCK_MS['5m']).toBe(5 * 60_000);
    expect(WALLET_AUTO_LOCK_MS.never).toBeNull();
  });

  it('locks on resume after the chosen away time', () => {
    expect(shouldAutoLockOnResume('never', 60 * 60_000)).toBe(false);
    expect(shouldAutoLockOnResume('instant', 0)).toBe(true);
    expect(shouldAutoLockOnResume('1m', 59_999)).toBe(false);
    expect(shouldAutoLockOnResume('1m', 60_000)).toBe(true);
    expect(shouldAutoLockOnResume('5m', 4 * 60_000)).toBe(false);
    expect(shouldAutoLockOnResume('5m', 5 * 60_000)).toBe(true);
  });
});
