import {PermissionsAndroid, Platform} from 'react-native';

/** Android 13+ replacement for location when using NSD / nearby Wi-Fi. */
export const NEARBY_WIFI_DEVICES = 'android.permission.NEARBY_WIFI_DEVICES';

export function androidApiLevel(
  version: string | number = Platform.Version,
): number {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }
  const parsed = parseInt(String(version), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * API 33+ needs NEARBY_WIFI_DEVICES for NSD. API 24–32 keeps the previous
 * behavior (no extra runtime prompt; location is still in the manifest).
 * Denial does not skip scan/publish — same as today's best-effort discovery.
 */
export async function ensureLanDiscoveryPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (androidApiLevel() < 33) {
    return true;
  }
  try {
    const already = await PermissionsAndroid.check(NEARBY_WIFI_DEVICES);
    if (already) {
      return true;
    }
    const result = await PermissionsAndroid.request(NEARBY_WIFI_DEVICES, {
      title: 'Local network permission',
      message:
        'Bold Wallet uses nearby Wi-Fi to find other devices on your LAN for pairing.',
      buttonPositive: 'OK',
      buttonNegative: 'Cancel',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
