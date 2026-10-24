jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    backupEncryptStoredKeyshare: jest.fn(),
    requestExportCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
    sha256: jest.fn(async (s: string) => `sha256(${s})`),
  },
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackend: jest.fn(),
  resolveTssBackendForKeygen: jest.fn(),
  detectKeyshareTssBackend: jest.fn(),
}));

jest.mock('../services/mpcCancel', () => ({
  markMpcInProgress: jest.fn(),
  resetMpcCancelState: jest.fn(),
  safeCancelMpc: jest.fn(),
}));

// TssProvider -> ceremonyAuth -> utils (op-sqlite); stub the logger.
jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {TssProvider} from '../services/TssProvider';

const native = BBMTLibNativeModule as any;

beforeEach(() => {
  jest.clearAllMocks();
  native.requestExportCeremonyToken.mockResolvedValue('tok-exp-1');
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
  native.backupEncryptStoredKeyshare.mockResolvedValue('BW2$blob');
});

describe('3b-3 A12 export token gating (F10-bridge)', () => {
  test('export mints an export ceremony and passes the token', async () => {
    const out = await TssProvider.backupEncryptStoredKeyshare('pw-1');
    expect(out).toBe('BW2$blob');
    expect(native.requestExportCeremonyToken).toHaveBeenCalledTimes(1);
    expect(native.backupEncryptStoredKeyshare).toHaveBeenCalledWith(
      'pw-1',
      'tok-exp-1',
    );
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-exp-1');
  });

  test('export failure releases the minted token', async () => {
    native.backupEncryptStoredKeyshare.mockRejectedValueOnce(
      new Error('no keyshare'),
    );
    await expect(
      TssProvider.backupEncryptStoredKeyshare('pw-1'),
    ).rejects.toThrow('no keyshare');
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-exp-1');
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
  });

  test('owner-provided token passes through with no lifecycle', async () => {
    await TssProvider.backupEncryptStoredKeyshare('pw-1', 'tok-owner-exp');
    expect(native.requestExportCeremonyToken).not.toHaveBeenCalled();
    expect(native.backupEncryptStoredKeyshare).toHaveBeenCalledWith(
      'pw-1',
      'tok-owner-exp',
    );
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('mint failure never reaches the encrypt call', async () => {
    native.requestExportCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    await expect(TssProvider.backupEncryptStoredKeyshare('pw-1')).rejects.toThrow();
    expect(native.backupEncryptStoredKeyshare).not.toHaveBeenCalled();
  });
});
