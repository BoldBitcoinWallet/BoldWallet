import {Alert} from 'react-native';
import {BBMTLibNativeModule} from '../native_modules';
import {dbg} from '../utils';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';
import {alertSecureStorageError} from './secureStorageErrors';

/**
 * F15b-1 migration bootstrap (§1.5 steps 7–8). Runs once per app
 * start, before route resolution. The native call is idempotent;
 * failures are non-fatal here (reads self-heal inline) but surface
 * via the shared storage alert.
 */
export async function runEnvelopeMigrationIfNeeded(): Promise<{
  migrated: boolean;
}> {
  try {
    const fn = BBMTLibNativeModule?.ensureKeyshareEnveloped;
    if (typeof fn !== 'function') {
      return {migrated: false};
    }
    const out = await fn();
    return {migrated: out?.migrated === true};
  } catch (e) {
    dbg('envelope migration failed (reads self-heal inline)', e);
    alertSecureStorageError(e);
    return {migrated: false};
  }
}

/**
 * Q2 condition: on the first launch where a migration ran, prompt
 * once to confirm a current backup exists. `onOpenBackup` navigates
 * to the backup UI. Returns true when the prompt was shown.
 */
export async function maybePromptPostMigrationBackup(
  migrated: boolean,
  onOpenBackup: () => void,
): Promise<boolean> {
  if (!migrated) {
    return false;
  }
  try {
    if (
      appConfigRepository.getBool(
        CONFIG_KEYS.ENVELOPE_MIGRATION_BACKUP_PROMPTED,
        false,
      )
    ) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    appConfigRepository.set(
      CONFIG_KEYS.ENVELOPE_MIGRATION_BACKUP_PROMPTED,
      'true',
    );
  } catch {
    /* prompt anyway — one extra prompt beats a missed backup */
  }
  Alert.alert(
    'Keyshare storage upgraded',
    'Your keyshare storage was upgraded. Make sure you have a current backup.',
    [
      {text: 'Later', style: 'cancel'},
      {text: 'Open backup', onPress: onOpenBackup},
    ],
  );
  return true;
}
