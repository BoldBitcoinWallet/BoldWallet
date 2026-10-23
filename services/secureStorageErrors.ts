/**
 * F3/F4: maps native secure-storage failures (Android Keystore/ESP, iOS
 * Keychain) to user-facing copy. Native layers tag these errors with a
 * stable `[SECURE_STORAGE_<KIND>]` token in the code or message.
 */
import {Alert} from 'react-native';
export type SecureStorageKind =
  | 'INVALIDATED'
  | 'LOCKED'
  | 'CORRUPTED'
  | 'UNAVAILABLE';

const KIND_RE = /\[SECURE_STORAGE_(INVALIDATED|LOCKED|CORRUPTED|UNAVAILABLE)\]/;

function textOf(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybe = error as {code?: unknown; message?: unknown};
    return `${String(maybe.code ?? '')} ${String(maybe.message ?? '')}`;
  }
  return '';
}

export function secureStorageKindOf(error: unknown): SecureStorageKind | null {
  const match = KIND_RE.exec(textOf(error));
  return match ? (match[1] as SecureStorageKind) : null;
}

/** User-facing message, or null when the error is not storage-related. */
export function secureStorageMessageFor(error: unknown): string | null {
  switch (secureStorageKindOf(error)) {
    case 'INVALIDATED':
      return (
        'Secure storage was reset (your device lock or biometrics changed). ' +
        'Your keyshare was not saved or read. Please re-import your keyshare backup.'
      );
    case 'LOCKED':
      return (
        'Your device must be unlocked to access the keyshare. ' +
        'Unlock and try again — nothing was saved or read.'
      );
    case 'CORRUPTED':
      return (
        'Secure storage on this device is corrupted. ' +
        'Your keyshare was not saved or read. Please re-import your keyshare backup.'
      );
    case 'UNAVAILABLE':
      return (
        'Secure storage is unavailable — the device must have a screen lock ' +
        'enabled and be unlocked. Your keyshare was not saved or read.'
      );
    default:
      return null;
  }
}

/**
 * Shows the user-facing alert when the error is storage-related.
 * Returns true when handled (caller should treat the op as failed-safe).
 */
export function alertSecureStorageError(error: unknown): boolean {
  const message = secureStorageMessageFor(error);
  if (message === null) {
    return false;
  }
  Alert.alert('Secure Storage Unavailable', message);
  return true;
}
