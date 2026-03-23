/**
 * HD wallet index persistence: external (receive) and internal (change) chain indexes.
 *
 * Keys are scoped by network and addressType so switching network/type keeps separate indexes.
 *
 * Migration: previously backed by LocalCache (file-based). Now backed by SQLite via
 * WalletRepository. The public API is synchronous to avoid cascading async changes
 * throughout the call-sites. WalletRepository.execute() is synchronous (op-sqlite).
 *
 * NOTE: All functions remain async-compatible (returning Promise) so existing call-sites
 * that use `await` require no changes.
 */
import walletRepository from './repositories/WalletRepository';
import {dbg} from '../utils';

export function getExternalIndex(
  network: string,
  addressType: string,
): Promise<number> {
  return Promise.resolve(walletRepository.getExternalIndex(network, addressType));
}

export function setExternalIndex(
  network: string,
  addressType: string,
  value: number,
): Promise<void> {
  walletRepository.setExternalIndex(network, addressType, value);
  dbg('HdIndexService: setExternalIndex', {network, addressType, value});
  return Promise.resolve();
}

export function getChangeIndex(
  network: string,
  addressType: string,
): Promise<number> {
  return Promise.resolve(walletRepository.getChangeIndex(network, addressType));
}

export function setChangeIndex(
  network: string,
  addressType: string,
  value: number,
): Promise<void> {
  walletRepository.setChangeIndex(network, addressType, value);
  dbg('HdIndexService: setChangeIndex', {network, addressType, value});
  return Promise.resolve();
}

export function getMaxUsedExternal(
  network: string,
  addressType: string,
): Promise<number> {
  return Promise.resolve(walletRepository.getMaxUsedExternal(network, addressType));
}

export function setMaxUsedExternal(
  network: string,
  addressType: string,
  value: number,
): Promise<void> {
  walletRepository.setMaxUsedExternal(network, addressType, value);
  return Promise.resolve();
}

/**
 * Call only after a send transaction has been successfully broadcast.
 * Increments the change index so the next send uses a fresh internal address.
 */
export function incrementChangeIndexAfterSend(
  network: string,
  addressType: string,
): Promise<void> {
  const next = walletRepository.incrementChangeIndex(network, addressType);
  dbg('HdIndexService: incrementChangeIndexAfterSend', {network, addressType, next});
  return Promise.resolve();
}
