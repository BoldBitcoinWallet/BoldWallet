import {
  sortMempoolTransactionsForDisplay,
  getMempoolTransactionAmounts,
} from '../utils/transactionListUtils';

describe('sortMempoolTransactionsForDisplay', () => {
  it('orders pending before confirmed', () => {
    const confirmed = {txid: 'a', status: {block_height: 100}};
    const pending = {txid: 'b', status: {block_height: null}};
    const out = sortMempoolTransactionsForDisplay([confirmed, pending]);
    expect(out[0].txid).toBe('b');
    expect(out[1].txid).toBe('a');
  });

  it('sorts two pending by sentAt descending', () => {
    const older = {txid: 'x', sentAt: 100, status: {}};
    const newer = {txid: 'y', sentAt: 200, status: {}};
    const out = sortMempoolTransactionsForDisplay([older, newer]);
    expect(out[0].txid).toBe('y');
    expect(out[1].txid).toBe('x');
  });

  it('sorts confirmed by block_height descending', () => {
    const low = {txid: 'l', status: {block_height: 50}};
    const high = {txid: 'h', status: {block_height: 900_000}};
    const out = sortMempoolTransactionsForDisplay([low, high]);
    expect(out[0].txid).toBe('h');
    expect(out[1].txid).toBe('l');
  });
});

describe('getMempoolTransactionAmounts', () => {
  const alwaysOurs = () => true;

  it('uses pending sentAt branch with self-transfer amounts', () => {
    const tx = {
      sentAt: Date.now(),
      from: 'bc1qaaa',
      to: 'bc1qaaa',
      amount: 50_000,
    };
    const r = getMempoolTransactionAmounts(tx, alwaysOurs);
    expect(r.sent).toBe(50_000 / 1e8);
    expect(r.changeAmount).toBe(0);
    expect(r.received).toBe(0);
  });

  it('computes sent/received from vin/vout for confirmed tx', () => {
    const ourAddr = 'bc1qours';
    const tx = {
      vin: [
        {
          prevout: {
            scriptpubkey_address: ourAddr,
            value: 1_000_000,
          },
        },
      ],
      vout: [
        {scriptpubkey_address: 'bc1other', value: 100_000},
        {scriptpubkey_address: ourAddr, value: 850_000},
      ],
      fee: 50_000,
    };
    const isOur = (a: string) => a === ourAddr;
    const r = getMempoolTransactionAmounts(tx, isOur);
    // sentAmount 1e6, change 850k, fee 50k -> finalSent = 1e6 - 850k - 50k = 100k
    expect(r.sent).toBe(100_000 / 1e8);
    expect(r.changeAmount).toBe(850_000 / 1e8);
    expect(r.received).toBe(850_000 / 1e8);
  });

  it('respects explicit address list over isOurAddress', () => {
    const addr = 'bc1explicit';
    const tx = {
      vin: [
        {prevout: {scriptpubkey_address: addr, value: 500_000}},
      ],
      vout: [{scriptpubkey_address: 'bc1x', value: 500_000}],
      fee: 0,
    };
    const neverOurs = () => false;
    const r = getMempoolTransactionAmounts(tx, neverOurs, [addr]);
    expect(r.sent).toBeGreaterThan(0);
  });
});
