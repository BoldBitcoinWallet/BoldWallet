/**
 * HD Options — discovery gap and API timing preferences.
 * Values are read from AppConfigRepository with fallback to defaults.
 * UI: WalletSettings → Wallet → HD Options.
 */
import appConfigRepository from './repositories/AppConfigRepository';

export const HD_OPTIONS_KEYS = {
  /** Consecutive unused addresses scanned during restore discovery. */
  GAP_LIMIT: 'hd_gap_limit',
  /** Default timeout for WalletService.withTimeout (price / native balance). */
  API_TIMEOUT_MS: 'api_timeout_ms',
  /** Skip repeat empty /utxo lookups on the send fallback path. */
  UTXO_EMPTY_CACHE_TTL_MS: 'utxo_empty_cache_ttl_ms',
  /** Abort timer for MempoolClient / Calls-tab HTTP (provider request timeout). */
  FETCH_TIMEOUT_MS: 'fetch_timeout_ms',
  /** In-memory TTL for unmatched mempool responses. */
  MEMPOOL_DEFAULT_TTL_MS: 'mempool_default_ttl_ms',
  /** How long an address's tx history is reused before downloading again. */
  TRANSACTION_DB_TTL_MS: 'transaction_db_ttl_ms',
} as const;

export const HD_OPTIONS_DEFAULTS = {
  // BIP-44 gap is 20. 10 is the default for a new install or a settings reset.
  // A stored hd_gap_limit always wins, so existing wallets keep their setting.
  [HD_OPTIONS_KEYS.GAP_LIMIT]: 10,
  [HD_OPTIONS_KEYS.API_TIMEOUT_MS]: 5000,
  [HD_OPTIONS_KEYS.UTXO_EMPTY_CACHE_TTL_MS]: 30_000,
  [HD_OPTIONS_KEYS.FETCH_TIMEOUT_MS]: 12_000,
  [HD_OPTIONS_KEYS.MEMPOOL_DEFAULT_TTL_MS]: 15_000,
  [HD_OPTIONS_KEYS.TRANSACTION_DB_TTL_MS]: 60_000,
} as const;

/** Legacy key removed from UI; still cleared on Restore defaults. */
const LEGACY_HD_OPTION_KEYS = ['hd_min_scan_index'] as const;

function parsePositiveInt(value: string | null, defaultVal: number): number {
  if (value == null || value.trim() === '') return defaultVal;
  const n = parseInt(value, 10);
  return Number.isNaN(n) || n < 0 ? defaultVal : n;
}

export function getGapLimit(): number {
  const v = appConfigRepository.get(HD_OPTIONS_KEYS.GAP_LIMIT);
  return parsePositiveInt(v, HD_OPTIONS_DEFAULTS[HD_OPTIONS_KEYS.GAP_LIMIT]);
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
  for (const key of LEGACY_HD_OPTION_KEYS) {
    appConfigRepository.remove(key);
  }
}
