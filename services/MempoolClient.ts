/**
 * MempoolClient — centralized HTTP cache + request deduplication layer.
 *
 * All mempool.space (and compatible) API calls should go through this module
 * instead of calling fetch() directly.  The two guarantees it provides:
 *
 *   1. CACHE — A successful (HTTP 200) response is reused for subsequent
 *      identical requests within the TTL window.  Failed responses are never
 *      cached, so a transient error never poisons the cache.
 *      Cache keys are host-independent: the same endpoint path served by
 *      different public hosts shares a single entry.
 *
 *   2. DEDUP — If two callers request the same URL while the first request is
 *      still in-flight, both await the same Promise.  Only one HTTP request
 *      is made.
 *
 *   3. FAILOVER — When the current API host is a known public mempool instance,
 *      a failed request is automatically retried on alternative public hosts
 *      (round-robin).  Custom (user-set) API bases are never failed-over.
 *
 * TTL defaults:
 *   - /address/…           15 s  (balance, UTXOs, transactions — default)
 *   - /v1/fees/recommended 30 s  (updates ~every block, no need to hammer)
 *   - /v1/prices           60 s  (price ticks slowly relative to UI refresh)
 *   - /tx/{txid}           5 min (confirmed tx content is immutable)
 *   - /v1/historical-price 7 d   (past-date price is immutable)
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

/**
 * Parse Retry-After header: integer seconds or HTTP-date.
 * Returns seconds to wait (1–120) or null if unparseable.
 */
function parseRetryAfter(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const trimmed = value.trim();
  const asNum = parseInt(trimmed, 10);
  if (!Number.isNaN(asNum) && asNum > 0) return asNum;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const seconds = Math.ceil((asDate - Date.now()) / 1000);
    return seconds > 0 ? seconds : null;
  }
  return null;
}

/**
 * Strips protocol://host[:port] from a URL, returning only /path?query.
 * This makes cache keys host-independent so the same endpoint served by
 * different public API hosts shares a single cache entry.
 *
 *   'https://mempool.space/api/address/bc1q.../txs'  → '/api/address/bc1q.../txs'
 *   'https://other.host/testnet/api/v1/prices'       → '/testnet/api/v1/prices'
 */
function stripHost(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+(\/.*)/);
  return m ? m[1] : url;
}

/** Extract protocol + host[:port] from a URL. */
function extractHost(url: string): string {
  const m = url.match(/^(https?:\/\/[^/]+)/);
  return m ? m[1] : '';
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
  /** When status === 429, server may send Retry-After; we parse it to seconds (1–120). */
  retryAfterSeconds?: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Per-endpoint TTL configuration
// ---------------------------------------------------------------------------

/** Default TTL — applies to balance, UTXO, and transaction endpoints. */
const DEFAULT_TTL_MS = 15_000; // 15 s

/**
 * URL pattern → TTL overrides (evaluated in order, first match wins).
 * Keep this list short and specific.
 */
const TTL_RULES: ReadonlyArray<[RegExp, number]> = [
  // Confirmed tx content is immutable — long TTL, rare re-fetch.
  [/\/tx\/[a-fA-F0-9]{64}$/, 300_000],
  // Fee rates refresh on each block (~10 min); 30 s is responsive without hammering.
  [/\/v1\/fees\/recommended/, 30_000],
  // BTC price endpoint — slow-moving relative to UI refresh rate.
  [/\/v1\/prices/, 60_000],
  // Historical price is immutable (past date); cache 30 days.
  [/\/v1\/historical-price\?/, 30 * 24 * 60 * 60 * 1000],
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
// Cache key — host-independent
// ---------------------------------------------------------------------------

/**
 * Builds a stable string key from the URL's path (+query) and optional body.
 * The host portion is stripped so the same endpoint served by different hosts
 * (e.g. mempool.space vs a mirror) shares a single cache entry and TTL.
 */
function buildKey(url: string, body?: string): string {
  const path = stripHost(url);
  return body ? `${path}\x00${body}` : path;
}

// ---------------------------------------------------------------------------
// MempoolClient
// ---------------------------------------------------------------------------

class MempoolClient {
  private static _instance: MempoolClient;

  /** Successful response cache, keyed by buildKey() (host-independent). */
  private readonly _cache = new Map<string, CacheEntry>();

  /**
   * In-flight request deduplication.
   * Key is host-independent, so concurrent requests for the same endpoint
   * via different hosts share a single in-flight promise.
   */
  private readonly _inflight = new Map<string, Promise<MempoolResponse<unknown>>>();

  /**
   * Known public API hosts (protocol + hostname, no trailing /api).
   * Requests targeting one of these hosts will failover to the others on error.
   */
  private _publicHosts: string[] = [];

  /** Round-robin index for distributing failover attempts. */
  private _rrIndex = 0;

  private constructor() {}

  static getInstance(): MempoolClient {
    if (!MempoolClient._instance) {
      MempoolClient._instance = new MempoolClient();
    }
    return MempoolClient._instance;
  }

  // -------------------------------------------------------------------------
  // Public host configuration (for round-robin failover)
  // -------------------------------------------------------------------------

  /**
   * Register the known public API base URLs (e.g. from getMainnetAPIList).
   * Accepts URLs with or without a trailing `/api` — the suffix is stripped
   * to produce bare host strings for matching against request URLs.
   *
   * When a request targeting one of these hosts fails, MempoolClient will
   * transparently retry on the other public hosts before giving up.
   * Custom (user-set) API bases that are NOT in this list are never
   * failed-over — the single host is used as-is.
   */
  setPublicBases(bases: string[]): void {
    const hosts = [
      ...new Set(
        bases
          .map(b => b.replace(/\/+$/, '').replace(/\/api\/?$/, ''))
          .filter(Boolean),
      ),
    ];
    if (hosts.length > 0) {
      this._publicHosts = hosts;
      dbg('MempoolClient: public hosts updated —', hosts);
    }
  }

  /**
   * Return alternative URLs for round-robin failover.
   * Empty array if the URL is on a custom host or testnet.
   */
  private _getFailoverUrls(url: string): string[] {
    if (this._publicHosts.length <= 1) return [];
    // Testnet only has one known host — no failover targets.
    if (url.includes('/testnet/')) return [];

    const host = extractHost(url);
    if (!host) return [];
    if (!this._publicHosts.includes(host)) return [];

    const path = url.slice(host.length);
    const alts: string[] = [];
    for (let i = 1; i <= this._publicHosts.length; i++) {
      const idx = (this._rrIndex + i) % this._publicHosts.length;
      if (this._publicHosts[idx] !== host) {
        alts.push(this._publicHosts[idx] + path);
      }
    }
    this._rrIndex = (this._rrIndex + 1) % this._publicHosts.length;
    return alts;
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

    // 3. Issue a new request (with failover for public hosts) --------------
    const ttl = init?.ttl ?? ttlForUrl(url);

    // Strip the custom `ttl` field so it is not forwarded to fetch().
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {ttl: _ttl, signal: callerSignal, ...restInit} = (init ?? {}) as RequestInit & {ttl?: number};

    const urls = [url, ...this._getFailoverUrls(url)];

    const promise = (async (): Promise<MempoolResponse<unknown>> => {
      let lastResult: MempoolResponse<unknown> | null = null;
      let lastError: unknown = null;

      try {
        for (let attempt = 0; attempt < urls.length; attempt++) {
          const tryUrl = urls[attempt];
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(
            () => timeoutController.abort(),
            FETCH_TIMEOUT_MS,
          );
          const signal = combineSignals(
            callerSignal as AbortSignal | undefined,
            timeoutController.signal,
          );

          try {
            const res = await fetch(tryUrl, {...restInit, signal});
            clearTimeout(timeoutId);

            if (res.ok) {
              const data = (await res.json()) as unknown;
              this._cache.set(key, {data, expiresAt: Date.now() + ttl});
              dbg(
                'MempoolClient: cached',
                tryUrl.slice(-80),
                `(ttl ${ttl / 1000}s)`,
              );
              return {ok: true, status: res.status, data};
            }

            // Non-2xx: do NOT cache — transient errors must not persist.
            dbg('MempoolClient: non-ok response', res.status, tryUrl.slice(-80));
            const out: MempoolResponse<unknown> = {
              ok: false,
              status: res.status,
              data: null as unknown,
            };
            if (res.status === 429) {
              const raw = res.headers.get('Retry-After');
              const seconds = parseRetryAfter(raw);
              if (seconds != null) {
                out.retryAfterSeconds = Math.min(120, Math.max(1, seconds));
                dbg('MempoolClient: 429 Retry-After', raw, '→', out.retryAfterSeconds, 's');
              }
            }
            lastResult = out;

            // Failover on server errors (5xx / 429), NOT on 4xx (client error).
            if ((res.status >= 500 || res.status === 429) && attempt < urls.length - 1) {
              dbg('MempoolClient: failover →', urls[attempt + 1].slice(-80));
              continue;
            }
            return out;
          } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            dbg('MempoolClient: fetch error', tryUrl.slice(-80), err);

            // Explicit caller abort — stop immediately, don't failover.
            if ((callerSignal as AbortSignal | undefined)?.aborted) {
              throw err;
            }

            if (attempt < urls.length - 1) {
              dbg('MempoolClient: failover →', urls[attempt + 1].slice(-80));
              continue;
            }
          }
        }

        // All URLs exhausted.
        if (lastResult) return lastResult;
        throw lastError;
      } finally {
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
   * Removes all cache entries whose key begins with the endpoint-path form
   * of `urlPrefix`.  Callers can pass a full URL — the host is stripped
   * automatically before matching.
   *
   * Example:
   *   mempoolClient.invalidate(`${apiBase}/api/address/${address}`);
   */
  invalidate(urlPrefix: string): void {
    const prefix = stripHost(urlPrefix);
    let count = 0;
    for (const key of this._cache.keys()) {
      if (key.startsWith(prefix)) {
        this._cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      dbg('MempoolClient: invalidated', count, 'entries matching', prefix);
    }
  }

  /**
   * Evicts in-flight dedup entries whose key begins with `urlPrefix`
   * (host-stripped automatically).
   * Call before retrying a request that was deduped to a stale/failing fetch.
   */
  evictInflight(urlPrefix: string): void {
    const prefix = stripHost(urlPrefix);
    for (const key of this._inflight.keys()) {
      if (key.startsWith(prefix)) {
        this._inflight.delete(key);
      }
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
