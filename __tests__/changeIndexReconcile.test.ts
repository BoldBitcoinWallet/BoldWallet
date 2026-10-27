/**
 * Change-index restart reconciliation tests — mocked SQLite.
 *
 * Scenario under test: a send was broadcast (transaction_addresses / utxos
 * reference the change address at idx N) but the process died before
 * incrementChangeIndexAfterSend ran. On next launch, reconcile must
 * advance change_index past N exactly once so the next send never
 * reuses that change address.
 */

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

type HdRow = {change_index: number};
type WaRow = {
  network: string;
  addressType: string;
  chain: number;
  idx: number;
  address: string;
};

const mockHdState = new Map<string, HdRow>();
const mockWalletAddresses: WaRow[] = [];
const mockTxRefs = new Set<string>();
const mockUtxoRefs = new Set<string>();

function hdKey(network: string, addressType: string): string {
  return `${network}|${addressType}`;
}

function refKey(address: string, network: string): string {
  return `${address}|${network}`;
}

jest.mock('../services/Database', () => ({
  __esModule: true,
  default: {
    execute: jest.fn((sql: string, params: unknown[] = []) => {
      const query = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      const [p0, p1, p2] = params as Array<string>;

      if (query.startsWith('insert or ignore into hd_state')) {
        const key = `${String(p0)}|${String(p1)}`;
        if (!mockHdState.has(key)) {
          mockHdState.set(key, {change_index: 0});
        }
        return {rows: [], rowsAffected: 0};
      }
      if (query.startsWith('update hd_state set change_index')) {
        const row = mockHdState.get(`${String(p1)}|${String(p2)}`);
        if (row) {
          row.change_index = Number(params[0]);
        }
        return {rows: [], rowsAffected: 1};
      }
      if (query.startsWith('select change_index from hd_state')) {
        const row = mockHdState.get(`${String(p0)}|${String(p1)}`);
        return {rows: row ? [{change_index: row.change_index}] : [], rowsAffected: 0};
      }
      if (query.includes('max(wa.idx)')) {
        const network = p0;
        const addressType = p1;
        let max = -1;
        for (const wa of mockWalletAddresses) {
          if (wa.network !== network || wa.addressType !== addressType) {
            continue;
          }
          if (wa.chain !== 1) {
            continue;
          }
          const referenced =
            mockTxRefs.has(`${wa.address}|${wa.network}`) ||
            mockUtxoRefs.has(`${wa.address}|${wa.network}`);
          if (referenced && wa.idx > max) {
            max = wa.idx;
          }
        }
        return {rows: [{m: max}], rowsAffected: 0};
      }
      return {rows: [], rowsAffected: 0};
    }),
    transaction: jest.fn((fn: (svc: unknown) => void) => {
      fn(undefined);
    }),
  },
}));

import walletRepository from '../services/repositories/WalletRepository';

const NETWORK = 'mainnet';
const TYPE = 'segwit-native';

function seedChangeIndex(value: number): void {
  mockHdState.set(hdKey(NETWORK, TYPE), {change_index: value});
}

function seedAddress(chain: number, idx: number, address: string): void {
  mockWalletAddresses.push({network: NETWORK, addressType: TYPE, chain, idx, address});
}

describe('change-index restart reconciliation', () => {
  beforeEach(() => {
    mockHdState.clear();
    mockWalletAddresses.length = 0;
    mockTxRefs.clear();
    mockUtxoRefs.clear();
  });

  it('bumps N→N+1 when a broadcast tx links reference change idx N', () => {
    seedChangeIndex(3);
    seedAddress(1, 3, 'chg3');
    mockTxRefs.add(refKey('chg3', NETWORK));

    const result = walletRepository.reconcileChangeIndex(NETWORK, TYPE);

    expect(result).toEqual({bumped: true, from: 3, to: 4});
    expect(walletRepository.getChangeIndex(NETWORK, TYPE)).toBe(4);
  });

  it('uses a UTXO-only reference to the change address', () => {
    seedChangeIndex(1);
    seedAddress(1, 1, 'chg1');
    mockUtxoRefs.add(refKey('chg1', NETWORK));

    const result = walletRepository.reconcileChangeIndex(NETWORK, TYPE);

    expect(result).toEqual({bumped: true, from: 1, to: 2});
    expect(walletRepository.getChangeIndex(NETWORK, TYPE)).toBe(2);
  });

  it('is a no-op when change_index is already past all references', () => {
    seedChangeIndex(7);
    seedAddress(1, 3, 'chg3');
    mockTxRefs.add(refKey('chg3', NETWORK));

    const result = walletRepository.reconcileChangeIndex(NETWORK, TYPE);

    expect(result).toEqual({bumped: false, from: 7, to: 7});
    expect(walletRepository.getChangeIndex(NETWORK, TYPE)).toBe(7);
  });

  it('is idempotent: a rerun after a bump does not advance again', () => {
    seedChangeIndex(3);
    seedAddress(1, 3, 'chg3');
    mockTxRefs.add(refKey('chg3', NETWORK));

    walletRepository.reconcileChangeIndex(NETWORK, TYPE);
    const second = walletRepository.reconcileChangeIndex(NETWORK, TYPE);

    expect(second).toEqual({bumped: false, from: 4, to: 4});
    expect(walletRepository.getChangeIndex(NETWORK, TYPE)).toBe(4);
  });

  it('ignores references to external-chain (chain 0) addresses', () => {
    seedChangeIndex(0);
    seedAddress(0, 0, 'recv0');
    mockTxRefs.add(refKey('recv0', NETWORK));
    mockUtxoRefs.add(refKey('recv0', NETWORK));

    const result = walletRepository.reconcileChangeIndex(NETWORK, TYPE);

    expect(result).toEqual({bumped: false, from: 0, to: 0});
    expect(walletRepository.getChangeIndex(NETWORK, TYPE)).toBe(0);
  });

  it('ignores references under a different network', () => {
    seedChangeIndex(0);
    seedAddress(1, 0, 'chg0');
    mockTxRefs.add(refKey('chg0', 'testnet4'));

    const result = walletRepository.reconcileChangeIndex(NETWORK, TYPE);

    expect(result).toEqual({bumped: false, from: 0, to: 0});
    expect(walletRepository.getChangeIndex(NETWORK, TYPE)).toBe(0);
  });

  it('is a no-op when nothing references any change address', () => {
    seedChangeIndex(2);
    seedAddress(1, 2, 'chg2');

    const result = walletRepository.reconcileChangeIndex(NETWORK, TYPE);

    expect(result).toEqual({bumped: false, from: 2, to: 2});
    expect(walletRepository.getChangeIndex(NETWORK, TYPE)).toBe(2);
  });
});
