/**
 * @format
 */

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/repositories/AppConfigRepository', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      get: jest.fn((key: string) => store.get(key) ?? null),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      remove: jest.fn((key: string) => {
        store.delete(key);
      }),
      __store: store,
    },
    CONFIG_KEYS: {
      KEYSHARE_META_JSON: 'keyshare_meta_json',
      BITCOIN_DISPLAY_SATS: 'bitcoin_display_sats',
      BALANCE_FORMATTING_ENABLED: 'balance_formatting_enabled',
      DEV_DEBUG_ENABLED: 'dev_debug_enabled',
      PSBT_MODE_FIRST_VISIT: 'psbt_mode_first_visit',
      APP_ICON_PREFERENCE: 'app_icon_preference',
      CAMOUFLAGE_PIN_HASH: 'camouflage_pin_hash',
      CAMOUFLAGE_PIN_ENABLED: 'camouflage_pin_enabled',
      CAMOUFLAGE_PIN_FAIL_COUNT: 'camouflage_pin_fail_count',
      CAMOUFLAGE_PIN_LOCKED_UNTIL: 'camouflage_pin_locked_until',
      MPC_BATTERY_EXEMPT_DONT_ASK: 'mpc_battery_exempt_dont_ask',
      ENCRYPTED_PREFS_MIGRATION_DONE: 'encrypted_prefs_migration_done',
    },
  };
});

import EncryptedStorage from 'react-native-encrypted-storage';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {
  ENCRYPTED_PREFS_MIGRATION_VERSION,
  clearShowcaseImportPrefs,
  migrateEncryptedPrefsIfNeeded,
  removeLegacyEncryptedPrefKeys,
} from '../services/encryptedPrefsMigration';

function configStore(): Map<string, string> {
  return (appConfigRepository as unknown as {__store: Map<string, string>})
    .__store;
}

describe('encryptedPrefsMigration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore().clear();
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('copies leftover EncryptedStorage prefs into app_config then drops them', async () => {
    (EncryptedStorage.getItem as jest.Mock).mockImplementation(
      async (key: string) => {
        if (key === 'keyshare_meta') {
          return '{"local_party_key":"1"}';
        }
        if (key === 'bitcoin_display_sats') {
          return 'true';
        }
        if (key === 'btcPub') {
          return 'deadbeef';
        }
        return null;
      },
    );

    await migrateEncryptedPrefsIfNeeded();

    expect(appConfigRepository.set).toHaveBeenCalledWith(
      CONFIG_KEYS.KEYSHARE_META_JSON,
      '{"local_party_key":"1"}',
    );
    expect(appConfigRepository.set).toHaveBeenCalledWith(
      CONFIG_KEYS.BITCOIN_DISPLAY_SATS,
      'true',
    );
    expect(configStore().get(CONFIG_KEYS.ENCRYPTED_PREFS_MIGRATION_DONE)).toBe(
      ENCRYPTED_PREFS_MIGRATION_VERSION,
    );
    expect(EncryptedStorage.removeItem).toHaveBeenCalledWith('btcPub');
    expect(EncryptedStorage.removeItem).toHaveBeenCalledWith('keyshare_meta');
  });

  it('does not overwrite existing app_config values', async () => {
    configStore().set(CONFIG_KEYS.BITCOIN_DISPLAY_SATS, 'false');
    (EncryptedStorage.getItem as jest.Mock).mockImplementation(
      async (key: string) =>
        key === 'bitcoin_display_sats' ? 'true' : null,
    );

    await migrateEncryptedPrefsIfNeeded();

    expect(configStore().get(CONFIG_KEYS.BITCOIN_DISPLAY_SATS)).toBe('false');
  });

  it('is idempotent once marked done', async () => {
    configStore().set(
      CONFIG_KEYS.ENCRYPTED_PREFS_MIGRATION_DONE,
      ENCRYPTED_PREFS_MIGRATION_VERSION,
    );
    await migrateEncryptedPrefsIfNeeded();
    expect(EncryptedStorage.getItem).not.toHaveBeenCalled();
  });

  it('clears showcase import prefs without touching launcher identity or keyshare meta', () => {
    configStore().set(CONFIG_KEYS.CAMOUFLAGE_PIN_HASH, 'ab:cd');
    configStore().set(CONFIG_KEYS.APP_ICON_PREFERENCE, 'quickcalc');
    configStore().set(CONFIG_KEYS.KEYSHARE_META_JSON, '{}');
    clearShowcaseImportPrefs();
    expect(configStore().has(CONFIG_KEYS.CAMOUFLAGE_PIN_HASH)).toBe(false);
    expect(configStore().get(CONFIG_KEYS.APP_ICON_PREFERENCE)).toBe('quickcalc');
    expect(configStore().get(CONFIG_KEYS.KEYSHARE_META_JSON)).toBe('{}');
  });

  it('removeLegacyEncryptedPrefKeys drops leftover EncryptedStorage prefs', async () => {
    await removeLegacyEncryptedPrefKeys();
    expect(EncryptedStorage.removeItem).toHaveBeenCalledWith('keyshare_meta');
    expect(EncryptedStorage.removeItem).not.toHaveBeenCalledWith('keyshare');
  });
});
