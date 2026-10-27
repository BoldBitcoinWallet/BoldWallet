import {Buffer} from 'buffer';
(global as any).Buffer = (global as any).Buffer || Buffer;

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {show: jest.fn(), hide: jest.fn()},
}));
jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: jest.fn((payload: unknown) => payload),
  },
}));
jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  copyFile: jest.fn(),
  readFile: jest.fn(),
}));
jest.mock('../services/rnfsSafe', () => ({
  safeUnlink: jest.fn(),
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));
jest.mock('../services/walletSessionReset', () => ({
  clearCachesBeforeWalletSession: jest.fn(async () => {}),
}));
jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    sha256: jest.fn(),
    hasKeyshareInSecureStorage: jest.fn(),
    // 3b-2e: import-flow owner ceremony (real ceremonyAuth).
    requestImportCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
  },
}));
// 3b-2e: stage routes via TssProvider (token plumbing pinned in
// tssImportTokenGating; this suite pins mapping + owner flow).
jest.mock('../services/TssProvider', () => ({
  TssProvider: {importBackupToStagedHandle: jest.fn()},
}));
jest.mock('../services/walletSetupOrchestrator', () => ({
  persistStagedKeyshare: jest.fn(),
}));
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
  CONFIG_KEYS: {
    CURRENT_ADDRESS: 'current_address',
    LEGACY_WALLET_DO_NOT_REMIND: 'legacy_wallet_do_not_remind',
  },
}));

import {Alert} from 'react-native';
import RNFS from 'react-native-fs';
import {BBMTLibNativeModule} from '../native_modules';
import {
  decryptAndValidateKeyshare,
  finalizeKeyshareImport,
  importKeyshareFromBase64,
  InvalidKeyshareError,
  readBackupBlobFromUri,
  WrongKeysharePasswordError,
} from '../services/keyshareImport';
import {TssProvider} from '../services/TssProvider';
import {persistStagedKeyshare} from '../services/walletSetupOrchestrator';
import {clearCachesBeforeWalletSession} from '../services/walletSessionReset';
import {
  bufferToUr,
  createUrDecoder,
  receiveUrBytesPartAsBase64,
  urAllSequentialParts,
} from '../utils/urBytesQr';

const stagedImport = (TssProvider as any)
  .importBackupToStagedHandle as jest.Mock;
const native = BBMTLibNativeModule as any;
const sha256 = BBMTLibNativeModule.sha256 as jest.Mock;

const staged = (metadata: object, legacy = false) =>
  JSON.stringify({handle: 'ab'.repeat(16), metadata, legacy});

describe('keyshareImport (F1 mapping, F15b-1 staged)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('F15b-1: v2 success returns handle + metadata, legacy=false', async () => {
    stagedImport.mockResolvedValue(
      staged({pub_key: 'abc', local_party_key: 'KeyShare1'}),
    );
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).resolves.toEqual({
      handle: 'ab'.repeat(16),
      parsed: {pub_key: 'abc', local_party_key: 'KeyShare1'},
      legacy: false,
    });
    expect(stagedImport).toHaveBeenCalledWith(
      'blob',
      'password',
      undefined,
      undefined,
    );
  });

  it('F15b-1: legacy success returns legacy=true', async () => {
    stagedImport.mockResolvedValue(
      staged({pub_key: 'abc', local_party_key: 'KeyShare1'}, true),
    );
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).resolves.toMatchObject({legacy: true});
  });

  it('F15b-1: resolved shape carries no share bytes', async () => {
    stagedImport.mockResolvedValue(
      staged({pub_key: 'abc', local_party_key: 'KeyShare1'}),
    );
    const out = await decryptAndValidateKeyshare('blob', 'password');
    expect(Object.keys(out).sort()).toEqual(
      ['handle', 'legacy', 'parsed'].sort(),
    );
    const flat = JSON.stringify(out);
    for (const secret of [
      'share_b64',
      'ecdsa_local_data',
      '"nsec"',
      'sessionKeyHex',
    ]) {
      expect(flat).not.toContain(secret);
    }
  });

  it('F1: no derived key in JS (staged import only, never sha256)', async () => {
    stagedImport.mockResolvedValue(
      staged({pub_key: 'abc', local_party_key: 'KeyShare1'}),
    );
    await decryptAndValidateKeyshare('blob', 'password');
    expect(sha256).not.toHaveBeenCalled();
  });

  it('F1: native rejection (v2 auth failure) maps to wrong password', async () => {
    stagedImport.mockRejectedValue(new Error('backup authentication failed'));
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(WrongKeysharePasswordError);
  });

  it('F1: legacy garbage maps to wrong password with preserved copy', async () => {
    stagedImport.mockRejectedValue(
      new Error('legacy backup content invalid (wrong password or corrupted backup)'),
    );
    const err = await decryptAndValidateKeyshare('blob', 'password').catch(
      e => e,
    );
    expect(err).toBeInstanceOf(WrongKeysharePasswordError);
    expect((err as Error).message).toBe('Wrong password or corrupted backup');
  });

  it('F1: staged metadata without pub_key maps to invalid keyshare', async () => {
    stagedImport.mockResolvedValue(staged({local_party_key: 'KeyShare1'}));
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
  });

  it('F1: malformed staged response maps to invalid keyshare', async () => {
    stagedImport.mockResolvedValue('{"metadata":{}}');
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
    stagedImport.mockResolvedValue('not-json-at-all');
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
  });

  it('F1: unrecognized format maps to invalid keyshare', async () => {
    stagedImport.mockRejectedValue(
      new Error('not a recognized backup format'),
    );
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
  });

  it('F15b-1: finalize persists the staged handle, not JSON', async () => {
    const navigate = jest.fn();
    const setActiveNetwork = jest.fn(async () => {});
    await finalizeKeyshareImport(
      'ab'.repeat(16),
      {pub_key: 'abc', local_party_key: 'KeyShare1'},
      {setActiveNetwork, navigate},
    );
    // No owner ceremony: finalize still marks the wallet as imported.
    expect(persistStagedKeyshare).toHaveBeenCalledWith('ab'.repeat(16), {
      origin: 'imported',
    });
    expect(clearCachesBeforeWalletSession).toHaveBeenCalled();
    expect(setActiveNetwork).toHaveBeenCalledWith('mainnet');
    expect(navigate).toHaveBeenCalled();
  });

  it('3b-2e B17/B18: import shares one ceremony across stage+persist', async () => {
    native.sha256.mockResolvedValue('sess-imp-owner');
    native.requestImportCeremonyToken.mockResolvedValue('tok-imp-owner');
    native.completeCeremonyToken.mockResolvedValue(true);
    stagedImport.mockResolvedValue(
      staged({pub_key: 'abc', local_party_key: 'KeyShare1'}),
    );
    const navigate = jest.fn();
    const setActiveNetwork = jest.fn(async () => {});
    await importKeyshareFromBase64('blob', 'password', {
      setActiveNetwork,
      navigate,
    });
    // One mint, threaded through stage AND persist, completed once.
    expect(native.requestImportCeremonyToken).toHaveBeenCalledTimes(1);
    expect(native.requestImportCeremonyToken).toHaveBeenCalledWith(
      'sess-imp-owner',
    );
    expect(stagedImport).toHaveBeenCalledWith(
      'blob',
      'password',
      'tok-imp-owner',
      'sess-imp-owner',
    );
    expect(persistStagedKeyshare).toHaveBeenCalledWith('ab'.repeat(16), {
      ceremonyToken: 'tok-imp-owner',
      ceremonySessionID: 'sess-imp-owner',
      origin: 'imported',
    });
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-imp-owner');
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  it('3b-6f: legacy import is silent (no alert, internal realign only)', async () => {
    native.sha256.mockResolvedValue('sess-imp-legacy');
    native.requestImportCeremonyToken.mockResolvedValue('tok-imp-legacy');
    native.completeCeremonyToken.mockResolvedValue(true);
    stagedImport.mockResolvedValue(
      staged({pub_key: 'abc', local_party_key: 'KeyShare1'}, true),
    );
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await importKeyshareFromBase64('blob', 'password', {
        setActiveNetwork: jest.fn(async () => {}),
        navigate: jest.fn(),
      });
    } finally {
      alertSpy.mockRestore();
    }
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('3b-2e B17/B18: stage failure releases, persist never runs', async () => {
    native.sha256.mockResolvedValue('sess-imp-fail');
    native.requestImportCeremonyToken.mockResolvedValue('tok-imp-fail');
    native.releaseCeremonyToken.mockResolvedValue(true);
    stagedImport.mockRejectedValue(new Error('backup authentication failed'));
    const navigate = jest.fn();
    const setActiveNetwork = jest.fn(async () => {});
    await expect(
      importKeyshareFromBase64('blob', 'wrong', {
        setActiveNetwork,
        navigate,
      }),
    ).rejects.toBeInstanceOf(WrongKeysharePasswordError);
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-imp-fail');
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
    expect(persistStagedKeyshare).not.toHaveBeenCalled();
  });

  it('3b-2e B17/B18: mint failure never reaches stage', async () => {
    native.sha256.mockResolvedValue('sess-imp-cancel');
    native.requestImportCeremonyToken.mockRejectedValue(
      Object.assign(new Error('cancelled'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    const navigate = jest.fn();
    const setActiveNetwork = jest.fn(async () => {});
    await expect(
      importKeyshareFromBase64('blob', 'password', {
        setActiveNetwork,
        navigate,
      }),
    ).rejects.toThrow();
    expect(stagedImport).not.toHaveBeenCalled();
    expect(persistStagedKeyshare).not.toHaveBeenCalled();
  });

  it('decryptAndValidateKeyshare accepts ciphertext recovered from airgap UR frames', async () => {
    const cipherBytes = Buffer.from('fake-backup-blob-bytes-for-airgap');
    const cipherBase64 = cipherBytes.toString('base64');
    const ur = bufferToUr(cipherBytes);
    expect(ur).not.toBeNull();
    const decoder = createUrDecoder();
    let recovered: string | null = null;
    for (const part of urAllSequentialParts(ur!)) {
      const result = receiveUrBytesPartAsBase64(decoder, part);
      if (result.kind === 'complete') {
        recovered = result.payload;
        break;
      }
    }
    expect(recovered).toBe(cipherBase64);

    stagedImport.mockResolvedValue(
      staged({pub_key: 'abc', local_party_key: 'KeyShare1'}),
    );
    await expect(
      decryptAndValidateKeyshare(recovered!, 'password'),
    ).resolves.toMatchObject({
      parsed: {pub_key: 'abc'},
    });
  });
});

describe('readBackupBlobFromUri (3b-6d file compat, F23)', () => {
  const fs = RNFS as any;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.copyFile.mockResolvedValue(undefined);
  });

  it('passes fixed v2 ASCII files through verbatim (no base64 read)', async () => {
    fs.readFile.mockResolvedValueOnce('BW2$QUJDREVG');
    await expect(readBackupBlobFromUri('file:///x/a.share')).resolves.toBe(
      'BW2$QUJDREVG',
    );
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledWith(expect.any(String), 'utf8');
  });

  it('trims surrounding whitespace on v2 files', async () => {
    fs.readFile.mockResolvedValueOnce('  BW2$QUJD\n');
    await expect(readBackupBlobFromUri('file:///x/a.share')).resolves.toBe(
      'BW2$QUJD',
    );
  });

  it('falls back to base64 for legacy raw-byte files (utf8 reject)', async () => {
    fs.readFile
      .mockRejectedValueOnce(new Error('invalid utf8'))
      .mockResolvedValueOnce('aGk=');
    await expect(readBackupBlobFromUri('file:///x/a.share')).resolves.toBe(
      'aGk=',
    );
    expect(fs.readFile).toHaveBeenNthCalledWith(2, expect.any(String), 'base64');
  });

  it('falls back to base64 when utf8 yields non-envelope text', async () => {
    fs.readFile
      .mockResolvedValueOnce('not-a-backup')
      .mockResolvedValueOnce('bGVnYWN5');
    await expect(readBackupBlobFromUri('file:///x/a.share')).resolves.toBe(
      'bGVnYWN5',
    );
  });

  it('empty file (B1 iOS silent-empty) fails Invalid, not wrong-password', async () => {
    fs.readFile
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    await expect(
      readBackupBlobFromUri('file:///x/empty.share'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
  });
});
