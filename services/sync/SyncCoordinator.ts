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
import {WalletService} from '../WalletService';
import walletRepository from '../repositories/WalletRepository';
import {dbg} from '../../utils';

const BALANCE_INTERVAL_MS = 120_000;
const HD_DISCOVERY_INTERVAL_MS = 1_200_000; // 20 minutes
const PRICE_INTERVAL_MS = 240_000;
const UTXO_INTERVAL_MS = 180_000;
const TX_INTERVAL_MS = 180_000;
const HD_DISCOVERY_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface SyncStatus {
  label: string;
  progress?: {current: number; total: number};
}

export interface SyncConfig {
  addresses: Array<{address: string; network: string; derivationPath?: string}>;
  network: string;
  addressType: string;
  apiBase: string;
  /** Optional callback — called after each sync cycle completes. */
  onSyncComplete?: () => void;
  /** Called when HD discovery finds new addresses so the UI can refresh. */
  onAddressesChanged?: (addresses: string[]) => void;
  /** Called with current sync operation status for CacheIndicator UI. null = idle. */
  onSyncStatus?: (status: SyncStatus | null) => void;
}

class SyncCoordinator {
  private _config: SyncConfig | null = null;
  private _balanceTimer: ReturnType<typeof setInterval> | null = null;
  private _hdDiscoveryTimer: ReturnType<typeof setInterval> | null = null;
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

    // Immediate first sync — force HD re-discovery to fix any stale/diverged indexes
    this._syncAll(true);

    // Schedule periodic syncs
    this._hdDiscoveryTimer = setInterval(
      () => this._syncHdDiscovery(),
      HD_DISCOVERY_INTERVAL_MS,
    );

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
    if (this._hdDiscoveryTimer) {
      clearInterval(this._hdDiscoveryTimer);
      this._hdDiscoveryTimer = null;
    }
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

  private async _syncAll(forceHdDiscovery = false): Promise<void> {
    // HD discovery first — may expand the address set for subsequent syncs
    await this._syncHdDiscovery(forceHdDiscovery);

    await Promise.all([
      this._syncBalances(),
      this._syncTxs(),
      this._syncUtxos(),
      this._syncPrice(),
    ]);
    this._config?.onSyncComplete?.();
  }

  private async _syncHdDiscovery(force = false): Promise<void> {
    if (!this._config) return;
    const {network, addressType, apiBase} = this._config;
    try {
      const hdState = walletRepository.getHdState(network, addressType);
      const restoreDone = hdState?.restoreDone === true;
      if (!restoreDone) return; // first-run discovery is handled by WalletHome

      if (!force) {
        const stale =
          !hdState?.discoveryLastAt ||
          Date.now() - hdState.discoveryLastAt > HD_DISCOVERY_STALE_MS;
        if (!stale) return;
      }

      dbg(
        'SyncCoordinator: HD indexes stale — re-discovering',
        network,
        addressType,
      );
      this._config.onSyncStatus?.({label: 'Discovering addresses…'});
      const ws = WalletService.getInstance();
      await ws.discoverHdIndexesForNetwork(
        network,
        addressType,
        apiBase,
        chain => {
          this._config?.onSyncStatus?.({
            label: `Scanning ${
              chain === 'external' ? 'receive' : 'change'
            } addresses…`,
          });
        },
      );
      this._config.onSyncStatus?.(null);

      const arr = await ws.getHdAddressesWithPaths(network, addressType);
      const newAddrs = arr.map(a => a.address);
      const oldAddrs = this._config.addresses.map(a => a.address);
      if (
        newAddrs.length !== oldAddrs.length ||
        newAddrs.some((a, i) => a !== oldAddrs[i])
      ) {
        dbg(
          'SyncCoordinator: HD discovery found new addresses',
          oldAddrs.length,
          '->',
          newAddrs.length,
        );
        this._config.addresses = arr.map(a => ({
          address: a.address,
          network,
          derivationPath: a.derivationPath,
        }));
        this._config.onAddressesChanged?.(newAddrs);
      }
    } catch (err) {
      dbg('SyncCoordinator: HD discovery error', err);
      this._config?.onSyncStatus?.(null);
    }
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
      // Resolve derivation paths from the cached HD address list so the
      // utxos table stores them (needed by getUtxosForNetwork filtering).
      let pathMap: Map<string, string> | undefined;
      try {
        const hdAddrs =
          await WalletService.getInstance().getHdAddressesWithPaths(
            this._config.network,
            this._config.addressType || 'segwit-native',
          );
        pathMap = new Map(hdAddrs.map(a => [a.address, a.derivationPath]));
      } catch {
        // Derivation unavailable — fall through with whatever config has
      }

      const entries: UtxoEntry[] = this._config.addresses.map(a => ({
        address: a.address,
        network: a.network,
        derivationPath:
          a.derivationPath || pathMap?.get(a.address) || undefined,
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
