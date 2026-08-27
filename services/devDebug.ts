import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';

/** True when Wallet Settings developer mode is enabled (7× build number tap). */
export async function isDevDebugEnabled(): Promise<boolean> {
  return appConfigRepository.getBool(CONFIG_KEYS.DEV_DEBUG_ENABLED, false);
}

export function setDevDebugEnabledPref(enabled: boolean): void {
  appConfigRepository.setBool(CONFIG_KEYS.DEV_DEBUG_ENABLED, enabled);
}
