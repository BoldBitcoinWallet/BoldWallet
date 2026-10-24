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

jest.mock('../services/backupNudge', () => ({
  setBackupNudgeActive: jest.fn(),
}));

import {Alert} from 'react-native';
import {BBMTLibNativeModule} from '../native_modules';
import appConfigRepository from '../services/repositories/AppConfigRepository';
import {alertSecureStorageError} from '../services/secureStorageErrors';
import {
  maybePromptPostMigrationBackup,
  runEnvelopeMigrationIfNeeded,
} from '../services/keyshareEnvelopeMigration';
import {setBackupNudgeActive} from '../services/backupNudge';

const native = BBMTLibNativeModule as any;
const repo = appConfigRepository as any;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
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
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(setBackupNudgeActive).not.toHaveBeenCalled();
  });

  test('prompt fires once and Open backup navigates', async () => {
    repo.getBool.mockReturnValue(false);
    const onOpen = jest.fn();
    await expect(maybePromptPostMigrationBackup(true, onOpen)).resolves.toBe(
      true,
    );
    expect(repo.set).toHaveBeenCalledWith(
      'envelope_migration_backup_prompted',
      'true',
    );
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    const open = buttons.find((b: any) => b.text === 'Open backup');
    expect(open).toBeDefined();
    open.onPress();
    expect(onOpen).toHaveBeenCalledTimes(1);
    // 3b-6e: the one-time prompt persists as the backup nudge.
    expect(setBackupNudgeActive).toHaveBeenCalledTimes(1);
  });

  test('prompt suppressed after the one-time flag is set', async () => {
    repo.getBool.mockReturnValue(true);
    await expect(
      maybePromptPostMigrationBackup(true, jest.fn()),
    ).resolves.toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(setBackupNudgeActive).not.toHaveBeenCalled();
  });
});
