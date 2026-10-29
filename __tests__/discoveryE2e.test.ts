/**
 * B3 — regression protection for discovery + pagination (no prod code).
 *
 * Covers:
 *  - discoverHdIndexesForNetwork E2E with stubbed /txs (happy path commits
 *    external/maxUsed/change and marks restore done)
 *  - partial-discovery commit (v4.1.0 behavior, protected here): external
 *    indexes still ratchet forward, change index untouched, restoreDone false
 *  - fetchMoreTransactionsForAddresses cursor exhaustion (short page → null)
 *
 * Note: the partial-discovery case exercises the real waitMS(1500) retry, so
 * it takes ~1.5 s by design — do not shorten it. (Flag: timer-mock if CI flakes.)
 */

jest.mock('../utils', () => ({
  dbg: jest.fn(),
  getKeyshareMetadata: jest.fn(async () => ({pub_key: 'pk'})),
  hasWalletKeyshareInSecureStorage: jest.fn(async () => true),
  resolveUseLegacyDerivationPaths: jest.fn(() => false),
  getReceivePath: jest.fn(
    (_n: string, _t: string, _legacy: boolean, i: number) =>
      `m/84'/0'/0'/0/${i}`,
  ),
  getChangePath: jest.fn(
    (_n: string, _t: string, _legacy: boolean, i: number) =>
      `m/84'/0'/0'/1/${i}`,
  ),
}));

jest.mock('../services/chaincodeReader', () => ({
  resolveChaincodeHex: jest.fn(async () => '00'),
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    derivePubkey: jest.fn(async (_pub: string, _cc: string, path: string) => path),
    btcAddress: jest.fn(async (pub: string) => {
      const parts = pub.split('/');
      const chain = parts[parts.length - 2];
      const idx = parts[parts.length - 1];
      return chain === '0' ? `recv${idx}` : `chg${idx}`;
    }),
  },
}));

jest.mock('../services/apiConfigApply', () => ({
  ensureMempoolApiApplied: jest.fn(async () => undefined),
}));

jest.mock('../services/mempoolProvidersStore', () => ({
  ensureMempoolProvidersSeeded: jest.fn(async () => []),
  isTestnetMempoolApiBase: jest.fn(() => false),
  publicMainnetPriceUrls: jest.fn(async () => []),
}));

jest.mock('../services/mempoolApiBase', () => ({
  normalizeNetworkKey: jest.fn((n: string) => n),
  getStoredNetworkKey: jest.fn(() => 'mainnet'),
  isTestnetNetworkKey: jest.fn(() => false),
  resolveStoredMempoolApiBase: jest.fn(() => 'https://mempool.space/api'),
  mainnetPricesUrl: jest.fn(() => 'https://mempool.space/api/v1/prices'),
  fiatRatesFromPrices: jest.fn(() => ({})),
  PRICE_FRESH_MS: 120_000,
}));

const mockUsedAddrs = new Set<string>();
const mockFailAddrs = new Set<string>();

jest.mock('../services/MempoolClient', () => ({
  __esModule: true,
  default: {
    syncPoolConcurrency: jest.fn(() => 1),
    get: jest.fn(async (url: string) => {
      const chainMatch = url.match(/\/address\/([^/]+)\/txs\/chain\//);
      if (chainMatch) {
        // fetchMore page: short page (< 25) exhausts the cursor.
        return {
          ok: true,
          status: 200,
          data: Array.from({length: 10}, (_, i) => ({
            txid: `more${i}`,
            status: {confirmed: true, block_height: 100 - i},
          })),
        };
      }
      const m = url.match(/\/address\/([^/]+)\/txs/);
      const addr = m ? decodeURIComponent(m[1]) : '';
      if (mockFailAddrs.has(addr)) {
        return {ok: false, status: 500, data: null};
      }
      return {
        ok: true,
        status: 200,
        data: mockUsedAddrs.has(addr) ? [{txid: 'a'.repeat(64)}] : [],
      };
    }),
    invalidateExact: jest.fn(),
    evictInflight: jest.fn(),
    abortAll: jest.fn(),
    setPublicBases: jest.fn(),
  },
}));

jest.mock('../services/sync/BalanceSyncer', () => ({
  __esModule: true,
  default: {syncAddresses: jest.fn(async () => undefined)},
}));

jest.mock('../services/sync/UtxoSyncer', () => ({
  __esModule: true,
  default: {syncAddresses: jest.fn(async () => undefined)},
}));

jest.mock('../services/HdOptionsConfig', () => ({
  getGapLimit: jest.fn(() => 10),
  getApiTimeoutMs: jest.fn(() => 5000),
  getUtxoEmptyCacheTtlMs: jest.fn(() => 30_000),
}));

jest.mock('../utils/scriptPubKeyFromAddress', () => ({
  scriptPubKeyFromAddress: jest.fn(() => ''),
}));

jest.mock('bitcoin-address-validation', () => ({
  validate: jest.fn(() => true),
}));

const mockHd = {
  external: 0,
  maxUsed: 0,
  change: 0,
};

jest.mock('../services/HdIndexService', () => ({
  getExternalIndex: jest.fn(async () => mockHd.external),
  getMaxUsedExternal: jest.fn(async () => mockHd.maxUsed),
  getChangeIndex: jest.fn(async () => mockHd.change),
  setExternalIndex: jest.fn(async (_n: string, _t: string, v: number) => {
    mockHd.external = v;
  }),
  setMaxUsedExternal: jest.fn(async (_n: string, _t: string, v: number) => {
    mockHd.maxUsed = v;
  }),
  setChangeIndex: jest.fn(async (_n: string, _t: string, v: number) => {
    mockHd.change = v;
  }),
  incrementChangeIndexAfterSend: jest.fn(async () => undefined),
}));

// ── In-memory op-sqlite fake (wallet_addresses + hd_state bookkeeping) ───────
type WaFake = {
  network: string;
  address_type: string;
  chain: number;
  idx: number;
  address: string;
  is_used: number;
  pinned_at: number | null;
};

const mockWaRows = new Map<string, WaFake>();
const mockHdMeta = new Map<string, Record<string, unknown>>();

jest.mock('@op-engineering/op-sqlite', () => {
  function executeSync(sql: string, params: unknown[] = []) {
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const p = params as Array<string | number>;

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
    if (q.startsWith('insert or ignore into hd_state')) {
      const key = `${p[0]}|${p[1]}`;
      if (!mockHdMeta.has(key)) {
        mockHdMeta.set(key, {});
      }
      return {rows: [], rowsAffected: 0};
    }
    if (q.startsWith('update hd_state')) {
      const key = `${p[p.length - 2]}|${p[p.length - 1]}`;
      const row = mockHdMeta.get(key) ?? {};
      mockHdMeta.set(key, row);
      if (q.includes('discovery_status')) {
        row.discovery_status = p[0];
      }
      if (q.includes('restore_done')) {
        row.restore_done = p[0];
      }
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('insert into wallet_addresses')) {
      const [network, addressType, chain, idx, address, isUsed] = p as [
        string,
        string,
        number,
        number,
        string,
        number,
      ];
      const key = `${network}|${addressType}|${chain}|${idx}`;
      const prev = mockWaRows.get(key);
      mockWaRows.set(key, {
        network,
        address_type: addressType,
        chain,
        idx,
        address,
        is_used: Math.max(prev?.is_used ?? 0, Number(isUsed)),
        pinned_at: prev?.pinned_at ?? null,
      });
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('select * from wallet_addresses')) {
      const rows = [...mockWaRows.values()].filter(
        r => r.network === p[0] && r.address_type === p[1] && r.chain === p[2],
      );
      return {rows, rowsAffected: 0};
    }
    return {rows: [], rowsAffected: 0};
  }

  return {open: jest.fn(() => ({executeSync, close: jest.fn()}))};
});

import database from '../services/Database';
import {WalletService} from '../services/WalletService';

const NETWORK = 'mainnet';
const TYPE = 'segwit-native';
const API = 'https://mempool.space/api';

describe('discoverHdIndexesForNetwork (stubbed /txs)', () => {
  beforeAll(async () => {
    await database.open();
  });

  beforeEach(() => {
    mockWaRows.clear();
    mockHdMeta.clear();
    mockUsedAddrs.clear();
    mockFailAddrs.clear();
    mockHd.external = 0;
    mockHd.maxUsed = 0;
    mockHd.change = 0;
  });

  it('commits indexes on a clean scan: used recv0-1, chg0', async () => {
    mockUsedAddrs.add('recv0');
    mockUsedAddrs.add('recv1');
    mockUsedAddrs.add('chg0');

    await WalletService.getInstance().discoverHdIndexesForNetwork(
      NETWORK,
      TYPE,
      API,
    );

    expect(mockHd.maxUsed).toBe(1);
    expect(mockHd.external).toBe(2); // next receive = maxUsed + 1
    expect(mockHd.change).toBe(1); // next change = maxUsedChange + 1
    const meta = mockHdMeta.get(`${NETWORK}|${TYPE}`);
    expect(meta?.discovery_status).toBe('ok');
    expect(meta?.restore_done).toBe(1);
  });

  it('partial discovery still commits external indexes, change untouched (v4.1.0 behavior)', async () => {
    mockUsedAddrs.add('recv0');
    mockUsedAddrs.add('recv1');
    mockFailAddrs.add('recv2'); // fails, retries, fails → partial

    await WalletService.getInstance().discoverHdIndexesForNetwork(
      NETWORK,
      TYPE,
      API,
    );

    // Partial results are kept (this predates HEAD — protected so a future
    // refactor cannot silently restore the old discard-everything behavior).
    expect(mockHd.maxUsed).toBe(1);
    expect(mockHd.external).toBe(2);
    // Change chain only advances on a fully ok scan.
    expect(mockHd.change).toBe(0);
    const meta = mockHdMeta.get(`${NETWORK}|${TYPE}`);
    expect(meta?.discovery_status).toBe('partial');
    expect(meta?.restore_done).not.toBe(1);
  }, 30_000);

  it('fetchMore exhausts the cursor on a short page', async () => {
    const result = await WalletService.getInstance()
      .fetchMoreTransactionsForAddresses(API, {recv0: 'cursorTxid'});

    expect(result.txs).toHaveLength(10);
    expect(result.cursors.recv0).toBeNull();
  });
});
