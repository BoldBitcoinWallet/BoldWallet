import React, {useCallback, useEffect, useRef} from 'react';
import {Alert} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import type {NavigationContainerRef} from '@react-navigation/native';
import {dbg} from '../utils';
import {hasLoadedWallet} from '../services/walletGuard';
import {parseIncomingUrl} from '../services/incomingUrlRouter';
import {
  clearPendingIncomingUrl,
  getInitialIncomingUrl,
  subscribeToIncomingUrls,
} from '../services/incomingUrlBridge';

type Props = {
  isAuthenticated: boolean;
  navigationRef: React.RefObject<NavigationContainerRef<any> | null>;
};

function showWalletRequiredAlert(): void {
  Alert.alert(
    'Wallet required',
    'Set up or restore a wallet before opening a Bitcoin payment link.',
  );
}

function showUnsupportedUrlAlert(): void {
  Alert.alert('Unsupported link', 'This link is not supported by BoldWallet.');
}

const IncomingUrlHandler = ({isAuthenticated, navigationRef}: Props) => {
  const processingUrlRef = useRef<string | null>(null);

  const finishPendingUrl = useCallback(async () => {
    await clearPendingIncomingUrl();
    processingUrlRef.current = null;
  }, []);

  const openPaymentLink = useCallback(
    async (address: string, amountBtc?: string) => {
      const walletLoaded = await hasLoadedWallet();
      if (!walletLoaded) {
        showWalletRequiredAlert();
        await finishPendingUrl();
        return;
      }
      navigationRef.current?.dispatch(
        CommonActions.navigate('MainTabs', {
          screen: 'Wallet',
          params: {
            sendAddress: address,
            sendAmountBtc: amountBtc,
          },
        }),
      );
      await finishPendingUrl();
    },
    [finishPendingUrl, navigationRef],
  );

  const processIncomingUrl = useCallback(
    async (rawUrl: string) => {
      const url = String(rawUrl).trim();
      if (!url || processingUrlRef.current === url) {
        return;
      }
      processingUrlRef.current = url;

      try {
        const parsed = parseIncomingUrl(url);
        if (parsed.kind === 'boldwallet-import-keyshare') {
          await finishPendingUrl();
          return;
        }
        if (parsed.kind === 'bitcoin-pay') {
          await openPaymentLink(parsed.address, parsed.amountBtc);
          return;
        }
        showUnsupportedUrlAlert();
        await finishPendingUrl();
      } catch (error) {
        dbg('IncomingUrlHandler: failed to process url', error);
        showUnsupportedUrlAlert();
        await finishPendingUrl();
      }
    },
    [finishPendingUrl, openPaymentLink],
  );

  const enqueueIncomingUrl = useCallback(
    (url: string) => {
      if (!url.trim()) {
        return;
      }
      if (isAuthenticated) {
        void processIncomingUrl(url);
      }
    },
    [isAuthenticated, processIncomingUrl],
  );

  useEffect(() => {
    const unsubscribe = subscribeToIncomingUrls(enqueueIncomingUrl);
    return unsubscribe;
  }, [enqueueIncomingUrl]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let cancelled = false;
    const consumeInitialUrl = async () => {
      const initialUrl = await getInitialIncomingUrl();
      if (cancelled || !initialUrl) {
        return;
      }
      enqueueIncomingUrl(initialUrl);
    };
    void consumeInitialUrl();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, enqueueIncomingUrl]);

  return null;
};

export default IncomingUrlHandler;
