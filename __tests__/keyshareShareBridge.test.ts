jest.mock('react-native', () => ({
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({remove: jest.fn()})),
  })),
  NativeModules: {
    KeyshareShareModule: {
      getInitialSharedKeyshareUri: jest.fn(),
      clearPendingSharedKeyshare: jest.fn(),
    },
  },
  Platform: {OS: 'ios'},
}));

import {NativeModules} from 'react-native';
import {
  clearPendingSharedKeyshare,
  getInitialSharedKeyshareUri,
  isKeyshareShareModuleAvailable,
  normalizeSharedKeyshareUri,
} from '../services/incomingShareBridge';

const {KeyshareShareModule} = NativeModules;

describe('keyshareShareBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects when native share module is available', () => {
    expect(isKeyshareShareModuleAvailable()).toBe(true);
  });

  it('returns pending uri from native module', async () => {
    (KeyshareShareModule.getInitialSharedKeyshareUri as jest.Mock).mockResolvedValue(
      'content://shared/key.share',
    );
    await expect(getInitialSharedKeyshareUri()).resolves.toBe(
      'content://shared/key.share',
    );
  });

  it('clears pending uri via native module', async () => {
    await clearPendingSharedKeyshare();
    expect(KeyshareShareModule.clearPendingSharedKeyshare).toHaveBeenCalled();
  });

  it('normalizes bare iOS paths to file URLs', () => {
    expect(
      normalizeSharedKeyshareUri('/private/var/mobile/pending_keyshare.share'),
    ).toBe('file:///private/var/mobile/pending_keyshare.share');
  });
});
