jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    importBackupToStagedHandle: jest.fn(),
    persistStoredKeyshare: jest.fn(),
    requestImportCeremonyToken: jest.fn(),
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

const STAGED_RAW = JSON.stringify({
  handle: 'staged-imp-1',
  metadata: {pub_key: 'aa', tss_backend: 'dkls23'},
});

beforeEach(() => {
  jest.clearAllMocks();
  native.requestImportCeremonyToken.mockResolvedValue('tok-imp-1');
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
  native.importBackupToStagedHandle.mockResolvedValue(STAGED_RAW);
  native.persistStoredKeyshare.mockResolvedValue('{"pub_key":"aa"}');
});

describe('3b-2e import token gating (F15b-2 / F10-bridge B17-B18)', () => {
  test('stage mints an import ceremony and passes token+session', async () => {
    const out = await TssProvider.importBackupToStagedHandle('blob', 'pw');
    expect(out).toBe(STAGED_RAW);
    expect(native.requestImportCeremonyToken).toHaveBeenCalledTimes(1);
    const session = native.requestImportCeremonyToken.mock.calls[0][0];
    expect(native.importBackupToStagedHandle).toHaveBeenCalledWith(
      'blob',
      'pw',
      'tok-imp-1',
      session,
    );
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-imp-1');
  });

  test('stage failure releases the minted token', async () => {
    native.importBackupToStagedHandle.mockRejectedValueOnce(
      new Error('backup authentication failed'),
    );
    await expect(
      TssProvider.importBackupToStagedHandle('blob', 'wrong'),
    ).rejects.toThrow('backup authentication failed');
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-imp-1');
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
  });

  test('stage owner pair passes through with no lifecycle', async () => {
    await TssProvider.importBackupToStagedHandle(
      'blob',
      'pw',
      'tok-owner',
      'sess-owner',
    );
    expect(native.requestImportCeremonyToken).not.toHaveBeenCalled();
    expect(native.importBackupToStagedHandle).toHaveBeenCalledWith(
      'blob',
      'pw',
      'tok-owner',
      'sess-owner',
    );
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('stage half pair throws (both-or-neither)', async () => {
    await expect(
      TssProvider.importBackupToStagedHandle('blob', 'pw', 'tok-only'),
    ).rejects.toThrow('both-or-neither');
    expect(native.importBackupToStagedHandle).not.toHaveBeenCalled();
    expect(native.requestImportCeremonyToken).not.toHaveBeenCalled();
  });

  test('persist mints an import ceremony and passes token+session', async () => {
    const out = await TssProvider.persistStoredKeyshare('h1', 'nsec', 'npub');
    expect(out).toBe('{"pub_key":"aa"}');
    expect(native.requestImportCeremonyToken).toHaveBeenCalledTimes(1);
    const session = native.requestImportCeremonyToken.mock.calls[0][0];
    expect(native.persistStoredKeyshare).toHaveBeenCalledWith(
      'h1',
      'nsec',
      'npub',
      'tok-imp-1',
      session,
    );
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-imp-1');
  });

  test('persist owner pair passes through with no lifecycle', async () => {
    await TssProvider.persistStoredKeyshare(
      'h1',
      '',
      '',
      'tok-owner',
      'sess-owner',
    );
    expect(native.requestImportCeremonyToken).not.toHaveBeenCalled();
    expect(native.persistStoredKeyshare).toHaveBeenCalledWith(
      'h1',
      '',
      '',
      'tok-owner',
      'sess-owner',
    );
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('persist half pair throws (both-or-neither)', async () => {
    await expect(
      TssProvider.persistStoredKeyshare('h1', '', '', undefined, 'sess-only'),
    ).rejects.toThrow('both-or-neither');
    expect(native.persistStoredKeyshare).not.toHaveBeenCalled();
  });

  test('persist failure releases the minted token', async () => {
    native.persistStoredKeyshare.mockRejectedValueOnce(new Error('nope'));
    await expect(TssProvider.persistStoredKeyshare('h1', '', '')).rejects.toThrow(
      'nope',
    );
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-imp-1');
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
  });
});
