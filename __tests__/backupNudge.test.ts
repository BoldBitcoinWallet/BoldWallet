jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    getBool: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
  CONFIG_KEYS: {
    STALE_BACKUP_NUDGE: 'stale_backup_nudge',
  },
}));

import appConfigRepository from '../services/repositories/AppConfigRepository';
import {
  clearBackupNudge,
  isBackupNudgeActive,
  setBackupNudgeActive,
} from '../services/backupNudge';

const repo = appConfigRepository as any;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('backupNudge flag (3b-6e)', () => {
  test('set writes the flag; isActive reads it; clear removes it', () => {
    setBackupNudgeActive();
    expect(repo.set).toHaveBeenCalledWith('stale_backup_nudge', 'true');
    repo.getBool.mockReturnValue(true);
    expect(isBackupNudgeActive()).toBe(true);
    expect(repo.getBool).toHaveBeenCalledWith('stale_backup_nudge', false);
    clearBackupNudge();
    expect(repo.remove).toHaveBeenCalledWith('stale_backup_nudge');
  });

  test('inactive by default', () => {
    repo.getBool.mockReturnValue(false);
    expect(isBackupNudgeActive()).toBe(false);
  });

  test('fail-safe: repo throws never propagate', () => {
    repo.getBool.mockImplementation(() => {
      throw new Error('db gone');
    });
    repo.set.mockImplementation(() => {
      throw new Error('db gone');
    });
    repo.remove.mockImplementation(() => {
      throw new Error('db gone');
    });
    expect(() => setBackupNudgeActive()).not.toThrow();
    expect(() => clearBackupNudge()).not.toThrow();
    expect(isBackupNudgeActive()).toBe(false);
  });
});
