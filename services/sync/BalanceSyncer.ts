/**
 * BalanceSyncer — fetches per-address confirmed + mempool balances and writes to SQLite.
 *
 * Sync schedule: on app foreground + every 30 s.
 * Sequential per address to avoid mempool.space rate limits.
 */
import mempoolClient from '../MempoolClient';
import balanceRepository from '../repositories/BalanceRepository';
import syncRepository from '../repositories/SyncRepository';
import {dbg} from '../../utils';

export interface AddressEntry {
  address: string;
  network: string;
}

interface MempoolAddressResponse {
  chain_stats: {funded_txo_sum: number; spent_txo_sum: number};
  mempool_stats: {funded_txo_sum: number; spent_txo_sum: number};
}

class BalanceSyncer {
  async syncAddresses(
    addresses: AddressEntry[],
    apiBase: string,
  ): Promise<void> {
    if (!addresses.length) return;
    const cleanApi = apiBase.replace(/\/+$/, '');

    for (const {address, network} of addresses) {
      try {
        const url = `${cleanApi}/address/${encodeURIComponent(address)}`;
        const res = await mempoolClient.get<MempoolAddressResponse>(url);
        if (!res.ok || !res.data) continue;

        const {chain_stats, mempool_stats} = res.data;
        const confirmedSats =
          (chain_stats.funded_txo_sum ?? 0) -
          (chain_stats.spent_txo_sum ?? 0);
        const pendingSats =
          (mempool_stats.funded_txo_sum ?? 0) -
          (mempool_stats.spent_txo_sum ?? 0);
        const balanceSats = Math.max(0, confirmedSats);
        const now = Date.now();

        balanceRepository.setBalance({
          address,
          network,
          balanceSats,
          pendingSats,
          hasNonzero: balanceSats > 0 || pendingSats > 0,
          fetchedAt: now,
        });

        syncRepository.updateCursor('balance', `${address}_${network}`, null, 'ok');
        dbg('BalanceSyncer: synced', address.slice(0, 10), balanceSats, 'sats');
      } catch (err) {
        dbg('BalanceSyncer: error for', address.slice(0, 10), err);
        syncRepository.updateCursor(
          'balance',
          `${address}_${network}`,
          null,
          'failed',
        );
      }
    }
  }
}

const balanceSyncer = new BalanceSyncer();
export default balanceSyncer;
