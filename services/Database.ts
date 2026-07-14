/**
 * Database.ts — SQLite singleton for Bold Wallet.
 *
 * Replaces the file-based LocalCache (react-native-fs) with a single
 * WAL-mode SQLite database as the authoritative local store.
 *
 * EncryptedStorage (keyshare, btcPub, etc.) is NOT touched here.
 */
import {open, type DB, type Scalar} from '@op-engineering/op-sqlite';
import {dbg} from '../utils';

// ---------------------------------------------------------------------------
// DDL — executed once on every open() call (all statements are IF NOT EXISTS)
// ---------------------------------------------------------------------------
const SCHEMA_STATEMENTS = [
  // ── App Configuration (replaces all single-value LocalCache preference keys) ─
  `CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  // ── Network Providers (replaces api, api_mainnet, api_testnet3 keys) ─────────
  `CREATE TABLE IF NOT EXISTS network_providers (
    network    TEXT NOT NULL,
    api_url    TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (network, api_url)
  )`,

  // ── Nostr Relays (replaces nostr_relays CSV key) ──────────────────────────────
  `CREATE TABLE IF NOT EXISTS nostr_relays (
    url       TEXT PRIMARY KEY,
    is_active INTEGER NOT NULL DEFAULT 1,
    added_at  INTEGER NOT NULL
  )`,

  // ── HD Wallet State (replaces hd_*_<network>_<addressType> keys) ─────────────
  `CREATE TABLE IF NOT EXISTS hd_state (
    network           TEXT NOT NULL,
    address_type      TEXT NOT NULL,
    external_index    INTEGER NOT NULL DEFAULT 0,
    change_index      INTEGER NOT NULL DEFAULT 0,
    max_used_external INTEGER NOT NULL DEFAULT 0,
    restore_done      INTEGER NOT NULL DEFAULT 0,
    discovery_status  TEXT,
    discovery_last_at INTEGER,
    PRIMARY KEY (network, address_type)
  )`,

  // ── Wallet Addresses (new — previously recomputed from keyshare every time) ───
  `CREATE TABLE IF NOT EXISTS wallet_addresses (
    network      TEXT NOT NULL,
    address_type TEXT NOT NULL,
    chain        INTEGER NOT NULL,
    idx          INTEGER NOT NULL,
    address      TEXT NOT NULL,
    is_used      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (network, address_type, chain, idx)
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_addresses_addr
     ON wallet_addresses (address)`,

  // ── Address Balances (replaces wallet_balance_* and aggregate_* keys) ─────────
  `CREATE TABLE IF NOT EXISTS address_balances (
    address      TEXT NOT NULL,
    network      TEXT NOT NULL,
    balance_sats INTEGER NOT NULL DEFAULT 0,
    pending_sats INTEGER NOT NULL DEFAULT 0,
    has_nonzero  INTEGER NOT NULL DEFAULT 0,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (address, network)
  )`,

  // ── UTXOs (new — previously only in MempoolClient in-memory cache) ───────────
  `CREATE TABLE IF NOT EXISTS utxos (
    txid            TEXT NOT NULL,
    vout            INTEGER NOT NULL,
    address         TEXT NOT NULL,
    network         TEXT NOT NULL,
    value_sats      INTEGER NOT NULL,
    script_pubkey   TEXT,
    derivation_path TEXT,
    is_confirmed    INTEGER NOT NULL DEFAULT 1,
    block_height    INTEGER,
    block_time      INTEGER,
    fetched_at      INTEGER NOT NULL,
    PRIMARY KEY (txid, vout)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos (address, network)`,
  `CREATE INDEX IF NOT EXISTS idx_utxos_network  ON utxos (network)`,

  // ── Transactions (one row per txid per network) ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS transactions (
    txid         TEXT NOT NULL,
    network      TEXT NOT NULL,
    block_height INTEGER,
    block_hash   TEXT,
    block_time   INTEGER,
    is_confirmed INTEGER NOT NULL DEFAULT 0,
    fee_sats     INTEGER,
    size         INTEGER,
    weight       INTEGER,
    version      INTEGER,
    locktime     INTEGER,
    raw_json     TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (txid, network)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_txns_network_time
     ON transactions (network, block_time DESC)`,

  // ── Transaction ↔ Address mapping (replaces per-address tx cache keys) ────────
  `CREATE TABLE IF NOT EXISTS transaction_addresses (
    txid     TEXT NOT NULL,
    network  TEXT NOT NULL,
    address  TEXT NOT NULL,
    net_sats INTEGER,
    PRIMARY KEY (txid, network, address)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_txaddr_address
     ON transaction_addresses (address, network)`,

  // ── Transaction Inputs ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tx_inputs (
    txid       TEXT NOT NULL,
    network    TEXT NOT NULL,
    vin_idx    INTEGER NOT NULL,
    prev_txid  TEXT,
    prev_vout  INTEGER,
    address    TEXT,
    value_sats INTEGER,
    sequence   INTEGER,
    PRIMARY KEY (txid, network, vin_idx)
  )`,

  // ── Transaction Outputs ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tx_outputs (
    txid          TEXT NOT NULL,
    network       TEXT NOT NULL,
    vout_idx      INTEGER NOT NULL,
    address       TEXT,
    value_sats    INTEGER NOT NULL,
    script_pubkey TEXT,
    is_spent      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (txid, network, vout_idx)
  )`,

  // ── Pending (mempool) Transactions ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS pending_transactions (
    txid       TEXT NOT NULL,
    network    TEXT NOT NULL,
    address    TEXT NOT NULL,
    raw_json   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (txid, network, address)
  )`,

  // ── Bitcoin Price (replaces 'price' and 'historical_price_*' keys) ───────────
  `CREATE TABLE IF NOT EXISTS price_rates (
    currency      TEXT NOT NULL,
    day_timestamp INTEGER NOT NULL,
    rate          REAL NOT NULL,
    fetched_at    INTEGER NOT NULL,
    PRIMARY KEY (currency, day_timestamp)
  )`,

  // ── Fee Rates (single-row cache for /v1/fees/recommended) ───────────────────
  `CREATE TABLE IF NOT EXISTS fee_rates (
    id         INTEGER PRIMARY KEY DEFAULT 1,
    fastest    INTEGER NOT NULL,
    half_hour  INTEGER NOT NULL,
    hour       INTEGER NOT NULL,
    economy    INTEGER NOT NULL,
    minimum    INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL
  )`,

  // ── Sync Metadata (new — pagination cursors + per-address sync state) ─────────
  `CREATE TABLE IF NOT EXISTS sync_metadata (
    entity_type    TEXT NOT NULL,
    entity_key     TEXT NOT NULL,
    cursor         TEXT,
    last_synced_at INTEGER,
    sync_status    TEXT,
    extra_json     TEXT,
    PRIMARY KEY (entity_type, entity_key)
  )`,

  // ── Merchant Labels (Branta address verification cache) ──────────────────────
  `CREATE TABLE IF NOT EXISTS merchant_labels (
    address            TEXT PRIMARY KEY,
    platform           TEXT NOT NULL,
    description        TEXT,
    logo_url           TEXT,
    logo_light_url     TEXT,
    verify_url         TEXT,
    fetched_at         INTEGER NOT NULL
  )`,
];

// ---------------------------------------------------------------------------
// DatabaseService
// ---------------------------------------------------------------------------
export type QueryResult = {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  insertId?: number;
};

class DatabaseService {
  private _db: DB | null = null;
  private _opening: Promise<void> | null = null;

  /** Open (or reuse) the database and run schema migrations. */
  async open(): Promise<void> {
    if (this._db) return;
    if (this._opening) return this._opening;

    this._opening = (async () => {
      try {
        dbg('DatabaseService: opening bold_wallet.db');
        this._db = open({name: 'bold_wallet.db'});

        // Enable WAL for concurrent read/write performance
        this._db.executeSync('PRAGMA journal_mode=WAL');
        this._db.executeSync('PRAGMA foreign_keys=ON');
        this._db.executeSync('PRAGMA synchronous=NORMAL');

        // Run schema (all IF NOT EXISTS — safe on every startup)
        for (const stmt of SCHEMA_STATEMENTS) {
          this._db.executeSync(stmt);
        }

        // Column migrations — ALTER TABLE ADD COLUMN fails silently if the
        // column already exists (SQLite throws "duplicate column name").
        // Wrap each one individually so a single failure never aborts the rest.
        const COLUMN_MIGRATIONS = [
          // v3.1: store block_time alongside block_height in utxos so the UI
          // can display human-readable timestamps for confirmed UTXOs loaded
          // from the DB (without this the row always showed "Unconfirmed").
          'ALTER TABLE utxos ADD COLUMN block_time INTEGER',
        ];
        for (const stmt of COLUMN_MIGRATIONS) {
          try {
            this._db.executeSync(stmt);
          } catch {
            // Column already present — safe to ignore.
          }
        }

        dbg('DatabaseService: schema ready');
      } catch (err) {
        dbg('DatabaseService: open error — attempting recovery', err);
        // If schema migration fails, wipe and recreate.
        // Keyshare is in EncryptedStorage so wallet is recoverable.
        try {
          if (this._db) {
            this._db.close();
            this._db = null;
          }
          this._db = open({name: 'bold_wallet.db'});
          this._db.executeSync('PRAGMA journal_mode=WAL');
          for (const stmt of SCHEMA_STATEMENTS) {
            this._db.executeSync(stmt);
          }
          dbg('DatabaseService: recovery succeeded');
        } catch (recoveryErr) {
          dbg('DatabaseService: recovery failed', recoveryErr);
          throw recoveryErr;
        }
      } finally {
        this._opening = null;
      }
    })();

    return this._opening;
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  private get db(): DB {
    if (!this._db) {
      throw new Error('DatabaseService: not open — call open() first');
    }
    return this._db;
  }

  /** Run a single SQL statement, returning rows and affected count. */
  execute(sql: string, params: unknown[] = []): QueryResult {
    const result = this.db.executeSync(sql, params as Scalar[]);
    const rows: Array<Record<string, Scalar>> = result.rows ?? [];
    return {
      rows,
      rowsAffected: result.rowsAffected ?? 0,
      insertId: result.insertId,
    };
  }

  /** Run multiple statements in a single atomic transaction. */
  transaction(fn: (svc: DatabaseService) => void): void {
    this.db.executeSync('BEGIN');
    try {
      fn(this);
      this.db.executeSync('COMMIT');
    } catch (err) {
      this.db.executeSync('ROLLBACK');
      throw err;
    }
  }

  /**
   * Clear all wallet-derived data tables (called on keyshare import/reset).
   * Preserves app_config, network_providers, nostr_relays.
   */
  clearWalletData(): void {
    this.transaction(tx => {
      for (const table of [
        'hd_state',
        'wallet_addresses',
        'address_balances',
        'utxos',
        'transactions',
        'transaction_addresses',
        'tx_inputs',
        'tx_outputs',
        'pending_transactions',
        'sync_metadata',
      ]) {
        tx.execute(`DELETE FROM ${table}`);
      }
    });
    dbg('DatabaseService: wallet data cleared');
  }

  /**
   * Delete rows in `network_providers` and `nostr_relays` (user-custom APIs / relays
   * from migration or future use). Invoked on full wallet delete alongside
   * AppConfigRepository.clearForWalletDelete().
   */
  clearConfigInfrastructureTables(): void {
    this.transaction(tx => {
      tx.execute('DELETE FROM network_providers');
      tx.execute('DELETE FROM nostr_relays');
    });
    dbg('DatabaseService: network_providers + nostr_relays cleared');
  }

  /**
   * Clear fetched/cached wallet data while preserving HD discovery state.
   *
   * Used for network-switch, address-type switch, and "Clear Cache" so that:
   *  • hd_state (externalIndex, changeIndex, restoreDone) is kept as a
   *    baseline for the next discoverHdIndexesForNetwork run.  If discovery
   *    fails the old correct indexes are still in DB, not replaced by 0.
   *  • wallet_addresses is kept so WalletHome can derive the current receive
   *    address immediately while the fresh API fetch completes.
   *
   * For full wallet reset (delete / new import) use clearWalletData() instead.
   */
  /**
   * Return the logical database size using SQLite PRAGMAs.
   * page_count × page_size gives the total allocated size;
   * subtracting freelist_count gives the actually-used portion.
   */
  getSizeBytes(): {totalBytes: number; usedBytes: number; freeBytes: number} {
    const pageSize =
      (this.db.executeSync('PRAGMA page_size').rows?.[0] as any)?.page_size ??
      4096;
    const pageCount =
      (this.db.executeSync('PRAGMA page_count').rows?.[0] as any)?.page_count ??
      0;
    const freePages =
      (this.db.executeSync('PRAGMA freelist_count').rows?.[0] as any)
        ?.freelist_count ?? 0;
    const totalBytes = pageCount * pageSize;
    const freeBytes = freePages * pageSize;
    return {totalBytes, usedBytes: totalBytes - freeBytes, freeBytes};
  }

  /** Return row-count per user-data table (excludes sqlite internals). */
  getTableRowCounts(): Array<{table: string; rows: number}> {
    const tables = this.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    ).rows as Array<{name: string}>;
    return tables.map(({name}) => {
      const count =
        (this.execute(`SELECT COUNT(*) as cnt FROM "${name}"`).rows[0] as any)
          ?.cnt ?? 0;
      return {table: name, rows: Number(count)};
    });
  }

  clearWalletCacheData(): void {
    this.transaction(tx => {
      for (const table of [
        'address_balances',
        'utxos',
        'transactions',
        'transaction_addresses',
        'tx_inputs',
        'tx_outputs',
        'pending_transactions',
        'sync_metadata',
      ]) {
        tx.execute(`DELETE FROM ${table}`);
      }
    });
    dbg('DatabaseService: wallet cache data cleared (hd_state preserved)');
  }

  /**
   * Invalidate sync_metadata for a specific network + address type combo
   * so syncers re-fetch from the API, while keeping the actual cached
   * balance/UTXO/transaction rows intact for instant UI display.
   */
  invalidateSyncMetadataForAddressType(
    network: string,
    addressType: string,
  ): void {
    const {rows} = this.execute(
      'SELECT address FROM wallet_addresses WHERE network = ? AND address_type = ?',
      [network, addressType],
    );
    const addrs: string[] = rows.map(r => r.address as string);
    if (addrs.length === 0) {
      dbg('DatabaseService: invalidateSyncMetadata — no addresses found');
      return;
    }

    const keys = addrs.flatMap(a => [`${a}_${network}`, a]);
    const placeholders = keys.map(() => '?').join(',');

    this.execute(
      `DELETE FROM sync_metadata WHERE entity_key IN (${placeholders})`,
      keys,
    );
    dbg(
      'DatabaseService: invalidated sync_metadata for',
      addrs.length,
      'addresses (',
      network,
      addressType,
      ')',
    );
  }
}

// Singleton export
const database = new DatabaseService();
export default database;
