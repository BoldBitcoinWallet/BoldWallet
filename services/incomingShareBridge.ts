import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {INCOMING_SHARED_FILE_EVENT} from '../types/incomingShare';

const {KeyshareShareModule, IncomingShareModule} = NativeModules;
const nativeModule = IncomingShareModule ?? KeyshareShareModule;

export function isIncomingShareModuleAvailable(): boolean {
  return (
    nativeModule != null &&
    typeof nativeModule.getInitialSharedKeyshareUri === 'function'
  );
}

export async function getInitialSharedFileUri(): Promise<string | null> {
  if (!isIncomingShareModuleAvailable()) {
    return null;
  }
  try {
    const uri = await nativeModule.getInitialSharedKeyshareUri();
    return uri && String(uri).trim() ? String(uri) : null;
  } catch {
    return null;
  }
}

export async function clearPendingSharedFile(): Promise<void> {
  if (!isIncomingShareModuleAvailable()) {
    return;
  }
  try {
    await nativeModule.clearPendingSharedKeyshare();
  } catch {
    // Non-fatal
  }
}

export function subscribeToSharedFiles(listener: (uri: string) => void): () => void {
  if (!isIncomingShareModuleAvailable()) {
    return () => {};
  }
  const emitter = new NativeEventEmitter(nativeModule);
  const subscription = emitter.addListener(
    INCOMING_SHARED_FILE_EVENT,
    (uri: string) => {
      if (uri && String(uri).trim()) {
        listener(String(uri));
      }
    },
  );
  return () => subscription.remove();
}

export function normalizeSharedFileUri(uri: string): string {
  const trimmed = String(uri).trim();
  if (
    Platform.OS === 'ios' &&
    trimmed.startsWith('/') &&
    !trimmed.startsWith('file://')
  ) {
    return `file://${trimmed}`;
  }
  return trimmed;
}

// Backward-compatible aliases
export const getInitialSharedKeyshareUri = getInitialSharedFileUri;
export const clearPendingSharedKeyshare = clearPendingSharedFile;
export const subscribeToSharedKeyshareFiles = subscribeToSharedFiles;
export const normalizeSharedKeyshareUri = normalizeSharedFileUri;
export const isKeyshareShareModuleAvailable = isIncomingShareModuleAvailable;
