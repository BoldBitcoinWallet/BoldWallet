/**
 * B3 — syncAddressesAtomic rollback, against the real transaction tables
 * (test-only, no prod code).
 *
 * Real TransactionSyncer + TransactionRepository + Database run over an
 * in-memory op-sqlite engine; only the network client is stubbed. After an
 * injected per-address failure the transactions table must hold zero rows —
 * asserted by querying the table itself, not by spying on the batch writer.
 * A fully successful batch is the contrast case (rows land, cursor advances).
 *
 * Note: discovery-style retry timing is not involved here; (flag: timer-mock
 * if CI flakes).
 */

jest.mock('../utils', () => ({dbg: jest.fn()}));

jest.mock('../services/repositories/SyncRepository', () => ({
  __esModule: true,
  default: {
    isFresh: jest.fn(() => false),
    getCursor: jest.fn(() => null),
    updateCursor: jest.fn(),
  },
}));

jest.mock('../services/HdOptionsConfig', () => ({
  getTransactionDbTtlMs: jest.fn(() => 60_000),
}));

jest.mock('../services/MempoolClient', () => ({
  __esModule: true,
  default: {
    syncPoolConcurrency: jest.fn(() => 1),
    get: jest.fn(async (url: string) => {
      if (url.includes('badaddr')) {
        return {ok: false, status: 500, data: null};
      }
      return {
        ok: true,
        status: 200,
        data: [
          {
            txid: 'a'.repeat(64),
            status: {confirmed: true, block_height: 100, block_hash: 'h', block_time: 1},
            fee: 10,
            vin: [{prevout: {scriptpubkey_address: 'recv0', value: 2000}}],
            vout: [{scriptpubkey_address: 'recv0', value: 1900}],
          },
        ],
      };
    }),
    invalidateExact: jest.fn(),
    evictInflight: jest.fn(),
  },
}));

// ── In-memory op-sqlite engine (real Database.ts runs on top of it) ─────────
const mockTxTable = new Map<string, Record<string, unknown>>();
const mockLinkTable = new Set<string>();

jest.mock('@op-engineering/op-sqlite', () => {
  function executeSync(sql: string, params: unknown[] = []) {
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const p = params as Array<string | number | null>;

    if (
      q.startsWith('pragma') ||
      q.startsWith('create') ||
      q.startsWith('alter') ||
      q.startsWith('drop') ||
      q === 'begin' ||
      q === 'commit' ||
      q === 'rollback'
    ) {
      return {rows: [], rowsAffected: 0};
    }
    if (q.startsWith('insert into transactions')) {
      mockTxTable.set(`${String(p[0])}|${String(p[1])}`, {
        txid: p[0],
        network: p[1],
        block_height: p[2],
        block_hash: p[3],
        block_time: p[4],
        is_confirmed: p[5],
      });
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('insert into transaction_addresses')) {
      mockLinkTable.add(`${String(p[0])}|${String(p[1])}|${String(p[2])}`);
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('select txid from transactions')) {
      const rows = [...mockTxTable.values()]
        .filter(r => r.network === p[0])
        .map(r => ({txid: r.txid}));
      return {rows, rowsAffected: 0};
    }
    return {rows: [], rowsAffected: 0};
  }

  return {open: jest.fn(() => ({executeSync, close: jest.fn()}))};
});

import database from '../services/Database';
import transactionRepository from '../services/repositories/TransactionRepository';
import transactionSyncer from '../services/sync/TransactionSyncer';

const API = 'https://mempool.space/api';

describe('syncAddressesAtomic rollback (real tables)', () => {
  beforeAll(async () => {
    await database.open();
  });

  beforeEach(() => {
    mockTxTable.clear();
    mockLinkTable.clear();
  });

  it('leaves zero rows in transactions after an injected per-address failure', async () => {
    await expect(
      transactionSyncer.syncAddressesAtomic(
        [
          {address: 'recv0', network: 'mainnet'},
          {address: 'badaddr', network: 'mainnet'},
        ],
        API,
      ),
    ).rejects.toThrow();

    expect(transactionRepository.getKnownTxids('mainnet').size).toBe(0);
    expect(mockLinkTable.size).toBe(0);
  });

  it('writes rows when every address succeeds (contrast)', async () => {
    await transactionSyncer.syncAddressesAtomic(
      [{address: 'recv0', network: 'mainnet'}],
      API,
    );

    expect(transactionRepository.getKnownTxids('mainnet').size).toBe(1);
    expect(mockLinkTable.size).toBe(1);
  });
});
