/**
 * UtxoTagRepository — user labels for UTXOs, keyed by outpoint (txid, vout).
 *
 * Stored separately from `utxos` so replaceUtxosForAddress / sync cannot wipe tags.
 */
import database from '../Database';
import {dbg} from '../../utils';
import {
  outpointKey,
  parseOutpointKey,
  isValidUtxoTag,
  sanitizeUtxoTag,
  sanitizeUtxoTagDraft,
} from '../utxoCoinControl';

export interface UtxoTag {
  txid: string;
  vout: number;
  tag: string;
  updatedAt: number;
}

class UtxoTagRepository {
  get(txid: string, vout: number): string | null {
    const id = (txid || '').trim();
    if (!id || !Number.isInteger(vout) || vout < 0) {
      return null;
    }
    try {
      const {rows} = database.execute(
        'SELECT tag FROM utxo_tags WHERE txid = ? AND vout = ?',
        [id, vout],
      );
      if (!rows.length) {
        return null;
      }
      const tag = sanitizeUtxoTag(rows[0].tag as string);
      return tag || null;
    } catch (err) {
      dbg('UtxoTagRepository.get error', txid, vout, err);
      return null;
    }
  }

  /**
   * Map of `txid:vout` → tag for the given outpoint keys.
   * Missing / empty tags are omitted.
   */
  getByOutpoints(keys: string[]): Map<string, string> {
    const result = new Map<string, string>();
    const pairs: Array<[string, number]> = [];
    for (const key of keys) {
      const parsed = parseOutpointKey(key);
      if (parsed) {
        pairs.push([parsed.txid, parsed.vout]);
      }
    }
    if (pairs.length === 0) {
      return result;
    }
    try {
      const placeholders = pairs.map(() => '(?, ?)').join(', ');
      const params = pairs.flatMap(([txid, vout]) => [txid, vout]);
      const {rows} = database.execute(
        `SELECT txid, vout, tag FROM utxo_tags WHERE (txid, vout) IN (${placeholders})`,
        params,
      );
      for (const row of rows) {
        const tag = sanitizeUtxoTag(row.tag as string);
        if (!tag) {
          continue;
        }
        result.set(outpointKey(row.txid as string, row.vout as number), tag);
      }
    } catch (err) {
      dbg('UtxoTagRepository.getByOutpoints error', err);
    }
    return result;
  }

  /**
   * Persist a tag. Empty / whitespace deletes the row.
   * Returns the stored tag, or null if deleted.
   */
  upsert(txid: string, vout: number, tag: string): string | null {
    const id = (txid || '').trim();
    if (!id || !Number.isInteger(vout) || vout < 0) {
      return null;
    }
    const cleaned = sanitizeUtxoTagDraft(tag);
    if (!cleaned) {
      this.delete(id, vout);
      return null;
    }
    if (!isValidUtxoTag(cleaned)) {
      dbg('UtxoTagRepository.upsert: invalid tag rejected', cleaned);
      return null;
    }
    try {
      database.execute(
        `INSERT INTO utxo_tags (txid, vout, tag, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(txid, vout) DO UPDATE SET
           tag = excluded.tag,
           updated_at = excluded.updated_at`,
        [id, vout, cleaned, Date.now()],
      );
      return cleaned;
    } catch (err) {
      dbg('UtxoTagRepository.upsert error', id, vout, err);
      return null;
    }
  }

  delete(txid: string, vout: number): void {
    const id = (txid || '').trim();
    if (!id || !Number.isInteger(vout) || vout < 0) {
      return;
    }
    try {
      database.execute('DELETE FROM utxo_tags WHERE txid = ? AND vout = ?', [
        id,
        vout,
      ]);
    } catch (err) {
      dbg('UtxoTagRepository.delete error', id, vout, err);
    }
  }

  /** Unique non-empty tags, sorted A→Z (case-insensitive). For autocomplete. */
  getDistinctTags(): string[] {
    try {
      const {rows} = database.execute(
        `SELECT DISTINCT tag FROM utxo_tags
         WHERE tag IS NOT NULL AND trim(tag) != ''
         ORDER BY lower(tag) ASC`,
      );
      const seen = new Set<string>();
      const out: string[] = [];
      for (const row of rows) {
        const tag = sanitizeUtxoTag(row.tag as string);
        if (!tag) {
          continue;
        }
        const key = tag.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push(tag);
      }
      return out;
    } catch (err) {
      dbg('UtxoTagRepository.getDistinctTags error', err);
      return [];
    }
  }
}

const utxoTagRepository = new UtxoTagRepository();
export default utxoTagRepository;
