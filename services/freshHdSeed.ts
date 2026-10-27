/** HD discovery_status written when a created wallet skips the gap scan. */
export const FRESH_DISCOVERY_STATUS = 'fresh';

/**
 * Created wallets start at receive 0 / change 0. Import, a moved index, a
 * used address, or a finished gap scan all keep the full discovery path.
 */
export function shouldSeedFreshHd(opts: {
  created: boolean;
  hasState: boolean;
  externalIndex: number;
  changeIndex: number;
  restoreDone: boolean;
  discoveryStatus: string | null;
  anyUsed: boolean;
}): boolean {
  if (!opts.created || opts.anyUsed) {
    return false;
  }
  if (!opts.hasState) {
    return true;
  }
  if (opts.externalIndex !== 0 || opts.changeIndex !== 0) {
    return false;
  }
  if (opts.discoveryStatus === FRESH_DISCOVERY_STATUS) {
    return true;
  }
  return !opts.restoreDone;
}
