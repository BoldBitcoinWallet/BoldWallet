import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';

/** @deprecated Use resolveTssBackendForKeygen; new wallets default to DKLs23. */
export async function isDkls23Enabled(): Promise<boolean> {
  return !(await isDkls23OptedOut());
}

/** Opt out of DKLs23 for new keygen (legacy GG18 keygen). */
export function setDkls23OptedOut(value: boolean): void {
  appConfigRepository.setBool(CONFIG_KEYS.DKLS23_OPTED_OUT, value);
}

export function isDkls23OptedOut(): boolean {
  return appConfigRepository.getBool(CONFIG_KEYS.DKLS23_OPTED_OUT, false);
}

/** @deprecated Prefer setDkls23OptedOut(!enabled) */
export function setDkls23Enabled(value: boolean): void {
  setDkls23OptedOut(!value);
}
