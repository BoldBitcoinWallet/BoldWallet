/**
 * MerchantLabelRepository tests
 */

// Mock the database module
const mockStore = {
  merchantLabels: new Map<string, Record<string, unknown>>(),
  verifiedTxs: new Map<string, {network: string; address?: string; created_at: number}>(),
  transactionBackfillRows: [] as Array<Record<string, unknown>>,
};

jest.mock('../services/Database', () => ({
  __esModule: true,
  default: {
    execute: jest.fn((sql: string, params: unknown[] = []) => {
      const query = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (query.startsWith('delete from merchant_labels')) {
        mockStore.merchantLabels.clear();
        return {rows: [], rowsAffected: 1};
      }
      if (query.startsWith('delete from branta_verified_txs')) {
        mockStore.verifiedTxs.clear();
        return {rows: [], rowsAffected: 1};
      }
      if (query.startsWith('delete from merchant_labels where')) {
        mockStore.merchantLabels.delete(params[0] as string);
        return {rows: [], rowsAffected: 1};
      }

      if (query.includes('insert into merchant_labels')) {
        const [
          address,
          platform,
          description,
          logo_url,
          logo_light_url,
          verify_url,
          fetched_at,
        ] = params as [
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          number,
        ];
        mockStore.merchantLabels.set(address, {
          address,
          platform,
          description,
          logo_url,
          logo_light_url,
          verify_url,
          fetched_at,
        });
        return {rows: [], rowsAffected: 1};
      }

      if (
        query.includes('from merchant_labels') &&
        query.includes('lower(address) = ?')
      ) {
        const key = String(params[0]).toLowerCase();
        const row = [...mockStore.merchantLabels.values()].find(
          r => String(r.address).toLowerCase() === key,
        );
        return {rows: row ? [row] : [], rowsAffected: 0};
      }

      if (query.includes('from merchant_labels') && query.includes(' in (')) {
        const keys = new Set(
          (params as string[]).map(addr => String(addr).toLowerCase()),
        );
        const rows = [...mockStore.merchantLabels.values()].filter(r =>
          keys.has(String(r.address).toLowerCase()),
        );
        return {rows, rowsAffected: 0};
      }

      if (query.includes('insert or replace into branta_verified_txs')) {
        const [txid, network, address, created_at] = params as [
          string,
          string,
          string | null,
          number,
        ];
        mockStore.verifiedTxs.set(`${txid}:${network}`, {
          network,
          address: address || undefined,
          created_at,
        });
        return {rows: [], rowsAffected: 1};
      }

      if (
        query.includes('from branta_verified_txs') &&
        query.includes('where txid = ? and network = ?')
      ) {
        const [txid, network] = params as [string, string];
        const row = mockStore.verifiedTxs.get(`${txid}:${network}`);
        if (query.includes('select address')) {
          return {
            rows: row ? [{address: row.address ?? null}] : [],
            rowsAffected: 0,
          };
        }
        return {rows: row ? [{txid}] : [], rowsAffected: 0};
      }

      if (
        query.includes('from branta_verified_txs') &&
        query.includes('where network = ?') &&
        query.includes(' in (')
      ) {
        const [network, ...txids] = params as [string, ...string[]];
        const rows = txids
          .filter(txid => mockStore.verifiedTxs.has(`${txid}:${network}`))
          .map(txid => ({txid}));
        return {rows, rowsAffected: 0};
      }

      if (
        query.includes('from merchant_labels ml') &&
        query.includes('join transaction_addresses')
      ) {
        return {rows: mockStore.transactionBackfillRows, rowsAffected: 0};
      }

      return {rows: [], rowsAffected: 0};
    }),
  },
}));

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

// Import after mocks are set up
import merchantLabelRepository, {
  shouldBackfillBrantaTx,
  BRANTA_BACKFILL_PRE_MS,
  BRANTA_BACKFILL_POST_MS,
  type BrantaBackfillCandidate,
} from '../services/repositories/MerchantLabelRepository';

describe('MerchantLabelRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.merchantLabels.clear();
    mockStore.verifiedTxs.clear();
    mockStore.transactionBackfillRows = [];
    merchantLabelRepository.clearAll();
  });

  afterEach(() => {
    // Clean up after tests
    merchantLabelRepository.clearAll();
  });

  test('should store and retrieve a merchant label by address', () => {
    const testLabel = {
      address: 'bc1qtest123',
      platform: 'Coinbase',
      description: 'Coinbase Exchange',
      logoUrl: 'https://example.com/logo.png',
      logoLightUrl: 'https://example.com/logo-light.png',
      verifyUrl: 'https://branta.pro/verify',
      fetchedAt: Date.now(),
    };

    merchantLabelRepository.upsert(testLabel);
    const retrieved = merchantLabelRepository.getByAddress('bc1qtest123');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.platform).toBe('Coinbase');
    expect(retrieved?.address).toBe('bc1qtest123');
    expect(retrieved?.description).toBe('Coinbase Exchange');
  });

  test('should return null for non-existent address', () => {
    const retrieved = merchantLabelRepository.getByAddress('bc1qnonexistent');
    expect(retrieved).toBeNull();
  });

  test('should update an existing label (upsert)', () => {
    const label1 = {
      address: 'bc1qtest123',
      platform: 'Coinbase',
      description: 'Old description',
      logoUrl: 'https://example.com/old-logo.png',
      logoLightUrl: 'https://example.com/old-logo-light.png',
      verifyUrl: 'https://branta.pro/verify',
      fetchedAt: Date.now(),
    };

    merchantLabelRepository.upsert(label1);

    const label2 = {
      address: 'bc1qtest123',
      platform: 'Coinbase Updated',
      description: 'New description',
      logoUrl: 'https://example.com/new-logo.png',
      logoLightUrl: 'https://example.com/new-logo-light.png',
      verifyUrl: 'https://branta.pro/verify/2',
      fetchedAt: Date.now() + 1000,
    };

    merchantLabelRepository.upsert(label2);
    const retrieved = merchantLabelRepository.getByAddress('bc1qtest123');

    expect(retrieved?.platform).toBe('Coinbase Updated');
    expect(retrieved?.description).toBe('New description');
  });

  test('should retrieve multiple labels by addresses', () => {
    const label1 = {
      address: 'bc1qaddr1',
      platform: 'Exchange A',
      description: 'Desc A',
      logoUrl: 'https://example.com/a.png',
      logoLightUrl: 'https://example.com/a-light.png',
      verifyUrl: 'https://branta.pro/1',
      fetchedAt: Date.now(),
    };

    const label2 = {
      address: 'bc1qaddr2',
      platform: 'Exchange B',
      description: 'Desc B',
      logoUrl: 'https://example.com/b.png',
      logoLightUrl: 'https://example.com/b-light.png',
      verifyUrl: 'https://branta.pro/2',
      fetchedAt: Date.now(),
    };

    merchantLabelRepository.upsert(label1);
    merchantLabelRepository.upsert(label2);

    const result = merchantLabelRepository.getByAddresses([
      'bc1qaddr1',
      'bc1qaddr2',
      'bc1qaddr3',
    ]);

    expect(result.size).toBe(2);
    expect(result.get('bc1qaddr1')?.platform).toBe('Exchange A');
    expect(result.get('bc1qaddr2')?.platform).toBe('Exchange B');
    expect(result.get('bc1qaddr3')).toBeUndefined();
  });

  test('should handle empty address list for getByAddresses', () => {
    const result = merchantLabelRepository.getByAddresses([]);
    expect(result.size).toBe(0);
  });

  test('should delete a label', () => {
    const label = {
      address: 'bc1qtest123',
      platform: 'Coinbase',
      description: 'Coinbase Exchange',
      logoUrl: 'https://example.com/logo.png',
      logoLightUrl: 'https://example.com/logo-light.png',
      verifyUrl: 'https://branta.pro/verify',
      fetchedAt: Date.now(),
    };

    merchantLabelRepository.upsert(label);
    expect(merchantLabelRepository.getByAddress('bc1qtest123')).not.toBeNull();

    merchantLabelRepository.delete('bc1qtest123');
    expect(merchantLabelRepository.getByAddress('bc1qtest123')).toBeNull();
  });

  test('should clear all labels', () => {
    const label1 = {
      address: 'bc1qaddr1',
      platform: 'Exchange A',
      description: 'Desc A',
      logoUrl: 'https://example.com/a.png',
      logoLightUrl: 'https://example.com/a-light.png',
      verifyUrl: 'https://branta.pro/1',
      fetchedAt: Date.now(),
    };

    const label2 = {
      address: 'bc1qaddr2',
      platform: 'Exchange B',
      description: 'Desc B',
      logoUrl: 'https://example.com/b.png',
      logoLightUrl: 'https://example.com/b-light.png',
      verifyUrl: 'https://branta.pro/2',
      fetchedAt: Date.now(),
    };

    merchantLabelRepository.upsert(label1);
    merchantLabelRepository.upsert(label2);

    merchantLabelRepository.clearAll();

    expect(merchantLabelRepository.getByAddress('bc1qaddr1')).toBeNull();
    expect(merchantLabelRepository.getByAddress('bc1qaddr2')).toBeNull();
  });

  test('should handle optional fields correctly', () => {
    const label = {
      address: 'bc1qminimal',
      platform: 'Exchange',
      description: undefined,
      logoUrl: undefined,
      logoLightUrl: undefined,
      verifyUrl: undefined,
      fetchedAt: Date.now(),
    };

    merchantLabelRepository.upsert(label);
    const retrieved = merchantLabelRepository.getByAddress('bc1qminimal');

    expect(retrieved?.platform).toBe('Exchange');
    expect(retrieved?.description).toBeUndefined();
    expect(retrieved?.logoUrl).toBeUndefined();
  });

  test('markVerifiedTx calls insert with txid and network', () => {
    const txid = 'a'.repeat(64);
    merchantLabelRepository.markVerifiedTx(txid, 'mainnet', 'bc1qtest');
    expect(merchantLabelRepository.isVerifiedTx(txid, 'mainnet')).toBe(true);
  });

  test('markVerifiedTx ignores invalid txid', () => {
    const sizeBefore = mockStore.verifiedTxs.size;
    merchantLabelRepository.markVerifiedTx('not-a-txid', 'mainnet', 'bc1qtest');
    expect(mockStore.verifiedTxs.size).toBe(sizeBefore);
  });

  test('isVerifiedTx returns true when row exists', () => {
    const txid = 'b'.repeat(64);
    merchantLabelRepository.markVerifiedTx(txid, 'mainnet', 'bc1qtest');
    expect(merchantLabelRepository.isVerifiedTx(txid, 'mainnet')).toBe(true);
  });

  test('isVerifiedTx returns false when row missing', () => {
    expect(
      merchantLabelRepository.isVerifiedTx('c'.repeat(64), 'mainnet'),
    ).toBe(false);
  });

  test('getVerifiedTxids returns matching txids', () => {
    const txid1 = 'd'.repeat(64);
    const txid2 = 'e'.repeat(64);
    merchantLabelRepository.markVerifiedTx(txid1, 'mainnet', 'bc1q1');
    merchantLabelRepository.markVerifiedTx(txid2, 'mainnet', 'bc1q2');
    const result = merchantLabelRepository.getVerifiedTxids(
      [txid1, txid2, 'f'.repeat(64)],
      'mainnet',
    );
    expect(result.has(txid1)).toBe(true);
    expect(result.has(txid2)).toBe(true);
    expect(result.size).toBe(2);
  });

  test('clearAll deletes merchant labels and verified txs', () => {
    merchantLabelRepository.upsert({
      address: 'bc1qclear',
      platform: 'Test',
      fetchedAt: Date.now(),
    });
    merchantLabelRepository.markVerifiedTx('1'.repeat(64), 'mainnet', 'bc1qclear');
    merchantLabelRepository.clearAll();
    expect(merchantLabelRepository.getByAddress('bc1qclear')).toBeNull();
    expect(
      merchantLabelRepository.isVerifiedTx('1'.repeat(64), 'mainnet'),
    ).toBe(false);
  });

  test('backfillVerifiedTxsFromMerchantHistory marks tx in scan window', () => {
    const fetchedAt = 1_700_000_000_000;
    const txidLocal = 'd'.repeat(64);
    mockStore.merchantLabels.set('bc1qbackfill', {
      address: 'bc1qbackfill',
      platform: 'Shop',
      verify_url: 'https://branta.pro/verify',
      fetched_at: fetchedAt,
    });
    mockStore.transactionBackfillRows = [
      {
        txid: txidLocal,
        network: 'mainnet',
        address: 'bc1qbackfill',
        fetched_at: fetchedAt,
        tx_time_ms: fetchedAt + 120_000,
      },
    ];

    const inserted =
      merchantLabelRepository.backfillVerifiedTxsFromMerchantHistory();
    expect(inserted).toBe(1);
    expect(merchantLabelRepository.isVerifiedTx(txidLocal, 'mainnet')).toBe(
      true,
    );
  });

  test('getByAddress matches mixed-case bech32', () => {
    merchantLabelRepository.upsert({
      address: 'BC1QTEST123',
      platform: 'Cafe',
      fetchedAt: Date.now(),
    });
    expect(merchantLabelRepository.getByAddress('bc1qtest123')?.platform).toBe(
      'Cafe',
    );
  });

  test('resolveForOutboundTx uses verified payment address, not change output', () => {
    const txid = '9'.repeat(64);
    merchantLabelRepository.upsert({
      address: 'bc1qmerchant',
      platform: 'Branta Shop',
      fetchedAt: Date.now(),
    });
    merchantLabelRepository.markVerifiedTx(txid, 'mainnet', 'bc1qmerchant');
    const label = merchantLabelRepository.resolveForOutboundTx(
      txid,
      'mainnet',
      ['bc1qchange', 'bc1qmerchant'],
    );
    expect(label?.platform).toBe('Branta Shop');
  });
});

describe('shouldBackfillBrantaTx', () => {
  const txid = 'a'.repeat(64);

  function candidate(
    overrides: Partial<BrantaBackfillCandidate> = {},
  ): BrantaBackfillCandidate {
    return {
      txid,
      network: 'mainnet',
      address: 'bc1qmerchant',
      fetchedAt: 1_000_000,
      txTimeMs: 1_000_000,
      ...overrides,
    };
  }

  test('returns true when tx is within Branta scan window', () => {
    const c = candidate({txTimeMs: 1_000_000 + 60_000});
    expect(shouldBackfillBrantaTx(c, [c])).toBe(true);
  });

  test('returns true slightly before fetchedAt (clock skew)', () => {
    const c = candidate({
      txTimeMs: 1_000_000 - BRANTA_BACKFILL_PRE_MS + 1_000,
    });
    expect(shouldBackfillBrantaTx(c, [c])).toBe(true);
  });

  test('returns false when tx is outside window and multiple candidates exist', () => {
    const c1 = candidate({txid: 'b'.repeat(64), txTimeMs: 1_000_000});
    const c2 = candidate({
      txid: 'c'.repeat(64),
      txTimeMs: 1_000_000 + BRANTA_BACKFILL_POST_MS + 1,
    });
    expect(shouldBackfillBrantaTx(c2, [c1, c2])).toBe(false);
  });

  test('returns true for sole outbound tx even without timestamp', () => {
    const c = candidate({txTimeMs: null});
    expect(shouldBackfillBrantaTx(c, [c])).toBe(true);
  });

  test('returns false without timestamp when multiple candidates exist', () => {
    const c1 = candidate({txid: 'b'.repeat(64), txTimeMs: null});
    const c2 = candidate({txid: 'c'.repeat(64), txTimeMs: 2_000_000});
    expect(shouldBackfillBrantaTx(c1, [c1, c2])).toBe(false);
  });
});
