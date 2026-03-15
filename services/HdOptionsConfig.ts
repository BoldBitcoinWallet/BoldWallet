/**
 * HD Options — configurable preferences for discovery gap, scan range, and API timeouts.
 * Values are read from AppConfigRepository with fallback to defaults.
 * UI: WalletSettings → Wallet → HD Options.
 */
import appConfigRepository from './repositories/AppConfigRepository';

export const HD_OPTIONS_KEYS = {
  GAP_LIMIT: 'hd_gap_limit',
  MIN_SCAN_INDEX: 'hd_min_scan_index',
  API_TIMEOUT_MS: 'api_timeout_ms',
  UTXO_EMPTY_CACHE_TTL_MS: 'utxo_empty_cache_ttl_ms',
  FETCH_TIMEOUT_MS: 'fetch_timeout_ms',
  MEMPOOL_DEFAULT_TTL_MS: 'mempool_default_ttl_ms',
  /** Skip tx sync / in-memory cache for address txs when DB was synced within this window. */
  TRANSACTION_DB_TTL_MS: 'transaction_db_ttl_ms',
} as const;

export const HD_OPTIONS_DEFAULTS = {
  [HD_OPTIONS_KEYS.GAP_LIMIT]: 2,
  [HD_OPTIONS_KEYS.MIN_SCAN_INDEX]: 5,
  [HD_OPTIONS_KEYS.API_TIMEOUT_MS]: 5000,
  [HD_OPTIONS_KEYS.UTXO_EMPTY_CACHE_TTL_MS]: 30_000,
  [HD_OPTIONS_KEYS.FETCH_TIMEOUT_MS]: 5_000,
  [HD_OPTIONS_KEYS.MEMPOOL_DEFAULT_TTL_MS]: 15_000,
  [HD_OPTIONS_KEYS.TRANSACTION_DB_TTL_MS]: 60_000,
} as const;

function parsePositiveInt(value: string | null, defaultVal: number): number {
  if (value == null || value.trim() === '') return defaultVal;
  const n = parseInt(value, 10);
  return Number.isNaN(n) || n < 0 ? defaultVal : n;
}

export function getGapLimit(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.GAP_LIMIT);
  return parsePositiveInt(v, HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.GAP_LIMIT]);
}

export function getMinScanIndex(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.MIN_SCAN_INDEX);
  return parsePositiveInt(
    v,
    HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.MIN_SCAN_INDEX],
  );
}

export function getApiTimeoutMs(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.API_TIMEOUT_MS);
  return parsePositiveInt(
    v,
    HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.API_TIMEOUT_MS],
  );
}

export function getUtxoEmptyCacheTtlMs(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.UTXO_EMPTY_CACHE_TTL_MS);
  return parsePositiveInt(
    v,
    HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.UTXO_EMPTY_CACHE_TTL_MS],
  );
}

export function getFetchTimeoutMs(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.FETCH_TIMEOUT_MS);
  return parsePositiveInt(
    v,
    HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.FETCH_TIMEOUT_MS],
  );
}

export function getMempoolDefaultTtlMs(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.MEMPOOL_DEFAULT_TTL_MS);
  return parsePositiveInt(
    v,
    HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.MEMPOOL_DEFAULT_TTL_MS],
  );
}

export function getTransactionDbTtlMs(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.TRANSACTION_DB_TTL_MS);
  return parsePositiveInt(
    v,
    HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.TRANSACTION_DB_TTL_MS],
  );
}

/** Remove all HD option overrides so getters return defaults. */
export function restoreHdOptionsDefaults(): void {
  for (const key of Object.values(HD_OPTIONS_KEYS)) {
    appConfigRepository.remove(key);
  }
}
