import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';

/**
 * 3b-6e: persistent "backup recommended" nudge. Replaces the
 * blocking post-import "Legacy Backup" alert (and persists the
 * post-migration "Later" dismissal) with a soft indicator shown on
 * Wallet home + Settings until a fresh backup is exported.
 *
 * All functions are fail-safe: a nudge failure must never break
 * import, export, or migration flows.
 */

export function isBackupNudgeActive(): boolean {
  try {
    return appConfigRepository.getBool(CONFIG_KEYS.STALE_BACKUP_NUDGE, false);
  } catch {
    return false;
  }
}

export function setBackupNudgeActive(): void {
  try {
    appConfigRepository.set(CONFIG_KEYS.STALE_BACKUP_NUDGE, 'true');
  } catch {
    /* nudge is advisory; never throw */
  }
}

export function clearBackupNudge(): void {
  try {
    appConfigRepository.remove(CONFIG_KEYS.STALE_BACKUP_NUDGE);
  } catch {
    /* nudge is advisory; never throw */
  }
}
