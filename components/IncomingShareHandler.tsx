import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, AppState} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import type {NavigationContainerRef} from '@react-navigation/native';
import KeyshareImportPasswordModal from './KeyshareImportPasswordModal';
import {useUser} from '../context/UserContext';
import {dbg} from '../utils';
import {hasLoadedWallet} from '../services/walletGuard';
import {
  importKeyshareFromBase64,
  readKeyshareBase64FromUri,
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
  Alert.alert('Unsupported file', 'This file type is not supported by BoldWallet.');
}

function showWalletRequiredForPsbtAlert(): void {
  Alert.alert(
    'Wallet required',
    'Set up or restore a wallet before importing a PSBT file.',
  );
}

const IncomingShareHandler = ({isAuthenticated, navigationRef}: Props) => {
  const {setActiveNetwork} = useUser();
  const [modalVisible, setModalVisible] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isAppActive, setIsAppActive] = useState(
    () => AppState.currentState === 'active',
  );
  const processingUriRef = useRef<string | null>(null);
  const queuedUriRef = useRef<string | null>(null);

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
            params: {
              sharedPsbtBase64: psbtBase64,
              isInitiator: true,
              forwardPeerCosign: true,
              initiatorTxId: `peer-cosign-${Date.now()}`,
            },
          },
        }),
      );
      await finishPendingShare();
    },
    [finishPendingShare, navigationRef],
  );

  const openKeyshareImport = useCallback(async (uri: string) => {
    const content = await readKeyshareBase64FromUri(uri);
    setFileContent(content);
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

      try {
        const kind = await classifyIncomingFile(uri);
        await routeSharedFile(uri, kind);
      } catch (error) {
        if (error instanceof WalletAlreadyLoadedError) {
          showWalletAlreadyLoadedAlert(navigateToSettings);
        } else {
          dbg('IncomingShareHandler: failed to process shared file', error);
          showKeyshareImportError(error);
        }
        await finishPendingShare();
      }
    },
    [finishPendingShare, navigateToSettings, routeSharedFile],
  );

  const enqueueSharedUri = useCallback(
    (uri: string) => {
      const normalized = normalizeSharedFileUri(uri);
      if (!normalized) {
        return;
      }
      queuedUriRef.current = normalized;
      if (isAuthenticated && isAppActive) {
        void processSharedUri(normalized);
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
    void processSharedUri(queuedUri);
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
    void consumeInitialShare();
    return () => {
      cancelled = true;
    };
  }, [isAppActive, isAuthenticated, enqueueSharedUri]);

  const handleCloseModal = () => {
    setModalVisible(false);
    setFileContent('');
    void finishPendingShare();
  };

  const handlePasswordSubmit = async (password: string) => {
    try {
      setIsImporting(true);
      await importKeyshareFromBase64(fileContent, password, {
        setActiveNetwork,
        navigate: action => navigationRef.current?.dispatch(action),
      });
      setModalVisible(false);
      setFileContent('');
      await finishPendingShare();
    } catch (error) {
      showKeyshareImportError(error);
    } finally {
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
