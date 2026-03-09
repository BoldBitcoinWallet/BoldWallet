/**
 * UtxoSyncer — full replace UTXO set for each address from mempool.space.
 *
 * mempool.space always returns the complete current UTXO set for an address,
 * so a full delete + insert is the correct strategy.
 *
 * Sync schedule: on app foreground + before any send operation.
 */
import mempoolClient from '../MempoolClient';
import utxoRepository from '../repositories/UtxoRepository';
import syncRepository from '../repositories/SyncRepository';
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

class UtxoSyncer {
  async syncAddresses(
    addresses: AddressEntry[],
    apiBase: string,
  ): Promise<void> {
    if (!addresses.length) return;
    const cleanApi = apiBase.replace(/\/+$/, '');

    for (const {address, network, derivationPath} of addresses) {
      try {
        const url = `${cleanApi}/address/${encodeURIComponent(address)}/utxo`;
        const res = await mempoolClient.get<ApiUtxo[]>(url);
        if (!res.ok || !Array.isArray(res.data)) continue;

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
          fetchedAt: now,
        }));

        utxoRepository.replaceUtxosForAddress(address, network, utxos);
        syncRepository.updateCursor('utxos', `${address}_${network}`, null, 'ok');
        dbg('UtxoSyncer: synced', address.slice(0, 10), utxos.length, 'UTXOs');
      } catch (err) {
        dbg('UtxoSyncer: error for', address.slice(0, 10), err);
        syncRepository.updateCursor(
          'utxos',
          `${address}_${network}`,
          null,
          'failed',
        );
      }
    }
  }
}

const utxoSyncer = new UtxoSyncer();
export default utxoSyncer;
