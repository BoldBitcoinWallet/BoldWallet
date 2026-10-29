/**
 * Created wallets have no chain history. The first index pass only needs the
 * current receive and change addresses. Imported wallets must still gap-scan.
 */
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';

export {
  FRESH_DISCOVERY_STATUS,
  shouldSeedFreshHd,
} from './freshHdSeed';

export const WALLET_ORIGIN_CREATED = 'created';
export const WALLET_ORIGIN_IMPORTED = 'imported';

export function markWalletCreated(): void {
  appConfigRepository.set(CONFIG_KEYS.WALLET_ORIGIN, WALLET_ORIGIN_CREATED);
}

export function markWalletImported(): void {
  appConfigRepository.set(CONFIG_KEYS.WALLET_ORIGIN, WALLET_ORIGIN_IMPORTED);
}

export function isCreatedWallet(): boolean {
  return appConfigRepository.get(CONFIG_KEYS.WALLET_ORIGIN) === WALLET_ORIGIN_CREATED;
}
