/**
 * One-time copy of leftover EncryptedStorage preferences into SQLite `app_config`.
 * After this, EncryptedStorage holds only the `keyshare` secret blob.
 */
import EncryptedStorage from 'react-native-encrypted-storage';
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';
import {dbg} from '../utils';

export const ENCRYPTED_PREFS_MIGRATION_VERSION = 'v1';

/** EncryptedStorage keys that used to hold prefs (not the keyshare secret). */
export const LEGACY_ENCRYPTED_PREF_KEYS = [
  'keyshare_meta',
  'btcPub',
  'bitcoin_display_sats',
  'balance_formatting_enabled',
  'devDebugEnabled',
  'psbt_mode_first_visit',
  'app_icon_preference',
  'camouflage_pin_hash',
  'camouflage_pin_enabled',
  'mpc_battery_exempt_dont_ask',
] as const;

const COPY_IF_ABSENT: ReadonlyArray<{from: string; to: string}> = [
  {from: 'keyshare_meta', to: CONFIG_KEYS.KEYSHARE_META_JSON},
  {from: 'bitcoin_display_sats', to: CONFIG_KEYS.BITCOIN_DISPLAY_SATS},
  {from: 'balance_formatting_enabled', to: CONFIG_KEYS.BALANCE_FORMATTING_ENABLED},
  {from: 'devDebugEnabled', to: CONFIG_KEYS.DEV_DEBUG_ENABLED},
  {from: 'psbt_mode_first_visit', to: CONFIG_KEYS.PSBT_MODE_FIRST_VISIT},
  {from: 'app_icon_preference', to: CONFIG_KEYS.APP_ICON_PREFERENCE},
  {from: 'camouflage_pin_hash', to: CONFIG_KEYS.CAMOUFLAGE_PIN_HASH},
  {from: 'camouflage_pin_enabled', to: CONFIG_KEYS.CAMOUFLAGE_PIN_ENABLED},
  {from: 'mpc_battery_exempt_dont_ask', to: CONFIG_KEYS.MPC_BATTERY_EXEMPT_DONT_ASK},
];

/** Welcome import: reset display / PIN / debug prefs; keep launcher identity + keyshare meta. */
export const SHOWCASE_RESET_CONFIG_KEYS: readonly string[] = [
  CONFIG_KEYS.BITCOIN_DISPLAY_SATS,
  CONFIG_KEYS.BALANCE_FORMATTING_ENABLED,
  CONFIG_KEYS.DEV_DEBUG_ENABLED,
  CONFIG_KEYS.PSBT_MODE_FIRST_VISIT,
  CONFIG_KEYS.CAMOUFLAGE_PIN_HASH,
  CONFIG_KEYS.CAMOUFLAGE_PIN_ENABLED,
  CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT,
  CONFIG_KEYS.CAMOUFLAGE_PIN_LOCKED_UNTIL,
];

export async function removeLegacyEncryptedPrefKeys(): Promise<void> {
  await Promise.allSettled(
    LEGACY_ENCRYPTED_PREF_KEYS.map(key => EncryptedStorage.removeItem(key)),
  );
}

export function clearShowcaseImportPrefs(): void {
  for (const key of SHOWCASE_RESET_CONFIG_KEYS) {
    appConfigRepository.remove(key);
  }
}

export async function migrateEncryptedPrefsIfNeeded(): Promise<void> {
  try {
    const done = appConfigRepository.get(
      CONFIG_KEYS.ENCRYPTED_PREFS_MIGRATION_DONE,
    );
    if (done === ENCRYPTED_PREFS_MIGRATION_VERSION) {
      return;
    }

    for (const {from, to} of COPY_IF_ABSENT) {
      try {
        const raw = await EncryptedStorage.getItem(from);
        if (raw == null || String(raw).trim() === '') {
          continue;
        }
        const existing = appConfigRepository.get(to);
        if (existing == null || String(existing).trim() === '') {
          appConfigRepository.set(to, raw);
          dbg('encryptedPrefsMigration: copied', from, '→', to);
        }
      } catch (e) {
        dbg('encryptedPrefsMigration: skip', from, e);
      }
    }

    await removeLegacyEncryptedPrefKeys();
    appConfigRepository.set(
      CONFIG_KEYS.ENCRYPTED_PREFS_MIGRATION_DONE,
      ENCRYPTED_PREFS_MIGRATION_VERSION,
    );
    dbg('encryptedPrefsMigration: done', ENCRYPTED_PREFS_MIGRATION_VERSION);
  } catch (e) {
    dbg('encryptedPrefsMigration: failed', e);
  }
}
