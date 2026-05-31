import {dedupeUtxosByOutpoint} from '../services/utxoDedup';
import type {StoredUtxo} from '../services/repositories/UtxoRepository';

const utxo = (txid: string, vout: number, address: string): StoredUtxo => ({
  txid,
  vout,
  address,
  network: 'testnet3',
  valueSats: 114_932,
  scriptPubkey: null,
  derivationPath: "m/84'/1'/0'/0/0",
  isConfirmed: false,
  blockHeight: null,
  blockTime: null,
  fetchedAt: 1,
});

describe('dedupeUtxosByOutpoint', () => {
  it('keeps one row per txid:vout (newest fetchedAt wins)', () => {
    const a = utxo('aa', 0, 'tb1qsend');
    const b = {...utxo('aa', 0, 'tb1qrecv'), fetchedAt: 2};
    expect(dedupeUtxosByOutpoint([a, b])).toHaveLength(1);
    expect(dedupeUtxosByOutpoint([a, b])[0].address).toBe('tb1qrecv');
  });
});
