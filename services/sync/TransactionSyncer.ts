/**
 * TransactionSyncer — incremental transaction history fetch using mempool.space chain cursors.
 *
 * The mempool.space API supports paginated fetch:
 *   GET /address/:addr/txs/chain/:last_txid
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
import {INTER_ADDRESS_DELAY_MS, sleep, with429Retry} from './rateLimitRetry';
import {dbg} from '../../utils';
import type {TxRecord, TxAddressMapping} from '../repositories/TransactionRepository';

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
  ): Promise<void> {
    if (!addresses.length) return;
    const cleanApi = apiBase.replace(/\/+$/, '');
    const knownTxids = transactionRepository.getKnownTxids(
      addresses[0]?.network ?? 'mainnet',
    );
    const allBatches: Array<{tx: TxRecord; addresses: TxAddressMapping[]}> = [];
    const cursors: Array<{entityKey: string; cursor: string | null}> = [];

    for (let addrIndex = 0; addrIndex < addresses.length; addrIndex++) {
      if (addrIndex > 0) {
        await sleep(INTER_ADDRESS_DELAY_MS);
      }
      const {address, network} = addresses[addrIndex];
      const entityKey = `${address}_${network}`;
      let cursor = syncRepository.getCursor('transactions', entityKey);
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
          if (!res.ok || !Array.isArray(res.data)) {
            throw new TxSyncError(
              `Transaction fetch failed (${res.status ?? 'error'})`,
              address,
            );
          }

          const page = res.data as ApiTx[];
          if (!page.length) break;

          let hasNew = false;
          for (const apiTx of page) {
            if (!apiTx.txid) continue;
            if (knownTxids.has(apiTx.txid)) {
              if (
                apiTx.status?.confirmed &&
                apiTx.status.block_height &&
                apiTx.status.block_time
              ) {
                transactionRepository.markConfirmed(
                  apiTx.txid,
                  network,
                  apiTx.status.block_height,
                  apiTx.status.block_time,
                  apiTx.status.block_hash,
                );
              }
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
            allBatches.push({
              tx: txRecord,
              addresses: [{txid: apiTx.txid, network, address, netSats}],
            });
          }

          const lastConfirmed = [...page]
            .reverse()
            .find(tx => tx.status?.confirmed);
          if (lastConfirmed) cursor = lastConfirmed.txid;
          pages++;
          if (!hasNew || page.length < PAGE_SIZE) break;
        }

        cursors.push({entityKey, cursor});
      } catch (err) {
        dbg('TransactionSyncer: error for', address.slice(0, 10), err);
        throw new TxSyncError(
          err instanceof Error ? err.message : 'Transaction fetch failed',
          address,
        );
      }
    }

    // All succeeded — write all batches then update cursors
    for (const batch of allBatches) {
      transactionRepository.upsertTransactionBatch([batch]);
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
    const cleanApi = apiBase.replace(/\/+$/, '');
    const entityKey = `${address}_${network}`;
    let cursor = syncRepository.getCursor('transactions', entityKey);
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
        if (!res.ok || !Array.isArray(res.data) || !res.data.length) break;

        const page = res.data as ApiTx[];
        const batch: Array<{tx: TxRecord; addresses: TxAddressMapping[]}> = [];
        let hasNew = false;

        for (const apiTx of page) {
          if (!apiTx.txid) continue;
          if (knownTxids.has(apiTx.txid)) {
            // If already known and now confirmed, update confirmation status
            if (
              apiTx.status?.confirmed &&
              apiTx.status.block_height &&
              apiTx.status.block_time
            ) {
              transactionRepository.markConfirmed(
                apiTx.txid,
                network,
                apiTx.status.block_height,
                apiTx.status.block_time,
                apiTx.status.block_hash,
              );
            }
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

        // Advance cursor to last confirmed txid in the page
        const lastConfirmed = [...page]
          .reverse()
          .find(tx => tx.status?.confirmed);
        if (lastConfirmed) {
          cursor = lastConfirmed.txid;
          syncRepository.updateCursor('transactions', entityKey, cursor, 'partial');
        }

        pages++;
        if (!hasNew || page.length < PAGE_SIZE) break;
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
