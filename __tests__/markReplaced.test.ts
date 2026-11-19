type Row = {
  txid: string;
  network: string;
  is_confirmed: number;
  fee_sats: number | null;
  replaced_by_txid: string | null;
  raw_json: string;
};

const mockTxs: Row[] = [];

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function mockExecute(sql: string, params: unknown[] = []) {
  const q = norm(sql);
  if (q.startsWith('select txid, is_confirmed')) {
    const network = String(params[0]);
    return {
      rows: mockTxs.filter(item => item.network === network),
    };
  }
  if (q.includes('select txid, raw_json')) {
    const network = String(params[0]);
    return {
      rows: mockTxs.filter(
        item =>
          item.network === network &&
          item.is_confirmed === 0 &&
          !item.replaced_by_txid,
      ),
    };
  }
  if (q.includes('set replaced_by_txid = ?')) {
    const [winner, loser, network] = params.map(String);
    const stored = mockTxs.find(
      item =>
        item.txid === loser &&
        item.network === network &&
        item.is_confirmed === 0,
    );
    if (stored) {
      stored.replaced_by_txid = winner;
    }
    return {rows: []};
  }
  if (q.includes('set replaced_by_txid = null')) {
    const [txid, network] = params.map(String);
    const stored = mockTxs.find(
      item => item.txid === txid && item.network === network && item.is_confirmed === 1,
    );
    if (stored) {
      stored.replaced_by_txid = null;
    }
    return {rows: []};
  }
  return {rows: []};
}

jest.mock('../utils', () => ({dbg: jest.fn()}));
jest.mock('../services/Database', () => ({
  __esModule: true,
  default: {
    execute: mockExecute,
    transaction: (fn: (svc: {execute: typeof mockExecute}) => void) => {
      fn({execute: mockExecute});
    },
  },
}));

import transactionRepository from '../services/repositories/TransactionRepository';

function txRow(partial: Partial<Row> & {txid: string; raw_json: string}): Row {
  return {
    network: 'testnet4',
    is_confirmed: 0,
    fee_sats: null,
    replaced_by_txid: null,
    ...partial,
  };
}

describe('markReplaced', () => {
  beforeEach(() => {
    mockTxs.length = 0;
  });

  it('points the stuck tx at its replacement and hides an unconfirmed child', () => {
    mockTxs.push(
      txRow({
        txid: 'old',
        raw_json: JSON.stringify({vin: [{txid: 'aa', vout: 0}]}),
      }),
      txRow({
        txid: 'child',
        raw_json: JSON.stringify({vin: [{txid: 'old', vout: 0}]}),
      }),
    );
    transactionRepository.markReplaced('old', 'new', 'testnet4');
    expect(mockTxs.find(item => item.txid === 'old')?.replaced_by_txid).toBe('new');
    expect(mockTxs.find(item => item.txid === 'child')?.replaced_by_txid).toBe('new');
  });

  it('keeps the higher-fee replacement when a lagging host still returns the original', () => {
    mockTxs.push(
      txRow({
        txid: 'old',
        fee_sats: 1000,
        replaced_by_txid: 'new',
        raw_json: JSON.stringify({
          fee: 1000,
          vin: [{txid: 'aa', vout: 0}],
        }),
      }),
      txRow({
        txid: 'new',
        fee_sats: 3000,
        raw_json: JSON.stringify({
          fee: 3000,
          vin: [{txid: 'aa', vout: 0}],
        }),
      }),
    );
    transactionRepository.noteReplacementConflicts('testnet4', [
      {txid: 'old', fee: 1000, status: {confirmed: false}, vin: [{txid: 'aa', vout: 0}]},
    ]);
    expect(mockTxs.find(item => item.txid === 'new')?.replaced_by_txid).toBeNull();
    expect(mockTxs.find(item => item.txid === 'old')?.replaced_by_txid).toBe('new');
  });

  it('restores a confirmed original and hides the unconfirmed replacement', () => {
    mockTxs.push(
      txRow({
        txid: 'old',
        is_confirmed: 1,
        fee_sats: 1000,
        replaced_by_txid: 'new',
        raw_json: JSON.stringify({
          fee: 1000,
          vin: [{txid: 'aa', vout: 0}],
        }),
      }),
      txRow({
        txid: 'new',
        fee_sats: 3000,
        raw_json: JSON.stringify({
          fee: 3000,
          vin: [{txid: 'aa', vout: 0}],
        }),
      }),
    );
    transactionRepository.noteReplacementConflicts('testnet4', [
      {
        txid: 'old',
        fee: 1000,
        status: {confirmed: true},
        vin: [{txid: 'aa', vout: 0}],
      },
    ]);
    expect(mockTxs.find(item => item.txid === 'old')?.replaced_by_txid).toBeNull();
    expect(mockTxs.find(item => item.txid === 'new')?.replaced_by_txid).toBe('old');
  });

  it('hides the replacement when the original is already confirmed', () => {
    mockTxs.push(
      txRow({
        txid: 'old',
        is_confirmed: 1,
        fee_sats: 1000,
        raw_json: JSON.stringify({fee: 1000, vin: [{txid: 'aa', vout: 0}]}),
      }),
      txRow({
        txid: 'new',
        fee_sats: 3000,
        raw_json: JSON.stringify({fee: 3000, vin: [{txid: 'aa', vout: 0}]}),
      }),
    );
    transactionRepository.noteReplacementConflicts('testnet4', [
      {txid: 'new', fee: 3000, vin: [{txid: 'aa', vout: 0}]},
    ]);
    expect(mockTxs.find(item => item.txid === 'old')?.replaced_by_txid).toBeNull();
    expect(mockTxs.find(item => item.txid === 'new')?.replaced_by_txid).toBe('old');
  });

  it('lets the higher unconfirmed fee win when neither row is marked yet', () => {
    mockTxs.push(
      txRow({
        txid: 'old',
        fee_sats: 1000,
        raw_json: JSON.stringify({fee: 1000, vin: [{txid: 'aa', vout: 0}]}),
      }),
    );
    transactionRepository.noteReplacementConflicts('testnet4', [
      {txid: 'new', fee: 3000, vin: [{txid: 'aa', vout: 0}]},
    ]);
    expect(mockTxs.find(item => item.txid === 'old')?.replaced_by_txid).toBe('new');
  });
});
