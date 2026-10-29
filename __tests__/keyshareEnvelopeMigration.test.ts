jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {show: jest.fn()},
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {ensureKeyshareEnveloped: jest.fn()},
}));

jest.mock('../utils', () => ({dbg: jest.fn()}));

jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {getBool: jest.fn(), set: jest.fn()},
  CONFIG_KEYS: {
    ENVELOPE_MIGRATION_BACKUP_PROMPTED: 'envelope_migration_backup_prompted',
  },
}));

jest.mock('../services/secureStorageErrors', () => ({
  alertSecureStorageError: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {currentAppPrompt, respondAppPrompt} from '../services/appPrompt';
import appConfigRepository from '../services/repositories/AppConfigRepository';
import {alertSecureStorageError} from '../services/secureStorageErrors';
import {
  maybePromptPostMigrationBackup,
  runEnvelopeMigrationIfNeeded,
} from '../services/keyshareEnvelopeMigration';

const native = BBMTLibNativeModule as any;
const repo = appConfigRepository as any;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('F15b-1 envelope migration bootstrap', () => {
  test('returns migrated=true when native migrated', async () => {
    native.ensureKeyshareEnveloped.mockResolvedValue({migrated: true});
    await expect(runEnvelopeMigrationIfNeeded()).resolves.toEqual({
      migrated: true,
    });
  });

  test('returns migrated=false when already enveloped', async () => {
    native.ensureKeyshareEnveloped.mockResolvedValue({migrated: false});
    await expect(runEnvelopeMigrationIfNeeded()).resolves.toEqual({
      migrated: false,
    });
    expect(alertSecureStorageError).not.toHaveBeenCalled();
  });

  test('native failure alerts and resolves non-fatal', async () => {
    native.ensureKeyshareEnveloped.mockRejectedValue(
      new Error('[SECURE_STORAGE_CORRUPTED] x'),
    );
    await expect(runEnvelopeMigrationIfNeeded()).resolves.toEqual({
      migrated: false,
    });
    expect(alertSecureStorageError).toHaveBeenCalledTimes(1);
  });

  test('no prompt when nothing migrated', async () => {
    const onOpen = jest.fn();
    await expect(maybePromptPostMigrationBackup(false, onOpen)).resolves.toBe(
      false,
    );
    expect(currentAppPrompt()).toBeNull();
  });

  test('prompt fires once and Back up navigates', async () => {
    repo.getBool.mockReturnValue(false);
    const onOpen = jest.fn();
    await expect(maybePromptPostMigrationBackup(true, onOpen)).resolves.toBe(
      true,
    );
    expect(repo.set).toHaveBeenCalledWith(
      'envelope_migration_backup_prompted',
      'true',
    );
    expect(currentAppPrompt()?.confirmLabel).toBe('Back up');
    respondAppPrompt(true);
    await Promise.resolve();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('prompt suppressed after the one-time flag is set', async () => {
    repo.getBool.mockReturnValue(true);
    await expect(
      maybePromptPostMigrationBackup(true, jest.fn()),
    ).resolves.toBe(false);
    expect(currentAppPrompt()).toBeNull();
  });
});
