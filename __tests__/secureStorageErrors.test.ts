jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {show: jest.fn()},
}));

import Toast from 'react-native-toast-message';
import {
  alertSecureStorageError,
  secureStorageKindOf,
  secureStorageMessageFor,
} from '../services/secureStorageErrors';

describe('secure storage errors (F3/F4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Toast, 'show').mockImplementation(() => {});
  });

  it('F3: maps all four native kinds to copy', () => {
    const cases: Array<[string, string]> = [
      ['[SECURE_STORAGE_INVALIDATED] x', 'was reset'],
      ['[SECURE_STORAGE_LOCKED] x', 'unlocked'],
      ['[SECURE_STORAGE_CORRUPTED] x', 'corrupted'],
      ['[SECURE_STORAGE_UNAVAILABLE] x', 'screen lock'],
    ];
    for (const [token, fragment] of cases) {
      expect(secureStorageKindOf(new Error(token))).not.toBeNull();
      expect(secureStorageMessageFor(new Error(token))).toContain(fragment);
    }
  });

  it('F3: matches code or message fields', () => {
    expect(
      secureStorageKindOf({code: '[SECURE_STORAGE_LOCKED]'}),
    ).toBe('LOCKED');
    expect(secureStorageKindOf(new Error('plain failure'))).toBeNull();
    expect(secureStorageMessageFor(new Error('plain failure'))).toBeNull();
    expect(secureStorageMessageFor(null)).toBeNull();
  });

  it('F3: alert fires once for storage errors, never otherwise', () => {
    expect(
      alertSecureStorageError(new Error('[SECURE_STORAGE_UNAVAILABLE] x')),
    ).toBe(true);
    expect(Toast.show).toHaveBeenCalledTimes(1);
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: 'Secure Storage Unavailable',
        text2: expect.stringContaining('screen lock'),
      }),
    );
    expect(alertSecureStorageError(new Error('plain failure'))).toBe(false);
    expect(Toast.show).toHaveBeenCalledTimes(1);
  });

  it('F15b-1: repeats within the window are suppressed, still handled', () => {
    // LOCKED message — distinct from the UNAVAILABLE message above so
    // module-level dedupe state cannot leak between tests.
    const err = () => new Error('[SECURE_STORAGE_LOCKED] x');
    expect(alertSecureStorageError(err())).toBe(true);
    expect(Toast.show).toHaveBeenCalledTimes(1);
    expect(alertSecureStorageError(err())).toBe(true);
    expect(alertSecureStorageError(err())).toBe(true);
    expect(Toast.show).toHaveBeenCalledTimes(1);
  });

  it('F15b-1: a different message is not suppressed', () => {
    expect(alertSecureStorageError(new Error('[SECURE_STORAGE_LOCKED] x'))).toBe(
      true,
    );
    const before = (Toast.show as jest.Mock).mock.calls.length;
    expect(
      alertSecureStorageError(new Error('[SECURE_STORAGE_CORRUPTED] x')),
    ).toBe(true);
    expect((Toast.show as jest.Mock).mock.calls.length).toBe(before + 1);
  });
});
