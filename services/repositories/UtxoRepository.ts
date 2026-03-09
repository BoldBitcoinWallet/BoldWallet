/**
 * UtxoRepository — UTXO persistence.
 *
 * Previously UTXOs were only in MempoolClient's in-memory cache and lost on restart.
 * This repository persists them to SQLite so the app can show the UTXO list offline
 * and use them immediately for fee estimation without a network round-trip.
 */
import database from '../Database';
import {dbg} from '../../utils';

export interface StoredUtxo {
  txid: string;
  vout: number;
  address: string;
  network: string;
  valueSats: number;
  scriptPubkey: string | null;
  derivationPath: string | null;
  isConfirmed: boolean;
  blockHeight: number | null;
  fetchedAt: number;
}

class UtxoRepository {
  /**
   * Replace the entire UTXO set for an address atomically.
   * mempool.space always returns the full current UTXO set so a full replace is correct.
   */
  replaceUtxosForAddress(
    address: string,
    network: string,
    utxos: StoredUtxo[],
  ): void {
    try {
      database.transaction(tx => {
        tx.execute(
          'DELETE FROM utxos WHERE address = ? AND network = ?',
          [address, network],
        );
        for (const u of utxos) {
          tx.execute(
            `INSERT INTO utxos
               (txid, vout, address, network, value_sats, script_pubkey,
                derivation_path, is_confirmed, block_height, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              u.txid, u.vout, u.address, u.network,
              u.valueSats, u.scriptPubkey ?? null,
              u.derivationPath ?? null,
              u.isConfirmed ? 1 : 0,
              u.blockHeight ?? null,
              u.fetchedAt,
            ],
          );
        }
      });
    } catch (err) {
      dbg('UtxoRepository.replaceUtxosForAddress error', err);
    }
  }

  getUtxosForAddress(address: string, network: string): StoredUtxo[] {
    try {
      const {rows} = database.execute(
        'SELECT * FROM utxos WHERE address = ? AND network = ? ORDER BY fetched_at DESC',
        [address, network],
      );
      return rows.map(this._rowToUtxo);
    } catch (err) {
      dbg('UtxoRepository.getUtxosForAddress error', err);
      return [];
    }
  }

  /** Get all UTXOs for a list of addresses (HD wallet spend flow). */
  getUtxosForAddresses(addresses: string[], network: string): StoredUtxo[] {
    if (!addresses.length) return [];
    try {
      const placeholders = addresses.map(() => '?').join(',');
      const {rows} = database.execute(
        `SELECT * FROM utxos
         WHERE address IN (${placeholders}) AND network = ?
         ORDER BY value_sats DESC`,
        [...addresses, network],
      );
      return rows.map(this._rowToUtxo);
    } catch (err) {
      dbg('UtxoRepository.getUtxosForAddresses error', err);
      return [];
    }
  }

  /** Delete all UTXOs for an address (used to force re-sync before a send). */
  invalidateAddress(address: string, network: string): void {
    try {
      database.execute(
        'DELETE FROM utxos WHERE address = ? AND network = ?',
        [address, network],
      );
    } catch (err) {
      dbg('UtxoRepository.invalidateAddress error', err);
    }
  }

  /** Total confirmed satoshis across all addresses for a network. */
  getTotalSats(network: string): number {
    try {
      const {rows} = database.execute(
        'SELECT COALESCE(SUM(value_sats), 0) AS total FROM utxos WHERE network = ? AND is_confirmed = 1',
        [network],
      );
      return rows.length ? (rows[0].total as number) : 0;
    } catch {
      return 0;
    }
  }

  private _rowToUtxo(r: Record<string, unknown>): StoredUtxo {
    return {
      txid: r.txid as string,
      vout: r.vout as number,
      address: r.address as string,
      network: r.network as string,
      valueSats: r.value_sats as number,
      scriptPubkey: (r.script_pubkey as string) ?? null,
      derivationPath: (r.derivation_path as string) ?? null,
      isConfirmed: (r.is_confirmed as number) === 1,
      blockHeight: (r.block_height as number) ?? null,
      fetchedAt: r.fetched_at as number,
    };
  }
}

const utxoRepository = new UtxoRepository();
export default utxoRepository;
