import type {StoredUtxo} from './repositories/UtxoRepository';

/** One outpoint (txid:vout) must not appear twice — stale rows cause fee estimation to double-count. */
export function dedupeUtxosByOutpoint(utxos: StoredUtxo[]): StoredUtxo[] {
  const byKey = new Map<string, StoredUtxo>();
  for (const u of utxos) {
    const key = `${u.txid}:${u.vout}`;
    const prev = byKey.get(key);
    if (!prev || u.fetchedAt >= prev.fetchedAt) {
      byKey.set(key, u);
    }
  }
  return [...byKey.values()];
}
