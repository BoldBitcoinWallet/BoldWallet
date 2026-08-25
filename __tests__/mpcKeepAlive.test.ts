/**
 * @format
 */

import fs from 'fs';
import path from 'path';
import {AppState, NativeModules, PermissionsAndroid, Platform} from 'react-native';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {
  getMpcKeepAliveBatteryCopy,
  getMpcKeepAliveCheckboxLabel,
  getMpcKeepAliveCompleteCopy,
  getMpcKeepAliveIosReturnCopy,
  getMpcKeepAliveKeygenSubtitle,
  getMpcKeepAliveNotificationTitle,
  getMpcKeepAliveNotificationsOffLine,
  getMpcKeepAlivePrepareModalSubtitle,
  getMpcKeepAliveSetupHint,
  getWalletSetupKeygenModalCopy,
  WALLET_SETUP_PREP_CARD,
} from '../services/walletSetupUi';
import {
  dismissMpcBatteryPrompt,
  getMpcKeepAliveUiState,
  isMpcKeepAliveActive,
  MPC_BATTERY_EXEMPT_DONT_ASK_KEY,
  publicKeepAliveStatus,
  resetMpcKeepAliveForTests,
  resolveMpcKeepAliveBranding,
  startMpcKeepAlive,
  stopMpcKeepAlive,
  updateMpcKeepAlive,
  withMpcKeepAlive,
} from '../services/mpcKeepAlive';

jest.mock('../services/repositories/AppConfigRepository', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      get: jest.fn((key: string) => store.get(key) ?? null),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      __store: store,
    },
    CONFIG_KEYS: {
      APP_ICON_PREFERENCE: 'app_icon_preference',
      MPC_BATTERY_EXEMPT_DONT_ASK: 'mpc_battery_exempt_dont_ask',
    },
  };
});

const mockStart = jest.fn(() => Promise.resolve(true));
const mockUpdate = jest.fn(() => Promise.resolve(true));
const mockStop = jest.fn(() => Promise.resolve(true));
const mockWarnBackgrounded = jest.fn(() => Promise.resolve(true));
const mockIsIgnoringBattery = jest.fn(() => Promise.resolve(true));
const mockRequestBattery = jest.fn(() => Promise.resolve(true));

describe('walletSetupUi keep-alive copy', () => {
  it('uses distinct Android vs iOS setup hints', () => {
    expect(getMpcKeepAliveSetupHint('android')).toMatch(/notification/i);
    expect(getMpcKeepAliveSetupHint('android')).toMatch(/swipe/i);
    expect(getMpcKeepAliveSetupHint('ios')).toMatch(/Locking the phone/i);
    expect(getMpcKeepAliveSetupHint('ios')).toMatch(/switching apps/i);
  });

  it('replaces the Android switch-apps hint when notifications are denied', () => {
    expect(
      getMpcKeepAliveSetupHint('android', {notificationsGranted: false}),
    ).toBe(getMpcKeepAliveNotificationsOffLine());
    expect(
      getMpcKeepAliveSetupHint('android', {notificationsGranted: true}),
    ).toMatch(/notification/i);
    expect(getMpcKeepAliveIosReturnCopy().title).toBe('Return to Bold');
    expect(getMpcKeepAliveBatteryCopy().allow).toBe('Allow');
  });

  it('does not tell the user they must never leave on Android', () => {
    expect(getMpcKeepAliveSetupHint('android')).not.toMatch(/do not leave/i);
    expect(getMpcKeepAliveCheckboxLabel('android')).toMatch(/swipe/i);
    expect(getMpcKeepAliveCheckboxLabel('ios')).toMatch(/on screen/i);
  });

  it('builds prepare and keygen subtitles from the platform hint', () => {
    expect(getMpcKeepAlivePrepareModalSubtitle('ios')).toContain(
      'Could take a while',
    );
    expect(getMpcKeepAliveKeygenSubtitle('android')).toContain(
      'notification',
    );
    expect(getWalletSetupKeygenModalCopy('ios').subtitle).toContain(
      'Locking the phone',
    );
  });

  it('keeps prep card transport-first without keep-open nag', () => {
    expect(WALLET_SETUP_PREP_CARD.description).toBe(
      'Wallet setup uses your local network.',
    );
    expect(WALLET_SETUP_PREP_CARD.description).not.toMatch(/keep the app open/i);
  });

  it('hides wallet wording in camouflage notification titles', () => {
    expect(
      getMpcKeepAliveNotificationTitle('keygen', 'QuickCalc', true),
    ).toBe('QuickCalc');
    expect(
      getMpcKeepAliveNotificationTitle('sign', 'Bold Wallet', false),
    ).toBe('Co-signing');
    expect(
      getMpcKeepAliveCompleteCopy('keygen', 'abort', false),
    ).toBeNull();
    expect(
      getMpcKeepAliveCompleteCopy('sign', 'success', true)?.title,
    ).toBe('Finished');
    expect(
      getMpcKeepAliveCompleteCopy('keygen', 'failure', false)?.title,
    ).toBe('Setup interrupted');
  });

  it('enables Live Activities in the iOS app Info.plist', () => {
    const plist = fs.readFileSync(
      path.join(__dirname, '../ios/BoldWallet/Info.plist'),
      'utf8',
    );
    expect(plist).toContain('NSSupportsLiveActivities');
    const widgetPlist = fs.readFileSync(
      path.join(__dirname, '../ios/MpcKeepAliveWidget/Info.plist'),
      'utf8',
    );
    expect(widgetPlist).toContain('com.apple.widgetkit-extension');
  });
});

describe('mpcKeepAlive', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  beforeEach(() => {
    resetMpcKeepAliveForTests();
    mockStart.mockClear();
    mockUpdate.mockClear();
    mockStop.mockClear();
    mockWarnBackgrounded.mockClear();
    mockIsIgnoringBattery.mockClear();
    mockRequestBattery.mockClear();
    mockIsIgnoringBattery.mockResolvedValue(true);
    NativeModules.MpcKeepAliveModule = {
      start: mockStart,
      update: mockUpdate,
      stop: mockStop,
      warnBackgrounded: mockWarnBackgrounded,
      isIgnoringBatteryOptimizations: mockIsIgnoringBattery,
      requestIgnoreBatteryOptimizations: mockRequestBattery,
    };
    (
      appConfigRepository as unknown as {__store: Map<string, string>}
    ).__store.clear();
    Object.defineProperty(Platform, 'OS', {configurable: true, value: 'ios'});
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalOS,
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: originalVersion,
    });
    jest.restoreAllMocks();
    resetMpcKeepAliveForTests();
  });

  it('resolves default branding on iOS even if camouflage is stored', async () => {
    appConfigRepository.set(CONFIG_KEYS.APP_ICON_PREFERENCE, 'quickcalc');
    await expect(resolveMpcKeepAliveBranding()).resolves.toEqual({
      appLabel: 'Bold Wallet',
      camouflaged: false,
    });
  });

  it('uses camouflage launcher label on Android', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    appConfigRepository.set(CONFIG_KEYS.APP_ICON_PREFERENCE, 'notes');
    await expect(resolveMpcKeepAliveBranding()).resolves.toEqual({
      appLabel: 'Notes',
      camouflaged: true,
    });
  });

  it('generic status when camouflaged includes percent', () => {
    expect(publicKeepAliveStatus('Creating your wallet…', 40, true)).toBe(
      'Working… 40%',
    );
    expect(publicKeepAliveStatus('Creating your wallet…', 40, false)).toBe(
      'Creating your wallet…',
    );
  });

  it('starts native keep-alive and stops with complete copy', async () => {
    await startMpcKeepAlive({kind: 'keygen', transport: 'lan'});
    expect(isMpcKeepAliveActive()).toBe(true);
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'keygen',
        transport: 'lan',
        camouflaged: false,
        title: 'Wallet setup',
      }),
    );
    await stopMpcKeepAlive('success');
    expect(isMpcKeepAliveActive()).toBe(false);
    expect(mockStop).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        title: 'Wallet ready',
      }),
    );
  });

  it('ignores updates after stop', async () => {
    await startMpcKeepAlive({kind: 'sign', transport: 'nostr'});
    await stopMpcKeepAlive('abort');
    updateMpcKeepAlive({percent: 50, status: 'Co-signing…'});
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalledWith(
      expect.objectContaining({outcome: 'abort', title: '', body: ''}),
    );
  });

  it('withMpcKeepAlive stops success or failure', async () => {
    await expect(
      withMpcKeepAlive({kind: 'prepare', transport: 'lan'}, async () => 1),
    ).resolves.toBe(1);
    expect(mockStop).toHaveBeenCalledWith(
      expect.objectContaining({outcome: 'success', title: 'Device ready'}),
    );
    mockStop.mockClear();
    await expect(
      withMpcKeepAlive({kind: 'prepare', transport: 'lan'}, async () => {
        throw new Error('prep failed');
      }),
    ).rejects.toThrow('prep failed');
    expect(mockStop).toHaveBeenCalledWith(
      expect.objectContaining({outcome: 'failure'}),
    );
  });

  it('skips the Android 13+ notification prompt below API 33', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 32,
    });
    const request = jest.spyOn(PermissionsAndroid, 'request');
    const result = await startMpcKeepAlive({kind: 'prepare', transport: 'lan'});
    expect(request).not.toHaveBeenCalled();
    expect(result.notificationsGranted).toBe(true);
  });

  it('returns notificationsGranted false when Android 13+ permission is denied', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 34,
    });
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    const result = await startMpcKeepAlive({kind: 'keygen', transport: 'lan'});
    expect(result.notificationsGranted).toBe(false);
    expect(getMpcKeepAliveUiState().notificationsGranted).toBe(false);
  });

  it('warns once on iOS AppState background, not inactive', async () => {
    let listener: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_ev, cb) => {
      listener = cb as (state: string) => void;
      return {remove: jest.fn()} as ReturnType<typeof AppState.addEventListener>;
    });
    await startMpcKeepAlive({kind: 'keygen', transport: 'lan'});
    listener?.('inactive');
    expect(mockWarnBackgrounded).not.toHaveBeenCalled();
    listener?.('background');
    expect(mockWarnBackgrounded).toHaveBeenCalledTimes(1);
    listener?.('background');
    expect(mockWarnBackgrounded).toHaveBeenCalledTimes(1);
  });

  it('does not warn on Android AppState background', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 32,
    });
    let listener: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_ev, cb) => {
      listener = cb as (state: string) => void;
      return {remove: jest.fn()} as ReturnType<typeof AppState.addEventListener>;
    });
    await startMpcKeepAlive({kind: 'sign', transport: 'nostr'});
    listener?.('background');
    expect(mockWarnBackgrounded).not.toHaveBeenCalled();
  });

  it('shows the Android battery prompt when not exempt and not camouflaged', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 32,
    });
    mockIsIgnoringBattery.mockResolvedValue(false);
    await startMpcKeepAlive({kind: 'sign', transport: 'lan'});
    expect(getMpcKeepAliveUiState().showBatteryPrompt).toBe(true);
  });

  it('skips the battery prompt when camouflaged', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 32,
    });
    mockIsIgnoringBattery.mockResolvedValue(false);
    appConfigRepository.set(CONFIG_KEYS.APP_ICON_PREFERENCE, 'notes');
    await startMpcKeepAlive({kind: 'keygen', transport: 'lan'});
    expect(getMpcKeepAliveUiState().camouflaged).toBe(true);
    expect(getMpcKeepAliveUiState().showBatteryPrompt).toBe(false);
  });

  it('persists don’t-ask when the battery prompt is dismissed', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 32,
    });
    mockIsIgnoringBattery.mockResolvedValue(false);
    await startMpcKeepAlive({kind: 'sign', transport: 'lan'});
    expect(getMpcKeepAliveUiState().showBatteryPrompt).toBe(true);
    await dismissMpcBatteryPrompt();
    expect(appConfigRepository.set).toHaveBeenCalledWith(
      MPC_BATTERY_EXEMPT_DONT_ASK_KEY,
      '1',
    );
    expect(getMpcKeepAliveUiState().showBatteryPrompt).toBe(false);

    await stopMpcKeepAlive('abort');
    resetMpcKeepAliveForTests();
    NativeModules.MpcKeepAliveModule = {
      start: mockStart,
      update: mockUpdate,
      stop: mockStop,
      warnBackgrounded: mockWarnBackgrounded,
      isIgnoringBatteryOptimizations: mockIsIgnoringBattery,
      requestIgnoreBatteryOptimizations: mockRequestBattery,
    };
    await startMpcKeepAlive({kind: 'sign', transport: 'lan'});
    expect(getMpcKeepAliveUiState().showBatteryPrompt).toBe(false);
  });
});
