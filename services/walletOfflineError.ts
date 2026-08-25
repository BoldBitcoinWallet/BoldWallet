/** Shared error for the in-app online/offline sandbox. No I/O imports. */

export const WALLET_OFFLINE_ERROR_CODE = 'WALLET_OFFLINE';

export class WalletOfflineError extends Error {
  code = WALLET_OFFLINE_ERROR_CODE;
  constructor(message = 'Wallet is offline') {
    super(message);
    this.name = 'WalletOfflineError';
  }
}

export function isWalletOfflineError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as {name?: string; code?: string};
  return e.name === 'WalletOfflineError' || e.code === WALLET_OFFLINE_ERROR_CODE;
}
