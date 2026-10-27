import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';
import {dbg, getMainnetAPIList} from '../utils';
import {tracedMempoolFetch} from './tracedMempoolFetch';
import {isWalletOnline} from './walletOnlineStore';

const MEMPOOL_API_VALIDATE_TIMEOUT_MS = 10_000;

/** Default public Mempool REST base for Bitcoin testnet4. */
export const CANONICAL_TESTNET_MEMPOOL_API_BASE =
  'https://mempool.space/testnet4/api';

export function isTestnetNetworkKey(network: string): boolean {
  return (
    network === 'testnet4' || network === 'testnet' || network === 'testnet3'
  );
}

/**
 * User/settings input: trim, strip trailing slashes, ensure path ends with `/api`
 * (same rules as WalletSettings / UserPreferenceScreen URL fields).
 */
export function normalizeUserMempoolApiInput(url: string): string {
  if (!url || url.trim() === '') {
    return url;
  }
  let normalized = url.trim();
  normalized = normalized.replace(/\/+$/, '');
  const apiPattern = /\/api$/i;
  if (!apiPattern.test(normalized)) {
    normalized = normalized + '/api';
  }
  return normalized;
}

/**
 * GET `${apiBase}/blocks/tip/hash` with timeout; true when response body is a 64-char hex tip hash.
 * Used when saving a custom Mempool REST base from settings.
 */
export async function validateMempoolApiBaseReachable(
  apiBase: string,
): Promise<boolean> {
  if (!isWalletOnline()) {
    dbg('API validation skipped: wallet offline');
    return false;
  }
  try {
    const testUrl = `${apiBase.replace(/\/$/, '')}/blocks/tip/hash`;
    dbg('Testing API endpoint:', testUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      MEMPOOL_API_VALIDATE_TIMEOUT_MS,
    );
    const response = await tracedMempoolFetch(testUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      dbg('API validation failed: HTTP', response.status);
      return false;
    }
    const blockHash = await response.text();
    const isValidBlockHash = /^[a-f0-9]{64}$/i.test(blockHash.trim());
    if (!isValidBlockHash) {
      dbg('API validation failed: Invalid block hash format:', blockHash);
      return false;
    }
    dbg('API validation successful:', blockHash);
    return true;
  } catch (error) {
    dbg('API validation error:', error);
    return false;
  }
}

/** Same normalization as WalletService / MempoolClient for comparing API roots. */
export function normalizeMempoolApiRoot(url: string): string {
  return (url || '').replace(/\/+$/, '').replace(/\/api\/?$/, '');
}

const MAINNET_MEMPOOL_DEFAULT_ROOT = normalizeMempoolApiRoot(
  'https://mempool.space/api',
);

/**
 * True when the stored URL is a plausible Mempool testnet4 REST base (not mainnet default).
 * Legacy installs may have `api_testnet3` = mainnet URL — those must be rejected.
 * Bare `/testnet/` (testnet3) URLs are rejected too: testnet3 is retired, and
 * accepting them would silently keep users on dead data.
 */
export function isValidTestnetMempoolApiUrl(url: string): boolean {
  const u = (url || '').trim().toLowerCase();
  if (!u) {
    return false;
  }
  if (u === 'https://mempool.space/api') {
    return false;
  }
  const root = normalizeMempoolApiRoot(url);
  if (root === MAINNET_MEMPOOL_DEFAULT_ROOT) {
    return false;
  }
  return u.includes('/testnet4');
}

/**
 * True when the URL is one of the curated public mainnet mirror bases.
 * Prefer the checkable provider list (`mempoolProvidersStore`) for runtime pool logic.
 */
export async function isKnownPublicMempoolMainnetBase(
  apiUrl: string,
): Promise<boolean> {
  const bases = await getMainnetAPIList();
  const roots = new Set(bases.map(normalizeMempoolApiRoot));
  return roots.has(normalizeMempoolApiRoot(apiUrl));
}

/**
 * Normalize route/user/legacy keys to the canonical native key.
 * 'testnet' and legacy 'testnet3' (persisted prefs) map to 'testnet4';
 * falsy maps to 'mainnet'; anything else passes through.
 */
export function normalizeNetworkKey(network: string): string {
  if (!network) {
    return 'mainnet';
  }
  if (network === 'testnet' || network === 'testnet3') {
    return 'testnet4';
  }
  return network;
}

/**
 * Stored active-network pref, normalized (legacy testnet/testnet3 →
 * testnet4; missing → mainnet). All state init reads the network
 * through here so no caller ever observes a retired key.
 */
export function getStoredNetworkKey(): string {
  return normalizeNetworkKey(
    appConfigRepository.get(CONFIG_KEYS.NETWORK) || '',
  );
}

/**
 * Per-network stored API base with legacy-key fallback: reads
 * `api_testnet4`, falling back to a pre-migration `api_testnet3`
 * value so existing installs keep their configured host.
 */
function getPerNetStoredApiBase(net: string): string | null {
  const perNet = appConfigRepository.get(`api_${net}`);
  if (perNet || net !== 'testnet4') {
    return perNet;
  }
  return appConfigRepository.get('api_testnet3');
}

/**
 * Mempool REST API base for wallet traffic (UTXO, balance, txs, sync).
 * Order: `api_<network>`, global `api`, then public mempool defaults.
 * Fee-market mirrors and dynamic host lists are separate (see setFeeAPIs / feeUtils).
 */
export function resolveStoredMempoolApiBase(network: string): string {
  const net = normalizeNetworkKey(network);
  const perNet = getPerNetStoredApiBase(net);

  if (net === 'testnet4') {
    if (perNet && isValidTestnetMempoolApiUrl(perNet)) {
      return perNet;
    }
    return CANONICAL_TESTNET_MEMPOOL_API_BASE;
  }

  if (perNet) {
    return perNet;
  }
  const global = appConfigRepository.get('api');
  if (global) {
    return global;
  }
  return 'https://mempool.space/api';
}

/**
 * Raw user-saved mempool REST base from `app_config` only (no public defaults).
 * Use to prefill settings / onboarding URL fields; empty when nothing was stored.
 */
export function getStoredUserMempoolApiBaseFromDb(network: string): string {
  const net = normalizeNetworkKey(network);
  const perNet = getPerNetStoredApiBase(net);

  if (net === 'testnet4') {
    if (perNet && isValidTestnetMempoolApiUrl(perNet)) {
      return perNet;
    }
    return '';
  }

  if (perNet) {
    return perNet;
  }
  const global = appConfigRepository.get('api');
  return global ?? '';
}

/** A stored BTC quote younger than this is still shown. */
export const PRICE_FRESH_MS = 120_000;

/**
 * Live BTC/fiat rates always come from mainnet `GET /api/v1/prices`.
 * Strip a trailing `/testnet4` only when it sits immediately before `/api`,
 * so `https://mempool.space/testnet4/api` stays `https://mempool.space/api`
 * and is never rewritten into `https://mempool.spaceapi`.
 */
export function mainnetPricesUrl(apiBase: string): string {
  const base = (apiBase || '')
    .replace(/\/+$/, '')
    .replace(/\/testnet4?(?=\/api\/?$)/, '');
  return `${base}/v1/prices`;
}

/**
 * Currency map from a mempool `/v1/prices` body.
 * Keeps positive 3-letter codes (USD, EUR, …) and drops `time` and other fields.
 */
export function fiatRatesFromPrices(
  data: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const rates: Record<string, number> = {};
  if (!data) {
    return rates;
  }
  for (const [key, value] of Object.entries(data)) {
    if (!/^[A-Z]{3}$/.test(key)) {
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      rates[key] = value;
    }
  }
  return rates;
}
