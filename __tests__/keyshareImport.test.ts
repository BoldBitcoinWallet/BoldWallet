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
    backupDecrypt: jest.fn(),
    aesDecrypt: jest.fn(),
    sha256: jest.fn(),
    hasKeyshareInSecureStorage: jest.fn(),
  },
}));
jest.mock('../services/walletSetupOrchestrator', () => ({
  persistWalletKeyshare: jest.fn(),
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
  InvalidKeyshareError,
  WrongKeysharePasswordError,
} from '../services/keyshareImport';
import {
  bufferToUr,
  createUrDecoder,
  receiveUrBytesPartAsBase64,
  urAllSequentialParts,
} from '../utils/urBytesQr';

const backupDecrypt = BBMTLibNativeModule.backupDecrypt as jest.Mock;
const aesDecrypt = BBMTLibNativeModule.aesDecrypt as jest.Mock;
const sha256 = BBMTLibNativeModule.sha256 as jest.Mock;

const v2Envelope = (plaintext: string) =>
  JSON.stringify({format: 'v2', plaintext});
const legacyEnvelope = (plaintext: string) =>
  JSON.stringify({format: 'legacy', plaintext});

describe('keyshareImport (F1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('F1: v2 success returns parsed keyshare with legacy=false', async () => {
    backupDecrypt.mockResolvedValue(
      v2Envelope('{"pub_key":"abc","local_party_key":"KeyShare1"}'),
    );
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).resolves.toEqual({
      decryptedKeyshare: '{"pub_key":"abc","local_party_key":"KeyShare1"}',
      parsed: {pub_key: 'abc', local_party_key: 'KeyShare1'},
      legacy: false,
    });
    expect(backupDecrypt).toHaveBeenCalledWith('blob', 'password');
  });

  it('F1: legacy success returns legacy=true', async () => {
    backupDecrypt.mockResolvedValue(
      legacyEnvelope('{"pub_key":"abc","local_party_key":"KeyShare1"}'),
    );
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).resolves.toMatchObject({legacy: true});
  });

  it('F1: no derived key in JS (backupDecrypt only, never aesDecrypt/sha256)', async () => {
    backupDecrypt.mockResolvedValue(
      v2Envelope('{"pub_key":"abc","local_party_key":"KeyShare1"}'),
    );
    await decryptAndValidateKeyshare('blob', 'password');
    expect(aesDecrypt).not.toHaveBeenCalled();
    expect(sha256).not.toHaveBeenCalled();
  });

  it('F1: native rejection (v2 auth failure) maps to wrong password', async () => {
    backupDecrypt.mockRejectedValue(new Error('backup authentication failed'));
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(WrongKeysharePasswordError);
  });

  it('F1: legacy garbage without pub_key maps to wrong password', async () => {
    backupDecrypt.mockResolvedValue(
      legacyEnvelope('not-json-without-pub-key'),
    );
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(WrongKeysharePasswordError);
  });

  it('F1: invalid keyshare JSON maps to invalid keyshare', async () => {
    backupDecrypt.mockResolvedValue(v2Envelope('{"pub_key":""}'));
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
  });

  it('F1: malformed envelope maps to invalid keyshare', async () => {
    backupDecrypt.mockResolvedValue('{"format":"v2"}');
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
    backupDecrypt.mockResolvedValue('not-json-at-all');
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
  });

  it('F1: unrecognized format maps to invalid keyshare', async () => {
    backupDecrypt.mockRejectedValue(
      new Error('not a recognized backup format'),
    );
    await expect(
      decryptAndValidateKeyshare('blob', 'password'),
    ).rejects.toBeInstanceOf(InvalidKeyshareError);
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

    backupDecrypt.mockResolvedValue(
      v2Envelope('{"pub_key":"abc","local_party_key":"KeyShare1"}'),
    );
    await expect(
      decryptAndValidateKeyshare(recovered!, 'password'),
    ).resolves.toMatchObject({
      parsed: {pub_key: 'abc'},
    });
  });
});
