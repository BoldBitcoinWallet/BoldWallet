/**
 * BalanceSyncer — fetches per-address confirmed + mempool balances and writes to SQLite.
 *
 * ATOMIC: All addresses must succeed; otherwise nothing is written (no partial data).
 * On 429: retry with backoff (see rateLimitRetry); then throw if still failing.
 * Sync schedule: on app foreground + every 2 min (SyncCoordinator).
 * Bounded parallel fetches (min(3, enabled providers) when 2+; else 1); atomic write.
 */
import mempoolClient from '../MempoolClient';
import balanceRepository from '../repositories/BalanceRepository';
import syncRepository from '../repositories/SyncRepository';
import {INTER_ADDRESS_DELAY_MS, mapPool, sleep, with429Retry} from './rateLimitRetry';
import {dbg} from '../../utils';
import type {AddressBalance} from '../repositories/BalanceRepository';

/** Skip API call if the DB row was synced within this window. */
const BALANCE_DB_TTL_MS = 20_000; // 20 s

export interface AddressEntry {
  address: string;
  network: string;
}

interface MempoolAddressResponse {
  chain_stats: {funded_txo_sum: number; spent_txo_sum: number};
  mempool_stats: {funded_txo_sum: number; spent_txo_sum: number};
}

/** Thrown when any address fetch fails (atomic: no DB writes). */
export class BalanceSyncError extends Error {
  constructor(message: string, public readonly failedAddress?: string) {
    super(message);
    this.name = 'BalanceSyncError';
  }
}

class BalanceSyncer {
  /**
   * Fetch all addresses; only if every one succeeds, write all to DB.
   * On any failure throws BalanceSyncError and writes nothing.
   */
  async syncAddresses(
    addresses: AddressEntry[],
    apiBase: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    if (!addresses.length) return;
    const cleanApi = apiBase.replace(/\/+$/, '');
    const total = addresses.length;
    const concurrency = mempoolClient.syncPoolConcurrency(cleanApi);
    let skipped = 0;
    let fetchedCount = 0;

    const perAddress = await mapPool(
      addresses,
      concurrency,
      async entry => {
        const {address, network} = entry;
        const entityKey = `${address}_${network}`;
        if (syncRepository.isFresh('balance', entityKey, BALANCE_DB_TTL_MS)) {
          skipped++;
          return null;
        }

        if (concurrency === 1 && fetchedCount > 0) {
          await sleep(INTER_ADDRESS_DELAY_MS);
        }
        fetchedCount++;
        try {
          const url = `${cleanApi}/address/${encodeURIComponent(address)}`;
          const res = await with429Retry<MempoolAddressResponse>(
            'BalanceSyncer',
            () => mempoolClient.get<MempoolAddressResponse>(url),
          );
          if (!res.ok || !res.data) {
            throw new BalanceSyncError(
              `Balance fetch failed for address (${res.status ?? 'error'})`,
              address,
            );
          }

          const {chain_stats, mempool_stats} = res.data;
          const confirmedSats =
            (chain_stats.funded_txo_sum ?? 0) -
            (chain_stats.spent_txo_sum ?? 0);
          const pendingSats =
            (mempool_stats.funded_txo_sum ?? 0) -
            (mempool_stats.spent_txo_sum ?? 0);
          const balanceSats = Math.max(0, confirmedSats);
          const now = Date.now();
          dbg('BalanceSyncer: fetched', address.slice(0, 10), balanceSats, 'sats');
          return {
            address,
            network,
            balanceSats,
            pendingSats,
            hasNonzero: balanceSats > 0 || pendingSats > 0,
            fetchedAt: now,
          } as AddressBalance;
        } catch (err) {
          if (err instanceof BalanceSyncError) throw err;
          dbg('BalanceSyncer: error for', address.slice(0, 10), err);
          throw new BalanceSyncError(
            err instanceof Error ? err.message : 'Balance fetch failed',
            address,
          );
        }
      },
      (completed, poolTotal) => onProgress?.(completed, poolTotal),
    );

    const results = perAddress.filter((row): row is AddressBalance => row != null);

    if (!results.length) {
      if (skipped > 0) dbg('BalanceSyncer: all', skipped, 'addresses fresh — skipped');
      return;
    }

    // All fetched addresses succeeded — write in one transaction
    balanceRepository.setBalances(results);
    for (const {address, network} of results) {
      syncRepository.updateCursor('balance', `${address}_${network}`, null, 'ok');
    }
    dbg('BalanceSyncer: wrote', results.length, 'addresses (skipped', skipped, 'fresh)');
  }
}

const balanceSyncer = new BalanceSyncer();
export default balanceSyncer;
