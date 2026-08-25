/**
 * AppConfigRepository — replaces all single-value LocalCache preference keys.
 *
 * Covers: network, address_type, current_address, currency, balance_hidden,
 * haptics_enabled, theme_mode, fee_strategy, legacy_wallet_do_not_remind,
 * tab_wallet_enabled, tab_psbt_enabled, tab_utxos_enabled, tab_addresses_enabled,
 * tab_mempool_enabled, addresses_view_mode (smart | hd_order),
 * nav_menu_style (docked | floating), sqlite_migration_done, and any future
 * string-typed preferences.
 */
import database from '../Database';
import {dbg} from '../../utils';

// Canonical key names (use these constants instead of raw strings)
export const CONFIG_KEYS = {
  NETWORK: 'network',
  ADDRESS_TYPE: 'address_type',
  CURRENT_ADDRESS: 'current_address',
  CURRENCY: 'currency',
  BALANCE_HIDDEN: 'balance_hidden',
  HAPTICS_ENABLED: 'haptics_enabled',
  THEME_MODE: 'theme_mode',
  FEE_STRATEGY: 'fee_strategy',
  LEGACY_WALLET_DO_NOT_REMIND: 'legacy_wallet_do_not_remind',
  TAB_WALLET_ENABLED: 'tab_wallet_enabled',
  TAB_PSBT_ENABLED: 'tab_psbt_enabled',
  TAB_UTXOS_ENABLED: 'tab_utxos_enabled',
  TAB_ADDRESSES_ENABLED: 'tab_addresses_enabled',
  TAB_MEMPOOL_ENABLED: 'tab_mempool_enabled',
  /** Addresses tab: `smart` (default) or `hd_order` */
  ADDRESSES_VIEW_MODE: 'addresses_view_mode',
  SQLITE_MIGRATION_DONE: 'sqlite_migration_done',
  /**
   * Lock screen bottom quotes strip (manchette). Stored as boolean string; default is on when key is absent.
   */
  LOCK_SCREEN_MANCHETTE_ENABLED: 'lock_screen_manchette_enabled',
  /**
   * Lock screen version chip + GitHub update check. Default on when absent.
   */
  LOCK_SCREEN_UPDATE_CHECKER_ENABLED: 'lock_screen_update_checker_enabled',
  /**
   * JSON blob of non-secret keyshare fields (same shape as EncryptedStorage `keyshare_meta`).
   * Written whenever the full keyshare is saved; `getKeyshareMetadata` uses Encrypted first, then this fallback.
   */
  KEYSHARE_META_JSON: 'keyshare_meta_json',
  /**
   * JSON: `{ "quotes": string[], "fetchedAt": number }` — cached lines from remote QUOTES.md for LoadingScreen ticker.
   */
  LOADING_QUOTES_JSON: 'loading_quotes_json',
  /** When true, new keygen uses legacy BNB GG18 instead of DKLs23 (libtss). Default off. */
  DKLS23_OPTED_OUT: 'dkls23_opted_out',
  /** @deprecated Use DKLS23_OPTED_OUT (inverted). Kept for migration from enable_dkls23. */
  ENABLE_DKLS23: 'enable_dkls23',
  /** One-time backfill of branta_verified_txs from merchant_labels + tx history. */
  BRANTA_VERIFIED_BACKFILL_V1: 'branta_verified_backfill_v1',
  /**
   * Merchant verification via Branta. Default off (absent = false).
   */
  BRANTA_ENABLED: 'branta_enabled',
  /**
   * In-app online/offline sandbox. Absent = online (true). When false, no
   * Internet or LAN calls are made; UI uses cached SQLite data.
   */
  WALLET_ONLINE: 'wallet_online',
  /**
   * Main tab bar layout. `floating` (default, bottom pill, max 90% width) or
   * `docked` (full-width). Absent = floating.
   */
  NAV_MENU_STYLE: 'nav_menu_style',
  /**
   * Camouflage / unlock PIN lockout. Consecutive wrong entries, then epoch-ms
   * until the pad may be used again (30s after 3 failures).
   */
  CAMOUFLAGE_PIN_FAIL_COUNT: 'camouflage_pin_fail_count',
  CAMOUFLAGE_PIN_LOCKED_UNTIL: 'camouflage_pin_locked_until',
  /** LAN MPC: this device's KeyShare role after pairing (KeyShare1|2|3). */
  LAN_LOCAL_PARTY: 'lan_local_party',
  LAN_PEER_PARTY: 'lan_peer_party',
  LAN_PEER_PARTY2: 'lan_peer_party2',
  /** LAN MPC: IPv4 host of KeyShare1 (HTTP relay). */
  LAN_MASTER_HOST: 'lan_master_host',
  LAN_IS_MASTER: 'lan_is_master',
  LAN_IS_TRIO: 'lan_is_trio',
  LAN_PEER_PUBKEY2: 'lan_peer_pubkey2',
  /**
   * JSON array of `{ url, enabled }` mainnet mempool REST bases (failover pool).
   * Primary `api` / `api_mainnet` stay in sync with the first enabled entry.
   */
  MEMPOOL_PROVIDERS_ENTRIES: 'mempool_providers_entries',
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

/**
 * Keys kept in `app_config` after “Delete wallet” / hard reset.
 * Everything else in `app_config` is removed (theme, tabs, APIs, HD options, etc.).
 *
 * - `sqlite_migration_done`: must stay so one-time LocalCache→SQLite migration is not re-run.
 */
export const APP_CONFIG_KEYS_PRESERVED_ON_WALLET_DELETE: readonly string[] = [
  CONFIG_KEYS.SQLITE_MIGRATION_DONE,
];

class AppConfigRepository {
  /** Read one preference; returns null when absent. */
  get(key: string): string | null {
    try {
      const {rows} = database.execute(
        'SELECT value FROM app_config WHERE key = ?',
        [key],
      );
      return rows.length > 0 ? (rows[0].value as string) : null;
    } catch (err) {
      dbg('AppConfigRepository.get error', key, err);
      return null;
    }
  }

  /** Write one preference (upsert). */
  set(key: string, value: string): void {
    try {
      database.execute(
        `INSERT INTO app_config (key, value, updated_at)
           VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           updated_at = excluded.updated_at`,
        [key, value, Date.now()],
      );
    } catch (err) {
      dbg('AppConfigRepository.set error', key, err);
    }
  }

  /** Delete one preference. */
  remove(key: string): void {
    try {
      database.execute('DELETE FROM app_config WHERE key = ?', [key]);
    } catch (err) {
      dbg('AppConfigRepository.remove error', key, err);
    }
  }

  /**
   * Hard-reset: delete every `app_config` row except
   * {@link APP_CONFIG_KEYS_PRESERVED_ON_WALLET_DELETE}.
   * Clears mempool API URLs, network/address defaults, theme, tabs, fee strategy, currency,
   * Nostr relay CSV in config, HD scan options, loading quotes cache, keyshare_meta mirror, etc.
   */
  clearForWalletDelete(): void {
    const preserved = [...APP_CONFIG_KEYS_PRESERVED_ON_WALLET_DELETE];
    if (preserved.length === 0) {
      dbg(
        'AppConfigRepository.clearForWalletDelete: refuse to wipe app_config with empty preserve list',
      );
      return;
    }
    try {
      const placeholders = preserved.map(() => '?').join(', ');
      database.execute(
        `DELETE FROM app_config WHERE key NOT IN (${placeholders})`,
        preserved,
      );
      dbg(
        'AppConfigRepository.clearForWalletDelete: done; preserved:',
        preserved.join(', '),
      );
    } catch (err) {
      dbg('AppConfigRepository.clearForWalletDelete error', err);
    }
  }

  /** Load all preferences as a plain object — useful for context hydration. */
  getAll(): Record<string, string> {
    try {
      const {rows} = database.execute('SELECT key, value FROM app_config');
      const result: Record<string, string> = {};
      for (const row of rows) {
        result[row.key as string] = row.value as string;
      }
      return result;
    } catch (err) {
      dbg('AppConfigRepository.getAll error', err);
      return {};
    }
  }

  /** Convenience: read boolean preference (default false). */
  getBool(key: string, defaultValue = false): boolean {
    const v = this.get(key);
    if (v === null) return defaultValue;
    return v === 'true';
  }

  /** Convenience: write boolean preference. */
  setBool(key: string, value: boolean): void {
    this.set(key, value ? 'true' : 'false');
  }

  /** Batch-write multiple key/value pairs in one transaction. */
  setMany(entries: Record<string, string>): void {
    try {
      const now = Date.now();
      database.transaction(tx => {
        for (const [key, value] of Object.entries(entries)) {
          tx.execute(
            `INSERT INTO app_config (key, value, updated_at)
               VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value      = excluded.value,
               updated_at = excluded.updated_at`,
            [key, value, now],
          );
        }
      });
    } catch (err) {
      dbg('AppConfigRepository.setMany error', err);
    }
  }
}

const appConfigRepository = new AppConfigRepository();
export default appConfigRepository;
