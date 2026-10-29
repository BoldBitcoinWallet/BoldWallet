/**
 * Wipe fetched wallet data before a new setup or a keyshare restore.
 * Keeps the keyshare blob, keyshare metadata, and provider settings.
 */
import apiQueue from './ApiQueue';
import database from './Database';
import LocalCache from './LocalCache';
import mempoolClient from './MempoolClient';
import syncCoordinator from './sync/SyncCoordinator';
import {WalletService} from './WalletService';
import {dbg} from '../utils';

export async function clearCachesBeforeWalletSession(): Promise<void> {
  dbg('clearCachesBeforeWalletSession');
  syncCoordinator.stop();
  apiQueue.clear();
  database.clearWalletData();
  WalletService.getInstance().invalidateAddressCache();
  mempoolClient.invalidateAll();
  await LocalCache.clear();
}
