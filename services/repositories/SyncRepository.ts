/**
 * SyncRepository — pagination cursors and per-entity sync state.
 *
 * entity_type: 'balance' | 'transactions' | 'utxos' | 'discovery'
 * entity_key:  address string, or "<network>_<addressType>" for aggregate entries
 */
import database from '../Database';
import {dbg} from '../../utils';

export type SyncStatus = 'ok' | 'partial' | 'failed';
export type EntityType = 'balance' | 'transactions' | 'utxos' | 'discovery';

export interface SyncMeta {
  entityType: EntityType;
  entityKey: string;
  cursor: string | null;
  lastSyncedAt: number | null;
  syncStatus: SyncStatus | null;
  extraJson: string | null;
}

class SyncRepository {
  get(entityType: EntityType, entityKey: string): SyncMeta | null {
    try {
      const {rows} = database.execute(
        'SELECT * FROM sync_metadata WHERE entity_type = ? AND entity_key = ?',
        [entityType, entityKey],
      );
      if (!rows.length) return null;
      return this._rowToMeta(rows[0]);
    } catch (err) {
      dbg('SyncRepository.get error', err);
      return null;
    }
  }

  set(meta: SyncMeta): void {
    try {
      database.execute(
        `INSERT INTO sync_metadata
           (entity_type, entity_key, cursor, last_synced_at, sync_status, extra_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_key) DO UPDATE SET
           cursor         = excluded.cursor,
           last_synced_at = excluded.last_synced_at,
           sync_status    = excluded.sync_status,
           extra_json     = excluded.extra_json`,
        [
          meta.entityType,
          meta.entityKey,
          meta.cursor ?? null,
          meta.lastSyncedAt ?? null,
          meta.syncStatus ?? null,
          meta.extraJson ?? null,
        ],
      );
    } catch (err) {
      dbg('SyncRepository.set error', err);
    }
  }

  /** Force immediate re-sync on next SyncCoordinator tick. */
  invalidate(entityType: EntityType, entityKey: string): void {
    try {
      database.execute(
        `UPDATE sync_metadata
         SET last_synced_at = 0, sync_status = 'failed'
         WHERE entity_type = ? AND entity_key = ?`,
        [entityType, entityKey],
      );
    } catch (err) {
      dbg('SyncRepository.invalidate error', err);
    }
  }

  /** Retrieve the stored cursor for paginated transaction fetching. */
  getCursor(entityType: EntityType, entityKey: string): string | null {
    try {
      const {rows} = database.execute(
        'SELECT cursor FROM sync_metadata WHERE entity_type = ? AND entity_key = ?',
        [entityType, entityKey],
      );
      return rows.length ? ((rows[0].cursor as string) ?? null) : null;
    } catch (err) {
      dbg('SyncRepository.getCursor error', err);
      return null;
    }
  }

  updateCursor(
    entityType: EntityType,
    entityKey: string,
    cursor: string | null,
    status: SyncStatus = 'ok',
  ): void {
    try {
      // Upsert — creates row if absent
      database.execute(
        `INSERT INTO sync_metadata
           (entity_type, entity_key, cursor, last_synced_at, sync_status)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_key) DO UPDATE SET
           cursor         = excluded.cursor,
           last_synced_at = excluded.last_synced_at,
           sync_status    = excluded.sync_status`,
        [entityType, entityKey, cursor, Date.now(), status],
      );
    } catch (err) {
      dbg('SyncRepository.updateCursor error', err);
    }
  }

  /** Return the timestamp of the last successful sync, or 0 if never synced. */
  getLastSyncedAt(entityType: EntityType, entityKey: string): number {
    try {
      const {rows} = database.execute(
        `SELECT last_synced_at FROM sync_metadata
         WHERE entity_type = ? AND entity_key = ? AND sync_status = 'ok'`,
        [entityType, entityKey],
      );
      return rows.length ? ((rows[0].last_synced_at as number) ?? 0) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Returns true if the entity was successfully synced within `ttlMs`
   * milliseconds.  Callers use this to skip redundant API calls when
   * the DB already holds fresh-enough data.
   */
  isFresh(entityType: EntityType, entityKey: string, ttlMs: number): boolean {
    const last = this.getLastSyncedAt(entityType, entityKey);
    return last > 0 && Date.now() - last < ttlMs;
  }

  private _rowToMeta(r: Record<string, unknown>): SyncMeta {
    return {
      entityType: r.entity_type as EntityType,
      entityKey: r.entity_key as string,
      cursor: (r.cursor as string) ?? null,
      lastSyncedAt: (r.last_synced_at as number) ?? null,
      syncStatus: (r.sync_status as SyncStatus) ?? null,
      extraJson: (r.extra_json as string) ?? null,
    };
  }
}

const syncRepository = new SyncRepository();
export default syncRepository;
