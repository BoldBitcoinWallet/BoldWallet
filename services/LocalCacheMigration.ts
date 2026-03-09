/**
 * LocalCacheMigration — one-time migration from the file-based LocalCache
 * to the SQLite database on the first launch after the SQLite update.
 *
 * Strategy:
 *  1. Check app_config for 'sqlite_migration_done'. If already set, return early.
 *  2. For every known LocalCache key, read the value and insert it into the
 *     appropriate SQLite table using INSERT OR IGNORE / ON CONFLICT.
 *  3. Write app_config 'sqlite_migration_done' = 'v1' when done.
 *  4. LocalCache files are NOT deleted here (rollback safety during transition).
 *     Deletion happens in Phase 5 of the migration plan.
 *
 * This migration is idempotent — it can be run multiple times safely.
 */
import LocalCache from './LocalCache';
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';
import walletRepository from './repositories/WalletRepository';
import balanceRepository from './repositories/BalanceRepository';
import transactionRepository, {type PendingTxData} from './repositories/TransactionRepository';
import priceRepository from './repositories/PriceRepository';
import database from './Database';
import {dbg} from '../utils';

const MIGRATION_VERSION = 'v1';

// All network+addressType combinations to scan for HD index keys
const NETWORKS = ['mainnet', 'testnet3'];
const ADDRESS_TYPES = ['legacy', 'segwit-native', 'segwit-compatible'];

// Mapping from old LocalCache key → new app_config key
const SIMPLE_KEY_MAP: Record<string, string> = {
  themeMode: CONFIG_KEYS.THEME_MODE,
  currency: CONFIG_KEYS.CURRENCY,
  balanceHidden: CONFIG_KEYS.BALANCE_HIDDEN,
  hapticsEnabled: CONFIG_KEYS.HAPTICS_ENABLED,
  feeStrategy: CONFIG_KEYS.FEE_STRATEGY,
  addressType: CONFIG_KEYS.ADDRESS_TYPE,
  currentAddress: CONFIG_KEYS.CURRENT_ADDRESS,
  network: CONFIG_KEYS.NETWORK,
  legacyWalletModalDoNotRemind: CONFIG_KEYS.LEGACY_WALLET_DO_NOT_REMIND,
  mempool_playground_enabled: CONFIG_KEYS.TAB_MEMPOOL_ENABLED,
  utxos_tab_enabled: CONFIG_KEYS.TAB_UTXOS_ENABLED,
  psbt_tab_enabled: CONFIG_KEYS.TAB_PSBT_ENABLED,
  wallet_tab_enabled: CONFIG_KEYS.TAB_WALLET_ENABLED,
};

export async function runMigrationIfNeeded(): Promise<void> {
  try {
    // Already migrated?
    const done = appConfigRepository.get(CONFIG_KEYS.SQLITE_MIGRATION_DONE);
    if (done === MIGRATION_VERSION) {
      dbg('LocalCacheMigration: already done, skipping');
      return;
    }

    dbg('LocalCacheMigration: starting v1 migration from LocalCache → SQLite');
    const start = Date.now();

    // ── 1. Simple preference keys → app_config ───────────────────────────
    for (const [oldKey, newKey] of Object.entries(SIMPLE_KEY_MAP)) {
      try {
        const value = await LocalCache.getItem(oldKey);
        if (value != null) {
          appConfigRepository.set(newKey, value);
          dbg('LocalCacheMigration: migrated', oldKey, '→', newKey, '=', value);
        }
      } catch {
        // non-fatal — continue with rest
      }
    }

    // ── 2. Network/API provider keys ─────────────────────────────────────
    for (const net of NETWORKS) {
      try {
        const api = await LocalCache.getItem(`api_${net}`);
        if (api) {
          const isActive = (appConfigRepository.get(CONFIG_KEYS.NETWORK) ?? 'mainnet') === net ? 1 : 0;
          database.execute(
            `INSERT OR IGNORE INTO network_providers (network, api_url, is_active, updated_at)
             VALUES (?, ?, ?, ?)`,
            [net, api, isActive, Date.now()],
          );
          dbg('LocalCacheMigration: migrated api_' + net, '=', api);
        }
      } catch {
        // non-fatal
      }
    }

    // ── 3. Nostr relays (CSV string → nostr_relays table) ────────────────
    try {
      const relaysCsv = await LocalCache.getItem('nostr_relays');
      if (relaysCsv) {
        const relays = relaysCsv.split(',').map(r => r.trim()).filter(Boolean);
        const now = Date.now();
        database.transaction(tx => {
          for (const url of relays) {
            tx.execute(
              `INSERT OR IGNORE INTO nostr_relays (url, is_active, added_at)
               VALUES (?, 1, ?)`,
              [url, now],
            );
          }
        });
        dbg('LocalCacheMigration: migrated', relays.length, 'nostr relay(s)');
      }
    } catch {
      // non-fatal
    }

    // ── 4. HD index keys → hd_state ──────────────────────────────────────
    for (const net of NETWORKS) {
      for (const addrType of ADDRESS_TYPES) {
        try {
          const extRaw = await LocalCache.getItem(`hd_external_index_${net}_${addrType}`);
          const chgRaw = await LocalCache.getItem(`hd_change_index_${net}_${addrType}`);
          const maxRaw = await LocalCache.getItem(`hd_max_used_external_${net}_${addrType}`);
          const doneRaw = await LocalCache.getItem(`hd_restore_done_${net}_${addrType}`);
          const statusRaw = await LocalCache.getItem(`hd_discovery_status_${net}_${addrType}`);
          const lastAtRaw = await LocalCache.getItem(`hd_discovery_last_at_${net}_${addrType}`);

          if (extRaw != null || chgRaw != null || maxRaw != null) {
            const externalIndex = extRaw != null ? parseInt(extRaw, 10) || 0 : 0;
            const changeIndex = chgRaw != null ? parseInt(chgRaw, 10) || 0 : 0;
            const maxUsed = maxRaw != null ? parseInt(maxRaw, 10) || 0 : 0;
            const restoreDone = doneRaw === 'true' ? 1 : 0;
            const discoveryStatus = statusRaw ?? null;
            const discoveryLastAt = lastAtRaw != null ? parseInt(lastAtRaw, 10) || null : null;

            walletRepository.setHdState({
              network: net,
              addressType: addrType,
              externalIndex,
              changeIndex,
              maxUsedExternal: maxUsed,
              restoreDone: restoreDone === 1,
              discoveryStatus,
              discoveryLastAt,
            });
            dbg('LocalCacheMigration: migrated hd_state', net, addrType, {
              externalIndex, changeIndex, maxUsed,
            });
          }
        } catch {
          // non-fatal
        }
      }
    }

    // ── 5. Per-address balance/transaction caches ─────────────────────────
    // We attempt to enumerate by reading a likely set of address cache keys.
    // In practice the migration only imports the current address' cache since
    // we don't have a list of all known addresses at migration time.
    // The sync layer will re-fetch and populate the rest on first launch.
    try {
      const currentAddr = appConfigRepository.get(CONFIG_KEYS.CURRENT_ADDRESS);
      const net = appConfigRepository.get(CONFIG_KEYS.NETWORK) ?? 'mainnet';

      if (currentAddr) {
        // Balance
        const balRaw = await LocalCache.getItem(`wallet_balance_${currentAddr}`);
        if (balRaw) {
          try {
            const cached = JSON.parse(balRaw);
            const sats = Math.round((parseFloat(cached.btc) || 0) * 100_000_000);
            balanceRepository.setBalance({
              address: currentAddr,
              network: net,
              balanceSats: sats,
              pendingSats: cached.pendingSats ?? 0,
              hasNonzero: sats > 0,
              fetchedAt: cached.timestamp ?? Date.now(),
            });
            dbg('LocalCacheMigration: migrated balance for', currentAddr);
          } catch {
            // malformed cache — skip
          }
        }

        // Transactions
        const txRaw = await LocalCache.getItem(`wallet_transactions_${currentAddr}`);
        if (txRaw) {
          try {
            const cached: {transactions: unknown[]; timestamp: number} = JSON.parse(txRaw);
            const fetchedAt = cached.timestamp ?? Date.now();
            for (const apiTx of (cached.transactions ?? [])) {
              const tx = apiTx as Record<string, unknown>;
              const txid = tx.txid as string;
              if (!txid) continue;
              const status = tx.status as Record<string, unknown> ?? {};
              transactionRepository.upsertTransaction(
                {
                  txid,
                  network: net,
                  blockHeight: (status.block_height as number) ?? null,
                  blockHash: (status.block_hash as string) ?? null,
                  blockTime: (status.block_time as number) ?? null,
                  isConfirmed: status.confirmed === true,
                  feeSats: (tx.fee as number) ?? null,
                  size: (tx.size as number) ?? null,
                  weight: (tx.weight as number) ?? null,
                  version: (tx.version as number) ?? null,
                  locktime: (tx.locktime as number) ?? null,
                  rawJson: JSON.stringify(tx),
                  fetchedAt,
                },
                [{txid, network: net, address: currentAddr, netSats: null}],
              );
            }
            dbg(
              'LocalCacheMigration: migrated',
              (cached.transactions ?? []).length,
              'transactions for',
              currentAddr,
            );
          } catch {
            // malformed cache — skip
          }
        }

        // Pending transactions
        const pendingRaw = await LocalCache.getItem(`${currentAddr}-pendingTxs`);
        if (pendingRaw) {
          try {
            const map = JSON.parse(pendingRaw) as Record<string, PendingTxData>;
            transactionRepository.setPendingTxMap(currentAddr, net, map);
            dbg('LocalCacheMigration: migrated pending txs for', currentAddr);
          } catch {
            // malformed cache — skip
          }
        }
      }
    } catch {
      // non-fatal — network data will be re-fetched
    }

    // ── 6. Current price → price_rates ───────────────────────────────────
    try {
      const priceRaw = await LocalCache.getItem('price');
      if (priceRaw) {
        const cached: {rates?: Record<string, number>; rate?: number; price?: string; timestamp?: number} =
          JSON.parse(priceRaw);
        const rates = cached.rates ?? {};
        if (cached.rate) {
          rates.USD = cached.rate;
        }
        if (Object.keys(rates).length) {
          priceRepository.setCurrentRates(rates);
          dbg('LocalCacheMigration: migrated price rates');
        }
      }
    } catch {
      // non-fatal
    }

    // ── Mark migration complete ───────────────────────────────────────────
    appConfigRepository.set(CONFIG_KEYS.SQLITE_MIGRATION_DONE, MIGRATION_VERSION);
    dbg('LocalCacheMigration: completed in', Date.now() - start, 'ms');
  } catch (err) {
    // Migration failure is non-fatal — app continues with empty SQLite tables
    // and the sync layer will re-populate from the network.
    dbg('LocalCacheMigration: unexpected error (non-fatal)', err);
  }
}
