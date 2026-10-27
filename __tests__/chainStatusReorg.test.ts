/**
 * B3 — applyChainStatus reorg round-trip (test-only, no prod code).
 *
 * confirmed (block 100) → unconfirmed (reorg) → confirmed again (block 101).
 * The raw_json status payload must track the columns at every step.
 */

jest.mock('../utils', () => ({dbg: jest.fn()}));

type TxFake = {
  txid: string;
  network: string;
  block_height: number | null;
  block_hash: string | null;
  block_time: number | null;
  is_confirmed: number;
  raw_json: string;
};

const mockTxRows = new Map<string, TxFake>();

function txKey(txid: string, network: string): string {
  return `${txid}|${network}`;
}

jest.mock('../services/Database', () => {
  const executeImpl = (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      const p = params as Array<string | number | null>;

      if (q.startsWith('insert into transactions')) {
        const key = `${String(p[0])}|${String(p[1])}`;
        mockTxRows.set(key, {
          txid: String(p[0]),
          network: String(p[1]),
          block_height: (p[2] as number) ?? null,
          block_hash: (p[3] as string) ?? null,
          block_time: (p[4] as number) ?? null,
          is_confirmed: Number(p[5]),
          raw_json: String(p[11]),
        });
        return {rows: [], rowsAffected: 1};
      }
      if (q.startsWith('select raw_json from transactions')) {
        const row = mockTxRows.get(`${String(p[0])}|${String(p[1])}`);
        return {rows: row ? [{raw_json: row.raw_json}] : [], rowsAffected: 0};
      }
      if (q.startsWith('update transactions')) {
        // applyChainStatus: [confirmed, blockHeight, blockTime, blockHash,
        // rawJson, fetchedAt, txid, network]
        const row = mockTxRows.get(`${String(p[6])}|${String(p[7])}`);
        if (row) {
          row.is_confirmed = Number(p[0]);
          row.block_height = (p[1] as number) ?? null;
          row.block_time = (p[2] as number) ?? null;
          row.block_hash = (p[3] as string) ?? null;
          row.raw_json = String(p[4]);
        }
        return {rows: [], rowsAffected: row ? 1 : 0};
      }
      return {rows: [], rowsAffected: 0};
    };

  return {
    __esModule: true,
    default: {
      execute: jest.fn(executeImpl),
      transaction: jest.fn((fn: (svc: unknown) => void) =>
        fn({execute: executeImpl}),
      ),
    },
  };
});

import transactionRepository from '../services/repositories/TransactionRepository';

const TXID = 'a'.repeat(64);
const NETWORK = 'mainnet';

function seedConfirmed(): void {
  transactionRepository.upsertTransaction(
    {
      txid: TXID,
      network: NETWORK,
      blockHeight: 100,
      blockHash: 'hash100',
      blockTime: 1_700_000_000,
      isConfirmed: true,
      feeSats: 500,
      size: 200,
      weight: 800,
      version: 2,
      locktime: 0,
      rawJson: JSON.stringify({
        txid: TXID,
        status: {confirmed: true, block_height: 100, block_hash: 'hash100'},
      }),
      fetchedAt: Date.now(),
    },
    [{txid: TXID, network: NETWORK, address: 'recv0', netSats: 1000}],
  );
}

function stored(): TxFake {
  const row = mockTxRows.get(txKey(TXID, NETWORK));
  if (!row) {
    throw new Error('tx row missing');
  }
  return row;
}

describe('applyChainStatus reorg round-trip', () => {
  beforeEach(() => {
    mockTxRows.clear();
  });

  it('confirmed → unconfirmed clears block fields in columns and raw_json', () => {
    seedConfirmed();

    transactionRepository.applyChainStatus(TXID, NETWORK, {
      confirmed: false,
    });

    const row = stored();
    expect(row.is_confirmed).toBe(0);
    expect(row.block_height).toBeNull();
    expect(row.block_hash).toBeNull();
    const status = JSON.parse(row.raw_json).status;
    expect(status.confirmed).toBe(false);
    expect(status.block_height).toBeNull();
  });

  it('unconfirmed → confirmed again restores block fields', () => {
    seedConfirmed();
    transactionRepository.applyChainStatus(TXID, NETWORK, {
      confirmed: false,
    });

    transactionRepository.applyChainStatus(TXID, NETWORK, {
      confirmed: true,
      blockHeight: 101,
      blockTime: 1_700_000_600,
      blockHash: 'hash101',
    });

    const row = stored();
    expect(row.is_confirmed).toBe(1);
    expect(row.block_height).toBe(101);
    expect(row.block_hash).toBe('hash101');
    const status = JSON.parse(row.raw_json).status;
    expect(status.confirmed).toBe(true);
    expect(status.block_height).toBe(101);
  });

  it('is a no-op for an unknown txid', () => {
    expect(() =>
      transactionRepository.applyChainStatus('b'.repeat(64), NETWORK, {
        confirmed: false,
      }),
    ).not.toThrow();
    expect(mockTxRows.size).toBe(0);
  });
});
