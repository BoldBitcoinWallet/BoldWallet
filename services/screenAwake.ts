import {NativeModules} from 'react-native';

type ScreenAwakeNative = {
  isScreenAwake?: () => Promise<boolean>;
  setScreenAwake?: (on: boolean) => Promise<boolean>;
};

/**
 * Keep the screen on until the returned function runs, then restore the
 * flag this call observed. Does not start the MPC keep-alive service.
 */
export async function holdScreenAwake(): Promise<() => void> {
  const mod = NativeModules.MpcKeepAliveModule as ScreenAwakeNative | undefined;
  if (!mod || typeof mod.setScreenAwake !== 'function') {
    return () => undefined;
  }
  let previous = false;
  try {
    if (typeof mod.isScreenAwake === 'function') {
      previous = Boolean(await mod.isScreenAwake());
    }
  } catch {
    previous = false;
  }
  try {
    await mod.setScreenAwake(true);
  } catch {
    return () => undefined;
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    mod.setScreenAwake?.(previous)?.catch(() => undefined);
  };
}
