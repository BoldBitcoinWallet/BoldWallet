import appConfigRepository from './repositories/AppConfigRepository';
import {dbg, getMainnetAPIList} from '../utils';

const MEMPOOL_API_VALIDATE_TIMEOUT_MS = 10_000;

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

/**
 * True when the URL is one of the dynamic public mainnet mirror bases (failover pool).
 * Private / self-hosted endpoints return false — MempoolClient must not round-robin them.
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
  if (perNet) {
    return perNet;
  }
  const global = appConfigRepository.get('api');
  if (global) {
    return global;
  }
  return net === 'testnet3'
    ? 'https://mempool.space/testnet/api'
    : 'https://mempool.space/api';
}
