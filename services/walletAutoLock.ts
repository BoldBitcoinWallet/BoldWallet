/**
 * How long the wallet may stay unlocked after the app leaves the foreground.
 */
import {useEffect, useState} from 'react';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';

export type WalletAutoLockPolicy = 'instant' | '1m' | '5m' | 'never';

export const WALLET_AUTO_LOCK_DEFAULT: WalletAutoLockPolicy = '1m';

export const WALLET_AUTO_LOCK_OPTIONS: ReadonlyArray<{
  value: WalletAutoLockPolicy;
  label: string;
}> = [
  {value: 'instant', label: 'Instant on leaving'},
  {value: '1m', label: 'After 1 min'},
  {value: '5m', label: 'After 5 mins'},
  {value: 'never', label: 'Never'},
];

export const WALLET_AUTO_LOCK_MS: Record<
  WalletAutoLockPolicy,
  number | null
> = {
  instant: 0,
  '1m': 60_000,
  '5m': 5 * 60_000,
  never: null,
};

type Subscriber = (policy: WalletAutoLockPolicy) => void;

const subscribers = new Set<Subscriber>();
let cachedPolicy: WalletAutoLockPolicy | null = null;

export function normalizeWalletAutoLock(
  raw: string | null | undefined,
): WalletAutoLockPolicy {
  if (raw === 'instant' || raw === '1m' || raw === '5m' || raw === 'never') {
    return raw;
  }
  return WALLET_AUTO_LOCK_DEFAULT;
}

function readPersistedPolicy(): WalletAutoLockPolicy {
  return normalizeWalletAutoLock(
    appConfigRepository.get(CONFIG_KEYS.WALLET_AUTO_LOCK),
  );
}

function notify(policy: WalletAutoLockPolicy): void {
  subscribers.forEach(fn => {
    try {
      fn(policy);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function getWalletAutoLock(): WalletAutoLockPolicy {
  if (cachedPolicy === null) {
    cachedPolicy = readPersistedPolicy();
  }
  return cachedPolicy;
}

export function setWalletAutoLock(next: WalletAutoLockPolicy): void {
  const policy = normalizeWalletAutoLock(next);
  const prev = getWalletAutoLock();
  cachedPolicy = policy;
  appConfigRepository.set(CONFIG_KEYS.WALLET_AUTO_LOCK, policy);
  if (prev !== policy) {
    notify(policy);
  }
}

export function subscribeWalletAutoLock(fn: Subscriber): () => void {
  subscribers.add(fn);
  fn(getWalletAutoLock());
  return () => {
    subscribers.delete(fn);
  };
}

export function useWalletAutoLock(): WalletAutoLockPolicy {
  const [policy, setPolicy] = useState(getWalletAutoLock);
  useEffect(() => subscribeWalletAutoLock(setPolicy), []);
  return policy;
}

/**
 * Whether resume after `awayMs` should lock for the given policy.
 * `awayMs` is time since AppState went to background.
 */
export function shouldAutoLockOnResume(
  policy: WalletAutoLockPolicy,
  awayMs: number,
): boolean {
  const threshold = WALLET_AUTO_LOCK_MS[normalizeWalletAutoLock(policy)];
  if (threshold === null) {
    return false;
  }
  return awayMs >= threshold;
}

/** Test-only: clear in-memory cache and subscribers. */
export function resetWalletAutoLockForTests(): void {
  cachedPolicy = null;
  subscribers.clear();
}
