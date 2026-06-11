import {NativeEventEmitter, NativeModules} from 'react-native';

export const INCOMING_URL_EVENT = 'incomingUrl';

const {IncomingUrlModule} = NativeModules;

export function isIncomingUrlModuleAvailable(): boolean {
  return (
    IncomingUrlModule != null &&
    typeof IncomingUrlModule.getInitialIncomingUrl === 'function'
  );
}

export async function getInitialIncomingUrl(): Promise<string | null> {
  if (!isIncomingUrlModuleAvailable()) {
    return null;
  }
  try {
    const url = await IncomingUrlModule.getInitialIncomingUrl();
    return url && String(url).trim() ? String(url) : null;
  } catch {
    return null;
  }
}

export async function clearPendingIncomingUrl(): Promise<void> {
  if (!isIncomingUrlModuleAvailable()) {
    return;
  }
  try {
    await IncomingUrlModule.clearPendingIncomingUrl();
  } catch {
    // Non-fatal
  }
}

export function subscribeToIncomingUrls(
  listener: (url: string) => void,
): () => void {
  if (!isIncomingUrlModuleAvailable()) {
    return () => {};
  }
  const emitter = new NativeEventEmitter(IncomingUrlModule);
  const subscription = emitter.addListener(INCOMING_URL_EVENT, (url: string) => {
    if (url && String(url).trim()) {
      listener(String(url));
    }
  });
  return () => subscription.remove();
}
