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
