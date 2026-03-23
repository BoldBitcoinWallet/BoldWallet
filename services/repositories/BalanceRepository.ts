/**
 * BalanceRepository — per-address and aggregate wallet balances.
 *
 * Replaces LocalCache keys:
 *   wallet_balance_<address>
 *   wallet_balance_aggregate_<network>_<addressType>
 */
import database from '../Database';
import {dbg} from '../../utils';

export interface AddressBalance {
  address: string;
  network: string;
  balanceSats: number;
  pendingSats: number;
  hasNonzero: boolean;
  fetchedAt: number;
}

class BalanceRepository {
  getBalance(address: string, network: string): AddressBalance | null {
    try {
      const {rows} = database.execute(
        'SELECT * FROM address_balances WHERE address = ? AND network = ?',
        [address, network],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return {
        address: r.address as string,
        network: r.network as string,
        balanceSats: r.balance_sats as number,
        pendingSats: r.pending_sats as number,
        hasNonzero: (r.has_nonzero as number) === 1,
        fetchedAt: r.fetched_at as number,
      };
    } catch (err) {
      dbg('BalanceRepository.getBalance error', err);
      return null;
    }
  }

  setBalance(bal: AddressBalance): void {
    try {
      database.execute(
        `INSERT INTO address_balances
           (address, network, balance_sats, pending_sats, has_nonzero, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(address, network) DO UPDATE SET
           balance_sats = excluded.balance_sats,
           pending_sats = excluded.pending_sats,
           has_nonzero  = excluded.has_nonzero,
           fetched_at   = excluded.fetched_at`,
        [
          bal.address,
          bal.network,
          bal.balanceSats,
          bal.pendingSats,
          bal.hasNonzero ? 1 : 0,
          bal.fetchedAt,
        ],
      );
    } catch (err) {
      dbg('BalanceRepository.setBalance error', err);
    }
  }

  /** Get all balances for a given network (used for aggregate calculation). */
  getBalancesForNetwork(network: string): AddressBalance[] {
    try {
      const {rows} = database.execute(
        'SELECT * FROM address_balances WHERE network = ?',
        [network],
      );
      return rows.map(r => ({
        address: r.address as string,
        network: r.network as string,
        balanceSats: r.balance_sats as number,
        pendingSats: r.pending_sats as number,
        hasNonzero: (r.has_nonzero as number) === 1,
        fetchedAt: r.fetched_at as number,
      }));
    } catch (err) {
      dbg('BalanceRepository.getBalancesForNetwork error', err);
      return [];
    }
  }

  /** Sum all confirmed + pending balances across all addresses for a network. */
  getAggregateBalance(network: string): {
    balanceSats: number;
    pendingSats: number;
    hasNonzero: boolean;
    fetchedAt: number;
  } {
    try {
      const {rows} = database.execute(
        `SELECT
           COALESCE(SUM(balance_sats), 0) AS total_confirmed,
           COALESCE(SUM(pending_sats), 0) AS total_pending,
           MAX(fetched_at)                AS newest_fetch
         FROM address_balances
         WHERE network = ?`,
        [network],
      );
      if (!rows.length) {
        return {balanceSats: 0, pendingSats: 0, hasNonzero: false, fetchedAt: 0};
      }
      const r = rows[0];
      const confirmed = r.total_confirmed as number;
      const pending = r.total_pending as number;
      return {
        balanceSats: confirmed,
        pendingSats: pending,
        hasNonzero: confirmed > 0 || pending > 0,
        fetchedAt: (r.newest_fetch as number) ?? 0,
      };
    } catch (err) {
      dbg('BalanceRepository.getAggregateBalance error', err);
      return {balanceSats: 0, pendingSats: 0, hasNonzero: false, fetchedAt: 0};
    }
  }

  /** Batch-write balances in one transaction. */
  setBalances(bals: AddressBalance[]): void {
    if (!bals.length) return;
    try {
      database.transaction(tx => {
        for (const bal of bals) {
          tx.execute(
            `INSERT INTO address_balances
               (address, network, balance_sats, pending_sats, has_nonzero, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(address, network) DO UPDATE SET
               balance_sats = excluded.balance_sats,
               pending_sats = excluded.pending_sats,
               has_nonzero  = excluded.has_nonzero,
               fetched_at   = excluded.fetched_at`,
            [
              bal.address,
              bal.network,
              bal.balanceSats,
              bal.pendingSats,
              bal.hasNonzero ? 1 : 0,
              bal.fetchedAt,
            ],
          );
        }
      });
    } catch (err) {
      dbg('BalanceRepository.setBalances error', err);
    }
  }
}

const balanceRepository = new BalanceRepository();
export default balanceRepository;
