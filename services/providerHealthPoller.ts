/**
 * Singleton 30s mempool tip probe for the header health dot.
 *
 * Uses GET `{apiBase}/blocks/tip/hash` (same reachability check as Settings
 * Verify & Save) and records into mempoolHealth. Does not run while offline.
 */
import {
  recordMempoolAttempt,
  type MempoolAttempt,
} from './mempoolHealth';
import {isWalletOnline, isWalletOfflineError, subscribeWalletOnline} from './walletOnlineStore';
import {dbg} from '../utils';

export const PROVIDER_HEALTH_POLL_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;

let apiBase = '';
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
let probing = false;
let onlineUnsub: (() => void) | null = null;

function isAbortOrTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const name = (err as {name?: string}).name ?? '';
  const message = (err as {message?: string}).message ?? '';
  return name === 'AbortError' || /timeout|aborted/i.test(message);
}

function record(sample: Omit<MempoolAttempt, 'at'>): void {
  recordMempoolAttempt({...sample, at: Date.now()});
}

async function probe(): Promise<void> {
  if (!isWalletOnline() || !apiBase || probing) {
    return;
  }
  probing = true;
  const url = `${apiBase.replace(/\/$/, '')}/blocks/tip/hash`;
  const hostMatch = url.match(/^(https?:\/\/[^/]+)/);
  const host = hostMatch ? hostMatch[1] : undefined;
  const startedAt = Date.now();
  try {
    // MempoolClient parses JSON; tip/hash is a raw hex string, so use get()
    // only for cache/offline gating of the round-trip via a height probe
    // would be wrong for the hash check. Fetch is gated by the online wrapper
    // and by isWalletOnline above. Record ourselves so JSON parse is not required.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'GET',
      headers: {Accept: 'text/plain, application/json'},
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const body = await res.text();
    const ok = res.ok && /^[a-f0-9]{64}$/i.test(body.trim());
    record({
      ok,
      timeout: false,
      status: res.status,
      durationMs: Date.now() - startedAt,
      host,
    });
    dbg('providerHealthPoller:', ok ? 'ok' : 'bad', url.slice(-48));
  } catch (err) {
    if (isWalletOfflineError(err) || !isWalletOnline()) {
      return;
    }
    record({
      ok: false,
      timeout: isAbortOrTimeout(err),
      status: 0,
      durationMs: Date.now() - startedAt,
      host,
    });
    dbg('providerHealthPoller: error', err);
  } finally {
    probing = false;
  }
}

function ensureTimer(): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    void probe();
  }, PROVIDER_HEALTH_POLL_MS);
}

function clearTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function setProviderHealthApiBase(nextApiBase: string): void {
  const normalized = (nextApiBase || '').replace(/\/+$/, '');
  if (normalized === apiBase) {
    return;
  }
  apiBase = normalized;
  if (started && isWalletOnline() && apiBase) {
    void probe();
  }
}

export function startProviderHealthPoller(nextApiBase?: string): void {
  if (nextApiBase != null) {
    apiBase = nextApiBase.replace(/\/+$/, '');
  }
  if (started) {
    if (isWalletOnline() && apiBase) {
      void probe();
    }
    return;
  }
  started = true;
  onlineUnsub = subscribeWalletOnline(online => {
    if (online) {
      ensureTimer();
      void probe();
      return;
    }
    clearTimer();
  });
}

export function stopProviderHealthPoller(): void {
  started = false;
  probing = false;
  clearTimer();
  if (onlineUnsub) {
    onlineUnsub();
    onlineUnsub = null;
  }
}

/** Test-only: reset singleton timers and api base. */
export function resetProviderHealthPollerForTests(): void {
  stopProviderHealthPoller();
  apiBase = '';
}

/** Exposed for tests. */
export function getProviderHealthApiBaseForTests(): string {
  return apiBase;
}
