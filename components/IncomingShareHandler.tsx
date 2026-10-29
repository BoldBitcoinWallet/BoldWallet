import React, {useCallback, useEffect, useRef, useState} from 'react';
import {showAppNotice} from '../services/appPrompt';
import {AppState} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import type {NavigationContainerRef} from '@react-navigation/native';
import KeyshareImportPasswordModal from './KeyshareImportPasswordModal';
import {useUser} from '../context/UserContext';
import {dbg} from '../utils';
import {hasLoadedWallet} from '../services/walletGuard';
import {
  importKeyshareFromBase64,
  readBackupBlobFromUri,
  showKeyshareImportError,
  showWalletAlreadyLoadedAlert,
  WalletAlreadyLoadedError,
} from '../services/keyshareImport';
import {
  classifyIncomingFile,
  type IncomingFileKind,
} from '../services/incomingFileClassifier';
import {
  readPsbtBase64FromUri,
  validatePsbtBase64,
} from '../services/psbtImport';
import {
  clearPendingSharedFile,
  getInitialSharedFileUri,
  normalizeSharedFileUri,
  subscribeToSharedFiles,
} from '../services/incomingShareBridge';

type Props = {
  isAuthenticated: boolean;
  navigationRef: React.RefObject<NavigationContainerRef<any> | null>;
};

function showUnsupportedFileAlert(): void {
  showAppNotice('Unsupported file', 'This file type is not supported by BoldWallet.');
}

function showWalletRequiredForPsbtAlert(): void {
  showAppNotice(
    'Wallet required',
    'Set up or restore a wallet before importing a PSBT file.',
  );
}

function isIncomingFileTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as {name?: string}).name === 'IncomingFileTooLargeError'
  );
}

function uriLooksLikePsbt(uri: string): boolean {
  return uri.toLowerCase().includes('.psbt');
}

/** Import (and its biometric) must not start before the host is active. */
function waitUntilShareHostActive(
  isActive: () => boolean,
): Promise<void> {
  if (isActive() || AppState.currentState === 'active') {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        sub.remove();
        resolve();
      }
    });
  });
}

const IncomingShareHandler = ({isAuthenticated, navigationRef}: Props) => {
  const {setActiveNetwork} = useUser();
  const [modalVisible, setModalVisible] = useState(false);
  const [_fileContent, setFileContent] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isAppActive, setIsAppActive] = useState(
    () => AppState.currentState === 'active',
  );
  const processingUriRef = useRef<string | null>(null);
  const queuedUriRef = useRef<string | null>(null);
  const pendingImportUriRef = useRef<string | null>(null);
  const importingRef = useRef(false);
  const isAppActiveRef = useRef(isAppActive);
  isAppActiveRef.current = isAppActive;

  const navigateToSettings = useCallback(() => {
    navigationRef.current?.dispatch(
      CommonActions.navigate({
        name: 'MainTabs',
        params: {screen: 'Settings'},
      }),
    );
  }, [navigationRef]);

  const finishPendingShare = useCallback(async () => {
    await clearPendingSharedFile();
    processingUriRef.current = null;
    queuedUriRef.current = null;
  }, []);

  const openSharedPsbt = useCallback(
    async (uri: string) => {
      const psbtBase64 = validatePsbtBase64(await readPsbtBase64FromUri(uri));
      navigationRef.current?.dispatch(
        CommonActions.navigate({
          name: 'MainTabs',
          params: {
            screen: 'PSBT',
            params: {sharedPsbtBase64: psbtBase64},
          },
        }),
      );
      await finishPendingShare();
    },
    [finishPendingShare, navigationRef],
  );

  const openKeyshareImport = useCallback((uri: string) => {
    // Password sheet first. Decrypt, ceremony, and the blob read all wait
    // until submit — a content:// read before the activity is resumed used
    // to throw and surface "Failed to import the file" on open.
    pendingImportUriRef.current = uri;
    setFileContent('');
    setModalVisible(true);
  }, []);

  const routeSharedFile = useCallback(
    async (rawUri: string, kind: IncomingFileKind) => {
      const walletLoaded = await hasLoadedWallet();
      if (kind === 'psbt') {
        if (!walletLoaded) {
          showWalletRequiredForPsbtAlert();
          await finishPendingShare();
          return;
        }
        await openSharedPsbt(rawUri);
        return;
      }
      if (kind === 'keyshare') {
        if (walletLoaded) {
          showWalletAlreadyLoadedAlert(navigateToSettings);
          await finishPendingShare();
          return;
        }
        await openKeyshareImport(rawUri);
        return;
      }
      showUnsupportedFileAlert();
      await finishPendingShare();
    },
    [finishPendingShare, navigateToSettings, openKeyshareImport, openSharedPsbt],
  );

  const processSharedUri = useCallback(
    async (rawUri: string) => {
      const uri = normalizeSharedFileUri(rawUri);
      if (processingUriRef.current === uri) {
        return;
      }
      processingUriRef.current = uri;

      let kind: IncomingFileKind | null = null;
      try {
        kind = await classifyIncomingFile(uri);
        await routeSharedFile(uri, kind);
      } catch (error) {
        if (error instanceof WalletAlreadyLoadedError) {
          showWalletAlreadyLoadedAlert(navigateToSettings);
          await finishPendingShare();
          return;
        }
        if (
          kind === 'psbt' ||
          isIncomingFileTooLarge(error) ||
          uriLooksLikePsbt(uri)
        ) {
          dbg('IncomingShareHandler: failed to process shared file', error);
          showKeyshareImportError(error);
          await finishPendingShare();
          return;
        }
        // Peek/copy can fail while the sender's read grant is not usable yet.
        // That is not a failed import — ask for the password and read on submit.
        dbg('IncomingShareHandler: opening password sheet before blob read', error);
        openKeyshareImport(uri);
      }
    },
    [finishPendingShare, navigateToSettings, openKeyshareImport, routeSharedFile],
  );

  const enqueueSharedUri = useCallback(
    (uri: string) => {
      const normalized = normalizeSharedFileUri(uri);
      if (!normalized) {
        return;
      }
      queuedUriRef.current = normalized;
      if (isAuthenticated && isAppActive) {
        processSharedUri(normalized);
      }
    },
    [isAppActive, isAuthenticated, processSharedUri],
  );

  useEffect(() => {
    const unsubscribe = subscribeToSharedFiles(enqueueSharedUri);
    return unsubscribe;
  }, [enqueueSharedUri]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setIsAppActive(state === 'active');
    });
    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !isAppActive) {
      return;
    }
    const queuedUri = queuedUriRef.current;
    if (!queuedUri) {
      return;
    }
    processSharedUri(queuedUri);
  }, [isAppActive, isAuthenticated, processSharedUri]);

  useEffect(() => {
    if (!isAuthenticated || !isAppActive) {
      return;
    }
    let cancelled = false;
    const consumeInitialShare = async () => {
      const initialUri = await getInitialSharedFileUri();
      if (cancelled || !initialUri) {
        return;
      }
      enqueueSharedUri(initialUri);
    };
    consumeInitialShare();
    return () => {
      cancelled = true;
    };
  }, [isAppActive, isAuthenticated, enqueueSharedUri]);

  const handleCloseModal = () => {
    setModalVisible(false);
    setFileContent('');
    pendingImportUriRef.current = null;
    finishPendingShare();
  };

  const handlePasswordSubmit = async (password: string) => {
    const uri = pendingImportUriRef.current;
    if (!uri || importingRef.current) {
      return;
    }
    importingRef.current = true;
    try {
      setIsImporting(true);
      await waitUntilShareHostActive(() => isAppActiveRef.current);
      const content = await readBackupBlobFromUri(uri);
      setFileContent(content);
      await importKeyshareFromBase64(content, password, {
        setActiveNetwork,
        navigate: action => navigationRef.current?.dispatch(action),
      });
      setModalVisible(false);
      setFileContent('');
      pendingImportUriRef.current = null;
      await finishPendingShare();
    } catch (error) {
      showKeyshareImportError(error);
    } finally {
      importingRef.current = false;
      setIsImporting(false);
    }
  };

  return (
    <KeyshareImportPasswordModal
      visible={modalVisible}
      onClose={handleCloseModal}
      onSubmit={handlePasswordSubmit}
      isSubmitting={isImporting}
    />
  );
};

export default IncomingShareHandler;
