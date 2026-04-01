import appConfigRepository from './repositories/AppConfigRepository';
import {getMainnetAPIList} from '../utils';

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
