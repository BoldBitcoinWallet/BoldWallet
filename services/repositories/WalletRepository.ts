/**
 * WalletRepository — HD wallet state and address cache.
 *
 * Replaces:
 *   LocalCache keys: hd_external_index_*, hd_change_index_*, hd_max_used_external_*,
 *                    hd_restore_done_*, hd_discovery_status_*, hd_discovery_last_at_*
 *
 * Also owns the new wallet_addresses table (previously recomputed every launch).
 */
import database from '../Database';
import {dbg} from '../../utils';

export interface HdState {
  network: string;
  addressType: string;
  externalIndex: number;
  changeIndex: number;
  maxUsedExternal: number;
  restoreDone: boolean;
  discoveryStatus: string | null;
  discoveryLastAt: number | null;
}

export interface WalletAddress {
  network: string;
  addressType: string;
  chain: number; // 0 = receive, 1 = change
  idx: number;
  address: string;
  isUsed: boolean;
  /** B2: ms timestamp when the user copied/shared this address; null = unpinned. */
  pinnedAt?: number | null;
}

class WalletRepository {
  // ── HD State ──────────────────────────────────────────────────────────────

  getHdState(network: string, addressType: string): HdState | null {
    try {
      const {rows} = database.execute(
        'SELECT * FROM hd_state WHERE network = ? AND address_type = ?',
        [network, addressType],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return {
        network: r.network as string,
        addressType: r.address_type as string,
        externalIndex: r.external_index as number,
        changeIndex: r.change_index as number,
        maxUsedExternal: r.max_used_external as number,
        restoreDone: (r.restore_done as number) === 1,
        discoveryStatus: (r.discovery_status as string) ?? null,
        discoveryLastAt: (r.discovery_last_at as number) ?? null,
      };
    } catch (err) {
      dbg('WalletRepository.getHdState error', err);
      return null;
    }
  }

  /** Upsert the full HD state row for a network+addressType. */
  setHdState(state: HdState): void {
    try {
      database.execute(
        `INSERT INTO hd_state
           (network, address_type, external_index, change_index,
            max_used_external, restore_done, discovery_status, discovery_last_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(network, address_type) DO UPDATE SET
           external_index    = excluded.external_index,
           change_index      = excluded.change_index,
           max_used_external = excluded.max_used_external,
           restore_done      = excluded.restore_done,
           discovery_status  = excluded.discovery_status,
           discovery_last_at = excluded.discovery_last_at`,
        [
          state.network,
          state.addressType,
          state.externalIndex,
          state.changeIndex,
          state.maxUsedExternal,
          state.restoreDone ? 1 : 0,
          state.discoveryStatus ?? null,
          state.discoveryLastAt ?? null,
        ],
      );
    } catch (err) {
      dbg('WalletRepository.setHdState error', err);
    }
  }

  /** Convenience: read just the external (receive) index. */
  getExternalIndex(network: string, addressType: string): number {
    try {
      const {rows} = database.execute(
        'SELECT external_index FROM hd_state WHERE network = ? AND address_type = ?',
        [network, addressType],
      );
      return rows.length > 0 ? (rows[0].external_index as number) : 0;
    } catch (err) {
      dbg('WalletRepository.getExternalIndex error', err);
      return 0;
    }
  }

  /** Convenience: read just the change index. */
  getChangeIndex(network: string, addressType: string): number {
    try {
      const {rows} = database.execute(
        'SELECT change_index FROM hd_state WHERE network = ? AND address_type = ?',
        [network, addressType],
      );
      return rows.length > 0 ? (rows[0].change_index as number) : 0;
    } catch (err) {
      dbg('WalletRepository.getChangeIndex error', err);
      return 0;
    }
  }

  /** Convenience: read max_used_external. */
  getMaxUsedExternal(network: string, addressType: string): number {
    try {
      const {rows} = database.execute(
        'SELECT max_used_external FROM hd_state WHERE network = ? AND address_type = ?',
        [network, addressType],
      );
      return rows.length > 0 ? (rows[0].max_used_external as number) : 0;
    } catch (err) {
      dbg('WalletRepository.getMaxUsedExternal error', err);
      return 0;
    }
  }

  /** Patch a single integer field in hd_state, creating the row if absent. */
  private patchHdField(
    network: string,
    addressType: string,
    field: string,
    value: number | string | null,
  ): void {
    // Ensure row exists first
    database.execute(
      `INSERT OR IGNORE INTO hd_state (network, address_type) VALUES (?, ?)`,
      [network, addressType],
    );
    database.execute(
      `UPDATE hd_state SET ${field} = ? WHERE network = ? AND address_type = ?`,
      [value, network, addressType],
    );
  }

  setExternalIndex(network: string, addressType: string, value: number): void {
    try {
      this.patchHdField(network, addressType, 'external_index', Math.max(0, Math.floor(value)));
      dbg('WalletRepository: setExternalIndex', {network, addressType, value});
    } catch (err) {
      dbg('WalletRepository.setExternalIndex error', err);
    }
  }

  setChangeIndex(network: string, addressType: string, value: number): void {
    try {
      this.patchHdField(network, addressType, 'change_index', Math.max(0, Math.floor(value)));
      dbg('WalletRepository: setChangeIndex', {network, addressType, value});
    } catch (err) {
      dbg('WalletRepository.setChangeIndex error', err);
    }
  }

  setMaxUsedExternal(network: string, addressType: string, value: number): void {
    try {
      this.patchHdField(network, addressType, 'max_used_external', Math.max(0, Math.floor(value)));
    } catch (err) {
      dbg('WalletRepository.setMaxUsedExternal error', err);
    }
  }

  incrementChangeIndex(network: string, addressType: string): number {
    try {
      const current = this.getChangeIndex(network, addressType);
      const next = current + 1;
      this.setChangeIndex(network, addressType, next);
      dbg('WalletRepository: incrementChangeIndex', {network, addressType, next});
      return next;
    } catch (err) {
      dbg('WalletRepository.incrementChangeIndex error', err);
      return 0;
    }
  }

  setRestoreDone(network: string, addressType: string, done: boolean): void {
    try {
      this.patchHdField(network, addressType, 'restore_done', done ? 1 : 0);
    } catch (err) {
      dbg('WalletRepository.setRestoreDone error', err);
    }
  }

  setDiscoveryStatus(
    network: string,
    addressType: string,
    status: string,
    lastAt?: number,
  ): void {
    try {
      database.execute(
        `INSERT OR IGNORE INTO hd_state (network, address_type) VALUES (?, ?)`,
        [network, addressType],
      );
      database.execute(
        `UPDATE hd_state
         SET discovery_status = ?, discovery_last_at = ?
         WHERE network = ? AND address_type = ?`,
        [status, lastAt ?? Date.now(), network, addressType],
      );
    } catch (err) {
      dbg('WalletRepository.setDiscoveryStatus error', err);
    }
  }

  // ── Wallet Addresses ──────────────────────────────────────────────────────

  upsertAddress(addr: WalletAddress): void {
    try {
      database.execute(
        `INSERT INTO wallet_addresses
           (network, address_type, chain, idx, address, is_used)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(network, address_type, chain, idx) DO UPDATE SET
           address = excluded.address,
           is_used = MAX(wallet_addresses.is_used, excluded.is_used),
           pinned_at = CASE WHEN excluded.is_used = 1 THEN NULL
                            ELSE wallet_addresses.pinned_at END`,
        [
          addr.network,
          addr.addressType,
          addr.chain,
          addr.idx,
          addr.address,
          addr.isUsed ? 1 : 0,
        ],
      );
    } catch (err) {
      dbg('WalletRepository.upsertAddress error', err);
    }
  }

  upsertAddressBatch(addrs: WalletAddress[]): void {
    if (!addrs.length) return;
    try {
      database.transaction(tx => {
        for (const addr of addrs) {
          tx.execute(
            `INSERT INTO wallet_addresses
               (network, address_type, chain, idx, address, is_used)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(network, address_type, chain, idx) DO UPDATE SET
               address = excluded.address,
               is_used = MAX(wallet_addresses.is_used, excluded.is_used),
               pinned_at = CASE WHEN excluded.is_used = 1 THEN NULL
                                ELSE wallet_addresses.pinned_at END`,
            [
              addr.network,
              addr.addressType,
              addr.chain,
              addr.idx,
              addr.address,
              addr.isUsed ? 1 : 0,
            ],
          );
        }
      });
    } catch (err) {
      dbg('WalletRepository.upsertAddressBatch error', err);
    }
  }

  getAddresses(
    network: string,
    addressType: string,
    chain: number,
  ): WalletAddress[] {
    try {
      const {rows} = database.execute(
        `SELECT * FROM wallet_addresses
         WHERE network = ? AND address_type = ? AND chain = ?
         ORDER BY idx ASC`,
        [network, addressType, chain],
      );
      return rows.map(r => ({
        network: r.network as string,
        addressType: r.address_type as string,
        chain: r.chain as number,
        idx: r.idx as number,
        address: r.address as string,
        isUsed: (r.is_used as number) === 1,
        pinnedAt: (r.pinned_at as number) ?? null,
      }));
    } catch (err) {
      dbg('WalletRepository.getAddresses error', err);
      return [];
    }
  }

  // markAddressUsed was removed: it had no runtime callers. The is_used flip
  // (and the pin clear that ends a pin's lifetime) lives in the upsert
  // ON CONFLICT branches above, which discovery actually calls.

  /**
   * Pin an address the user copied/shared so refreshes keep watching it even
   * after rotation moves it outside the active window. Idempotent: the first
   * timestamp wins. No-op when the row is not derived yet.
   */
  pinAddress(network: string, addressType: string, address: string): void {
    try {
      database.execute(
        `UPDATE wallet_addresses SET pinned_at = ?
         WHERE network = ? AND address_type = ? AND address = ?
           AND pinned_at IS NULL`,
        [Date.now(), network, addressType, address],
      );
    } catch (err) {
      dbg('WalletRepository.pinAddress error', err);
    }
  }

  /** Clear a pin (does not affect active-set membership via the used path). */
  unpinAddress(network: string, addressType: string, address: string): void {
    try {
      database.execute(
        `UPDATE wallet_addresses SET pinned_at = NULL
         WHERE network = ? AND address_type = ? AND address = ?`,
        [network, addressType, address],
      );
    } catch (err) {
      dbg('WalletRepository.unpinAddress error', err);
    }
  }

  /** All currently pinned addresses for a (network, addressType). */
  getPinnedAddresses(network: string, addressType: string): string[] {
    try {
      const {rows} = database.execute(
        `SELECT address FROM wallet_addresses
         WHERE network = ? AND address_type = ? AND pinned_at IS NOT NULL
         ORDER BY idx ASC`,
        [network, addressType],
      );
      return rows.map(r => r.address as string);
    } catch (err) {
      dbg('WalletRepository.getPinnedAddresses error', err);
      return [];
    }
  }

  isAddressKnown(address: string): boolean {
    try {
      const {rows} = database.execute(
        'SELECT 1 FROM wallet_addresses WHERE address = ? LIMIT 1',
        [address],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Single row for (network, addressType, chain, idx). chain 0 = receive, 1 = change.
   */
  getAddressAt(
    network: string,
    addressType: string,
    chain: number,
    idx: number,
  ): WalletAddress | null {
    try {
      const {rows} = database.execute(
        `SELECT * FROM wallet_addresses
         WHERE network = ? AND address_type = ? AND chain = ? AND idx = ?`,
        [network, addressType, chain, idx],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return {
        network: r.network as string,
        addressType: r.address_type as string,
        chain: r.chain as number,
        idx: r.idx as number,
        address: r.address as string,
        isUsed: (r.is_used as number) === 1,
        pinnedAt: (r.pinned_at as number) ?? null,
      };
    } catch (err) {
      dbg('WalletRepository.getAddressAt error', err);
      return null;
    }
  }

  /**
   * Highest change-chain (chain 1) idx whose address is referenced by local
   * history: a transaction_addresses link or a stored UTXO. -1 when none is
   * referenced. Only this wallet's (network, addressType) rows count.
   */
  getMaxReferencedChangeIdx(network: string, addressType: string): number {
    try {
      const {rows} = database.execute(
        `SELECT COALESCE(MAX(wa.idx), -1) AS m
         FROM wallet_addresses wa
         WHERE wa.network = ? AND wa.address_type = ? AND wa.chain = 1
           AND (
             EXISTS (SELECT 1 FROM transaction_addresses ta
                      WHERE ta.address = wa.address AND ta.network = wa.network)
             OR EXISTS (SELECT 1 FROM utxos u
                      WHERE u.address = wa.address AND u.network = wa.network)
           )`,
        [network, addressType],
      );
      return rows.length ? (rows[0].m as number) : -1;
    } catch (err) {
      dbg('WalletRepository.getMaxReferencedChangeIdx error', err);
      return -1;
    }
  }

  /**
   * Restart safety net for a change index that never advanced (e.g. the
   * process died after broadcast but before incrementChangeIndexAfterSend).
   * If local history already references change_idx N, advance to N+1 so the
   * next send never reuses that change address. Idempotent and offline.
   */
  reconcileChangeIndex(
    network: string,
    addressType: string,
  ): {bumped: boolean; from: number; to: number} {
    const from = this.getChangeIndex(network, addressType);
    const maxReferenced = this.getMaxReferencedChangeIdx(network, addressType);
    if (maxReferenced < 0 || from > maxReferenced) {
      return {bumped: false, from, to: from};
    }
    const to = maxReferenced + 1;
    this.setChangeIndex(network, addressType, to);
    dbg('WalletRepository: reconciled change index', {network, addressType, from, to});
    return {bumped: true, from, to};
  }

  /** Largest idx for chain (0 or 1), or -1 if none. */
  getMaxIdxForChain(
    network: string,
    addressType: string,
    chain: number,
  ): number {
    try {
      const {rows} = database.execute(
        `SELECT COALESCE(MAX(idx), -1) AS m FROM wallet_addresses
         WHERE network = ? AND address_type = ? AND chain = ?`,
        [network, addressType, chain],
      );
      if (!rows.length) return -1;
      return rows[0].m as number;
    } catch (err) {
      dbg('WalletRepository.getMaxIdxForChain error', err);
      return -1;
    }
  }
}

const walletRepository = new WalletRepository();
export default walletRepository;
