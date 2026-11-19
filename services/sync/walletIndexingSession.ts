/**
 * Screen-independent HD indexing session.
 *
 * Dedupes concurrent discovery for the same network+addressType, reports
 * status for the home CacheIndicator, waits until the wallet is online when
 * needed, and runs a full refresh after a successful scan.
 */
import {useEffect, useState} from 'react';
import {dbg} from '../../utils';
import {WalletService} from '../WalletService';
import walletRepository from '../repositories/WalletRepository';
import {getStoredNetworkKey} from '../mempoolApiBase';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../repositories/AppConfigRepository';
import {
  isWalletOnline,
  subscribeWalletOnline,
} from '../walletOnlineStore';
import syncCoordinator from './SyncCoordinator';
import {runWalletRefreshSession} from './walletRefreshSession';
import mempoolClient from '../MempoolClient';

export type IndexingPhase =
  | 'idle'
  | 'waitingOnline'
  | 'scanning'
  | 'syncing'
  | 'failed';

export type IndexingStatus = {
  network: string;
  addressType: string;
  phase: IndexingPhase;
  label: string;
  error?: string | null;
};

export type IndexingResult = 'ok' | 'failed' | 'cancelled' | 'waitingOnline';

export type RequestWalletIndexingOpts = {
  network: string;
  addressType: string;
  apiBase: string;
  /** Re-run even when restoreDone is already true (Clear Cache / long-press). */
  force?: boolean;
  btcRate?: number;
};

type Subscriber = (status: IndexingStatus) => void;

const IDLE: IndexingStatus = {
  network: '',
  addressType: '',
  phase: 'idle',
  label: '',
  error: null,
};

let status: IndexingStatus = {...IDLE};
const subscribers = new Set<Subscriber>();

let inflightKey: string | null = null;
let inflightPromise: Promise<IndexingResult> | null = null;
let abortController: AbortController | null = null;
let onlineUnsub: (() => void) | null = null;
let resolveWaiting: ((result: IndexingResult) => void) | null = null;
/** Generation bumped on cancel so stale async work does not overwrite status. */
let runGeneration = 0;

function sessionKey(network: string, addressType: string): string {
  return `${network}|${addressType}`;
}

function notify(): void {
  subscribers.forEach(fn => {
    try {
      fn(status);
    } catch {
      // ignore subscriber errors
    }
  });
}

function setStatus(next: IndexingStatus): void {
  status = next;
  notify();
}

function clearOnlineWait(): void {
  if (onlineUnsub) {
    onlineUnsub();
    onlineUnsub = null;
  }
}

function isStillActiveTarget(network: string, addressType: string): boolean {
  const activeNet = getStoredNetworkKey();
  const activeType =
    appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) || 'segwit-native';
  return activeNet === network && activeType === addressType;
}

export function getIndexingStatus(): IndexingStatus {
  return status;
}

export function subscribeIndexingStatus(fn: Subscriber): () => void {
  subscribers.add(fn);
  fn(status);
  return () => {
    subscribers.delete(fn);
  };
}

export function useIndexingStatus(): IndexingStatus {
  const [s, setS] = useState(getIndexingStatus);
  useEffect(() => subscribeIndexingStatus(setS), []);
  return s;
}

export function cancelWalletIndexing(): void {
  runGeneration += 1;
  clearOnlineWait();
  if (resolveWaiting) {
    const done = resolveWaiting;
    resolveWaiting = null;
    done('cancelled');
  }
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  try {
    mempoolClient.abortAll();
  } catch {
    // ignore
  }
  inflightKey = null;
  inflightPromise = null;
  setStatus({...IDLE});
}

async function runScan(
  opts: RequestWalletIndexingOpts,
  generation: number,
): Promise<IndexingResult> {
  const {network, addressType, apiBase} = opts;
  const controller = new AbortController();
  abortController = controller;

  syncCoordinator.pause();
  let lastLabelKey = '';

  try {
    setStatus({
      network,
      addressType,
      phase: 'scanning',
      label: 'Discovering addresses…',
      error: null,
    });

    const ws = WalletService.getInstance();
    await ws.discoverHdIndexesForNetwork(
      network,
      addressType,
      apiBase,
      (chain, index, _gapIndex) => {
        if (generation !== runGeneration) {
          return;
        }
        // Update once per window-ish: chain + coarse index bucket so the
        // CacheIndicator fill window restarts infrequently.
        const chainLabel = chain === 'external' ? 'receive' : 'change';
        const bucket = Math.floor(index / 4) * 4;
        const labelKey = `${chain}:${bucket}`;
        if (labelKey === lastLabelKey && index !== 0) {
          return;
        }
        lastLabelKey = labelKey;
        setStatus({
          network,
          addressType,
          phase: 'scanning',
          label: `Scanning ${chainLabel} addresses… ${index + 1} checked`,
          error: null,
        });
      },
      {signal: controller.signal},
    );

    if (generation !== runGeneration || controller.signal.aborted) {
      return 'cancelled';
    }

    if (!isStillActiveTarget(network, addressType)) {
      dbg('walletIndexingSession: stale result after network/type change', {
        network,
        addressType,
      });
      setStatus({...IDLE});
      return 'cancelled';
    }

    const hdState = walletRepository.getHdState(network, addressType);
    if (!hdState?.restoreDone) {
      setStatus({
        network,
        addressType,
        phase: 'failed',
        label: '',
        error: 'Index discovery incomplete — tap to retry',
      });
      return 'failed';
    }

    setStatus({
      network,
      addressType,
      phase: 'syncing',
      label: 'Syncing wallet…',
      error: null,
    });

    try {
      await runWalletRefreshSession({
        network,
        addressType,
        apiBase,
        btcRate: opts.btcRate ?? 0,
        activeOnly: false,
        includeTx: true,
        forceTx: true,
      });
    } catch (err) {
      dbg('walletIndexingSession: refresh after scan failed', err);
      if (
        generation === runGeneration &&
        isStillActiveTarget(network, addressType)
      ) {
        setStatus({
          network,
          addressType,
          phase: 'failed',
          label: '',
          error: 'Sync after discovery failed — tap to retry',
        });
        return 'failed';
      }
      return 'cancelled';
    }

    if (generation !== runGeneration) {
      return 'cancelled';
    }

    setStatus({...IDLE});
    return 'ok';
  } catch (err) {
    if (
      (err instanceof Error && err.name === 'AbortError') ||
      generation !== runGeneration
    ) {
      return 'cancelled';
    }
    dbg('walletIndexingSession: scan failed', err);
    if (isStillActiveTarget(network, addressType)) {
      setStatus({
        network,
        addressType,
        phase: 'failed',
        label: '',
        error:
          err instanceof Error
            ? err.message
            : 'Index discovery failed — tap to retry',
      });
      return 'failed';
    }
    return 'cancelled';
  } finally {
    if (abortController === controller) {
      abortController = null;
    }
    syncCoordinator.resume();
  }
}

/**
 * Request HD discovery (+ post-scan refresh) for a network/addressType.
 * Concurrent requests for the same key join the in-flight promise.
 * A request for a different key cancels the running one.
 *
 * When the wallet is offline, status becomes `waitingOnline` and the promise
 * resolves with `'waitingOnline'` immediately; the session starts the scan
 * automatically once the wallet goes online (if still the active target).
 */
export function requestWalletIndexing(
  opts: RequestWalletIndexingOpts,
): Promise<IndexingResult> {
  const {network, addressType, force} = opts;
  const key = sessionKey(network, addressType);

  if (!force) {
    const hd = walletRepository.getHdState(network, addressType);
    if (hd?.restoreDone) {
      return Promise.resolve('ok');
    }
  }

  if (inflightPromise && inflightKey === key) {
    if (status.phase === 'waitingOnline') {
      return Promise.resolve('waitingOnline');
    }
    return inflightPromise;
  }

  if (inflightPromise && inflightKey !== key) {
    cancelWalletIndexing();
  }

  const generation = ++runGeneration;
  inflightKey = key;

  if (!isWalletOnline()) {
    setStatus({
      network,
      addressType,
      phase: 'waitingOnline',
      label: 'Waiting to go online…',
      error: null,
    });

    clearOnlineWait();
    const deferred = new Promise<IndexingResult>(resolve => {
      resolveWaiting = resolve;
      onlineUnsub = subscribeWalletOnline(online => {
        if (!online) {
          return;
        }
        clearOnlineWait();
        const finishWait = resolveWaiting;
        resolveWaiting = null;
        if (generation !== runGeneration) {
          finishWait?.('cancelled');
          return;
        }
        if (!isStillActiveTarget(network, addressType)) {
          setStatus({...IDLE});
          inflightKey = null;
          inflightPromise = null;
          finishWait?.('cancelled');
          return;
        }
        const scanPromise = runScan(opts, generation).finally(() => {
          if (inflightKey === key) {
            inflightKey = null;
            inflightPromise = null;
          }
        });
        inflightPromise = scanPromise;
        void scanPromise.then(
          result => finishWait?.(result),
          () => finishWait?.('failed'),
        );
      });
    });

    // Keep a handle so cancel / same-key join works while waiting.
    inflightPromise = deferred;
    return Promise.resolve('waitingOnline');
  }

  const started = runScan(opts, generation).finally(() => {
    if (inflightKey === key) {
      inflightKey = null;
      inflightPromise = null;
    }
  });
  inflightPromise = started;
  return started;
}

/** Test-only reset. */
export function resetWalletIndexingSessionForTests(): void {
  cancelWalletIndexing();
  runGeneration = 0;
  status = {...IDLE};
}
