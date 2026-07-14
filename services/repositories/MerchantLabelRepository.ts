/**
 * MerchantLabelRepository — Branta address verification cache.
 *
 * Stores address → merchant (platform, logo, verify URL) mappings resolved from Branta.
 * Populated at send time (when user scans a Branta ZK QR); auto-matched in tx list/details.
 */
import database from '../Database';
import {dbg} from '../../utils';

export interface MerchantLabel {
  address: string;
  platform: string;
  description?: string;
  logoUrl?: string;
  logoLightUrl?: string;
  verifyUrl?: string;
  fetchedAt: number;
}

class MerchantLabelRepository {
  /**
   * Fetch a single merchant label by address.
   * Returns null if not found or on error.
   */
  getByAddress(address: string): MerchantLabel | null {
    try {
      const {rows} = database.execute(
        `SELECT address, platform, description, logo_url, logo_light_url, verify_url, fetched_at
         FROM merchant_labels
         WHERE address = ?`,
        [address],
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
      // Build placeholders for IN clause
      const placeholders = addresses.map(() => '?').join(',');
      const {rows} = database.execute(
        `SELECT address, platform, description, logo_url, logo_light_url, verify_url, fetched_at
         FROM merchant_labels
         WHERE address IN (${placeholders})`,
        addresses,
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
          label.address,
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
   * Clear all merchant labels (e.g., on wallet reset).
   */
  clearAll(): void {
    try {
      database.execute('DELETE FROM merchant_labels');
    } catch (err) {
      dbg('MerchantLabelRepository.clearAll error', err);
    }
  }
}

export default new MerchantLabelRepository();
