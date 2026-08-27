/**
 * Persisted in-app online/offline sandbox.
 *
 * Absent preference is online. When offline, JS fetch and native HTTP
 * methods are rejected and MempoolClient / SyncCoordinator skip the network.
 */
import {useEffect, useState} from 'react';
import {NativeModules} from 'react-native';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';
import {dbg} from '../utils';
import {WalletOfflineError} from './walletOfflineError';

export {
  WALLET_OFFLINE_ERROR_CODE,
  WalletOfflineError,
  isWalletOfflineError,
} from './walletOfflineError';

export const WALLET_OFFLINE_TOAST = 'Wallet offline — using cached data';
export const WALLET_ONLINE_TOAST = 'Wallet online';

type Subscriber = (online: boolean) => void;

const subscribers = new Set<Subscriber>();
let cachedOnline: boolean | null = null;
let fetchGuardInstalled = false;
let nativeGuardInstalled = false;

/** Native methods that perform LAN or Internet I/O. Local crypto is left alone. */
export const NATIVE_NETWORK_METHODS = [
  'postTx',
  'fetchData',
  'publishData',
  'runRelay',
  'listenForPeers',
  'discoverPeers',
  'nostrMpcTssSetup',
  'nostrMpcSendBTC',
  'nostrMpcSignPSBT',
  'mpcTssSetup',
  'dklsMpcTssSetup',
  'mpcSendBTCWithUTXOs',
  'dklsMpcSendBTCWithUTXOs',
  'dklsMpcSignPSBT',
] as const;

function readPersistedOnline(): boolean {
  return appConfigRepository.getBool(CONFIG_KEYS.WALLET_ONLINE, true);
}

function notify(online: boolean): void {
  subscribers.forEach(fn => {
    try {
      fn(online);
    } catch {
      // ignore subscriber errors
    }
  });
}

function abortInflightMempool(): void {
  try {
    // Lazy require avoids a cycle: MempoolClient → this module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {mempoolClient} = require('./MempoolClient');
    mempoolClient.abortAll();
  } catch (err) {
    dbg('walletOnlineStore: abortAll failed', err);
  }
}

export function isWalletOnline(): boolean {
  if (cachedOnline === null) {
    cachedOnline = readPersistedOnline();
  }
  return cachedOnline;
}

export function setWalletOnline(next: boolean): void {
  const prev = isWalletOnline();
  cachedOnline = next;
  appConfigRepository.setBool(CONFIG_KEYS.WALLET_ONLINE, next);
  if (prev && !next) {
    abortInflightMempool();
  }
  if (prev !== next) {
    notify(next);
  }
}

export function subscribeWalletOnline(fn: Subscriber): () => void {
  subscribers.add(fn);
  fn(isWalletOnline());
  return () => {
    subscribers.delete(fn);
  };
}

export function useWalletOnline(): boolean {
  const [online, setOnline] = useState(isWalletOnline);
  useEffect(() => subscribeWalletOnline(setOnline), []);
  return online;
}

/** User-initiated action: toast and return false when sandboxed. */
export function guardOnlineAction(message?: string): boolean {
  if (isWalletOnline()) {
    return true;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Toast = require('react-native-toast-message').default;
    Toast.show({
      type: 'info',
      text1: message ?? WALLET_OFFLINE_TOAST,
      position: 'top',
    });
  } catch (err) {
    dbg('walletOnlineStore: toast failed', err);
  }
  return false;
}

export function notifyWalletOnlineToggle(online: boolean): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Toast = require('react-native-toast-message').default;
    Toast.show({
      type: online ? 'success' : 'info',
      text1: online ? WALLET_ONLINE_TOAST : WALLET_OFFLINE_TOAST,
      position: 'top',
    });
  } catch (err) {
    dbg('walletOnlineStore: toggle toast failed', err);
  }
}

function wrapNativeNetworkMethods(mod?: Record<string, unknown> | null): void {
  if (nativeGuardInstalled) {
    return;
  }
  const target =
    mod ??
    (NativeModules.BBMTLibNativeModule as Record<string, unknown> | undefined);
  if (!target) {
    return;
  }
  for (const name of NATIVE_NETWORK_METHODS) {
    const orig = target[name];
    if (typeof orig !== 'function') {
      continue;
    }
    target[name] = (...args: unknown[]) => {
      if (!isWalletOnline()) {
        return Promise.reject(new WalletOfflineError());
      }
      return (orig as (...a: unknown[]) => unknown).apply(target, args);
    };
  }
  nativeGuardInstalled = true;
}

function wrapGlobalFetch(): void {
  if (fetchGuardInstalled) {
    return;
  }
  const g = globalThis as typeof globalThis & {
    fetch: typeof fetch;
  };
  if (typeof g.fetch !== 'function') {
    return;
  }
  const original = g.fetch.bind(g);
  g.fetch = ((input: RequestInfo, init?: RequestInit) => {
    if (!isWalletOnline()) {
      return Promise.reject(new WalletOfflineError());
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
  fetchGuardInstalled = true;
}

/** Patch global.fetch and native HTTP methods. Call once at app boot. */
export function installWalletOnlineNetworkGuard(
  nativeMod?: Record<string, unknown>,
): void {
  wrapGlobalFetch();
  wrapNativeNetworkMethods(nativeMod);
}

/** Test-only: clear in-memory cache and subscribers. Does not unpatch fetch. */
export function resetWalletOnlineForTests(): void {
  cachedOnline = null;
  subscribers.clear();
}
