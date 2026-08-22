/**
 * MerchantLabelRepository — Branta address verification cache.
 *
 * Stores address → merchant (platform, logo, verify URL) mappings resolved from Branta.
 * Populated at send time (when user scans a Branta ZK QR); auto-matched in tx list/details.
 */
import database from '../Database';
import {dbg} from '../../utils';

/** Allow tx slightly before Branta QR resolve (clock skew). */
export const BRANTA_BACKFILL_PRE_MS = 60 * 60 * 1000;
/** Branta scan → broadcast/confirm window for historical backfill. */
export const BRANTA_BACKFILL_POST_MS = 7 * 24 * 60 * 60 * 1000;

export interface BrantaBackfillCandidate {
  txid: string;
  network: string;
  address: string;
  fetchedAt: number;
  txTimeMs: number | null;
}

/**
 * Whether a historical outbound tx should receive a backfilled Branta checkmark.
 * Used for one-time migration when per-txid records did not exist yet.
 */
export function shouldBackfillBrantaTx(
  candidate: BrantaBackfillCandidate,
  allCandidatesForAddress: BrantaBackfillCandidate[],
): boolean {
  const {fetchedAt, txTimeMs} = candidate;
  if (txTimeMs == null || !Number.isFinite(txTimeMs)) {
    return allCandidatesForAddress.length === 1;
  }
  const windowStart = fetchedAt - BRANTA_BACKFILL_PRE_MS;
  const windowEnd = fetchedAt + BRANTA_BACKFILL_POST_MS;
  if (txTimeMs >= windowStart && txTimeMs <= windowEnd) {
    return true;
  }
  return allCandidatesForAddress.length === 1;
}

export interface MerchantLabel {
  address: string;
  platform: string;
  description?: string;
  logoUrl?: string;
  logoLightUrl?: string;
  verifyUrl?: string;
  fetchedAt: number;
}

export function normalizeMerchantAddress(address: string): string {
  return address.trim().toLowerCase();
}

class MerchantLabelRepository {
  /**
   * Fetch a single merchant label by address.
   * Returns null if not found or on error.
   */
  getByAddress(address: string): MerchantLabel | null {
    try {
      const key = normalizeMerchantAddress(address);
      if (!key) {
        return null;
      }
      const {rows} = database.execute(
        `SELECT address, platform, description, logo_url, logo_light_url, verify_url, fetched_at
         FROM merchant_labels
         WHERE lower(address) = ?`,
        [key],
      );
      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        address: row.address as string,
        platform: row.platform as string,
        description: (row.description as string) || undefined,
        logoUrl: (row.logo_url as string) || undefined,
        logoLightUrl: (row.logo_light_url as string) || undefined,
        verifyUrl: (row.verify_url as string) || undefined,
        fetchedAt: row.fetched_at as number,
      };
    } catch (err) {
      dbg('MerchantLabelRepository.getByAddress error', address, err);
      return null;
    }
  }

  /**
   * Fetch multiple merchant labels by addresses.
   * Returns a Map of address → MerchantLabel for addresses found; missing addresses not in map.
   */
  getByAddresses(addresses: string[]): Map<string, MerchantLabel> {
    const result = new Map<string, MerchantLabel>();
    if (addresses.length === 0) return result;

    try {
      const keys = [
        ...new Set(
          addresses.map(normalizeMerchantAddress).filter(addr => addr.length > 0),
        ),
      ];
      if (keys.length === 0) {
        return result;
      }
      const placeholders = keys.map(() => '?').join(',');
      const {rows} = database.execute(
        `SELECT address, platform, description, logo_url, logo_light_url, verify_url, fetched_at
         FROM merchant_labels
         WHERE lower(address) IN (${placeholders})`,
        keys,
      );

      for (const row of rows) {
        const addr = row.address as string;
        result.set(addr, {
          address: addr,
          platform: row.platform as string,
          description: (row.description as string) || undefined,
          logoUrl: (row.logo_url as string) || undefined,
          logoLightUrl: (row.logo_light_url as string) || undefined,
          verifyUrl: (row.verify_url as string) || undefined,
          fetchedAt: row.fetched_at as number,
        });
      }
    } catch (err) {
      dbg('MerchantLabelRepository.getByAddresses error', addresses, err);
    }

    return result;
  }

  /**
   * Upsert a merchant label for an address.
   */
  upsert(label: MerchantLabel): void {
    try {
      database.execute(
        `INSERT INTO merchant_labels (address, platform, description, logo_url, logo_light_url, verify_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET
           platform       = excluded.platform,
           description    = excluded.description,
           logo_url       = excluded.logo_url,
           logo_light_url = excluded.logo_light_url,
           verify_url     = excluded.verify_url,
           fetched_at     = excluded.fetched_at`,
        [
          normalizeMerchantAddress(label.address) || label.address,
          label.platform,
          label.description || null,
          label.logoUrl || null,
          label.logoLightUrl || null,
          label.verifyUrl || null,
          label.fetchedAt,
        ],
      );
    } catch (err) {
      dbg('MerchantLabelRepository.upsert error', label.address, err);
    }
  }

  /**
   * Delete a merchant label by address.
   */
  delete(address: string): void {
    try {
      database.execute('DELETE FROM merchant_labels WHERE address = ?', [
        address,
      ]);
    } catch (err) {
      dbg('MerchantLabelRepository.delete error', address, err);
    }
  }

  /**
   * Record a Branta-initiated send by txid (survives mempool → confirmed).
   */
  markVerifiedTx(txid: string, network: string, address?: string): void {
    if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
      return;
    }
    try {
      database.execute(
        `INSERT OR REPLACE INTO branta_verified_txs (txid, network, address, created_at)
         VALUES (?, ?, ?, ?)`,
        [
          txid,
          network,
          address ? normalizeMerchantAddress(address) : null,
          Date.now(),
        ],
      );
    } catch (err) {
      dbg('MerchantLabelRepository.markVerifiedTx error', txid, err);
    }
  }

  getVerifiedTxAddress(txid: string, network: string): string | null {
    if (!txid || !network) {
      return null;
    }
    try {
      const {rows} = database.execute(
        `SELECT address FROM branta_verified_txs WHERE txid = ? AND network = ? LIMIT 1`,
        [txid, network],
      );
      const addr = rows[0]?.address as string | undefined;
      return addr ? normalizeMerchantAddress(addr) : null;
    } catch (err) {
      dbg('MerchantLabelRepository.getVerifiedTxAddress error', txid, err);
      return null;
    }
  }

  /**
   * Merchant label for an outbound tx: verified-payment address first, then any output.
   */
  resolveForOutboundTx(
    txid: string,
    network: string | null | undefined,
    outputAddresses: string[],
  ): MerchantLabel | null {
    const candidates: string[] = [];
    if (network) {
      const verifiedAddr = this.getVerifiedTxAddress(txid, network);
      if (verifiedAddr) {
        candidates.push(verifiedAddr);
      }
    }
    candidates.push(...outputAddresses);
    const seen = new Set<string>();
    for (const addr of candidates) {
      const key = normalizeMerchantAddress(addr || '');
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const label = this.getByAddress(key);
      if (label) {
        return label;
      }
    }
    return null;
  }

  /**
   * Whether this txid was marked as a Branta-initiated send on this device.
   */
  isVerifiedTx(txid: string, network: string): boolean {
    if (!txid || !network) {
      return false;
    }
    try {
      const {rows} = database.execute(
        'SELECT 1 FROM branta_verified_txs WHERE txid = ? AND network = ? LIMIT 1',
        [txid, network],
      );
      return rows.length > 0;
    } catch (err) {
      dbg('MerchantLabelRepository.isVerifiedTx error', txid, err);
      return false;
    }
  }

  /**
   * Batch lookup of verified txids for list rendering.
   */
  getVerifiedTxids(txids: string[], network: string): Set<string> {
    const result = new Set<string>();
    if (!network || txids.length === 0) {
      return result;
    }
    const valid = txids.filter(t => /^[a-fA-F0-9]{64}$/.test(t));
    if (valid.length === 0) {
      return result;
    }
    try {
      const placeholders = valid.map(() => '?').join(',');
      const {rows} = database.execute(
        `SELECT txid FROM branta_verified_txs
         WHERE network = ? AND txid IN (${placeholders})`,
        [network, ...valid],
      );
      for (const row of rows) {
        result.add(row.txid as string);
      }
    } catch (err) {
      dbg('MerchantLabelRepository.getVerifiedTxids error', err);
    }
    return result;
  }

  /**
   * One-time backfill: infer Branta-initiated sends from merchant label timing.
   * Best-effort for txs that predate branta_verified_txs. Returns rows inserted.
   */
  backfillVerifiedTxsFromMerchantHistory(): number {
    let inserted = 0;
    try {
      const {rows: txRows} = database.execute(
        `SELECT ta.txid, ta.network, ml.address, ml.fetched_at,
                COALESCE(t.block_time * 1000, pt.created_at) AS tx_time_ms
         FROM merchant_labels ml
         JOIN transaction_addresses ta
           ON ta.address = ml.address AND COALESCE(ta.net_sats, 0) > 0
         JOIN transactions t
           ON t.txid = ta.txid AND t.network = ta.network
         LEFT JOIN pending_transactions pt
           ON pt.txid = ta.txid AND pt.network = ta.network
         WHERE ml.verify_url IS NOT NULL AND ml.verify_url != ''
           AND EXISTS (
             SELECT 1 FROM transaction_addresses spend
             WHERE spend.txid = ta.txid
               AND spend.network = ta.network
               AND COALESCE(spend.net_sats, 0) < 0
           )`,
      );

      const byAddress = new Map<string, BrantaBackfillCandidate[]>();
      for (const row of txRows) {
        const address = row.address as string;
        const candidate: BrantaBackfillCandidate = {
          txid: row.txid as string,
          network: row.network as string,
          address,
          fetchedAt: row.fetched_at as number,
          txTimeMs:
            row.tx_time_ms != null ? Number(row.tx_time_ms) : null,
        };
        const list = byAddress.get(address) ?? [];
        list.push(candidate);
        byAddress.set(address, list);
      }

      for (const candidates of byAddress.values()) {
        for (const candidate of candidates) {
          if (!/^[a-fA-F0-9]{64}$/.test(candidate.txid)) {
            continue;
          }
          if (this.isVerifiedTx(candidate.txid, candidate.network)) {
            continue;
          }
          if (!shouldBackfillBrantaTx(candidate, candidates)) {
            continue;
          }
          this.markVerifiedTx(
            candidate.txid,
            candidate.network,
            candidate.address,
          );
          inserted += 1;
        }
      }

      dbg(
        'MerchantLabelRepository.backfillVerifiedTxsFromMerchantHistory inserted',
        inserted,
      );
    } catch (err) {
      dbg('MerchantLabelRepository.backfillVerifiedTxsFromMerchantHistory error', err);
    }
    return inserted;
  }

  /**
   * Clear merchant labels and Branta verified tx records (e.g., on wallet reset).
   */
  clearAll(): void {
    try {
      database.execute('DELETE FROM merchant_labels');
      database.execute('DELETE FROM branta_verified_txs');
    } catch (err) {
      dbg('MerchantLabelRepository.clearAll error', err);
    }
  }
}

export default new MerchantLabelRepository();
