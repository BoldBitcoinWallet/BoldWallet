/**
 * MerchantLabelRepository tests
 */

// Mock the database module
jest.mock('../services/Database', () => ({
  database: {
    execute: jest.fn(),
  },
}));

// Import after mocks are set up
import merchantLabelRepository from '../services/repositories/MerchantLabelRepository';

describe('MerchantLabelRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear all labels before each test
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
});
