/**
 * UtxoSyncer — full replace UTXO set for each address from mempool.space.
 *
 * ATOMIC: All addresses must succeed; otherwise nothing is written (no partial data).
 * On 429: retry with backoff (see rateLimitRetry); then throw if still failing.
 * mempool.space always returns the complete current UTXO set per address.
 */
import mempoolClient from '../MempoolClient';
import utxoRepository from '../repositories/UtxoRepository';
import syncRepository from '../repositories/SyncRepository';
import {INTER_ADDRESS_DELAY_MS, mapPool, sleep, with429Retry} from './rateLimitRetry';
import {dbg} from '../../utils';
import type {StoredUtxo} from '../repositories/UtxoRepository';

interface ApiUtxo {
  txid: string;
  vout: number;
  value: number;
  status?: {
    confirmed?: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

/** Skip API call if the DB row was synced within this window. */
const UTXO_DB_TTL_MS = 60_000; // 60 s

export interface AddressEntry {
  address: string;
  network: string;
  derivationPath?: string;
}

/** Thrown when any address UTXO fetch fails (atomic: no DB writes). */
export class UtxoSyncError extends Error {
  constructor(message: string, public readonly failedAddress?: string) {
    super(message);
    this.name = 'UtxoSyncError';
  }
}

class UtxoSyncer {
  /**
   * Fetch UTXOs for all addresses; only if every one succeeds, write all to DB.
   * On any failure throws UtxoSyncError and writes nothing.
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
        const {address, network, derivationPath} = entry;
        const entityKey = `${address}_${network}`;
        if (syncRepository.isFresh('utxos', entityKey, UTXO_DB_TTL_MS)) {
          skipped++;
          return null;
        }

        if (concurrency === 1 && fetchedCount > 0) {
          await sleep(INTER_ADDRESS_DELAY_MS);
        }
        fetchedCount++;
        try {
          const url = `${cleanApi}/address/${encodeURIComponent(address)}/utxo`;
          const res = await with429Retry<ApiUtxo[]>(
            'UtxoSyncer',
            () => mempoolClient.get<ApiUtxo[]>(url),
          );
          if (!res.ok || !Array.isArray(res.data)) {
            throw new UtxoSyncError(
              `UTXO fetch failed for address (${res.status ?? 'error'})`,
              address,
            );
          }

          const now = Date.now();
          const utxos: StoredUtxo[] = res.data.map(u => ({
            txid: u.txid,
            vout: u.vout,
            address,
            network,
            valueSats: u.value,
            scriptPubkey: null,
            derivationPath: derivationPath ?? null,
            isConfirmed: u.status?.confirmed ?? true,
            blockHeight: u.status?.block_height ?? null,
            blockTime: u.status?.block_time ?? null,
            fetchedAt: now,
          }));
          dbg('UtxoSyncer: fetched', address.slice(0, 10), utxos.length, 'UTXOs');
          return {
            address,
            network,
            derivationPath: derivationPath ?? null,
            utxos,
          };
        } catch (err) {
          if (err instanceof UtxoSyncError) throw err;
          dbg('UtxoSyncer: error for', address.slice(0, 10), err);
          throw new UtxoSyncError(
            err instanceof Error ? err.message : 'UTXO fetch failed',
            address,
          );
        }
      },
      (completed, poolTotal) => onProgress?.(completed, poolTotal),
    );

    const results = perAddress.filter(
      (row): row is NonNullable<(typeof perAddress)[number]> => row != null,
    );

    if (!results.length) {
      if (skipped > 0) dbg('UtxoSyncer: all', skipped, 'addresses fresh — skipped');
      return;
    }

    for (const {address, network, utxos} of results) {
      utxoRepository.replaceUtxosForAddress(address, network, utxos);
      syncRepository.updateCursor('utxos', `${address}_${network}`, null, 'ok');
    }
    dbg('UtxoSyncer: wrote', results.length, 'addresses (skipped', skipped, 'fresh)');
  }
}

const utxoSyncer = new UtxoSyncer();
export default utxoSyncer;
