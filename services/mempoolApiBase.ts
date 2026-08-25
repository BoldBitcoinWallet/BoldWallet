import appConfigRepository from './repositories/AppConfigRepository';
import {dbg, getMainnetAPIList} from '../utils';
import {isWalletOnline} from './walletOnlineStore';

const MEMPOOL_API_VALIDATE_TIMEOUT_MS = 10_000;

/** Single allowed Mempool REST base for Bitcoin testnet (no custom / mainnet hosts). */
export const CANONICAL_TESTNET_MEMPOOL_API_BASE =
  'https://mempool.space/testnet/api';

export function isTestnetNetworkKey(network: string): boolean {
  return network === 'testnet3' || network === 'testnet';
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
    const response = await fetch(testUrl, {
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
 * True when the stored URL is a plausible Mempool testnet REST base (not mainnet default).
 * Legacy installs may have `api_testnet3` = mainnet URL — those must be rejected.
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
  return u.includes('/testnet');
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

/** Normalize route/user 'testnet' to native key 'testnet3'. Other networks pass through. */
export function normalizeNetworkKey(network: string): string {
  if (!network) {
    return 'mainnet';
  }
  return network === 'testnet' ? 'testnet3' : network;
}

/**
 * Mempool REST API base for wallet traffic (UTXO, balance, txs, sync).
 * Order: `api_<network>`, global `api`, then public mempool defaults.
 * Fee-market mirrors and dynamic host lists are separate (see setFeeAPIs / feeUtils).
 */
export function resolveStoredMempoolApiBase(network: string): string {
  const net = normalizeNetworkKey(network);
  const perNet = appConfigRepository.get(`api_${net}`);

  if (net === 'testnet3') {
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
  const perNet = appConfigRepository.get(`api_${net}`);

  if (net === 'testnet3') {
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
