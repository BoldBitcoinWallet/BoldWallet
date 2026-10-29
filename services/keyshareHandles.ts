import {BBMTLibNativeModule} from '../native_modules';

/**
 * F15b-1: best-effort wipe of Go-staged keyshares. Called on abort,
 * delete, new-run reset, and anywhere a pending staged handle is
 * dropped without persist. Never throws — teardown must not fail UX.
 */
export async function discardPendingKeyshares(): Promise<void> {
  try {
    const fn = BBMTLibNativeModule?.destroyKeyshareHandles;
    if (typeof fn === 'function') {
      await fn();
    }
  } catch {
    /* staged entries also die on next Stage / process death */
  }
}
