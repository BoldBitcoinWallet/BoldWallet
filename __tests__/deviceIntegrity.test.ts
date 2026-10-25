import {Alert} from 'react-native';

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));
jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {},
}));
jest.mock('../services/tssBackend', () => ({
  detectKeyshareTssBackend: jest.fn(),
}));

import {
  confirmDeviceIntegrityForSensitiveAction,
  getDeviceIntegritySignals,
} from '../services/deviceIntegrity';

describe('deviceIntegrity (F36)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((..._args: any[]) => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('reports compromised signals from the native layer', async () => {
    const fake = {
      getDeviceIntegritySignals: jest.fn().mockResolvedValue(
        JSON.stringify({
          compromised: true,
          signals: ['android-su-binary-present'],
        }),
      ),
    };
    await expect(getDeviceIntegritySignals(fake)).resolves.toEqual({
      compromised: true,
      signals: ['android-su-binary-present'],
      unknown: false,
    });
  });

  it('fails open as unknown when the native method is missing', async () => {
    await expect(getDeviceIntegritySignals({} as any)).resolves.toEqual({
      compromised: false,
      signals: [],
      unknown: true,
    });
  });

  it('fails open as unknown when the native layer rejects', async () => {
    const fake = {
      getDeviceIntegritySignals: jest
        .fn()
        .mockRejectedValue(new Error('bridge down')),
    };
    await expect(getDeviceIntegritySignals(fake)).resolves.toEqual({
      compromised: false,
      signals: [],
      unknown: true,
    });
  });

  it('fails open as unknown on malformed native payloads', async () => {
    const fake = {
      getDeviceIntegritySignals: jest.fn().mockResolvedValue('not-json{{{'),
    };
    await expect(getDeviceIntegritySignals(fake)).resolves.toEqual({
      compromised: false,
      signals: [],
      unknown: true,
    });
  });

  it('proceeds without a dialog on a clean device', async () => {
    const fake = {
      getDeviceIntegritySignals: jest.fn().mockResolvedValue(
        JSON.stringify({compromised: false, signals: []}),
      ),
    };
    await expect(
      confirmDeviceIntegrityForSensitiveAction('test action', fake),
    ).resolves.toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('proceeds without a dialog when detection is unavailable', async () => {
    await expect(
      confirmDeviceIntegrityForSensitiveAction('test action', {} as any),
    ).resolves.toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('blocks when the user cancels the compromise warning', async () => {
    const fake = {
      getDeviceIntegritySignals: jest.fn().mockResolvedValue(
        JSON.stringify({compromised: true, signals: ['ios-sandbox-escape']}),
      ),
    };
    alertSpy.mockImplementation(
      (
        _title: string,
        _message: string,
        buttons?: Array<{onPress?: () => void}>,
      ) => {
        buttons?.[0]?.onPress?.();
      },
    );
    await expect(
      confirmDeviceIntegrityForSensitiveAction('test action', fake),
    ).resolves.toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('proceeds when the user explicitly continues past the warning', async () => {
    const fake = {
      getDeviceIntegritySignals: jest.fn().mockResolvedValue(
        JSON.stringify({compromised: true, signals: ['android-emulator-build']}),
      ),
    };
    alertSpy.mockImplementation(
      (
        _title: string,
        _message: string,
        buttons?: Array<{onPress?: () => void}>,
      ) => {
        buttons?.[1]?.onPress?.();
      },
    );
    await expect(
      confirmDeviceIntegrityForSensitiveAction('test action', fake),
    ).resolves.toBe(true);
  });
});
