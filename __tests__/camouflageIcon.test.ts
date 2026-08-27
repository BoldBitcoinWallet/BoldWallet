/**
 * @format
 */

import {NativeModules, Platform} from 'react-native';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {
  APP_ICON_PREFERENCE_KEY,
  getLauncherCamouflagePreset,
  resetLauncherCamouflageToDefault,
  setLauncherCamouflagePreset,
} from '../services/camouflageIcon';

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
    CONFIG_KEYS: {APP_ICON_PREFERENCE: 'app_icon_preference'},
  };
});

const originalOS = Platform.OS;

function configStore(): Map<string, string> {
  return (appConfigRepository as unknown as {__store: Map<string, string>})
    .__store;
}

describe('camouflageIcon', () => {
  const getCurrentIcon = jest.fn();
  const changeIcon = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    configStore().clear();
    NativeModules.IconChanger = {getCurrentIcon, changeIcon};
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalOS,
    });
    delete NativeModules.IconChanger;
  });

  it('ignores native state on iOS', async () => {
    Object.defineProperty(Platform, 'OS', {configurable: true, value: 'ios'});
    configStore().set(CONFIG_KEYS.APP_ICON_PREFERENCE, 'quickcalc');
    await expect(getLauncherCamouflagePreset()).resolves.toBe('quickcalc');
    expect(getCurrentIcon).not.toHaveBeenCalled();
  });

  it('prefers the enabled launcher alias over app_config', async () => {
    getCurrentIcon.mockResolvedValue('quickcalc');
    configStore().set(CONFIG_KEYS.APP_ICON_PREFERENCE, 'default');
    await expect(getLauncherCamouflagePreset()).resolves.toBe('quickcalc');
    expect(appConfigRepository.set).toHaveBeenCalledWith(
      APP_ICON_PREFERENCE_KEY,
      'quickcalc',
    );
  });

  it('maps legacy native alternative onto quickcalc', async () => {
    getCurrentIcon.mockResolvedValue('alternative');
    await expect(getLauncherCamouflagePreset()).resolves.toBe('quickcalc');
  });

  it('falls back to app_config when native is missing', async () => {
    delete NativeModules.IconChanger;
    configStore().set(CONFIG_KEYS.APP_ICON_PREFERENCE, 'notes');
    await expect(getLauncherCamouflagePreset()).resolves.toBe('notes');
  });

  it('writes app_config then asks native to change the alias', async () => {
    changeIcon.mockResolvedValue('ok');
    await setLauncherCamouflagePreset('files');
    expect(appConfigRepository.set).toHaveBeenCalledWith(
      APP_ICON_PREFERENCE_KEY,
      'files',
    );
    expect(changeIcon).toHaveBeenCalledWith('files');
  });

  it('resets the launcher to Bold Wallet', async () => {
    changeIcon.mockResolvedValue('ok');
    await resetLauncherCamouflageToDefault();
    expect(changeIcon).toHaveBeenCalledWith('default');
    expect(appConfigRepository.set).toHaveBeenCalledWith(
      APP_ICON_PREFERENCE_KEY,
      'default',
    );
  });
});
