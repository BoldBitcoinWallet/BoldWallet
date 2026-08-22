/**
 * SyncCoordinator — orchestrates all background sync workers.
 *
 * Architecture:
 *  - Most wallet UI reads from SQLite repositories; SyncCoordinator keeps them updated.
 *  - Transaction list (`components/TransactionList.tsx`) also performs user-driven API
 *    fetches (refresh, pagination) and merges with cache/DB — see `services/sync/README.md`.
 *  - SyncCoordinator runs on app foreground and on a timer, fetching from the Mempool API
 *    base and writing deltas to SQLite.
 *  - Sync failures are silent unless the UI supplies `onSyncFailed` (e.g. Home
 *    CacheIndicator while focused). Otherwise they are retried on the next
 *    timer or foreground event.
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
import mempoolClient from '../MempoolClient';
import {dbg} from '../../utils';

const BALANCE_INTERVAL_MS = 120_000;
const HD_DISCOVERY_INTERVAL_MS = 1_200_000; // 20 minutes
const PRICE_INTERVAL_MS = 240_000;
const UTXO_INTERVAL_MS = 180_000;
const TX_INTERVAL_MS = 180_000;
const HD_DISCOVERY_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Sort key from BIP32 path (m/84'/0'/0'/0/25 → [0, -25]) so higher index sorts first. */
function sortKeyForPath(path: string | undefined): [number, number] {
  if (!path) return [2, 0];
  const parts = path.split('/');
  const chain = parseInt(parts[parts.length - 2], 10) ?? 0;
  const index = parseInt(parts[parts.length - 1], 10) ?? 0;
  return [chain, -index];
}

/** Sort addresses by highest HD index first (receive chain then change chain, descending index). */
function sortAddressesByIndexDesc<T extends {derivationPath?: string}>(
  addresses: T[],
): T[] {
  return [...addresses].sort((a, b) => {
    const [cA, iA] = sortKeyForPath(a.derivationPath);
    const [cB, iB] = sortKeyForPath(b.derivationPath);
    return cA !== cB ? cA - cB : iA - iB;
  });
}

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
  /**
   * Called when a background sync phase fails. Home may set CacheIndicator
   * error copy while focused — no toast per cycle.
   */
  onSyncFailed?: (err: unknown) => void;
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
  /** Nested pause count — background sync yields while Nostr/LAN MPC uses the network. */
  private _pauseCount = 0;
  /** True when any phase in the current `_syncAll` cycle failed. */
  private _cycleFailed = false;

  private _notifySyncFailed(context: string, err: unknown): void {
    dbg(`SyncCoordinator: ${context}`, err);
    this._cycleFailed = true;
    this._config?.onSyncStatus?.(null);
    this._config?.onSyncFailed?.(err);
  }

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
      () => {
        if (!this._isPaused()) {
          this._syncHdDiscovery();
        }
      },
      HD_DISCOVERY_INTERVAL_MS,
    );

    this._balanceTimer = setInterval(
      () => {
        if (!this._isPaused()) {
          this._syncBalances();
        }
      },
      BALANCE_INTERVAL_MS,
    );
    this._priceTimer = setInterval(() => {
      if (!this._isPaused()) {
        this._syncPrice();
      }
    }, PRICE_INTERVAL_MS);
    this._utxoTimer = setInterval(() => {
      if (!this._isPaused()) {
        this._syncUtxos();
      }
    }, UTXO_INTERVAL_MS);
    this._txTimer = setInterval(() => {
      if (!this._isPaused()) {
        this._syncTxs();
      }
    }, TX_INTERVAL_MS);

    // Resume sync when app comes to foreground
    this._appStateSubscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active' && this._running && !this._isPaused()) {
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

  /**
   * Pause background mempool sync so MPC (especially Nostr relay publish)
   * is not competing for the device HTTP pool. Nested; match each pause with resume.
   */
  pause(): void {
    this._pauseCount += 1;
    if (this._pauseCount === 1) {
      mempoolClient.abortAll();
      dbg('SyncCoordinator: paused (aborted in-flight mempool requests)');
    }
  }

  /** Resume background sync after {@link pause}. Does not kick an immediate cycle. */
  resume(): void {
    if (this._pauseCount > 0) {
      this._pauseCount -= 1;
    }
    if (this._pauseCount === 0) {
      dbg('SyncCoordinator: resumed');
    }
  }

  private _isPaused(): boolean {
    return this._pauseCount > 0;
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
    if (this._isPaused()) {
      return;
    }
    this._cycleFailed = false;
    // HD discovery first — may expand the address set for subsequent syncs
    await this._syncHdDiscovery(forceHdDiscovery);
    if (this._isPaused()) {
      return;
    }

    // Serialized API phases (price first — few requests), then per-address syncers
    // one at a time. Avoids pumping balance + txs + UTXOs + price in parallel
    // against the same apiBase, which eases rate limits on public and custom hosts.
    await this._syncPrice();
    if (this._isPaused()) {
      return;
    }
    await this._syncBalances();
    if (this._isPaused()) {
      return;
    }
    await this._syncUtxos();
    if (this._isPaused()) {
      return;
    }
    await this._syncTxs();

    if (!this._isPaused()) {
      if (this._cycleFailed) {
        return;
      }
      this._config?.onSyncComplete?.();
    }
  }

  private async _syncHdDiscovery(force = false): Promise<void> {
    if (!this._config || this._isPaused()) return;
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
      this._notifySyncFailed('HD discovery error', err);
    }
  }

  private async _syncBalances(): Promise<void> {
    if (!this._config || this._isPaused()) return;
    try {
      const network = this._config.network;
      const addressType =
        this._config.addressType || 'segwit-native';
      let addrs: Array<{address: string; derivationPath?: string}> =
        await WalletService.getInstance().getActiveAddressesWithPaths(
          network,
          addressType,
        );
      if (addrs.length === 0) addrs = this._config.addresses;
      const sorted = sortAddressesByIndexDesc(
        addrs.map(a => ({
          address: a.address,
          network,
          derivationPath: a.derivationPath,
        })),
      );
      const entries: BalanceEntry[] = sorted.map(a => ({
        address: a.address,
        network: a.network,
      }));
      await balanceSyncer.syncAddresses(entries, this._config.apiBase);
    } catch (err) {
      this._notifySyncFailed('balance sync error', err);
    }
  }

  private async _syncTxs(): Promise<void> {
    if (!this._config || this._isPaused()) return;
    try {
      const network = this._config.network;
      const addressType =
        this._config.addressType || 'segwit-native';
      let addrs: Array<{address: string; derivationPath?: string}> =
        await WalletService.getInstance().getActiveAddressesWithPaths(
          network,
          addressType,
        );
      if (addrs.length === 0) addrs = this._config.addresses;
      const sorted = sortAddressesByIndexDesc(
        addrs.map(a => ({
          address: a.address,
          network,
          derivationPath: a.derivationPath,
        })),
      );
      for (const {address, network: net} of sorted) {
        if (this._isPaused()) {
          return;
        }
        await transactionSyncer.syncAddress(
          address,
          net,
          this._config.apiBase,
        );
      }
    } catch (err) {
      this._notifySyncFailed('tx sync error', err);
    }
  }

  private async _syncUtxos(): Promise<void> {
    if (!this._config || this._isPaused()) return;
    try {
      const network = this._config.network;
      const addressType =
        this._config.addressType || 'segwit-native';
      let addrs: Array<{address: string; derivationPath?: string}> =
        await WalletService.getInstance().getActiveAddressesWithPaths(
          network,
          addressType,
        );
      let pathMap: Map<string, string> | undefined;
      if (addrs.length === 0) {
        addrs = this._config.addresses;
        try {
          const hdAddrs =
            await WalletService.getInstance().getHdAddressesWithPaths(
              network,
              addressType,
            );
          pathMap = new Map(hdAddrs.map(a => [a.address, a.derivationPath]));
        } catch {
          // derivation paths optional for utxo sync
        }
      }
      const sorted = sortAddressesByIndexDesc(
        addrs.map(a => ({
          address: a.address,
          network,
          derivationPath:
            (a as {derivationPath?: string}).derivationPath ??
            pathMap?.get(a.address),
        })),
      );
      const entries: UtxoEntry[] = sorted.map(a => ({
        address: a.address,
        network: a.network,
        derivationPath: a.derivationPath ?? undefined,
      }));
      await utxoSyncer.syncAddresses(entries, this._config.apiBase);
    } catch (err) {
      this._notifySyncFailed('utxo sync error', err);
    }
  }

  private async _syncPrice(): Promise<void> {
    if (!this._config || this._isPaused()) return;
    try {
      await priceSyncer.syncCurrentPrice(this._config.apiBase);
    } catch (err) {
      this._notifySyncFailed('price sync error', err);
    }
  }
}

const syncCoordinator = new SyncCoordinator();
export default syncCoordinator;
