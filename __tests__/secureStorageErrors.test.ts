import {Alert} from 'react-native';
import {
  alertSecureStorageError,
  secureStorageKindOf,
  secureStorageMessageFor,
} from '../services/secureStorageErrors';

describe('secure storage errors (F3/F4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
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
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Secure Storage Unavailable',
      expect.stringContaining('screen lock'),
    );
    expect(alertSecureStorageError(new Error('plain failure'))).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
