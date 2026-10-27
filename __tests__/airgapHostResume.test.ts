/**
 * @format
 */

import {AppState, InteractionManager, Platform} from 'react-native';
import {
  AIRGAP_HOST_SETTLE_MS,
  AIRGAP_HOST_WAIT_MS,
  AirgapHostResumeError,
  waitForAirgapHostScreen,
} from '../utils/airgapHostResume';

describe('waitForAirgapHostScreen', () => {
  const originalOS = Platform.OS;
  let appStateHandler: ((state: string) => void) | null;

  beforeEach(() => {
    jest.useFakeTimers();
    appStateHandler = null;
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      writable: true,
      value: 'background',
    });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        appStateHandler = listener as (state: string) => void;
        return {remove: jest.fn()} as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    jest
      .spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation(task => {
        if (typeof task === 'function') {
          task();
        }
        return {then: (cb: () => void) => cb(), cancel: jest.fn()} as never;
      });
  });

  afterEach(() => {
    Platform.OS = originalOS;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits for Android to become active, then settles', async () => {
    Platform.OS = 'android';
    let resolved = false;
    const pending = waitForAirgapHostScreen().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    expect(appStateHandler).toBeTruthy();

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      writable: true,
      value: 'active',
    });
    appStateHandler?.('active');
    await Promise.resolve();
    expect(resolved).toBe(false);

    jest.advanceTimersByTime(AIRGAP_HOST_SETTLE_MS);
    await pending;
    expect(resolved).toBe(true);
  });

  it('does not prompt on an already-active Android screen until the settle delay', async () => {
    Platform.OS = 'android';
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      writable: true,
      value: 'active',
    });
    let resolved = false;
    const pending = waitForAirgapHostScreen().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(appStateHandler).toBeNull();

    jest.advanceTimersByTime(AIRGAP_HOST_SETTLE_MS);
    await pending;
    expect(resolved).toBe(true);
  });

  it('waits out the iOS scanner dismiss before settling', async () => {
    Platform.OS = 'ios';
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      writable: true,
      value: 'active',
    });
    let resolved = false;
    const pending = waitForAirgapHostScreen().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(InteractionManager.runAfterInteractions).toHaveBeenCalled();
    expect(resolved).toBe(false);

    jest.advanceTimersByTime(AIRGAP_HOST_SETTLE_MS);
    await pending;
    expect(resolved).toBe(true);
  });

  it('rejects when the host screen never becomes active', async () => {
    Platform.OS = 'android';
    const pending = waitForAirgapHostScreen();
    jest.advanceTimersByTime(AIRGAP_HOST_WAIT_MS);
    await expect(pending).rejects.toBeInstanceOf(AirgapHostResumeError);
  });
});
