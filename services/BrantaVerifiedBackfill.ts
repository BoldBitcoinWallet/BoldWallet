/**
 * One-time migration: backfill branta_verified_txs for payments that predate
 * per-txid Branta tracking.
 */
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';
import merchantLabelRepository from './repositories/MerchantLabelRepository';
import {dbg} from '../utils';

export async function runBrantaVerifiedBackfillIfNeeded(): Promise<void> {
  if (
    appConfigRepository.get(CONFIG_KEYS.BRANTA_VERIFIED_BACKFILL_V1) === 'done'
  ) {
    return;
  }

  try {
    const inserted =
      merchantLabelRepository.backfillVerifiedTxsFromMerchantHistory();
    appConfigRepository.set(CONFIG_KEYS.BRANTA_VERIFIED_BACKFILL_V1, 'done');
    dbg('BrantaVerifiedBackfill: complete, inserted', inserted);
  } catch (err) {
    dbg('BrantaVerifiedBackfill: failed (will retry on next launch)', err);
  }
}
