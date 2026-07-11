import React from 'react';
import {Alert, AppState} from 'react-native';
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
const mockReadKeyshareBase64FromUri = jest.fn();
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
  importKeyshareFromBase64: jest.fn(),
  readKeyshareBase64FromUri: (uri: string) => mockReadKeyshareBase64FromUri(uri),
  showKeyshareImportError: jest.fn(),
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
      void listener;
      return () => {};
    });

    mockGetInitialSharedFileUri.mockResolvedValue('file:///tmp/pending_keyshare.share');
    mockClassifyIncomingFile.mockResolvedValue('keyshare');
    mockReadKeyshareBase64FromUri.mockResolvedValue('encrypted-keyshare-content');

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });

    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((type: string, listener: (state: any) => void) => {
        if (type === 'change') {
          appStateHandler = listener;
        }
        return {remove: jest.fn()} as never;
      });

    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
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
    expect(mockReadKeyshareBase64FromUri).not.toHaveBeenCalled();

    await act(async () => {
      appStateHandler?.('active');
    });

    await flush();
    await flush();

    expect(mockGetInitialSharedFileUri).toHaveBeenCalled();
    expect(mockClassifyIncomingFile).toHaveBeenCalledWith(
      'file:///tmp/pending_keyshare.share',
    );
    expect(mockReadKeyshareBase64FromUri).toHaveBeenCalledWith(
      'file:///tmp/pending_keyshare.share',
    );

    const lastModalCall = mockModalProps.mock.calls[mockModalProps.mock.calls.length - 1]?.[0] as
      | {visible?: boolean}
      | undefined;
    expect(lastModalCall?.visible).toBe(true);
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

    expect(Alert.alert).toHaveBeenCalledWith(
      'Unsupported file',
      'This file type is not supported by BoldWallet.',
    );
    expect(mockReadKeyshareBase64FromUri).not.toHaveBeenCalled();
    expect(mockClearPendingSharedFile).toHaveBeenCalled();
  });
});
