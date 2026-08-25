/**
 * @format
 */

jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

jest.mock('../services/Database', () => {
  const store = new Map<string, string>();
  const execute = jest.fn((sql: string, params: unknown[] = []) => {
    const q = String(sql);
    if (q.includes('SELECT value')) {
      const value = store.get(params[0] as string);
      return {rows: value == null ? [] : [{value}]};
    }
    if (q.includes('INSERT')) {
      store.set(params[0] as string, params[1] as string);
      return {rows: []};
    }
    if (q.includes('DELETE FROM app_config WHERE key')) {
      store.delete(params[0] as string);
      return {rows: []};
    }
    return {rows: []};
  });
  return {
    __esModule: true,
    default: {
      execute,
      transaction: jest.fn((fn: (tx: {execute: typeof execute}) => void) => {
        fn({execute});
      }),
      __store: store,
    },
  };
});

import EncryptedStorage from 'react-native-encrypted-storage';
import database from '../services/Database';
import {CONFIG_KEYS} from '../services/repositories/AppConfigRepository';
import {
  CAMOUFLAGE_PIN_ENABLED_KEY,
  CAMOUFLAGE_PIN_HASH_KEY,
  CAMOUFLAGE_PIN_LOCKOUT_MS,
  applyCamouflagePinFailure,
  camouflagePinRetryHint,
  clearCamouflagePin,
  clearCamouflagePinLockout,
  getCamouflagePinLockState,
  hasCamouflagePin,
  isCamouflagePinEnabled,
  isValidCamouflagePin,
  recordCamouflagePinFailure,
  resolveCamouflagePinLock,
  setCamouflagePin,
  setCamouflagePinEnabled,
  shouldPromptCamouflagePin,
  verifyCamouflagePin,
} from '../services/camouflagePin';

const getItem = EncryptedStorage.getItem as jest.Mock;
const setItem = EncryptedStorage.setItem as jest.Mock;
const dbStore = (
  database as unknown as {__store: Map<string, string>}
).__store;

describe('camouflagePin', () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    (EncryptedStorage.removeItem as jest.Mock).mockReset();
    dbStore.clear();
  });

  it('accepts only 4 digits', () => {
    expect(isValidCamouflagePin('1234')).toBe(true);
    expect(isValidCamouflagePin('0000')).toBe(true);
    expect(isValidCamouflagePin('123')).toBe(false);
    expect(isValidCamouflagePin('12345')).toBe(false);
    expect(isValidCamouflagePin('12a4')).toBe(false);
  });

  it('defaults PIN toggle off when unset', async () => {
    getItem.mockResolvedValue(null);
    expect(await isCamouflagePinEnabled()).toBe(false);
  });

  it('reads stored toggle', async () => {
    getItem.mockResolvedValue('false');
    expect(await isCamouflagePinEnabled()).toBe(false);
    getItem.mockResolvedValue('true');
    expect(await isCamouflagePinEnabled()).toBe(true);
  });

  it('hashes and verifies a PIN', async () => {
    const store = new Map<string, string>();
    getItem.mockImplementation(async (key: string) => store.get(key) ?? null);
    setItem.mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
    });
    await setCamouflagePin('4821');
    expect(store.get(CAMOUFLAGE_PIN_HASH_KEY)).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(store.get(CAMOUFLAGE_PIN_ENABLED_KEY)).toBe('true');
    expect(await hasCamouflagePin()).toBe(true);
    expect(await verifyCamouflagePin('4821')).toBe(true);
    expect(await verifyCamouflagePin('0000')).toBe(false);
  });

  it('prompts on lock for camouflage when a PIN exists, or Bold when toggle is on', async () => {
    getItem.mockImplementation(async (key: string) => {
      if (key === CAMOUFLAGE_PIN_HASH_KEY) {
        return 'ab:cd';
      }
      if (key === CAMOUFLAGE_PIN_ENABLED_KEY) {
        return 'false';
      }
      return null;
    });
    expect(await shouldPromptCamouflagePin(true)).toBe(true);
    expect(await shouldPromptCamouflagePin(false)).toBe(false);

    getItem.mockImplementation(async (key: string) => {
      if (key === CAMOUFLAGE_PIN_HASH_KEY) {
        return 'ab:cd';
      }
      if (key === CAMOUFLAGE_PIN_ENABLED_KEY) {
        return 'true';
      }
      return null;
    });
    expect(await shouldPromptCamouflagePin(false)).toBe(true);

    getItem.mockResolvedValue(null);
    expect(await shouldPromptCamouflagePin(true)).toBe(false);
  });

  it('persists enabled flag', async () => {
    setItem.mockResolvedValue(undefined);
    await setCamouflagePinEnabled(false);
    expect(setItem).toHaveBeenCalledWith(CAMOUFLAGE_PIN_ENABLED_KEY, 'false');
  });

  it('locks for 30s after 3 failures and resets the window after the wait', () => {
    const t0 = 1_700_000_000_000;
    let s = applyCamouflagePinFailure({failures: 0, lockedUntil: 0}, t0);
    expect(s).toMatchObject({failures: 1, locked: false, remainingMs: 0});
    s = applyCamouflagePinFailure(s, t0 + 1);
    expect(s.failures).toBe(2);
    expect(s.locked).toBe(false);
    s = applyCamouflagePinFailure(s, t0 + 2);
    expect(s.locked).toBe(true);
    expect(s.failures).toBe(0);
    expect(s.remainingMs).toBe(CAMOUFLAGE_PIN_LOCKOUT_MS);
    expect(s.lockedUntil).toBe(t0 + 2 + CAMOUFLAGE_PIN_LOCKOUT_MS);

    const mid = resolveCamouflagePinLock(s, t0 + 2 + 10_000);
    expect(mid.locked).toBe(true);
    expect(mid.remainingMs).toBe(20_000);

    const done = resolveCamouflagePinLock(s, t0 + 2 + CAMOUFLAGE_PIN_LOCKOUT_MS);
    expect(done.locked).toBe(false);
    expect(done.failures).toBe(0);
  });

  it('does not add failures while locked', () => {
    const now = 5_000;
    const locked = applyCamouflagePinFailure(
      {failures: 2, lockedUntil: 0},
      now,
    );
    const again = applyCamouflagePinFailure(locked, now + 100);
    expect(again.lockedUntil).toBe(locked.lockedUntil);
    expect(again.failures).toBe(0);
  });

  it('persists fail count and lockout until in app_config', () => {
    const t0 = 9_000;
    expect(recordCamouflagePinFailure(t0).failures).toBe(1);
    expect(dbStore.get(CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT)).toBe('1');
    expect(recordCamouflagePinFailure(t0 + 1).failures).toBe(2);
    const locked = recordCamouflagePinFailure(t0 + 2);
    expect(locked.locked).toBe(true);
    expect(dbStore.get(CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT)).toBe('0');
    expect(dbStore.get(CONFIG_KEYS.CAMOUFLAGE_PIN_LOCKED_UNTIL)).toBe(
      String(t0 + 2 + CAMOUFLAGE_PIN_LOCKOUT_MS),
    );

    expect(getCamouflagePinLockState(t0 + 2 + 1_000).locked).toBe(true);
    expect(getCamouflagePinLockState(t0 + 2 + CAMOUFLAGE_PIN_LOCKOUT_MS).locked).toBe(
      false,
    );
    expect(dbStore.has(CONFIG_KEYS.CAMOUFLAGE_PIN_LOCKED_UNTIL)).toBe(false);
  });

  it('clears lockout on success and when the PIN is removed', async () => {
    recordCamouflagePinFailure(1);
    recordCamouflagePinFailure(2);
    expect(dbStore.get(CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT)).toBe('2');
    clearCamouflagePinLockout();
    expect(dbStore.has(CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT)).toBe(false);

    recordCamouflagePinFailure(3);
    (EncryptedStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    await clearCamouflagePin();
    expect(dbStore.has(CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT)).toBe(false);
    expect(dbStore.has(CONFIG_KEYS.CAMOUFLAGE_PIN_LOCKED_UNTIL)).toBe(false);
  });

  it('formats a retry countdown', () => {
    expect(camouflagePinRetryHint(30_000)).toBe('Retry in 30s');
    expect(camouflagePinRetryHint(1)).toBe('Retry in 1s');
  });
});
