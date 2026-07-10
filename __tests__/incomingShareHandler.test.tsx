import React from 'react';
import {AppState} from 'react-native';
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

jest.mock('../context/UserContext', () => ({
  useUser: () => ({
    setActiveNetwork: mockSetActiveNetwork,
  }),
}));

jest.mock('../services/walletGuard', () => ({
  hasLoadedWallet: jest.fn(async () => false),
}));

jest.mock('../services/incomingFileClassifier', () => ({
  classifyIncomingFile: (...args: unknown[]) => mockClassifyIncomingFile(...args),
}));

jest.mock('../services/keyshareImport', () => ({
  importKeyshareFromBase64: jest.fn(),
  readKeyshareBase64FromUri: (...args: unknown[]) =>
    mockReadKeyshareBase64FromUri(...args),
  showKeyshareImportError: jest.fn(),
  showWalletAlreadyLoadedAlert: jest.fn(),
  WalletAlreadyLoadedError: class WalletAlreadyLoadedError extends Error {},
}));

jest.mock('../services/incomingShareBridge', () => ({
  clearPendingSharedFile: jest.fn(async () => undefined),
  getInitialSharedFileUri: (...args: unknown[]) =>
    mockGetInitialSharedFileUri(...args),
  normalizeSharedFileUri: (uri: string) => uri,
  subscribeToSharedFiles: (...args: unknown[]) =>
    mockSubscribeToSharedFiles(...args),
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
});
