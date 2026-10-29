import React, {useEffect, useRef, useState} from 'react';
import WalletOfflineSandboxModal from './WalletOfflineSandboxModal';
import {
  currentWalletOfflineSandbox,
  dismissWalletOfflineSandbox,
  respondWalletOfflineSandbox,
  subscribeWalletOfflineSandbox,
  type WalletOfflineSandboxRequest,
} from '../services/walletOfflineSandboxPrompt';
import {
  notifyWalletOnlineToggle,
  setWalletOnline,
} from '../services/walletOnlineStore';

/**
 * One offline-sandbox sheet for the whole app. Opened by guardOnlineAction
 * and by Home / UTXOs refresh when the wallet is sandboxed offline.
 */
export default function WalletOfflineSandboxHost() {
  const [request, setRequest] = useState<WalletOfflineSandboxRequest | null>(
    () => currentWalletOfflineSandbox(),
  );
  const [shown, setShown] = useState<WalletOfflineSandboxRequest | null>(
    request,
  );
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(
    () =>
      subscribeWalletOfflineSandbox(next => {
        setRequest(next);
        if (next) {
          setShown(next);
        }
      }),
    [],
  );

  const display = request ?? shown;
  const visible = request != null;

  return (
    <WalletOfflineSandboxModal
      visible={visible}
      message={display?.message}
      onClose={() => {
        dismissWalletOfflineSandbox();
        setShown(null);
      }}
      onKeepOffline={() => {
        dismissWalletOfflineSandbox();
        setShown(null);
      }}
      onGoOnline={() => {
        setWalletOnline(true);
        notifyWalletOnlineToggle(true);
        respondWalletOfflineSandbox(true);
        setShown(null);
      }}
    />
  );
}
