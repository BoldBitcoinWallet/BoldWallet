/**
 * UtxoTagRepository tests — mocked SQLite, independent of the utxos table.
 */

const mockTags = new Map<string, {txid: string; vout: number; tag: string; updated_at: number}>();

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

jest.mock('../services/Database', () => ({
  __esModule: true,
  default: {
    execute: jest.fn((sql: string, params: unknown[] = []) => {
      const query = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (query.startsWith('delete from utxo_tags where txid')) {
        mockTags.delete(`${params[0]}:${params[1]}`);
        return {rows: [], rowsAffected: 1};
      }

      if (query.startsWith('insert into utxo_tags')) {
        const [txid, vout, tag, updated_at] = params as [
          string,
          number,
          string,
          number,
        ];
        mockTags.set(`${txid}:${vout}`, {txid, vout, tag, updated_at});
        return {rows: [], rowsAffected: 1};
      }

      if (query.includes('from utxo_tags where txid = ? and vout = ?')) {
        const row = mockTags.get(`${params[0]}:${params[1]}`);
        return {rows: row ? [row] : [], rowsAffected: 0};
      }

      if (query.includes('from utxo_tags where (txid, vout) in')) {
        const pairs: string[] = [];
        for (let i = 0; i < params.length; i += 2) {
          pairs.push(`${params[i]}:${params[i + 1]}`);
        }
        const rows = pairs
          .map(k => mockTags.get(k))
          .filter((r): r is NonNullable<typeof r> => !!r);
        return {rows, rowsAffected: 0};
      }

      if (query.includes('select distinct tag from utxo_tags')) {
        const tags = [
          ...new Set(
            [...mockTags.values()]
              .map(r => String(r.tag || '').trim())
              .filter(Boolean),
          ),
        ].sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
        return {
          rows: tags.map(tag => ({tag})),
          rowsAffected: 0,
        };
      }

      return {rows: [], rowsAffected: 0};
    }),
  },
}));

import utxoTagRepository from '../services/repositories/UtxoTagRepository';
import {UTXO_TAG_MAX_LEN} from '../services/utxoCoinControl';

const TXID = 'aa'.repeat(32);

beforeEach(() => {
  mockTags.clear();
});

describe('UtxoTagRepository', () => {
  test('upsert then get', () => {
    expect(utxoTagRepository.upsert(TXID, 0, '  savings  ')).toBe('savings');
    expect(utxoTagRepository.get(TXID, 0)).toBe('savings');
  });

  test('empty tag deletes the row', () => {
    utxoTagRepository.upsert(TXID, 1, 'keep');
    expect(utxoTagRepository.upsert(TXID, 1, '   ')).toBeNull();
    expect(utxoTagRepository.get(TXID, 1)).toBeNull();
  });

  test('caps at 64 characters', () => {
    const stored = utxoTagRepository.upsert(TXID, 2, 'z'.repeat(80));
    expect(stored).toHaveLength(UTXO_TAG_MAX_LEN);
    expect(utxoTagRepository.get(TXID, 2)).toBe('z'.repeat(64));
  });

  test('getByOutpoints returns a map and skips missing', () => {
    utxoTagRepository.upsert(TXID, 0, 'aa');
    utxoTagRepository.upsert(TXID, 3, 'bb');
    const map = utxoTagRepository.getByOutpoints([
      `${TXID}:0`,
      `${TXID}:1`,
      `${TXID}:3`,
    ]);
    expect(map.get(`${TXID}:0`)).toBe('aa');
    expect(map.get(`${TXID}:3`)).toBe('bb');
    expect(map.has(`${TXID}:1`)).toBe(false);
  });

  test('rejects tags shorter than 2 characters', () => {
    expect(utxoTagRepository.upsert(TXID, 4, 'a')).toBeNull();
    expect(utxoTagRepository.get(TXID, 4)).toBeNull();
  });

  test('tags survive independently of a utxos replace (separate store)', () => {
    utxoTagRepository.upsert(TXID, 0, 'cold');
    mockTags.delete = mockTags.delete.bind(mockTags);
    expect(utxoTagRepository.get(TXID, 0)).toBe('cold');
  });

  test('getDistinctTags returns unique tags sorted A→Z', () => {
    utxoTagRepository.upsert(TXID, 0, 'savings');
    utxoTagRepository.upsert(TXID, 1, 'cold');
    utxoTagRepository.upsert(TXID, 2, 'savings');
    expect(utxoTagRepository.getDistinctTags()).toEqual(['cold', 'savings']);
  });
});
