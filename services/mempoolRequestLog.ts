/**
 * In-memory ring of recent mempool HTTP outcomes for the header Calls tab.
 * Fed by MempoolClient, traced raw fetches, and native (Go) mempool_http hooks.
 * Not persisted. Newest first.
 */

import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

export type MempoolRequestSource =
  | 'cache'
  | 'joined'
  | 'live'
  | 'timeout'
  | 'native';

export type MempoolRequestLogEntry = {
  id: string;
  at: number;
  host: string;
  path: string;
  method?: string;
  status: number;
  source: MempoolRequestSource;
  durationMs?: number;
  /** Truncated JSON/text body for traceability. */
  bodyPreview: string;
};

const MAX_ENTRIES = 40;
const BODY_MAX = 800;

type Subscriber = (entries: MempoolRequestLogEntry[]) => void;

const entries: MempoolRequestLogEntry[] = [];
const listeners = new Set<Subscriber>();
let seq = 0;

function emit() {
  const snapshot = entries.slice();
  listeners.forEach(fn => {
    try {
      fn(snapshot);
    } catch {
      // ignore subscriber errors
    }
  });
}

function compactBody(raw: unknown): string {
  if (raw == null) {
    return '';
  }
  if (typeof raw === 'string') {
    return raw;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function prettyBody(raw: unknown): string | null {
  try {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
      }
      if (trimmed.length > 20000) {
        return null;
      }
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    }
    return JSON.stringify(raw, null, 2);
  } catch {
    return null;
  }
}

export function truncateBodyPreview(raw: unknown): string {
  const pretty = prettyBody(raw);
  if (pretty && pretty.length <= BODY_MAX) {
    return pretty;
  }
  const text = compactBody(raw);
  if (text.length <= BODY_MAX) {
    return text;
  }
  return `${text.slice(0, BODY_MAX)}…`;
}

export function hostAndPathFromUrl(url: string): {host: string; path: string} {
  try {
    const m = url.match(/^(https?:\/\/[^/]+)(\/.*)?$/);
    if (m) {
      return {host: m[1], path: m[2] || '/'};
    }
  } catch {
    // fall through
  }
  return {host: '', path: url || '/'};
}

export type AppendMempoolRequestInput = {
  url: string;
  status: number;
  source: MempoolRequestSource;
  durationMs?: number;
  method?: string;
  body?: unknown;
};

export function appendMempoolRequest(input: AppendMempoolRequestInput): void {
  const {host, path} = hostAndPathFromUrl(input.url);
  seq += 1;
  const entry: MempoolRequestLogEntry = {
    id: `${Date.now()}-${seq}`,
    at: Date.now(),
    host,
    path,
    method: input.method?.trim().toUpperCase() || undefined,
    status: input.status,
    source: input.source,
    durationMs: input.durationMs,
    bodyPreview: truncateBodyPreview(input.body),
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }
  emit();
}

export function getMempoolRequestLog(): MempoolRequestLogEntry[] {
  return entries.slice();
}

export function subscribeMempoolRequestLog(fn: Subscriber): () => void {
  listeners.add(fn);
  fn(entries.slice());
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only. */
export function clearMempoolRequestLog(): void {
  entries.length = 0;
  emit();
}

type NativeMempoolHttpHook = {
  type?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  timeout?: boolean;
  bodyPreview?: string;
  error?: string;
  method?: string;
};

/** Ingest Go Hook JSON of type mempool_http (via TssHook / BBMT_* events). */
export function ingestNativeMempoolHttpHook(message: string): boolean {
  if (!message || message.indexOf('mempool_http') < 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(message) as NativeMempoolHttpHook;
    if (parsed.type !== 'mempool_http' || !parsed.url) {
      return false;
    }
    appendMempoolRequest({
      url: parsed.url,
      status: typeof parsed.status === 'number' ? parsed.status : 0,
      source: parsed.timeout ? 'timeout' : 'native',
      method: typeof parsed.method === 'string' ? parsed.method : undefined,
      durationMs:
        typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      body: parsed.bodyPreview || parsed.error || '',
    });
    return true;
  } catch {
    return false;
  }
}

let nativeTraceInstalled = false;

/**
 * Always-on listener for native mempool HTTP traces (Go FetchUTXOs,
 * FetchUTXODetails, RecommendedFees, PostTx). Safe to call once at boot.
 */
export function installNativeMempoolRequestTrace(): () => void {
  if (nativeTraceInstalled) {
    return () => {};
  }
  const mod = NativeModules.BBMTLibNativeModule;
  if (!mod) {
    return () => {};
  }
  nativeTraceInstalled = true;
  const emitter = new NativeEventEmitter(mod);
  const event = Platform.OS === 'android' ? 'BBMT_DROID' : 'BBMT_APPLE';
  const sub = emitter.addListener(
    event,
    (log: {tag?: string; message?: string}) => {
      const tag = log?.tag ?? '';
      const message = typeof log?.message === 'string' ? log.message : '';
      // TssHook carries Hook() payloads; other tags may still embed JSON.
      if (tag === 'TssHook' || message.includes('mempool_http')) {
        ingestNativeMempoolHttpHook(message);
      }
    },
  );
  return () => {
    sub.remove();
    nativeTraceInstalled = false;
  };
}
