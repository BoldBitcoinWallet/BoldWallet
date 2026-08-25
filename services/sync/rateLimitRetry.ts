/**
 * Shared helpers for 429 (rate limit) handling across BalanceSyncer, UtxoSyncer, TransactionSyncer.
 * Plan: §7 in docs/PLAN_ATOMIC_API_AND_UX.md — retry with backoff, keep atomicity.
 */
import {dbg} from '../../utils';

/** Delay before retrying after a 429 (ms). Use when Retry-After is not available. */
export const RATE_LIMIT_DELAY_MS = 5_000;

/** Max number of retries for a single request after 429 (so 3 attempts total). */
export const MAX_429_RETRIES = 2;

/** Optional delay between addresses to reduce chance of hitting 429 (ms). */
export const INTER_ADDRESS_DELAY_MS = 300;

/** Max parallel address fetches when multiple providers are enabled. */
export const MULTI_PROVIDER_SYNC_CONCURRENCY = 3;

/** Single enabled provider (or empty pool): serial to avoid 429s. */
export const SINGLE_PROVIDER_SYNC_CONCURRENCY = 1;

/** @deprecated Prefer MULTI_PROVIDER_SYNC_CONCURRENCY */
export const PUBLIC_SYNC_CONCURRENCY = MULTI_PROVIDER_SYNC_CONCURRENCY;

/** @deprecated Prefer SINGLE_PROVIDER_SYNC_CONCURRENCY */
export const CUSTOM_HOST_SYNC_CONCURRENCY = SINGLE_PROVIDER_SYNC_CONCURRENCY;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * If response is 429, wait (Retry-After when present, else fixed delay) and retry.
 * Returns the last response. Caller should check res.ok and throw if still failing after retries.
 */
export async function with429Retry<T>(
  label: string,
  request: () => Promise<{ok: boolean; status: number; data: T; retryAfterSeconds?: number}>,
): Promise<{ok: boolean; status: number; data: T; retryAfterSeconds?: number}> {
  let res = await request();
  let attempts = 0;
  while (!res.ok && res.status === 429 && attempts < MAX_429_RETRIES) {
    attempts++;
    const waitMs =
      res.retryAfterSeconds != null
        ? Math.min(120_000, Math.max(1000, res.retryAfterSeconds * 1000))
        : RATE_LIMIT_DELAY_MS;
    dbg(
      `${label}: 429 rate limited, waiting ${waitMs / 1000}s before retry (${attempts}/${MAX_429_RETRIES})`,
      res.retryAfterSeconds != null ? `(Retry-After: ${res.retryAfterSeconds}s)` : '',
    );
    await sleep(waitMs);
    res = await request();
  }
  return res;
}

/**
 * Map `items` with a bounded worker pool. On the first rejection remaining
 * workers stop taking new items; in-flight calls finish. Results keep input order.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;
  let completed = 0;
  let aborted = false;
  let firstError: unknown;

  const worker = async (): Promise<void> => {
    while (!aborted) {
      const i = next;
      next += 1;
      if (i >= items.length) {
        return;
      }
      try {
        results[i] = await fn(items[i], i);
        completed += 1;
        onProgress?.(completed, items.length);
      } catch (err) {
        aborted = true;
        firstError = err;
        throw err;
      }
    }
  };

  const workers = Array.from({length: limit}, () => worker());
  const settled = await Promise.allSettled(workers);
  if (firstError) {
    throw firstError;
  }
  const rejected = settled.find(s => s.status === 'rejected');
  if (rejected && rejected.status === 'rejected') {
    throw rejected.reason;
  }
  return results;
}
