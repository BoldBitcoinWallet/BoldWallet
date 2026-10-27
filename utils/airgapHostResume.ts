import {
  AppState,
  InteractionManager,
  Platform,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

/** Pause after the welcome screen is active so a modal or capture activity can finish. */
export const AIRGAP_HOST_SETTLE_MS = 500;

/** Read current AppState without letting TS narrow across async gaps. */
function readAppState(): AppStateStatus {
  return AppState.currentState;
}

/**
 * How long to wait, once JS timers are running, for the host screen to become
 * active. While Android's capture activity is in front, timers are frozen, so
 * this starts when MainActivity resumes.
 */
export const AIRGAP_HOST_WAIT_MS = 15_000;

export class AirgapHostResumeError extends Error {
  constructor() {
    super('The import screen did not come back. Scan the QR again.');
    this.name = 'AirgapHostResumeError';
  }
}

/**
 * Resolves after the host screen can present an OS auth prompt.
 *
 * Android posts the airgap scan while MainActivity is paused behind the
 * camera activity. BiometricPrompt on that transition neither shows nor
 * calls back. Wait until the app is active, then a short settle.
 * iOS keeps AppState active under the scanner modal, so wait for the
 * dismiss interaction and the same settle.
 */
export function waitForAirgapHostScreen(
  settleMs: number = AIRGAP_HOST_SETTLE_MS,
  waitMs: number = AIRGAP_HOST_WAIT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sub: NativeEventSubscription | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;

    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      sub?.remove();
      if (giveUp) {
        clearTimeout(giveUp);
      }
      if (err) {
        reject(err);
        return;
      }
      setTimeout(resolve, settleMs);
    };

    const arm = () => finish();

    giveUp = setTimeout(() => {
      finish(new AirgapHostResumeError());
    }, waitMs);

    if (Platform.OS === 'ios') {
      InteractionManager.runAfterInteractions(arm);
      return;
    }

    if (readAppState() === 'active') {
      arm();
      return;
    }

    sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        arm();
      }
    });
    if (readAppState() === 'active') {
      arm();
    }
  });
}
