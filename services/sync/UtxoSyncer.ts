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
import {INTER_ADDRESS_DELAY_MS, sleep, with429Retry} from './rateLimitRetry';
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

    const results: Array<{address: string; network: string; derivationPath: string | null; utxos: StoredUtxo[]}> = [];

    for (let i = 0; i < addresses.length; i++) {
      onProgress?.(i + 1, total);
      const {address, network, derivationPath} = addresses[i];
      if (i > 0) {
        await sleep(INTER_ADDRESS_DELAY_MS);
      }
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

        results.push({address, network, derivationPath: derivationPath ?? null, utxos});
        dbg('UtxoSyncer: fetched', address.slice(0, 10), utxos.length, 'UTXOs');
      } catch (err) {
        if (err instanceof UtxoSyncError) throw err;
        dbg('UtxoSyncer: error for', address.slice(0, 10), err);
        throw new UtxoSyncError(
          err instanceof Error ? err.message : 'UTXO fetch failed',
          address,
        );
      }
    }

    // All succeeded — write each address's UTXOs (order doesn't matter; no partial state)
    for (const {address, network, utxos} of results) {
      utxoRepository.replaceUtxosForAddress(address, network, utxos);
      syncRepository.updateCursor('utxos', `${address}_${network}`, null, 'ok');
    }
    dbg('UtxoSyncer: atomic write complete', results.length, 'addresses');
  }
}

const utxoSyncer = new UtxoSyncer();
export default utxoSyncer;
