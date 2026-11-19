/**
 * TransactionRepository — transaction history, inputs, outputs, and pending tx tracking.
 *
 * Replaces LocalCache keys:
 *   wallet_transactions_<address>
 *   wallet_txs_<network>_<addressType>
 *   <address>-pendingTxs
 */
import database from '../Database';
import {dbg} from '../../utils';

export interface TxRecord {
  txid: string;
  network: string;
  blockHeight: number | null;
  blockHash: string | null;
  blockTime: number | null;
  isConfirmed: boolean;
  feeSats: number | null;
  size: number | null;
  weight: number | null;
  version: number | null;
  locktime: number | null;
  rawJson: string;
  fetchedAt: number;
  replacedByTxid?: string | null;
}

export interface TxAddressMapping {
  txid: string;
  network: string;
  address: string;
  netSats: number | null;
}

export interface PendingTx {
  txid: string;
  network: string;
  address: string;
  rawJson: string;
  createdAt: number;
}

export interface PendingTxData {
  txid: string;
  from?: string;
  to?: string;
  satoshiAmount?: number;
  satoshiFees?: number;
  sentAt?: number;
  [key: string]: unknown;
}

export interface ConflictTx {
  txid?: string;
  fee?: number;
  status?: {confirmed?: boolean};
  vin?: Array<{txid?: string; vout?: number; prevout?: {value?: number}}>;
  vout?: Array<{value?: number}>;
}

interface ConflictRow {
  txid: string;
  confirmed: boolean;
  fee: number;
  replacedBy: string | null;
  vins: NonNullable<ConflictTx['vin']>;
}

interface ConflictView {
  txid: string;
  confirmed: boolean;
  fee: number;
  replaced: boolean;
}

/** Absolute fee from input and output values, then the fee field. */
export function absoluteFeeSats(tx: ConflictTx): number | null {
  const vins = tx.vin ?? [];
  const vouts = tx.vout ?? [];
  const valued =
    vins.length > 0 &&
    vouts.length > 0 &&
    vins.every(vin => vin.prevout?.value != null);
  if (valued) {
    const inputs = vins.reduce((sum, vin) => sum + (vin.prevout?.value ?? 0), 0);
    const outputs = vouts.reduce((sum, vout) => sum + (vout.value ?? 0), 0);
    if (inputs >= outputs) {
      return inputs - outputs;
    }
  }
  return typeof tx.fee === 'number' ? tx.fee : null;
}

/**
 * Confirmed beats unconfirmed. A replaced unconfirmed tx never wins.
 * Otherwise the higher absolute fee wins. Equal fees leave both in place.
 */
export function replacementWinner(left: ConflictView, right: ConflictView): string | null {
  if (left.txid === right.txid) {
    return null;
  }
  if (left.confirmed !== right.confirmed) {
    return left.confirmed ? left.txid : right.txid;
  }
  if (left.confirmed && right.confirmed) {
    return null;
  }
  if (left.replaced !== right.replaced) {
    return left.replaced ? right.txid : left.txid;
  }
  if (left.replaced && right.replaced) {
    return null;
  }
  if (left.fee === right.fee) {
    return null;
  }
  return left.fee > right.fee ? left.txid : right.txid;
}

function parseTxJson(raw: unknown): ConflictTx {
  try {
    return JSON.parse(String(raw ?? '{}')) as ConflictTx;
  } catch {
    return {};
  }
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function outpointKeys(
  vins: Array<{txid?: string; vout?: number}> | undefined,
): Set<string> {
  const keys = new Set<string>();
  for (const vin of vins ?? []) {
    if (vin.txid != null && vin.vout != null) {
      keys.add(`${vin.txid}:${vin.vout}`);
    }
  }
  return keys;
}

function sharesOutpoint(
  vins: Array<{txid?: string; vout?: number}>,
  keys: Set<string>,
): boolean {
  for (const vin of vins) {
    if (vin.txid != null && vin.vout != null && keys.has(`${vin.txid}:${vin.vout}`)) {
      return true;
    }
  }
  return false;
}

function spendsTx(tx: ConflictTx, parentTxid: string): boolean {
  return (tx.vin ?? []).some(vin => vin.txid === parentTxid);
}

function localView(row: ConflictRow): ConflictView {
  return {
    txid: row.txid,
    confirmed: row.confirmed,
    fee: row.fee,
    replaced: !row.confirmed && !!row.replacedBy,
  };
}

function conflictView(
  txid: string,
  incoming: ConflictTx,
  stored: ConflictRow | undefined,
): ConflictView {
  const confirmed =
    incoming.status?.confirmed === true || stored?.confirmed === true;
  return {
    txid,
    confirmed,
    fee: absoluteFeeSats(incoming) ?? stored?.fee ?? incoming.fee ?? 0,
    replaced: !confirmed && !!stored?.replacedBy,
  };
}

class TransactionRepository {
  // ── Confirmed / history transactions ────────────────────────────────────

  upsertTransaction(tx: TxRecord, addresses: TxAddressMapping[]): void {
    try {
      database.transaction(svc => {
        svc.execute(
          `INSERT INTO transactions
             (txid, network, block_height, block_hash, block_time,
              is_confirmed, fee_sats, size, weight, version, locktime,
              raw_json, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(txid, network) DO UPDATE SET
             block_height = excluded.block_height,
             block_hash   = excluded.block_hash,
             block_time   = excluded.block_time,
             is_confirmed = excluded.is_confirmed,
             fee_sats     = excluded.fee_sats,
             size         = excluded.size,
             weight       = excluded.weight,
             raw_json     = excluded.raw_json,
             fetched_at   = excluded.fetched_at,
             replaced_by_txid = CASE
               WHEN excluded.is_confirmed = 1 THEN NULL
               ELSE transactions.replaced_by_txid
             END`,
          [
            tx.txid, tx.network,
            tx.blockHeight ?? null, tx.blockHash ?? null, tx.blockTime ?? null,
            tx.isConfirmed ? 1 : 0,
            tx.feeSats ?? null, tx.size ?? null, tx.weight ?? null,
            tx.version ?? null, tx.locktime ?? null,
            tx.rawJson, tx.fetchedAt,
          ],
        );

        for (const mapping of addresses) {
          svc.execute(
            `INSERT INTO transaction_addresses
               (txid, network, address, net_sats)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(txid, network, address) DO UPDATE SET
               net_sats = COALESCE(excluded.net_sats, transaction_addresses.net_sats)`,
            [mapping.txid, mapping.network, mapping.address, mapping.netSats ?? null],
          );
        }
      });
    } catch (err) {
      dbg('TransactionRepository.upsertTransaction error', err);
    }
  }

  /**
   * Batch upsert — used by TransactionSyncer for large page fetches.
   * All records written in one SQLite transaction.
   */
  upsertTransactionBatch(
    txs: Array<{tx: TxRecord; addresses: TxAddressMapping[]}>,
  ): void {
    if (!txs.length) return;
    try {
      database.transaction(svc => {
        for (const {tx, addresses} of txs) {
          svc.execute(
            `INSERT INTO transactions
               (txid, network, block_height, block_hash, block_time,
                is_confirmed, fee_sats, size, weight, version, locktime,
                raw_json, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(txid, network) DO UPDATE SET
               block_height = excluded.block_height,
               block_hash   = excluded.block_hash,
               block_time   = excluded.block_time,
               is_confirmed = excluded.is_confirmed,
               fee_sats     = excluded.fee_sats,
               size         = excluded.size,
               weight       = excluded.weight,
               raw_json     = excluded.raw_json,
               fetched_at   = excluded.fetched_at,
               replaced_by_txid = CASE
                 WHEN excluded.is_confirmed = 1 THEN NULL
                 ELSE transactions.replaced_by_txid
               END`,
            [
              tx.txid, tx.network,
              tx.blockHeight ?? null, tx.blockHash ?? null, tx.blockTime ?? null,
              tx.isConfirmed ? 1 : 0,
              tx.feeSats ?? null, tx.size ?? null, tx.weight ?? null,
              tx.version ?? null, tx.locktime ?? null,
              tx.rawJson, tx.fetchedAt,
            ],
          );

          for (const m of addresses) {
            svc.execute(
              `INSERT INTO transaction_addresses
                 (txid, network, address, net_sats)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(txid, network, address) DO UPDATE SET
                 net_sats = COALESCE(excluded.net_sats, transaction_addresses.net_sats)`,
              [m.txid, m.network, m.address, m.netSats ?? null],
            );
          }
        }
      });
    } catch (err) {
      dbg('TransactionRepository.upsertTransactionBatch error', err);
    }
  }

  /**
   * Ensure transaction_addresses rows exist for the given mappings.
   * Cheap no-op when the links already exist (INSERT OR IGNORE).
   */
  ensureAddressLinks(links: TxAddressMapping[]): void {
    if (!links.length) return;
    try {
      database.transaction(svc => {
        for (const m of links) {
          svc.execute(
            `INSERT INTO transaction_addresses
               (txid, network, address, net_sats)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(txid, network, address) DO UPDATE SET
               net_sats = COALESCE(excluded.net_sats, transaction_addresses.net_sats)`,
            [m.txid, m.network, m.address, m.netSats ?? null],
          );
        }
      });
    } catch (err) {
      dbg('TransactionRepository.ensureAddressLinks error', err);
    }
  }

  /** Get all transactions touching a given address, ordered newest first. */
  getTransactionsForAddress(
    address: string,
    network: string,
    limit = 50,
  ): TxRecord[] {
    try {
      const {rows} = database.execute(
        `SELECT t.* FROM transactions t
         JOIN transaction_addresses ta
           ON t.txid = ta.txid AND t.network = ta.network
         WHERE ta.address = ? AND t.network = ?
           AND (t.replaced_by_txid IS NULL OR t.replaced_by_txid = '')
         ORDER BY t.block_time DESC NULLS FIRST, t.fetched_at DESC
         LIMIT ?`,
        [address, network, limit],
      );
      return rows.map(this._rowToTx);
    } catch (err) {
      dbg('TransactionRepository.getTransactionsForAddress error', err);
      return [];
    }
  }

  /**
   * Get all transactions for a set of wallet addresses (HD wallet view).
   * Addresses must all belong to the same network.
   */
  getTransactionsForAddresses(
    addresses: string[],
    network: string,
    limit = 200,
  ): TxRecord[] {
    if (!addresses.length) return [];
    try {
      const placeholders = addresses.map(() => '?').join(',');
      const {rows} = database.execute(
        `SELECT DISTINCT t.* FROM transactions t
         JOIN transaction_addresses ta
           ON t.txid = ta.txid AND t.network = ta.network
         WHERE ta.address IN (${placeholders}) AND t.network = ?
           AND (t.replaced_by_txid IS NULL OR t.replaced_by_txid = '')
         ORDER BY t.block_time DESC NULLS FIRST, t.fetched_at DESC
         LIMIT ?`,
        [...addresses, network, limit],
      );
      return rows.map(this._rowToTx);
    } catch (err) {
      dbg('TransactionRepository.getTransactionsForAddresses error', err);
      return [];
    }
  }

  /**
   * Latest activity time per address (ms), from SQLite only:
   * max of (confirmed tx block_time/fetched_at) and (pending broadcast created_at).
   */
  getLastActivityTimestampsForAddresses(
    addresses: string[],
    network: string,
  ): Map<string, number> {
    const out = new Map<string, number>();
    if (!addresses.length) return out;
    const placeholders = addresses.map(() => '?').join(',');
    const params = [...addresses, network];
    try {
      const {rows} = database.execute(
        `SELECT ta.address,
                MAX(COALESCE(t.block_time, t.fetched_at)) AS last_activity
         FROM transaction_addresses ta
         JOIN transactions t
           ON ta.txid = t.txid AND ta.network = t.network
         WHERE ta.address IN (${placeholders}) AND t.network = ?
         GROUP BY ta.address`,
        params,
      );
      for (const r of rows) {
        const addr = r.address as string;
        const v = r.last_activity as number | null;
        if (addr && v != null && !Number.isNaN(v)) {
          out.set(addr, v);
        }
      }
    } catch (err) {
      dbg('TransactionRepository.getLastActivityTimestampsForAddresses error', err);
    }
    try {
      const {rows} = database.execute(
        `SELECT address, MAX(created_at) AS last_activity
         FROM pending_transactions
         WHERE address IN (${placeholders}) AND network = ?
         GROUP BY address`,
        params,
      );
      for (const r of rows) {
        const addr = r.address as string;
        const v = r.last_activity as number | null;
        if (!addr || v == null || Number.isNaN(v)) continue;
        const prev = out.get(addr);
        if (prev == null || v > prev) {
          out.set(addr, v);
        }
      }
    } catch (err) {
      dbg(
        'TransactionRepository.getLastActivityTimestampsForAddresses pending',
        err,
      );
    }
    return out;
  }

  /**
   * Insert a transaction immediately after successful broadcast so it appears
   * in the UI without waiting for API sync. Call from pairing screens (send_btc multi-path)
   * with full apiTxShape (vin/vout) built from the payload.
   *
   * NOTE: MobileNostrPairing fallback (empty p.inputs/p.outputs) yields a recipient-only
   * transaction_addresses row here; the change reference lands via
   * refreshSpendStateAfterBroadcast's UTXO sync in the same session. If that sync fails and
   * the app restarts before the next send, reconcileChangeIndex has no change reference to
   * find — see B1 known limitation.
   */
  insertBroadcastTransaction(
    txid: string,
    network: string,
    apiTxShape: {
      txid: string;
      status?: {confirmed?: boolean; block_height?: number | null; block_time?: number | null; block_hash?: string | null};
      fee?: number;
      vin?: Array<{
        txid?: string;
        vout?: number;
        sequence?: number;
        prevout?: {scriptpubkey_address?: string; value?: number};
      }>;
      vout?: Array<{scriptpubkey_address?: string; value?: number}>;
      size?: number | null;
      weight?: number | null;
    },
    senderAddress?: string,
  ): void {
    const status = apiTxShape.status ?? {confirmed: false, block_height: null, block_time: null, block_hash: null};
    const tx: TxRecord = {
      txid,
      network,
      blockHeight: status.block_height ?? null,
      blockHash: status.block_hash ?? null,
      blockTime: status.block_time ?? null,
      isConfirmed: status.confirmed ?? false,
      feeSats: apiTxShape.fee ?? null,
      size: apiTxShape.size ?? null,
      weight: apiTxShape.weight ?? null,
      version: null,
      locktime: null,
      rawJson: JSON.stringify(apiTxShape),
      fetchedAt: Date.now(),
    };
    const addresses = this._addressMappingsFromApiTx(txid, network, apiTxShape);
    this.upsertTransaction(tx, addresses);
    dbg('TransactionRepository: inserted broadcast tx', txid, 'for', (senderAddress ?? '').slice(0, 12));
  }

  /** Build TxAddressMapping[] from apiTxShape (vin/vout). */
  private _addressMappingsFromApiTx(
    txid: string,
    network: string,
    apiTx: {vin?: Array<{prevout?: {scriptpubkey_address?: string; value?: number}}>; vout?: Array<{scriptpubkey_address?: string; value?: number}>},
  ): TxAddressMapping[] {
    const netByAddress = new Map<string, number>();
    for (const vin of apiTx.vin ?? []) {
      const addr = vin.prevout?.scriptpubkey_address;
      if (addr) {
        const v = vin.prevout?.value ?? 0;
        netByAddress.set(addr, (netByAddress.get(addr) ?? 0) - v);
      }
    }
    for (const vout of apiTx.vout ?? []) {
      const addr = vout.scriptpubkey_address;
      if (addr) {
        const v = vout.value ?? 0;
        netByAddress.set(addr, (netByAddress.get(addr) ?? 0) + v);
      }
    }
    return Array.from(netByAddress.entries()).map(([address, netSats]) => ({
      txid,
      network,
      address,
      netSats,
    }));
  }

  /**
   * Write the chain's current status. A reorg can clear a block height that
   * this phone already stored.
   */
  applyChainStatus(
    txid: string,
    network: string,
    status: {
      confirmed: boolean;
      blockHeight?: number | null;
      blockTime?: number | null;
      blockHash?: string | null;
    },
  ): void {
    try {
      const {rows} = database.execute(
        'SELECT raw_json FROM transactions WHERE txid = ? AND network = ? LIMIT 1',
        [txid, network],
      );
      if (!rows.length) {
        return;
      }
      let rawJson = rows[0].raw_json as string;
      try {
        const parsed = JSON.parse(rawJson);
        const prev = parsed.status ?? {};
        parsed.status = {
          ...prev,
          confirmed: status.confirmed,
          block_height: status.confirmed ? status.blockHeight ?? null : null,
          block_time: status.confirmed ? status.blockTime ?? prev.block_time ?? null : null,
          block_hash: status.confirmed ? status.blockHash ?? prev.block_hash ?? null : null,
        };
        rawJson = JSON.stringify(parsed);
      } catch {
        // Keep the previous payload if it is not JSON.
      }
      database.execute(
        `UPDATE transactions
         SET is_confirmed = ?, block_height = ?, block_time = ?, block_hash = ?,
             raw_json = ?, fetched_at = ?,
             replaced_by_txid = CASE
               WHEN ? = 1 THEN NULL
               ELSE replaced_by_txid
             END
         WHERE txid = ? AND network = ?`,
        [
          status.confirmed ? 1 : 0,
          status.confirmed ? status.blockHeight ?? null : null,
          status.confirmed ? status.blockTime ?? null : null,
          status.confirmed ? status.blockHash ?? null : null,
          rawJson,
          Date.now(),
          status.confirmed ? 1 : 0,
          txid,
          network,
        ],
      );
    } catch (err) {
      dbg('TransactionRepository.applyChainStatus error', err);
    }
  }

  /** Mark a previously-unconfirmed transaction as confirmed. */
  markConfirmed(
    txid: string,
    network: string,
    blockHeight: number,
    blockTime: number,
    blockHash?: string,
  ): void {
    try {
      database.execute(
        `UPDATE transactions
         SET is_confirmed = 1, block_height = ?, block_time = ?, block_hash = ?,
             replaced_by_txid = NULL
         WHERE txid = ? AND network = ?`,
        [blockHeight, blockTime, blockHash ?? null, txid, network],
      );
    } catch (err) {
      dbg('TransactionRepository.markConfirmed error', err);
    }
  }

  /** Check whether a txid is already stored. */
  hasTx(txid: string, network: string): boolean {
    try {
      const {rows} = database.execute(
        'SELECT 1 FROM transactions WHERE txid = ? AND network = ? LIMIT 1',
        [txid, network],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  /** Return set of known txids for a network (for delta computation). */
  getKnownTxids(network: string): Set<string> {
    try {
      const {rows} = database.execute(
        'SELECT txid FROM transactions WHERE network = ?',
        [network],
      );
      return new Set(rows.map(r => r.txid as string));
    } catch (err) {
      dbg('TransactionRepository.getKnownTxids error', err);
      return new Set();
    }
  }

  // ── Pending transactions ─────────────────────────────────────────────────

  addPending(pending: PendingTx): void {
    try {
      database.execute(
        `INSERT OR REPLACE INTO pending_transactions
           (txid, network, address, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          pending.txid,
          pending.network,
          pending.address,
          pending.rawJson,
          pending.createdAt,
        ],
      );
    } catch (err) {
      dbg('TransactionRepository.addPending error', err);
    }
  }

  removePending(txid: string, network: string): void {
    try {
      database.execute(
        'DELETE FROM pending_transactions WHERE txid = ? AND network = ?',
        [txid, network],
      );
    } catch (err) {
      dbg('TransactionRepository.removePending error', err);
    }
  }

  /** Returns distinct addresses that have pending (unconfirmed) txs across either the
   *  pending_transactions table or the main transactions table (is_confirmed = 0).
   *  Used by getActiveAddressesWithPaths to include addresses with in-flight txs. */
  getAddressesWithPendingTxs(network: string): string[] {
    try {
      // pending_transactions table (local broadcast tracking)
      const {rows: pendingRows} = database.execute(
        'SELECT DISTINCT address FROM pending_transactions WHERE network = ?',
        [network],
      );
      // main transactions table — unconfirmed mempool entries
      const {rows: mempoolRows} = database.execute(
        `SELECT DISTINCT ta.address
         FROM transaction_addresses ta
         JOIN transactions t ON ta.txid = t.txid AND ta.network = t.network
         WHERE t.network = ? AND t.is_confirmed = 0
           AND (t.replaced_by_txid IS NULL OR t.replaced_by_txid = '')`,
        [network],
      );
      const addrs = new Set<string>();
      for (const r of pendingRows) addrs.add(r.address as string);
      for (const r of mempoolRows) addrs.add(r.address as string);
      return Array.from(addrs);
    } catch (err) {
      dbg('TransactionRepository.getAddressesWithPendingTxs error', err);
      return [];
    }
  }

  getPendingForAddress(address: string, network: string): PendingTx[] {
    try {
      const {rows} = database.execute(
        `SELECT * FROM pending_transactions
         WHERE address = ? AND network = ?
         ORDER BY created_at DESC`,
        [address, network],
      );
      return rows.map(r => ({
        txid: r.txid as string,
        network: r.network as string,
        address: r.address as string,
        rawJson: r.raw_json as string,
        createdAt: r.created_at as number,
      }));
    } catch (err) {
      dbg('TransactionRepository.getPendingForAddress error', err);
      return [];
    }
  }

  getPendingTxMap(
    address: string,
    network: string,
  ): Record<string, PendingTxData> {
    const pending = this.getPendingForAddress(address, network);
    const result: Record<string, PendingTxData> = {};
    for (const p of pending) {
      try {
        result[p.txid] = JSON.parse(p.rawJson) as PendingTxData;
      } catch {
        result[p.txid] = {txid: p.txid};
      }
    }
    return result;
  }

  setPendingTxMap(
    address: string,
    network: string,
    map: Record<string, PendingTxData>,
  ): void {
    try {
      database.transaction(tx => {
        tx.execute(
          'DELETE FROM pending_transactions WHERE address = ? AND network = ?',
          [address, network],
        );
        const now = Date.now();
        for (const [txid, data] of Object.entries(map)) {
          tx.execute(
            `INSERT OR REPLACE INTO pending_transactions
               (txid, network, address, raw_json, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [txid, network, address, JSON.stringify(data), now],
          );
        }
      });
    } catch (err) {
      dbg('TransactionRepository.setPendingTxMap error', err);
    }
  }

  /**
   * The replacement is in the mempool. Hide the stuck tx, its unconfirmed
   * children, and drop the pending row.
   */
  markReplaced(oldTxid: string, newTxid: string, network: string): void {
    if (!oldTxid || !newTxid || oldTxid === newTxid) {
      return;
    }
    try {
      database.transaction(svc => {
        const queue = [oldTxid];
        const seen = new Set<string>();
        while (queue.length) {
          const current = queue.shift() as string;
          if (seen.has(current) || current === newTxid) {
            continue;
          }
          seen.add(current);
          svc.execute(
            `UPDATE transactions SET replaced_by_txid = ?
             WHERE txid = ? AND network = ?
               AND is_confirmed = 0`,
            [newTxid, current, network],
          );
          svc.execute(
            `DELETE FROM pending_transactions WHERE txid = ? AND network = ?`,
            [current, network],
          );
          const {rows} = svc.execute(
            `SELECT txid, raw_json FROM transactions
             WHERE network = ? AND is_confirmed = 0
               AND (replaced_by_txid IS NULL OR replaced_by_txid = '')`,
            [network],
          );
          for (const row of rows ?? []) {
            const child = String(row.txid);
            if (spendsTx(parseTxJson(row.raw_json), current)) {
              queue.push(child);
            }
          }
        }
      });
    } catch (err) {
      dbg('TransactionRepository.markReplaced error', err);
    }
  }

  /**
   * After this phone broadcasts a replacement, hide every local unconfirmed
   * tx that spends the same inputs. A confirmed conflict wins instead.
   */
  markConflictsReplacedBy(
    newTxid: string,
    inputs: Array<{txid?: string; vout?: number}>,
    network: string,
  ): void {
    const keys = outpointKeys(inputs);
    if (!newTxid || !keys.size) {
      return;
    }
    try {
      const locals = this._conflictRows(network);
      for (const local of locals) {
        if (local.txid === newTxid || !sharesOutpoint(local.vins, keys)) {
          continue;
        }
        if (local.confirmed) {
          this.markReplaced(newTxid, local.txid, network);
        } else {
          this.markReplaced(local.txid, newTxid, network);
        }
      }
    } catch (err) {
      dbg('TransactionRepository.markConflictsReplacedBy error', err);
    }
  }

  /**
   * A synced tx spends an input that another local tx also spends.
   * Confirmed wins. Otherwise the higher absolute fee wins. A tx that is
   * already marked replaced, and still unconfirmed, never wins.
   */
  noteReplacementConflicts(network: string, incoming: ConflictTx[]): void {
    const parsed = incoming.filter(tx => tx.txid);
    if (!parsed.length) {
      return;
    }
    try {
      const locals = this._conflictRows(network);
      const byId = new Map(locals.map(row => [row.txid, row]));
      for (const inc of parsed) {
        const txid = inc.txid as string;
        const stored = byId.get(txid);
        const view = conflictView(txid, inc, stored);
        if (view.confirmed) {
          this._clearReplaced(txid, network);
        }
        if (view.replaced) {
          continue;
        }
        const keys = outpointKeys(inc.vin);
        for (const local of locals) {
          if (local.txid === txid || !sharesOutpoint(local.vins, keys)) {
            continue;
          }
          const winner = replacementWinner(localView(local), view);
          if (!winner) {
            continue;
          }
          const loser = winner === txid ? local.txid : txid;
          const loserConfirmed = winner === txid ? local.confirmed : view.confirmed;
          if (loserConfirmed) {
            continue;
          }
          this.markReplaced(loser, winner, network);
          if (loser === local.txid) {
            local.replacedBy = winner;
          }
        }
      }
    } catch (err) {
      dbg('TransactionRepository.noteReplacementConflicts error', err);
    }
  }

  private _clearReplaced(txid: string, network: string): void {
    database.execute(
      `UPDATE transactions SET replaced_by_txid = NULL
       WHERE txid = ? AND network = ? AND is_confirmed = 1`,
      [txid, network],
    );
  }

  private _conflictRows(network: string): ConflictRow[] {
    const {rows} = database.execute(
      `SELECT txid, is_confirmed, fee_sats, replaced_by_txid, raw_json
       FROM transactions
       WHERE network = ?`,
      [network],
    );
    return rows.map(row => {
      const parsed = parseTxJson(row.raw_json);
      const replacedBy = (row.replaced_by_txid as string) || null;
      return {
        txid: String(row.txid),
        confirmed: Number(row.is_confirmed) === 1,
        fee: absoluteFeeSats(parsed) ?? numOrNull(row.fee_sats) ?? 0,
        replacedBy,
        vins: parsed.vin ?? [],
      };
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _rowToTx(r: Record<string, unknown>): TxRecord {
    return {
      txid: r.txid as string,
      network: r.network as string,
      blockHeight: (r.block_height as number) ?? null,
      blockHash: (r.block_hash as string) ?? null,
      blockTime: (r.block_time as number) ?? null,
      isConfirmed: (r.is_confirmed as number) === 1,
      feeSats: (r.fee_sats as number) ?? null,
      size: (r.size as number) ?? null,
      weight: (r.weight as number) ?? null,
      version: (r.version as number) ?? null,
      locktime: (r.locktime as number) ?? null,
      rawJson: r.raw_json as string,
      fetchedAt: r.fetched_at as number,
      replacedByTxid: (r.replaced_by_txid as string) ?? null,
    };
  }
}

const transactionRepository = new TransactionRepository();
export default transactionRepository;
