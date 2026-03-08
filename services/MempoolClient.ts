/**
 * MempoolClient — centralized HTTP cache + request deduplication layer.
 *
 * All mempool.space (and compatible) API calls should go through this module
 * instead of calling fetch() directly.  The two guarantees it provides:
 *
 *   1. CACHE — A successful (HTTP 200) response is reused for subsequent
 *      identical requests within the TTL window.  Failed responses are never
 *      cached, so a transient error never poisons the cache.
 *
 *   2. DEDUP — If two callers request the same URL while the first request is
 *      still in-flight, both await the same Promise.  Only one HTTP request
 *      is made.
 *
 * TTL is 30 s by default.  Certain endpoints carry different defaults:
 *   - /tx/{txid}          5 min  (confirmed tx content is immutable)
 *   - /v1/fees/recommended 60 s  (updates ~every block)
 *   - /v1/prices           60 s  (price ticks slowly relative to UI refresh)
 *
 * Usage:
 *   import mempoolClient from './MempoolClient';
 *   const res = await mempoolClient.get<ApiUtxo[]>(url);
 *   if (!res.ok) { ... handle error ... }
 *   const utxos = res.data;
 */

import {dbg} from '../utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap applied to every outgoing HTTP request. */
const FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns an AbortSignal that fires when EITHER of the two input signals fires.
 * Falls back gracefully when one of them is undefined.
 *
 * React Native does not yet expose AbortSignal.any(), so we wire them manually.
 */
function combineSignals(
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): AbortSignal {
  if (!callerSignal) {
    return timeoutSignal;
  }
  const combined = new AbortController();

  if (callerSignal.aborted || timeoutSignal.aborted) {
    combined.abort();
    return combined.signal;
  }

  callerSignal.addEventListener('abort', () => combined.abort(), {once: true});
  timeoutSignal.addEventListener('abort', () => combined.abort(), {once: true});
  return combined.signal;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MempoolResponse<T = unknown> {
  /** true when the HTTP response was 2xx (or served from cache). */
  ok: boolean;
  /** HTTP status code of the original response (200 for cache hits). */
  status: number;
  /** Parsed JSON body. Only meaningful when ok === true. */
  data: T;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Per-endpoint TTL configuration
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 30_000; // 30 s

/**
 * URL pattern → TTL overrides (evaluated in order, first match wins).
 * Keep this list short and specific.
 */
const TTL_RULES: ReadonlyArray<[RegExp, number]> = [
  // Confirmed tx content is immutable — long TTL, rare re-fetch.
  [/\/tx\/[a-fA-F0-9]{64}$/, 300_000],
  // Fee rate refreshes on each block (~10 min), 60 s is fresh enough for UI.
  [/\/v1\/fees\/recommended/, 60_000],
  // BTC price endpoint.
  [/\/v1\/prices/, 60_000],
  // Historical price is immutable (past date); cache 7 days.
  [/\/v1\/historical-price\?/, 7 * 24 * 60 * 60 * 1000],
];

function ttlForUrl(url: string): number {
  for (const [pattern, ttl] of TTL_RULES) {
    if (pattern.test(url)) {
      return ttl;
    }
  }
  return DEFAULT_TTL_MS;
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

/**
 * Builds a stable string key from URL + optional request body.
 * Query parameters are already part of the URL string.
 */
function buildKey(url: string, body?: string): string {
  return body ? `${url}\x00${body}` : url;
}

// ---------------------------------------------------------------------------
// MempoolClient
// ---------------------------------------------------------------------------

class MempoolClient {
  private static _instance: MempoolClient;

  /** Successful response cache, keyed by buildKey(). */
  private readonly _cache = new Map<string, CacheEntry>();

  /**
   * In-flight request deduplication.
   * A key present here means an HTTP request is already running for that URL.
   * New callers receive the same Promise, so only one network round-trip runs.
   */
  private readonly _inflight = new Map<string, Promise<MempoolResponse<unknown>>>();

  private constructor() {}

  static getInstance(): MempoolClient {
    if (!MempoolClient._instance) {
      MempoolClient._instance = new MempoolClient();
    }
    return MempoolClient._instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Performs a GET (or POST) request with caching and in-flight deduplication.
   *
   * @param url     Full URL including query parameters.
   * @param init    Standard RequestInit; pass `signal` for abort support.
   *                Optionally pass `ttl` (ms) to override the default TTL.
   * @returns       MempoolResponse<T> — never throws for HTTP-level errors;
   *                rejects only on network-level failures (offline, abort).
   */
  async get<T = unknown>(
    url: string,
    init?: RequestInit & {ttl?: number},
  ): Promise<MempoolResponse<T>> {
    const bodyStr =
      init?.body != null ? String(init.body) : undefined;
    const key = buildKey(url, bodyStr);
    const now = Date.now();

    // 1. Serve from cache if still fresh -----------------------------------
    const cached = this._cache.get(key);
    if (cached && cached.expiresAt > now) {
      dbg('MempoolClient: cache hit', url.slice(-80));
      return {ok: true, status: 200, data: cached.data as T};
    }

    // 2. Attach to an in-flight request if one exists ----------------------
    const existing = this._inflight.get(key);
    if (existing) {
      dbg('MempoolClient: dedup in-flight', url.slice(-80));
      return existing as Promise<MempoolResponse<T>>;
    }

    // 3. Issue a new request -----------------------------------------------
    const ttl = init?.ttl ?? ttlForUrl(url);

    // Strip the custom `ttl` field so it is not forwarded to fetch().
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {ttl: _ttl, signal: callerSignal, ...restInit} = (init ?? {}) as RequestInit & {ttl?: number};

    const promise = (async (): Promise<MempoolResponse<unknown>> => {
      // Create a per-request timeout controller and combine with caller's signal.
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(
        () => timeoutController.abort(),
        FETCH_TIMEOUT_MS,
      );
      const signal = combineSignals(callerSignal as AbortSignal | undefined, timeoutController.signal);

      try {
        const res = await fetch(url, {...restInit, signal});

        if (res.ok) {
          const data = (await res.json()) as unknown;
          this._cache.set(key, {data, expiresAt: Date.now() + ttl});
          dbg(
            'MempoolClient: cached',
            url.slice(-80),
            `(ttl ${ttl / 1000}s)`,
          );
          return {ok: true, status: res.status, data};
        }

        // Non-2xx: do NOT cache — transient errors must not persist.
        dbg('MempoolClient: non-ok response', res.status, url.slice(-80));
        return {ok: false, status: res.status, data: null as unknown};
      } catch (err) {
        // Network error, timeout, or abort: propagate so callers can handle it.
        dbg('MempoolClient: fetch error', url.slice(-80), err);
        throw err;
      } finally {
        clearTimeout(timeoutId);
        // Always remove the in-flight entry so future callers get a fresh attempt.
        this._inflight.delete(key);
      }
    })();

    this._inflight.set(key, promise);
    return promise as Promise<MempoolResponse<T>>;
  }

  // -------------------------------------------------------------------------
  // Cache management
  // -------------------------------------------------------------------------

  /**
   * Removes all cache entries whose key begins with `urlPrefix`.
   * Useful after a transaction is broadcast to immediately allow fresh UTXO
   * and balance data for a specific address.
   *
   * Example:
   *   mempoolClient.invalidate(`${apiBase}/api/address/${address}`);
   */
  invalidate(urlPrefix: string): void {
    let count = 0;
    for (const key of this._cache.keys()) {
      if (key.startsWith(urlPrefix)) {
        this._cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      dbg('MempoolClient: invalidated', count, 'entries matching', urlPrefix);
    }
  }

  /**
   * Clears the entire response cache.
   * Call on network switch, address-type change, or full wallet restore.
   */
  invalidateAll(): void {
    const count = this._cache.size;
    this._cache.clear();
    dbg('MempoolClient: full cache clear —', count, 'entries removed');
  }

  /**
   * Removes entries whose TTL has elapsed.
   * The cache self-serves stale entries only within TTL, so calling prune()
   * is optional — its sole purpose is to release Map memory in long sessions.
   * Call on app foreground or after a large batch of address scans.
   */
  prune(): void {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this._cache) {
      if (entry.expiresAt <= now) {
        this._cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      dbg('MempoolClient: pruned', count, 'expired entries');
    }
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  get cacheSize(): number {
    return this._cache.size;
  }

  get inflightCount(): number {
    return this._inflight.size;
  }
}

export const mempoolClient = MempoolClient.getInstance();
export default mempoolClient;
