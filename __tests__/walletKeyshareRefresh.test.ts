/**
 * @format
 */

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));

jest.mock('react-native', () => ({
  DeviceEventEmitter: {
    emit: jest.fn(),
    addListener: jest.fn(() => ({remove: jest.fn()})),
  },
  NativeModules: {},
  Platform: {OS: 'ios'},
}));

jest.mock('react-native-encrypted-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {set: jest.fn()},
  CONFIG_KEYS: {KEYSHARE_META_JSON: 'keyshare_meta_json'},
}));

jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));

import {DeviceEventEmitter} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import {saveKeyshareMetadata} from '../utils';

describe('wallet:keyshare-ready', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saveKeyshareMetadata emits wallet:keyshare-ready after persisting mirror', async () => {
    const keyshare = JSON.stringify({
      pub_key: '02' + 'ab'.repeat(32),
      chain_code_hex: 'cd'.repeat(32),
      local_party_key: '1',
      keygen_committee_keys: ['1', '2'],
      share_b64: 'secret-not-in-meta',
    });

    await saveKeyshareMetadata(keyshare);

    expect(EncryptedStorage.setItem).toHaveBeenCalledWith(
      'keyshare_meta',
      expect.any(String),
    );
    expect(DeviceEventEmitter.emit).toHaveBeenCalledWith(
      'wallet:keyshare-ready',
    );
  });
});
