/**
 * B2 — pinned receive addresses (nullable pinned_at on wallet_addresses).
 *
 * Real Database + WalletRepository + WalletService run against an in-memory
 * op-sqlite fake; network/native are mocked. Scenarios:
 *  1. pinned skipped address is included in getActiveAddressesWithPaths
 *  2. unpinned skipped address is excluded
 *  3. pinAddress is idempotent (first timestamp wins)
 *  4. pin survives clearWalletCacheData, dies on clearWalletData
 *  5. unpin lifecycle: is_used flip clears pin; address stays active via used
 *  6. mempool-style is_used flip also clears pin
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

jest.mock('../services/MempoolClient', () => ({
  __esModule: true,
  default: {
    syncPoolConcurrency: jest.fn(() => 1),
    get: jest.fn(async () => ({ok: true, status: 200, data: []})),
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

// ── In-memory op-sqlite fake (real Database.ts runs on top of it) ───────────
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
const mockHdRows = new Map<string, {change_index: number}>();
const mockTxRefs = new Set<string>();
const mockUtxoRefs = new Set<string>();
const mockUtxoRows: Array<Record<string, unknown>> = [];

const mockIndexes = {external: 5, maxUsed: 3, change: 2};

jest.mock('../services/HdIndexService', () => ({
  getExternalIndex: jest.fn(async () => mockIndexes.external),
  getMaxUsedExternal: jest.fn(async () => mockIndexes.maxUsed),
  getChangeIndex: jest.fn(async () => mockIndexes.change),
  setExternalIndex: jest.fn(async () => undefined),
  setMaxUsedExternal: jest.fn(async () => undefined),
  setChangeIndex: jest.fn(async () => undefined),
  incrementChangeIndexAfterSend: jest.fn(async () => undefined),
}));

jest.mock('@op-engineering/op-sqlite', () => {
  const waKey = (
    network: string,
    addressType: string,
    chain: number,
    idx: number,
  ) => `${network}|${addressType}|${chain}|${idx}`;
  const findByAddress = (address: string) =>
    [...mockWaRows.values()].filter(r => r.address === address);

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
      if (!mockHdRows.has(key)) {
        mockHdRows.set(key, {change_index: 0});
      }
      return {rows: [], rowsAffected: 0};
    }
    if (q.startsWith('update hd_state set change_index')) {
      const row = mockHdRows.get(`${p[1]}|${p[2]}`);
      if (row) {
        row.change_index = Number(p[0]);
      }
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('select change_index from hd_state')) {
      const row = mockHdRows.get(`${p[0]}|${p[1]}`);
      return {rows: row ? [{change_index: row.change_index}] : [], rowsAffected: 0};
    }
    if (q.includes('max(wa.idx)')) {
      let max = -1;
      for (const wa of mockWaRows.values()) {
        if (wa.network !== p[0] || wa.address_type !== p[1] || wa.chain !== 1) {
          continue;
        }
        const ref =
          mockTxRefs.has(`${wa.address}|${wa.network}`) ||
          mockUtxoRefs.has(`${wa.address}|${wa.network}`);
        if (ref && wa.idx > max) {
          max = wa.idx;
        }
      }
      return {rows: [{m: max}], rowsAffected: 0};
    }
    if (q.startsWith('insert into wallet_addresses')) {
      const [network, addressType, chain, idx, address, isUsed] =
        p as [string, string, number, number, string, number];
      const key = waKey(network, addressType, chain, idx);
      const prev = mockWaRows.get(key);
      const used = Math.max(prev?.is_used ?? 0, Number(isUsed));
      mockWaRows.set(key, {
        network,
        address_type: addressType,
        chain,
        idx,
        address,
        is_used: used,
        pinned_at: Number(isUsed) === 1 ? null : prev?.pinned_at ?? null,
      });
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('update wallet_addresses set pinned_at = ?')) {
      const [pinnedAt, network, addressType, address] = p as [
        number,
        string,
        string,
        string,
      ];
      let changed = 0;
      for (const row of findByAddress(address)) {
        if (row.network === network && row.address_type === addressType) {
          if (row.pinned_at == null) {
            row.pinned_at = pinnedAt;
            changed++;
          }
        }
      }
      return {rows: [], rowsAffected: changed};
    }
    if (q.startsWith('update wallet_addresses set pinned_at = null')) {
      const [, network, addressType, address] = p;
      for (const row of findByAddress(String(address))) {
        if (row.network === network && row.address_type === addressType) {
          row.pinned_at = null;
        }
      }
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('update wallet_addresses set is_used = 1')) {
      for (const row of findByAddress(String(p[0]))) {
        row.is_used = 1;
        if (q.includes('pinned_at = null')) {
          row.pinned_at = null;
        }
      }
      return {rows: [], rowsAffected: 1};
    }
    if (q.startsWith('select * from wallet_addresses') && q.includes('idx = ?')) {
      const rows = [...mockWaRows.values()].filter(
        r =>
          r.network === p[0] &&
          r.address_type === p[1] &&
          r.chain === p[2] &&
          r.idx === p[3],
      );
      return {rows, rowsAffected: 0};
    }
    if (
      q.startsWith('select address from wallet_addresses') &&
      q.includes('pinned_at')
    ) {
      const rows = [...mockWaRows.values()]
        .filter(
          r =>
            r.network === p[0] && r.address_type === p[1] && r.pinned_at != null,
        )
        .map(r => ({address: r.address}));
      return {rows, rowsAffected: 0};
    }
    if (q.startsWith('select * from wallet_addresses where network = ? and address_type = ? and chain = ?')) {
      const rows = [...mockWaRows.values()].filter(
        r => r.network === p[0] && r.address_type === p[1] && r.chain === p[2],
      );
      return {rows, rowsAffected: 0};
    }
    if (q.startsWith('delete from wallet_addresses')) {
      mockWaRows.clear();
      return {rows: [], rowsAffected: 0};
    }
    if (q.startsWith('delete from utxos')) {
      mockUtxoRows.length = 0;
      mockUtxoRefs.clear();
      return {rows: [], rowsAffected: 0};
    }
    if (q.startsWith('delete from')) {
      return {rows: [], rowsAffected: 0};
    }
    if (q.includes('from utxos')) {
      const rows = mockUtxoRows.filter(r => {
        if (q.includes('address in')) {
          return p.slice(0, -1).includes(r.address as string);
        }
        return true;
      });
      return {rows, rowsAffected: 0};
    }
    if (q.includes('pending_transactions') || q.includes('is_confirmed = 0')) {
      return {rows: [], rowsAffected: 0};
    }
    if (q.includes('from app_config')) {
      return {rows: [], rowsAffected: 0};
    }
    return {rows: [], rowsAffected: 0};
  }

  return {
    open: jest.fn(() => ({executeSync, close: jest.fn()})),
  };
});

import database from '../services/Database';
import walletRepository from '../services/repositories/WalletRepository';
import {WalletService} from '../services/WalletService';

const NETWORK = 'mainnet';
const TYPE = 'segwit-native';
/** Receive idx beyond used frontier (maxUsed=3) + probe 2 → active only if pinned/used. */
const SKIPPED = 'recv8';

function seedHdAddresses(): void {
  // Stored rows 0..12 receive / 0..10 change; higher ones derive via bridge.
  for (let i = 0; i <= 12; i++) {
    walletRepository.upsertAddress({
      network: NETWORK,
      addressType: TYPE,
      chain: 0,
      idx: i,
      address: `recv${i}`,
      isUsed: i <= 3,
    });
  }
  for (let i = 0; i <= 10; i++) {
    walletRepository.upsertAddress({
      network: NETWORK,
      addressType: TYPE,
      chain: 1,
      idx: i,
      address: `chg${i}`,
      isUsed: false,
    });
  }
}

async function activeAddresses(): Promise<string[]> {
  const list = await WalletService.getInstance().getActiveAddressesWithPaths(
    NETWORK,
    TYPE,
  );
  return list.map(a => a.address);
}

describe('B2 pinned addresses', () => {
  beforeAll(async () => {
    await database.open();
  });

  beforeEach(() => {
    mockWaRows.clear();
    mockTxRefs.clear();
    mockUtxoRefs.clear();
    mockUtxoRows.length = 0;
    mockIndexes.external = 5;
    mockIndexes.maxUsed = 3;
    mockIndexes.change = 2;
    seedHdAddresses();
  });

  it('includes a pinned skipped address in the active set', async () => {
    walletRepository.pinAddress(NETWORK, TYPE, SKIPPED);

    expect((await activeAddresses()).filter(a => a === SKIPPED)).toHaveLength(1);
  });

  it('pinned active entries keep their derivation path (signable)', async () => {
    walletRepository.pinAddress(NETWORK, TYPE, SKIPPED);

    const entry = (
      await WalletService.getInstance().getActiveAddressesWithPaths(NETWORK, TYPE)
    ).find(a => a.address === SKIPPED);

    expect(entry?.derivationPath).toBe(`m/84'/0'/0'/0/8`);
  });

  it('pinAddress is a no-op for an address not yet derived', () => {
    expect(() =>
      walletRepository.pinAddress(NETWORK, TYPE, 'never-derived'),
    ).not.toThrow();
    expect(walletRepository.getPinnedAddresses(NETWORK, TYPE)).toEqual([]);
  });

  it('excludes the same skipped address when unpinned', async () => {
    expect(await activeAddresses()).not.toContain(SKIPPED);
  });

  it('pinAddress is idempotent: first timestamp wins', () => {
    walletRepository.pinAddress(NETWORK, TYPE, SKIPPED);

    const row = walletRepository.getAddressAt(NETWORK, TYPE, 0, 8);
    const first = row?.pinnedAt;
    expect(first).not.toBeNull();

    // Backdate guard: a second pin must not move pinned_at forward.
    walletRepository.pinAddress(NETWORK, TYPE, SKIPPED);
    const second = walletRepository.getAddressAt(NETWORK, TYPE, 0, 8)?.pinnedAt;
    expect(second).toBe(first);
    expect(walletRepository.getPinnedAddresses(NETWORK, TYPE)).toEqual([SKIPPED]);
  });

  it('pin survives clearWalletCacheData but dies on clearWalletData', () => {
    walletRepository.pinAddress(NETWORK, TYPE, SKIPPED);

    database.clearWalletCacheData();
    expect(walletRepository.getPinnedAddresses(NETWORK, TYPE)).toEqual([SKIPPED]);

    database.clearWalletData();
    expect(walletRepository.getPinnedAddresses(NETWORK, TYPE)).toEqual([]);
    expect(walletRepository.getAddressAt(NETWORK, TYPE, 0, 8)).toBeNull();
  });

  it('unpins on the is_used flip and the address stays active via the used path', async () => {
    walletRepository.pinAddress(NETWORK, TYPE, SKIPPED);
    expect(await activeAddresses()).toContain(SKIPPED);

    walletRepository.upsertAddressBatch([
      {
        network: NETWORK,
        addressType: TYPE,
        chain: 0,
        idx: 8,
        address: SKIPPED,
        isUsed: true,
      },
    ]);

    expect(walletRepository.getPinnedAddresses(NETWORK, TYPE)).toEqual([]);
    expect(walletRepository.getAddressAt(NETWORK, TYPE, 0, 8)?.pinnedAt).toBeNull();
    expect(await activeAddresses()).toContain(SKIPPED);
  });

  it('clears the pin on the mempool-style is_used flip (discovery detection)', () => {
    walletRepository.pinAddress(NETWORK, TYPE, SKIPPED);

    // Discovery's isAddressUsed is true on mempool appearance; the batch
    // upsert is where is_used flips, so the pin must clear there too.
    walletRepository.upsertAddress({
      network: NETWORK,
      addressType: TYPE,
      chain: 0,
      idx: 8,
      address: SKIPPED,
      isUsed: true,
    });

    expect(walletRepository.getPinnedAddresses(NETWORK, TYPE)).toEqual([]);
    expect(walletRepository.getAddressAt(NETWORK, TYPE, 0, 8)?.isUsed).toBe(true);
    expect(walletRepository.getAddressAt(NETWORK, TYPE, 0, 8)?.pinnedAt).toBeNull();
  });
});
