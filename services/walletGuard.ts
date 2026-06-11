import {hasWalletKeyshareInSecureStorage} from '../utils';

export class WalletAlreadyLoadedError extends Error {
  constructor() {
    super('Wallet already loaded');
    this.name = 'WalletAlreadyLoadedError';
  }
}

export async function assertNoExistingWallet(): Promise<void> {
  const hasKeyshare = await hasWalletKeyshareInSecureStorage();
  if (hasKeyshare) {
    throw new WalletAlreadyLoadedError();
  }
}

export async function hasLoadedWallet(): Promise<boolean> {
  return hasWalletKeyshareInSecureStorage();
}
