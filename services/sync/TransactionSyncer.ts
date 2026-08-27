/**
 * TransactionSyncer — two-phase transaction history fetch using mempool.space.
 *
 * Phase 1 (forward): Always fetch from `/txs` (newest first, no cursor) so that
 *   transactions confirmed *after* the previous sync are discovered.
 * Phase 2 (backfill): If a stored cursor exists, continue from it to fetch older
 *   history that wasn't covered by the initial sync (wallets with >25 txs/address).
 *
 * ATOMIC sync: syncAddressesAtomic fetches all addresses into memory; only if every
 * address succeeds does it write all batches to DB. Otherwise throws TxSyncError.
 * On 429: retry with backoff (see rateLimitRetry); then throw if still failing.
 *
 * Sync schedule: on app foreground (incremental, only new txs).
 *                Full re-fetch only after keyshare import (restore_done=0).
 */
import mempoolClient from '../MempoolClient';
import transactionRepository from '../repositories/TransactionRepository';
import syncRepository from '../repositories/SyncRepository';
import {getTransactionDbTtlMs} from '../HdOptionsConfig';
import {INTER_ADDRESS_DELAY_MS, mapPool, sleep, with429Retry} from './rateLimitRetry';
import {dbg} from '../../utils';
import type {TxRecord, TxAddressMapping} from '../repositories/TransactionRepository';
type AddressLink = TxAddressMapping;

const PAGE_SIZE = 25;
const MAX_PAGES_PER_ADDRESS = 20;

interface ApiTx {
  txid: string;
  status?: {
    confirmed?: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
  fee?: number;
  size?: number;
  weight?: number;
  version?: number;
  locktime?: number;
  vin?: Array<{prevout?: {scriptpubkey_address?: string; value?: number}}>;
  vout?: Array<{scriptpubkey_address?: string; value?: number}>;
}

/** Thrown when any address tx fetch fails (atomic: no DB writes). */
export class TxSyncError extends Error {
  constructor(message: string, public readonly failedAddress?: string) {
    super(message);
    this.name = 'TxSyncError';
  }
}

class TransactionSyncer {
  /**
   * ATOMIC: Fetch transactions for all addresses; only if every one succeeds, write all.
   * On any failure throws TxSyncError and writes nothing.
   */
  async syncAddressesAtomic(
    addresses: Array<{address: string; network: string}>,
    apiBase: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    if (!addresses.length) return;
    // Skip full fetch when every address was synced recently (same TTL as syncAddress).
    // Prevents duplicate work when UI re-enqueues "Syncing transactions…" (e.g. effect re-run).
    const txDbTtlMs = getTransactionDbTtlMs();
    const allFresh = addresses.every(({address, network}) =>
      syncRepository.isFresh(
        'transactions',
        `${address}_${network}`,
        txDbTtlMs,
      ),
    );
    if (allFresh) {
      dbg(
        'TransactionSyncer: syncAddressesAtomic skipped — all',
        addresses.length,
        'addresses fresh (TTL',
        txDbTtlMs / 1000,
        's)',
      );
      return;
    }
    const cleanApi = apiBase.replace(/\/+$/, '');
    const concurrency = mempoolClient.syncPoolConcurrency(cleanApi);
    const knownAtStart = transactionRepository.getKnownTxids(
      addresses[0]?.network ?? 'mainnet',
    );
    let fetchedCount = 0;

    const perAddress = await mapPool(
      addresses,
      concurrency,
      async ({address, network}) => {
        if (concurrency === 1 && fetchedCount > 0) {
          await sleep(INTER_ADDRESS_DELAY_MS);
        }
        fetchedCount++;
        const knownTxids = new Set(knownAtStart);
        const entityKey = `${address}_${network}`;
        const savedCursor = syncRepository.getCursor('transactions', entityKey);
        let cursor: string | null = null;
        let forwardDone = false;
        let pages = 0;
        const batches: Array<{tx: TxRecord; addresses: TxAddressMapping[]}> = [];
        const links: AddressLink[] = [];

        try {
          while (pages < MAX_PAGES_PER_ADDRESS) {
            const url = cursor
              ? `${cleanApi}/address/${encodeURIComponent(address)}/txs/chain/${cursor}`
              : `${cleanApi}/address/${encodeURIComponent(address)}/txs`;

            const res = await with429Retry<ApiTx[]>(
              'TransactionSyncer',
              () => mempoolClient.get<ApiTx[]>(url),
            );
            if (!res.ok || !Array.isArray(res.data)) {
              throw new TxSyncError(
                `Transaction fetch failed (${res.status ?? 'error'})`,
                address,
              );
            }

            const page = res.data as ApiTx[];
            if (!page.length) {
              if (!forwardDone && savedCursor) {
                forwardDone = true;
                cursor = savedCursor;
                continue;
              }
              break;
            }

            let hasNew = false;
            for (const apiTx of page) {
              if (!apiTx.txid) continue;
              if (knownTxids.has(apiTx.txid)) {
                const netSats = this._computeNetSats(apiTx, address);
                const txRecord: TxRecord = {
                  txid: apiTx.txid,
                  network,
                  blockHeight: apiTx.status?.block_height ?? null,
                  blockHash: apiTx.status?.block_hash ?? null,
                  blockTime: apiTx.status?.block_time ?? null,
                  isConfirmed: apiTx.status?.confirmed ?? false,
                  feeSats: apiTx.fee ?? null,
                  size: apiTx.size ?? null,
                  weight: apiTx.weight ?? null,
                  version: apiTx.version ?? null,
                  locktime: apiTx.locktime ?? null,
                  rawJson: JSON.stringify(apiTx),
                  fetchedAt: Date.now(),
                };
                batches.push({
                  tx: txRecord,
                  addresses: [{txid: apiTx.txid, network, address, netSats}],
                });
                links.push({
                  txid: apiTx.txid,
                  network,
                  address,
                  netSats,
                });
                continue;
              }
              hasNew = true;
              knownTxids.add(apiTx.txid);
              const netSats = this._computeNetSats(apiTx, address);
              const txRecord: TxRecord = {
                txid: apiTx.txid,
                network,
                blockHeight: apiTx.status?.block_height ?? null,
                blockHash: apiTx.status?.block_hash ?? null,
                blockTime: apiTx.status?.block_time ?? null,
                isConfirmed: apiTx.status?.confirmed ?? false,
                feeSats: apiTx.fee ?? null,
                size: apiTx.size ?? null,
                weight: apiTx.weight ?? null,
                version: apiTx.version ?? null,
                locktime: apiTx.locktime ?? null,
                rawJson: JSON.stringify(apiTx),
                fetchedAt: Date.now(),
              };
              batches.push({
                tx: txRecord,
                addresses: [{txid: apiTx.txid, network, address, netSats}],
              });
            }

            const lastConfirmed = [...page]
              .reverse()
              .find(tx => tx.status?.confirmed);
            if (lastConfirmed) cursor = lastConfirmed.txid;
            pages++;
            if (!hasNew || page.length < PAGE_SIZE) {
              if (!forwardDone && savedCursor) {
                forwardDone = true;
                cursor = savedCursor;
                continue;
              }
              break;
            }
          }

          return {batches, links, entityKey, cursor};
        } catch (err) {
          dbg('TransactionSyncer: error for', address.slice(0, 10), err);
          throw new TxSyncError(
            err instanceof Error ? err.message : 'Transaction fetch failed',
            address,
          );
        }
      },
      (completed, poolTotal) => onProgress?.(completed, poolTotal),
    );

    const allBatches = perAddress.flatMap(row => row.batches);
    const missingLinks = perAddress.flatMap(row => row.links);
    const cursors = perAddress.map(row => ({
      entityKey: row.entityKey,
      cursor: row.cursor,
    }));

    // All succeeded — write all batches then update cursors
    for (const batch of allBatches) {
      transactionRepository.upsertTransactionBatch([batch]);
    }
    if (missingLinks.length) {
      transactionRepository.ensureAddressLinks(missingLinks);
    }
    for (const {entityKey, cursor} of cursors) {
      syncRepository.updateCursor('transactions', entityKey, cursor, 'ok');
    }
    dbg('TransactionSyncer: atomic write complete', addresses.length, 'addresses', allBatches.length, 'txs');
  }

  /**
   * Incrementally fetch new transactions for an address.
   * Stops when a page returns no new txids (delta = empty).
   * Non-atomic: use for background sync; on failure only this address is marked failed.
   */
  async syncAddress(
    address: string,
    network: string,
    apiBase: string,
  ): Promise<void> {
    const entityKey = `${address}_${network}`;
    if (syncRepository.isFresh('transactions', entityKey, getTransactionDbTtlMs())) {
      dbg('TransactionSyncer: fresh — skipping', address.slice(0, 10));
      return;
    }

    const cleanApi = apiBase.replace(/\/+$/, '');
    const savedCursor = syncRepository.getCursor('transactions', entityKey);
    let cursor: string | null = null; // Phase 1: always start fresh from top
    let forwardDone = false;
    const knownTxids = transactionRepository.getKnownTxids(network);
    let newCount = 0;
    let pages = 0;

    try {
      while (pages < MAX_PAGES_PER_ADDRESS) {
        const url = cursor
          ? `${cleanApi}/address/${encodeURIComponent(address)}/txs/chain/${cursor}`
          : `${cleanApi}/address/${encodeURIComponent(address)}/txs`;

        const res = await with429Retry<ApiTx[]>(
          'TransactionSyncer',
          () => mempoolClient.get<ApiTx[]>(url),
        );
        if (!res.ok || !Array.isArray(res.data)) break;

        const page = res.data as ApiTx[];
        if (!page.length) {
          if (!forwardDone && savedCursor) {
            forwardDone = true;
            cursor = savedCursor;
            continue;
          }
          break;
        }

        const batch: Array<{tx: TxRecord; addresses: TxAddressMapping[]}> = [];
        const links: AddressLink[] = [];
        let hasNew = false;

        for (const apiTx of page) {
          if (!apiTx.txid) continue;
          if (knownTxids.has(apiTx.txid)) {
            // Full upsert so broadcast-inserted pending tx gets updated with API payload when confirmed
            const netSats = this._computeNetSats(apiTx, address);
            const txRecord: TxRecord = {
              txid: apiTx.txid,
              network,
              blockHeight: apiTx.status?.block_height ?? null,
              blockHash: apiTx.status?.block_hash ?? null,
              blockTime: apiTx.status?.block_time ?? null,
              isConfirmed: apiTx.status?.confirmed ?? false,
              feeSats: apiTx.fee ?? null,
              size: apiTx.size ?? null,
              weight: apiTx.weight ?? null,
              version: apiTx.version ?? null,
              locktime: apiTx.locktime ?? null,
              rawJson: JSON.stringify(apiTx),
              fetchedAt: Date.now(),
            };
            batch.push({
              tx: txRecord,
              addresses: [{txid: apiTx.txid, network, address, netSats}],
            });
            links.push({
              txid: apiTx.txid,
              network,
              address,
              netSats,
            });
            continue;
          }

          hasNew = true;
          knownTxids.add(apiTx.txid);
          newCount++;

          const netSats = this._computeNetSats(apiTx, address);
          const txRecord: TxRecord = {
            txid: apiTx.txid,
            network,
            blockHeight: apiTx.status?.block_height ?? null,
            blockHash: apiTx.status?.block_hash ?? null,
            blockTime: apiTx.status?.block_time ?? null,
            isConfirmed: apiTx.status?.confirmed ?? false,
            feeSats: apiTx.fee ?? null,
            size: apiTx.size ?? null,
            weight: apiTx.weight ?? null,
            version: apiTx.version ?? null,
            locktime: apiTx.locktime ?? null,
            rawJson: JSON.stringify(apiTx),
            fetchedAt: Date.now(),
          };
          batch.push({
            tx: txRecord,
            addresses: [{txid: apiTx.txid, network, address, netSats}],
          });
        }

        if (batch.length) {
          transactionRepository.upsertTransactionBatch(batch);
        }
        if (links.length) {
          transactionRepository.ensureAddressLinks(links);
        }

        const lastConfirmed = [...page]
          .reverse()
          .find(tx => tx.status?.confirmed);
        if (lastConfirmed) {
          cursor = lastConfirmed.txid;
          syncRepository.updateCursor('transactions', entityKey, cursor, 'partial');
        }

        pages++;
        if (!hasNew || page.length < PAGE_SIZE) {
          if (!forwardDone && savedCursor) {
            forwardDone = true;
            cursor = savedCursor;
            continue;
          }
          break;
        }
      }

      syncRepository.updateCursor('transactions', entityKey, cursor ?? null, 'ok');
      dbg('TransactionSyncer: synced', address.slice(0, 10), newCount, 'new txs');
    } catch (err) {
      dbg('TransactionSyncer: error for', address.slice(0, 10), err);
      syncRepository.updateCursor('transactions', entityKey, cursor ?? null, 'failed');
    }
  }

  private _computeNetSats(apiTx: ApiTx, address: string): number | null {
    try {
      const sent = (apiTx.vin ?? []).reduce((sum, vin) => {
        return vin.prevout?.scriptpubkey_address === address
          ? sum + (vin.prevout?.value ?? 0)
          : sum;
      }, 0);
      const received = (apiTx.vout ?? []).reduce((sum, vout) => {
        return vout.scriptpubkey_address === address
          ? sum + (vout.value ?? 0)
          : sum;
      }, 0);
      return received - sent;
    } catch {
      return null;
    }
  }
}

const transactionSyncer = new TransactionSyncer();
export default transactionSyncer;
