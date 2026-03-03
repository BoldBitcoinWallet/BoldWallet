/**
 * HD wallet index persistence: external (receive) and internal (change) chain indexes.
 * Keys are scoped by network and addressType so switching network/type keeps separate indexes.
 */
import LocalCache from './LocalCache';
import {dbg} from '../utils';

const KEY_EXTERNAL = (network: string, addressType: string) =>
  `hd_external_index_${network}_${addressType}`;
const KEY_CHANGE = (network: string, addressType: string) =>
  `hd_change_index_${network}_${addressType}`;
const KEY_MAX_USED_EXTERNAL = (network: string, addressType: string) =>
  `hd_max_used_external_${network}_${addressType}`;

export async function getExternalIndex(
  network: string,
  addressType: string,
): Promise<number> {
  const key = KEY_EXTERNAL(network, addressType);
  const raw = await LocalCache.getItem(key);
  if (raw == null || raw === '') return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

export async function setExternalIndex(
  network: string,
  addressType: string,
  value: number,
): Promise<void> {
  const key = KEY_EXTERNAL(network, addressType);
  await LocalCache.setItem(key, String(Math.max(0, Math.floor(value))));
  dbg('HdIndexService: setExternalIndex', {network, addressType, value});
}

export async function getChangeIndex(
  network: string,
  addressType: string,
): Promise<number> {
  const key = KEY_CHANGE(network, addressType);
  const raw = await LocalCache.getItem(key);
  if (raw == null || raw === '') return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

export async function setChangeIndex(
  network: string,
  addressType: string,
  value: number,
): Promise<void> {
  const key = KEY_CHANGE(network, addressType);
  await LocalCache.setItem(key, String(Math.max(0, Math.floor(value))));
  dbg('HdIndexService: setChangeIndex', {network, addressType, value});
}

export async function getMaxUsedExternal(
  network: string,
  addressType: string,
): Promise<number> {
  const key = KEY_MAX_USED_EXTERNAL(network, addressType);
  const raw = await LocalCache.getItem(key);
  if (raw == null || raw === '') return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

export async function setMaxUsedExternal(
  network: string,
  addressType: string,
  value: number,
): Promise<void> {
  const key = KEY_MAX_USED_EXTERNAL(network, addressType);
  await LocalCache.setItem(key, String(Math.max(0, Math.floor(value))));
}

/**
 * Call only after a send transaction has been successfully broadcast.
 * Increments the change index so the next send uses a fresh internal address.
 */
export async function incrementChangeIndexAfterSend(
  network: string,
  addressType: string,
): Promise<void> {
  const next = (await getChangeIndex(network, addressType)) + 1;
  await setChangeIndex(network, addressType, next);
  dbg('HdIndexService: incrementChangeIndexAfterSend', {network, addressType, next});
}
