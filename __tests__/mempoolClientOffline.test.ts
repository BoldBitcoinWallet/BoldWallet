/**
 * @format
 */

const mockOnlineState = {value: true};

jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: () => mockOnlineState.value,
}));

jest.mock('../services/HdOptionsConfig', () => ({
  getFetchTimeoutMs: () => 5_000,
  getMempoolDefaultTtlMs: () => 60_000,
  getTransactionDbTtlMs: () => 60_000,
}));

jest.mock('../services/mempoolHealth', () => ({
  recordMempoolAttempt: jest.fn(),
  rankedHosts: (hosts: string[]) => hosts,
}));

jest.mock('../utils', () => ({dbg: jest.fn()}));

import mempoolClient from '../services/MempoolClient';

describe('MempoolClient offline gate', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockOnlineState.value = true;
    mempoolClient.invalidateAll();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({height: 1}),
      text: async () => '',
      headers: {get: () => null},
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not fetch when offline and cache is empty', async () => {
    mockOnlineState.value = false;
    const res = await mempoolClient.get('https://mempool.space/api/v1/prices');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still serves a fresh cache hit while offline', async () => {
    const url = 'https://mempool.space/api/v1/prices?offline-cache=1';
    const first = await mempoolClient.get(url);
    expect(first.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    (global.fetch as jest.Mock).mockClear();
    mockOnlineState.value = false;
    const second = await mempoolClient.get(url);
    expect(second.ok).toBe(true);
    expect(second.data).toEqual({height: 1});
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('MempoolClient.syncPoolConcurrency', () => {
  afterEach(() => {
    mempoolClient.setPublicBases([]);
  });
  it('is 1 when no enabled failover hosts are registered', () => {
    mempoolClient.setPublicBases([]);
    expect(
      mempoolClient.syncPoolConcurrency('https://mempool.space/api'),
    ).toBe(1);
  });

  it('is min(3, n) for multiple enabled hosts', () => {
    mempoolClient.setPublicBases([
      'https://mempool.space/api',
      'https://mempool.emzy.de/api',
    ]);
    expect(
      mempoolClient.syncPoolConcurrency('https://mempool.space/api'),
    ).toBe(2);
    expect(
      mempoolClient.syncPoolConcurrency('https://my-node.example/api'),
    ).toBe(2);
  });
});
