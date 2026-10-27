jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {show: jest.fn()},
}));

import React from 'react';
import {AppState} from 'react-native';
import Toast from 'react-native-toast-message';
import TestRenderer, {act} from 'react-test-renderer';
import IncomingShareHandler from '../components/IncomingShareHandler';

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    navigate: jest.fn((payload: unknown) => payload),
  },
}));

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

const mockSetActiveNetwork = jest.fn();
const mockClassifyIncomingFile = jest.fn();
const mockReadBackupBlobFromUri = jest.fn();
const mockImportKeyshareFromBase64 = jest.fn(
  async (..._args: unknown[]) => undefined,
);
const mockShowKeyshareImportError = jest.fn();
const mockSubscribeToSharedFiles = jest.fn();
const mockGetInitialSharedFileUri = jest.fn();
const mockModalProps = jest.fn();
const mockClearPendingSharedFile = jest.fn(async () => undefined);

jest.mock('../context/UserContext', () => ({
  useUser: () => ({
    setActiveNetwork: mockSetActiveNetwork,
  }),
}));

jest.mock('../services/walletGuard', () => ({
  hasLoadedWallet: jest.fn(async () => false),
}));

jest.mock('../services/incomingFileClassifier', () => ({
  classifyIncomingFile: (uri: string) => mockClassifyIncomingFile(uri),
}));

jest.mock('../services/keyshareImport', () => ({
  importKeyshareFromBase64: (...args: unknown[]) =>
    mockImportKeyshareFromBase64(...args),
  readBackupBlobFromUri: (uri: string) => mockReadBackupBlobFromUri(uri),
  showKeyshareImportError: (error: unknown) => mockShowKeyshareImportError(error),
  showWalletAlreadyLoadedAlert: jest.fn(),
  WalletAlreadyLoadedError: class WalletAlreadyLoadedError extends Error {},
}));

jest.mock('../services/incomingShareBridge', () => ({
  clearPendingSharedFile: () => mockClearPendingSharedFile(),
  getInitialSharedFileUri: () => mockGetInitialSharedFileUri(),
  normalizeSharedFileUri: (uri: string) => uri,
  subscribeToSharedFiles: (listener: (uri: string) => void) =>
    mockSubscribeToSharedFiles(listener),
}));

jest.mock('../components/KeyshareImportPasswordModal', () => {
  const ReactLocal = require('react');
  return function MockKeyshareImportPasswordModal(props: unknown) {
    mockModalProps(props);
    return ReactLocal.createElement(ReactLocal.Fragment, null);
  };
});

describe('IncomingShareHandler', () => {
  const navigationRef = {current: {dispatch: jest.fn()}};
  let appStateHandler: ((state: string) => void) | null = null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    appStateHandler = null;
    mockClearPendingSharedFile.mockResolvedValue(undefined);

    mockSubscribeToSharedFiles.mockImplementation((listener: (uri: string) => void) => {
      listener;
      return () => {};
    });

    mockGetInitialSharedFileUri.mockResolvedValue('file:///tmp/pending_keyshare.share');
    mockClassifyIncomingFile.mockResolvedValue('keyshare');
    mockReadBackupBlobFromUri.mockResolvedValue('encrypted-keyshare-content');

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });

    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((type: string, listener: (state: any) => void) => {
        if (type === 'change') {
          appStateHandler = (state: string) => {
            Object.defineProperty(AppState, 'currentState', {
              configurable: true,
              value: state,
            });
            listener(state);
          };
        }
        return {remove: jest.fn()} as never;
      });

    jest.spyOn(Toast, 'show').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defers initial shared keyshare processing until app becomes active', async () => {
    await act(async () => {
      TestRenderer.create(
        <IncomingShareHandler
          isAuthenticated={true}
          navigationRef={navigationRef as never}
        />,
      );
    });

    await flush();

    expect(mockGetInitialSharedFileUri).not.toHaveBeenCalled();
    expect(mockClassifyIncomingFile).not.toHaveBeenCalled();
    expect(mockReadBackupBlobFromUri).not.toHaveBeenCalled();

    await act(async () => {
      appStateHandler?.('active');
    });

    await flush();
    await flush();

    expect(mockGetInitialSharedFileUri).toHaveBeenCalled();
    expect(mockClassifyIncomingFile).toHaveBeenCalledWith(
      'file:///tmp/pending_keyshare.share',
    );
    expect(mockReadBackupBlobFromUri).not.toHaveBeenCalled();
    expect(mockImportKeyshareFromBase64).not.toHaveBeenCalled();
    expect(mockShowKeyshareImportError).not.toHaveBeenCalled();

    const lastModalCall = mockModalProps.mock.calls[mockModalProps.mock.calls.length - 1]?.[0] as
      | {visible?: boolean; onSubmit?: (password: string) => Promise<void>}
      | undefined;
    expect(lastModalCall?.visible).toBe(true);

    await act(async () => {
      await lastModalCall?.onSubmit?.('backup-password');
    });

    expect(mockReadBackupBlobFromUri).toHaveBeenCalledWith(
      'file:///tmp/pending_keyshare.share',
    );
    expect(mockImportKeyshareFromBase64).toHaveBeenCalledWith(
      'encrypted-keyshare-content',
      'backup-password',
      expect.objectContaining({setActiveNetwork: mockSetActiveNetwork}),
    );
  });

  it('opens the password modal when the blob cannot be read yet', async () => {
    mockClassifyIncomingFile.mockRejectedValue(new Error('Permission Denial'));

    await act(async () => {
      TestRenderer.create(
        <IncomingShareHandler
          isAuthenticated={true}
          navigationRef={navigationRef as never}
        />,
      );
    });

    await act(async () => {
      appStateHandler?.('active');
    });
    await flush();
    await flush();

    expect(mockShowKeyshareImportError).not.toHaveBeenCalled();
    expect(mockImportKeyshareFromBase64).not.toHaveBeenCalled();
    expect(Toast.show).not.toHaveBeenCalled();

    const lastModalCall = mockModalProps.mock.calls[mockModalProps.mock.calls.length - 1]?.[0] as
      | {visible?: boolean; onSubmit?: (password: string) => Promise<void>}
      | undefined;
    expect(lastModalCall?.visible).toBe(true);

    mockReadBackupBlobFromUri.mockRejectedValueOnce(new Error('Could not read keyshare file'));
    await act(async () => {
      await lastModalCall?.onSubmit?.('backup-password');
    });

    expect(mockReadBackupBlobFromUri).toHaveBeenCalled();
    expect(mockImportKeyshareFromBase64).not.toHaveBeenCalled();
    expect(mockShowKeyshareImportError).toHaveBeenCalledTimes(1);
  });

  it('shows unsupported alert for unknown shared file kinds', async () => {
    mockClassifyIncomingFile.mockResolvedValue('unknown');
    mockGetInitialSharedFileUri.mockResolvedValue('file:///tmp/video.mp4');

    await act(async () => {
      TestRenderer.create(
        <IncomingShareHandler
          isAuthenticated={true}
          navigationRef={navigationRef as never}
        />,
      );
    });

    await act(async () => {
      appStateHandler?.('active');
    });

    await flush();
    await flush();

    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: 'Unsupported file',
        text2: 'This file type is not supported by BoldWallet.',
      }),
    );
    expect(mockReadBackupBlobFromUri).not.toHaveBeenCalled();
    expect(mockClearPendingSharedFile).toHaveBeenCalled();
  });
});
