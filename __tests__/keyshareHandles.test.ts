jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {destroyKeyshareHandles: jest.fn(async () => true)},
}));

import {BBMTLibNativeModule} from '../native_modules';
import {discardPendingKeyshares} from '../services/keyshareHandles';

const native = BBMTLibNativeModule as any;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('F15b-1 staged-handle discard (A10)', () => {
  test('wipes staged entries via the native destroy method', async () => {
    await discardPendingKeyshares();
    expect(native.destroyKeyshareHandles).toHaveBeenCalledTimes(1);
  });

  test('never throws on native failure', async () => {
    native.destroyKeyshareHandles.mockRejectedValueOnce(new Error('down'));
    await expect(discardPendingKeyshares()).resolves.toBeUndefined();
  });
});
