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
 *      different hosts shares a single entry.
 *
 *   2. DEDUP — If two callers request the same URL while the first request is
 *      still in-flight, both await the same Promise.  Only one HTTP request
 *      is made.
 *
 *   3. FAILOVER — When enabled provider bases are registered (setPublicBases from
 *      the checkable provider list), mainnet requests are routed through those
 *      hosts only (reliability order). A request URL pointing at a disabled or
 *      unknown host is rewritten onto the enabled pool — disabled providers are
 *      never contacted. We failover on 5xx/429 always; when multiple URLs are in
 *      use we also failover on 4xx. Testnet and an empty pool leave the URL as-is.
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
import {
  getFetchTimeoutMs,
  getMempoolDefaultTtlMs,
  getTransactionDbTtlMs,
} from './HdOptionsConfig';
import {rankedHosts, recordMempoolAttempt} from './mempoolHealth';
import {isWalletOnline} from './walletOnlineStore';
import {
  MULTI_PROVIDER_SYNC_CONCURRENCY,
  SINGLE_PROVIDER_SYNC_CONCURRENCY,
} from './sync/rateLimitRetry';

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

function isAbortOrTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const name = (err as {name?: string}).name ?? '';
  const message = (err as {message?: string}).message ?? '';
  return name === 'AbortError' || /timeout|aborted/i.test(message);
}

/** Observe-only: never changes cache, failover, or the value returned to callers. */
function observeAttempt(
  startedAt: number,
  outcome: {ok: boolean; timeout?: boolean; status: number},
  tryUrl: string,
): void {
  recordMempoolAttempt({
    ok: outcome.ok,
    timeout: outcome.timeout ?? false,
    status: outcome.status,
    durationMs: Date.now() - startedAt,
    at: Date.now(),
    host: extractHost(tryUrl) || undefined,
  });
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

/**
 * URL pattern → TTL overrides (evaluated in order, first match wins).
 * Keep this list short and specific.
 * Note: A batch of address/txs requests often takes longer than the TTL (e.g. 40+ s
 * for many addresses). The next run will then see cache expired and log "fetched and
 * cached" for every URL. Address/txs TTL is read from HD option TRANSACTION_DB_TTL_MS
 * so repeat runs within the same window can get "cache hit" and avoid duplicate network calls.
 */
const ADDRESS_TXS_TTL_PATTERN = /\/address\/[^/]+\/txs/;

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
  if (ADDRESS_TXS_TTL_PATTERN.test(url)) {
    return getTransactionDbTtlMs();
  }
  for (const [pattern, ttl] of TTL_RULES) {
    if (pattern.test(url)) {
      return ttl;
    }
  }
  return getMempoolDefaultTtlMs();
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
   * Enabled provider hosts (protocol + hostname, no trailing /api).
   * Requests targeting one of these hosts will failover to the others on error,
   * ordered by recent reliability scores.
   */
  private _enabledHosts: string[] = [];

  /**
   * Session AbortController. All get() requests combine this with the caller
   * signal. abortAll() aborts this so every in-flight request stops; then a
   * new controller is created for subsequent requests.
   */
  private _sessionController = new AbortController();

  private constructor() {}

  static getInstance(): MempoolClient {
    if (!MempoolClient._instance) {
      MempoolClient._instance = new MempoolClient();
    }
    return MempoolClient._instance;
  }

  // -------------------------------------------------------------------------
  // Enabled provider configuration (for ranked failover)
  // -------------------------------------------------------------------------

  /**
   * Register enabled API base URLs (from the checkable provider list).
   * Accepts URLs with or without a trailing `/api` — the suffix is stripped
   * to produce bare host strings for matching against request URLs.
   *
   * When a request targeting one of these hosts fails, MempoolClient will
   * transparently retry on the other enabled hosts (best reliability first)
   * before giving up. A single enabled host never fails over off-host.
   */
  setPublicBases(bases: string[]): void {
    const hosts = [
      ...new Set(
        bases
          .map(b => b.replace(/\/+$/, '').replace(/\/api\/?$/, ''))
          .filter(Boolean),
      ),
    ];
    this._enabledHosts = hosts;
    dbg(
      'MempoolClient: enabled hosts updated —',
      hosts.length ? hosts : '(cleared — no multi-host failover)',
    );
  }

  /** Enabled provider host roots currently registered for failover. */
  getEnabledHosts(): string[] {
    return [...this._enabledHosts];
  }

  /**
   * Aborts all in-flight API requests. Each get() in progress will reject with
   * an abort error. New requests after this call use a fresh session and run
   * normally. Call this when the user taps the cache indicator again while
   * sync is in progress to stop all mempool API calls.
   */
  abortAll(): void {
    this._sessionController.abort();
    this._sessionController = new AbortController();
    dbg('MempoolClient: abortAll — all in-flight requests aborted');
  }

  /**
   * Mainnet failover candidates: **only** registered enabled hosts.
   * If the request URL points at a disabled / unknown host, rewrite onto the
   * enabled pool so disabled providers are never contacted.
   * Testnet and an empty pool leave the original URL unchanged.
   */
  private _getUrlsToTry(url: string): string[] | null {
    if (this._enabledHosts.length === 0) return null;
    if (url.includes('/testnet/')) return null;

    const host = extractHost(url);
    const path = host ? url.slice(host.length) : url.startsWith('/') ? url : `/${url}`;

    if (this._enabledHosts.length === 1) {
      const only = this._enabledHosts[0];
      // Already targeting the sole enabled host — no rewrite needed.
      if (host === only) return null;
      return [only + path];
    }

    const ordered = rankedHosts(this._enabledHosts);
    return ordered.map(h => h + path);
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
    init?: RequestInit & {ttl?: number; timeoutMs?: number},
  ): Promise<MempoolResponse<T>> {
    const bodyStr =
      init?.body != null ? String(init.body) : undefined;
    const key = buildKey(url, bodyStr);
    const now = Date.now();

    // 1. Serve from cache if still fresh -----------------------------------
    // (Log "cache hit" = no fetch. "fetched and cached" below = we did a fetch then stored.)
    const cached = this._cache.get(key);
    if (cached && cached.expiresAt > now) {
      dbg('MempoolClient: cache hit', url.slice(-80));
      return {ok: true, status: 200, data: cached.data as T};
    }

    // Sandbox: never fetch or failover. Fresh cache (above) is still served.
    // Do not record health — offline is not a provider failure.
    if (!isWalletOnline()) {
      dbg('MempoolClient: offline — skip fetch', url.slice(-80));
      return {ok: false, status: 0, data: null as T};
    }

    // 2. Attach to an in-flight request if one exists ----------------------
    const existing = this._inflight.get(key);
    if (existing) {
      dbg('MempoolClient: dedup in-flight', url.slice(-80));
      return existing as Promise<MempoolResponse<T>>;
    }

    // 3. Issue a new request (with failover among enabled hosts) ----------
    const ttl = init?.ttl ?? ttlForUrl(url);

    // Strip custom fields so they are not forwarded to fetch().
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {ttl: _ttl, timeoutMs: timeoutOverride, signal: callerSignal, ...restInit} = (init ?? {}) as RequestInit & {ttl?: number; timeoutMs?: number};
    const fetchTimeoutMs = timeoutOverride ?? getFetchTimeoutMs();

    const urls = this._getUrlsToTry(url) ?? [url];

    const promise = (async (): Promise<MempoolResponse<unknown>> => {
      let lastResult: MempoolResponse<unknown> | null = null;
      let lastError: unknown = null;

      try {
        for (let attempt = 0; attempt < urls.length; attempt++) {
          const tryUrl = urls[attempt];
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(
            () => timeoutController.abort(),
            fetchTimeoutMs,
          );
          const timeAndCaller = combineSignals(
            callerSignal as AbortSignal | undefined,
            timeoutController.signal,
          );
          const signal = combineSignals(
            timeAndCaller,
            this._sessionController.signal,
          );

          const startedAt = Date.now();
          try {
            const res = await fetch(tryUrl, {...restInit, signal});
            clearTimeout(timeoutId);

            if (res.ok) {
              const data = (await res.json()) as unknown;
              this._cache.set(key, {data, expiresAt: Date.now() + ttl});
              observeAttempt(startedAt, {ok: true, status: res.status}, tryUrl);
              dbg(
                'MempoolClient: fetched and cached',
                tryUrl.slice(-80),
                `(ttl ${ttl / 1000}s)`,
              );
              return {ok: true, status: res.status, data};
            }

            // Non-2xx: do NOT cache — transient errors must not persist.
            dbg('MempoolClient: non-ok response', res.status, tryUrl.slice(-80));
            observeAttempt(startedAt, {ok: false, status: res.status}, tryUrl);
            await res.text().catch(() => {}); // consume body before possible failover
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

            // Failover: on 5xx/429 always try next; when multi-host, also try next on 4xx.
            if (attempt < urls.length - 1) {
              const doFailover =
                res.status >= 500 ||
                res.status === 429 ||
                (urls.length > 1 && !res.ok);
              if (doFailover) {
                dbg('MempoolClient: failover →', urls[attempt + 1].slice(-80));
                continue;
              }
            }
            return out;
          } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            observeAttempt(
              startedAt,
              {
                ok: false,
                timeout: isAbortOrTimeout(err),
                status: 0,
              },
              tryUrl,
            );
            dbg('MempoolClient: fetch error', tryUrl.slice(-80), err);

            // Explicit caller or session (abortAll) abort — stop immediately.
            if (
              (callerSignal as AbortSignal | undefined)?.aborted ||
              this._sessionController.signal.aborted
            ) {
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

  /**
   * Address-sync pool size: min(3, enabledCount) when 2+ providers are enabled,
   * otherwise 1 (single host).
   */
  syncPoolConcurrency(_apiBase?: string | null): number {
    const n = this._enabledHosts.length;
    if (n <= 1) {
      return SINGLE_PROVIDER_SYNC_CONCURRENCY;
    }
    return Math.min(MULTI_PROVIDER_SYNC_CONCURRENCY, n);
  }
}

export const mempoolClient = MempoolClient.getInstance();
export default mempoolClient;
