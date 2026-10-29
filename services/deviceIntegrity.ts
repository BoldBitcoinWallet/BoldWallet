import {Alert} from 'react-native';
import {BBMTLibNativeModule} from '../native_modules';
import {dbg} from '../utils';

export type DeviceIntegritySignals = {
  compromised: boolean;
  signals: string[];
  /** True when detection ran nowhere (missing native method, reject, malformed payload). */
  unknown: boolean;
};

type NativeIntegrityModule = {
  getDeviceIntegritySignals?: () => Promise<unknown>;
};

const UNKNOWN: DeviceIntegritySignals = {
  compromised: false,
  signals: [],
  unknown: true,
};

/**
 * F36: device-integrity signals from the native layer (root/jailbreak
 * artifacts, sandbox escape, suspicious dylibs, emulator build).
 * Fail-open as unknown when detection is unavailable — same posture as
 * biometric-unavailable in walletBiometricAuth (a detection failure must
 * never brick the app).
 */
export async function getDeviceIntegritySignals(
  nativeModule: NativeIntegrityModule = BBMTLibNativeModule,
): Promise<DeviceIntegritySignals> {
  try {
    const fn = nativeModule?.getDeviceIntegritySignals;
    if (typeof fn !== 'function') {
      return UNKNOWN;
    }
    const raw = await fn();
    if (typeof raw !== 'string') {
      return UNKNOWN;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return UNKNOWN;
    }
    const obj = parsed as {compromised?: unknown; signals?: unknown};
    const signals = Array.isArray(obj.signals)
      ? obj.signals.filter((s): s is string => typeof s === 'string')
      : [];
    return {
      compromised: obj.compromised === true || signals.length > 0,
      signals,
      unknown: false,
    };
  } catch (error) {
    dbg('getDeviceIntegritySignals: error', error);
    return UNKNOWN;
  }
}

/**
 * F36 warn-and-confirm gate for extractive/destructive wallet actions
 * (backup, airgap export, delete, keyshare inspect). Proceeds silently on
 * clean or unknown devices; on compromised signals shows a warning requiring
 * explicit Continue. Returns true when the action may proceed.
 *
 * Honest scope: client-side signals only — a hooked device can lie to this
 * check. It raises the bar for casual rooted/jailbroken/emulator use; it is
 * not attestation (that needs Play Integrity / App Attest plus backend
 * verdict verification, which this app has no backend for).
 */
export async function confirmDeviceIntegrityForSensitiveAction(
  actionLabel: string,
  nativeModule: NativeIntegrityModule = BBMTLibNativeModule,
): Promise<boolean> {
  const integrity = await getDeviceIntegritySignals(nativeModule);
  if (!integrity.compromised) {
    return true;
  }
  dbg('confirmDeviceIntegrity: compromised signals', integrity.signals);
  const count = integrity.signals.length;
  return new Promise<boolean>(resolve => {
    Alert.alert(
      'Device May Be Compromised',
      `This device shows ${count} sign${count === 1 ? '' : 's'} of rooting, ` +
        `jailbreaking, or emulation. ${actionLabel} exposes wallet secrets — ` +
        'on a compromised device, other apps may be able to read them. ' +
        'Continue only if you trust this device.',
      [
        {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
        {
          text: 'Continue Anyway',
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      {cancelable: true, onDismiss: () => resolve(false)},
    );
  });
}
