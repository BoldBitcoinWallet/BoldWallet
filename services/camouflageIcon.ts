/**
 * Android launcher camouflage: keep SQLite `app_config` in sync with the
 * enabled activity-alias (what the OS launcher actually shows).
 */
import {NativeModules, Platform} from 'react-native';
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';
import {
  normalizeCamouflagePresetId,
  type CamouflagePresetId,
} from './camouflagePresets';

export const APP_ICON_PREFERENCE_KEY = CONFIG_KEYS.APP_ICON_PREFERENCE;

type IconChangerNative = {
  getCurrentIcon: () => Promise<string>;
  changeIcon: (iconName: string) => Promise<string>;
};

function nativeIconChanger(): IconChangerNative | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const mod = NativeModules.IconChanger as IconChangerNative | undefined;
  if (!mod?.getCurrentIcon || !mod?.changeIcon) {
    return null;
  }
  return mod;
}

export async function persistLauncherCamouflagePreference(
  preset: CamouflagePresetId,
): Promise<void> {
  appConfigRepository.set(
    CONFIG_KEYS.APP_ICON_PREFERENCE,
    normalizeCamouflagePresetId(preset),
  );
}

function readStoredPreference(): CamouflagePresetId {
  return normalizeCamouflagePresetId(
    appConfigRepository.get(CONFIG_KEYS.APP_ICON_PREFERENCE),
  );
}

/** Home-screen identity: native alias first, `app_config` as fallback. */
export async function getLauncherCamouflagePreset(): Promise<CamouflagePresetId> {
  const native = nativeIconChanger();
  if (native) {
    try {
      const id = normalizeCamouflagePresetId(await native.getCurrentIcon());
      if (id !== readStoredPreference()) {
        persistLauncherCamouflagePreference(id);
      }
      return id;
    } catch {
      // fall through to app_config
    }
  }
  return readStoredPreference();
}

export async function setLauncherCamouflagePreset(
  preset: CamouflagePresetId,
): Promise<void> {
  const id = normalizeCamouflagePresetId(preset);
  const native = nativeIconChanger();
  if (Platform.OS === 'android' && !native) {
    throw new Error('Icon switching is not available on this device.');
  }
  // Persist JS first: native changeIcon may kill the process when leaving the
  // currently-enabled launcher alias.
  await persistLauncherCamouflagePreference(id);
  if (native) {
    await native.changeIcon(id);
  }
}

/** Wallet delete: restore the Bold Wallet launcher tile. */
export async function resetLauncherCamouflageToDefault(): Promise<void> {
  try {
    await setLauncherCamouflagePreset('default');
  } catch {
    try {
      await persistLauncherCamouflagePreference('default');
    } catch {
      // ignore
    }
  }
}
