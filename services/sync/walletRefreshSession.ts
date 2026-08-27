/**
 * User-owned Home refresh: pause background sync, fetch active-set balance
 * (and optional txs) plus price, then resume without kicking a coordinator cycle.
 *
 * SQLite remains the UI source of truth — callers paint from DB before and after.
 */
import {dbg} from '../../utils';
import {WalletService} from '../WalletService';
import syncRepository from '../repositories/SyncRepository';
import apiQueue from '../ApiQueue';
import transactionSyncer from './TransactionSyncer';
import syncCoordinator from './SyncCoordinator';

export type WalletRefreshSessionOpts = {
  network: string;
  addressType: string;
  apiBase: string;
  btcRate: number;
  pendingSent?: number;
  activeOnly?: boolean;
  includeTx?: boolean;
};

export async function runWalletRefreshSession(
  opts: WalletRefreshSessionOpts,
): Promise<void> {
  const activeOnly = opts.activeOnly !== false;
  const includeTx = opts.includeTx !== false;
  const pendingSent = opts.pendingSent ?? 0;
  const cleanBase = opts.apiBase.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  const apiUrl = `${cleanBase}/api`;

  syncCoordinator.pause();
  try {
    syncRepository.invalidate(
      'balance',
      `aggregate_${opts.network}_${opts.addressType}`,
    );

    const ws = WalletService.getInstance();
    const pricePromise = ws.getBitcoinPrice().catch(err => {
      dbg('walletRefreshSession: price error', err);
    });

    await apiQueue.enqueue('Syncing balance…', setProgress =>
      ws.getWalletBalanceAggregate(
        opts.network,
        opts.addressType,
        opts.btcRate,
        pendingSent,
        true,
        setProgress,
        activeOnly,
      ),
    );

    if (includeTx) {
      const addrs = activeOnly
        ? await ws.getActiveAddressesWithPaths(opts.network, opts.addressType)
        : await ws.getHdAddressesWithPaths(opts.network, opts.addressType);
      const list = addrs.map(a => a.address);
      if (list.length > 0) {
        await apiQueue.enqueue('Syncing transactions…', setProgress =>
          transactionSyncer.syncAddressesAtomic(
            list.map(address => ({address, network: opts.network})),
            apiUrl,
            setProgress,
          ),
        );
      }
    }

    await pricePromise;
  } finally {
    syncCoordinator.resume();
  }
}
