import {Buffer} from 'buffer';
(global as any).Buffer = (global as any).Buffer || Buffer;

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
jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    importBackupToStagedHandle: jest.fn(),
    sha256: jest.fn(),
    hasKeyshareInSecureStorage: jest.fn(),
  },
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

import {BBMTLibNativeModule} from '../native_modules';
import {
  decryptAndValidateKeyshare,
  finalizeKeyshareImport,
  InvalidKeyshareError,
  WrongKeysharePasswordError,
} from '../services/keyshareImport';
import {persistStagedKeyshare} from '../services/walletSetupOrchestrator';
import {
  bufferToUr,
  createUrDecoder,
  receiveUrBytesPartAsBase64,
  urAllSequentialParts,
} from '../utils/urBytesQr';

const stagedImport = BBMTLibNativeModule.importBackupToStagedHandle as jest.Mock;
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
    expect(stagedImport).toHaveBeenCalledWith('blob', 'password');
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
    expect(persistStagedKeyshare).toHaveBeenCalledWith('ab'.repeat(16));
    expect(setActiveNetwork).toHaveBeenCalledWith('mainnet');
    expect(navigate).toHaveBeenCalled();
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
