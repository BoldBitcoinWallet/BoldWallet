/**
 * SyncCoordinator — orchestrates all background sync workers.
 *
 * Architecture:
 *  - UI reads exclusively from SQLite repositories (zero direct API calls from UI layer).
 *  - SyncCoordinator runs on app foreground and on a timer, fetching from mempool.space
 *    and writing deltas to SQLite.
 *  - Sync failures are silent (sync_metadata.sync_status = 'failed') and retried
 *    on the next foreground event.
 *
 * Usage:
 *   import syncCoordinator from './services/sync/SyncCoordinator';
 *
 *   // Call once when app foregrounds (e.g. AppState 'active'):
 *   syncCoordinator.start(addresses, network, apiBase);
 *
 *   // Optional: stop all timers (e.g. when app backgrounds fully):
 *   syncCoordinator.stop();
 */
import {AppState, type AppStateStatus} from 'react-native';
import balanceSyncer, {
  type AddressEntry as BalanceEntry,
} from './BalanceSyncer';
import transactionSyncer from './TransactionSyncer';
import utxoSyncer, {type AddressEntry as UtxoEntry} from './UtxoSyncer';
import priceSyncer from './PriceSyncer';
import {dbg} from '../../utils';

const BALANCE_INTERVAL_MS = 30_000;
const PRICE_INTERVAL_MS = 120_000;
const UTXO_INTERVAL_MS = 120_000;
const TX_INTERVAL_MS = 120_000;

export interface SyncConfig {
  addresses: Array<{address: string; network: string; derivationPath?: string}>;
  network: string;
  apiBase: string;
  /** Optional callback — called after each sync cycle completes. */
  onSyncComplete?: () => void;
}

class SyncCoordinator {
  private _config: SyncConfig | null = null;
  private _balanceTimer: ReturnType<typeof setInterval> | null = null;
  private _txTimer: ReturnType<typeof setInterval> | null = null;
  private _utxoTimer: ReturnType<typeof setInterval> | null = null;
  private _priceTimer: ReturnType<typeof setInterval> | null = null;
  private _appStateSubscription: ReturnType<
    typeof AppState.addEventListener
  > | null = null;
  private _running = false;

  /**
   * Start background sync with the given config.
   * Safe to call multiple times — stops previous timers first.
   */
  start(config: SyncConfig): void {
    this.stop();
    this._config = config;
    this._running = true;

    // Immediate first sync
    this._syncAll();

    // Schedule periodic syncs
    this._balanceTimer = setInterval(
      () => this._syncBalances(),
      BALANCE_INTERVAL_MS,
    );
    this._priceTimer = setInterval(() => this._syncPrice(), PRICE_INTERVAL_MS);
    this._utxoTimer = setInterval(() => this._syncUtxos(), UTXO_INTERVAL_MS);
    this._txTimer = setInterval(() => this._syncTxs(), TX_INTERVAL_MS);

    // Resume sync when app comes to foreground
    this._appStateSubscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active' && this._running) {
          dbg('SyncCoordinator: app foregrounded — syncing');
          this._syncAll();
        }
      },
    );

    dbg(
      'SyncCoordinator: started',
      config.addresses.length,
      'addresses on',
      config.network,
    );
  }

  /** Update the config without restarting timers (e.g. addresses changed). */
  updateConfig(config: SyncConfig): void {
    this._config = config;
  }

  /** Stop all timers and release listeners. */
  stop(): void {
    this._running = false;
    if (this._balanceTimer) {
      clearInterval(this._balanceTimer);
      this._balanceTimer = null;
    }
    if (this._txTimer) {
      clearInterval(this._txTimer);
      this._txTimer = null;
    }
    if (this._utxoTimer) {
      clearInterval(this._utxoTimer);
      this._utxoTimer = null;
    }
    if (this._priceTimer) {
      clearInterval(this._priceTimer);
      this._priceTimer = null;
    }
    if (this._appStateSubscription) {
      this._appStateSubscription.remove();
      this._appStateSubscription = null;
    }
    dbg('SyncCoordinator: stopped');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _syncAll(): Promise<void> {
    await Promise.all([
      this._syncBalances(),
      this._syncTxs(),
      this._syncUtxos(),
      this._syncPrice(),
    ]);
    this._config?.onSyncComplete?.();
  }

  private async _syncBalances(): Promise<void> {
    if (!this._config) return;
    try {
      const entries: BalanceEntry[] = this._config.addresses.map(a => ({
        address: a.address,
        network: a.network,
      }));
      await balanceSyncer.syncAddresses(entries, this._config.apiBase);
    } catch (err) {
      dbg('SyncCoordinator: balance sync error', err);
    }
  }

  private async _syncTxs(): Promise<void> {
    if (!this._config) return;
    try {
      for (const {address, network} of this._config.addresses) {
        await transactionSyncer.syncAddress(
          address,
          network,
          this._config.apiBase,
        );
      }
    } catch (err) {
      dbg('SyncCoordinator: tx sync error', err);
    }
  }

  private async _syncUtxos(): Promise<void> {
    if (!this._config) return;
    try {
      const entries: UtxoEntry[] = this._config.addresses.map(a => ({
        address: a.address,
        network: a.network,
        derivationPath: a.derivationPath,
      }));
      await utxoSyncer.syncAddresses(entries, this._config.apiBase);
    } catch (err) {
      dbg('SyncCoordinator: utxo sync error', err);
    }
  }

  private async _syncPrice(): Promise<void> {
    if (!this._config) return;
    try {
      await priceSyncer.syncCurrentPrice(this._config.apiBase);
    } catch (err) {
      dbg('SyncCoordinator: price sync error', err);
    }
  }
}

const syncCoordinator = new SyncCoordinator();
export default syncCoordinator;
