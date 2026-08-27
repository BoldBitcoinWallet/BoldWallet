/**
 * @format
 */

jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: () => true,
}));

jest.mock('../services/HdOptionsConfig', () => ({
  getFetchTimeoutMs: () => 5_000,
  getMempoolDefaultTtlMs: () => 60_000,
  getTransactionDbTtlMs: () => 60_000,
}));

jest.mock('../utils', () => ({dbg: jest.fn()}));

import {
  rankedHosts,
  recordMempoolAttempt,
  resetMempoolHealthForTests,
  scoreHost,
} from '../services/mempoolHealth';
import mempoolClient from '../services/MempoolClient';

describe('mempoolHealth host ranking', () => {
  beforeEach(() => {
    resetMempoolHealthForTests();
  });

  afterEach(() => {
    resetMempoolHealthForTests();
  });

  it('scores cold hosts in the middle (0)', () => {
    expect(scoreHost('https://cold.example')).toBe(0);
  });

  it('ranks healthy hosts before failed ones; cold in the middle', () => {
    const good = 'https://good.example';
    const bad = 'https://bad.example';
    const cold = 'https://cold.example';

    recordMempoolAttempt({
      ok: true,
      timeout: false,
      status: 200,
      durationMs: 100,
      at: Date.now(),
      host: good,
    });
    recordMempoolAttempt({
      ok: false,
      timeout: true,
      status: 0,
      durationMs: 5000,
      at: Date.now(),
      host: bad,
    });

    expect(rankedHosts([bad, cold, good])).toEqual([good, cold, bad]);
  });
});

describe('MempoolClient syncPoolConcurrency + ranked failover', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mempoolClient.invalidateAll();
    mempoolClient.setPublicBases([]);
    resetMempoolHealthForTests();
    global.fetch = jest.fn(async (url: RequestInfo) => {
      const u = String(url);
      if (u.includes('bad.example')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
          text: async () => '',
          headers: {get: () => null},
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ok: true}),
        text: async () => '',
        headers: {get: () => null},
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mempoolClient.setPublicBases([]);
    resetMempoolHealthForTests();
  });

  it('uses concurrency 1 with a single enabled host', () => {
    mempoolClient.setPublicBases(['https://mempool.space/api']);
    expect(mempoolClient.syncPoolConcurrency()).toBe(1);
  });

  it('uses min(3, n) when multiple hosts are enabled', () => {
    mempoolClient.setPublicBases([
      'https://mempool.space/api',
      'https://mempool.emzy.de/api',
    ]);
    expect(mempoolClient.syncPoolConcurrency()).toBe(2);
    mempoolClient.setPublicBases([
      'https://a.example/api',
      'https://b.example/api',
      'https://c.example/api',
      'https://d.example/api',
    ]);
    expect(mempoolClient.syncPoolConcurrency()).toBe(3);
  });

  it('tries the healthier host first on failover', async () => {
    const good = 'https://good.example';
    const bad = 'https://bad.example';
    mempoolClient.setPublicBases([`${bad}/api`, `${good}/api`]);
    recordMempoolAttempt({
      ok: true,
      timeout: false,
      status: 200,
      durationMs: 80,
      at: Date.now(),
      host: good,
    });
    recordMempoolAttempt({
      ok: false,
      timeout: false,
      status: 503,
      durationMs: 50,
      at: Date.now(),
      host: bad,
    });

    const res = await mempoolClient.get(`${bad}/api/v1/prices?rank=1`);
    expect(res.ok).toBe(true);
    const calls = (global.fetch as jest.Mock).mock.calls.map(c => String(c[0]));
    expect(calls[0]).toContain('good.example');
  });

  it('never contacts a host that is not in the enabled pool', async () => {
    const enabled = 'https://enabled.example';
    const disabled = 'https://disabled.example';
    mempoolClient.setPublicBases([`${enabled}/api`]);

    const res = await mempoolClient.get(
      `${disabled}/api/v1/prices?disabled-leak=1`,
    );
    expect(res.ok).toBe(true);
    const calls = (global.fetch as jest.Mock).mock.calls.map(c => String(c[0]));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('enabled.example');
    expect(calls[0]).not.toContain('disabled.example');
  });

  it('multi-host pool never tries a foreign disabled host', async () => {
    const a = 'https://a.example';
    const b = 'https://b.example';
    const disabled = 'https://disabled.example';
    mempoolClient.setPublicBases([`${a}/api`, `${b}/api`]);

    await mempoolClient.get(`${disabled}/api/v1/prices?multi-disabled=1`);
    const calls = (global.fetch as jest.Mock).mock.calls.map(c => String(c[0]));
    expect(calls.every(c => !c.includes('disabled.example'))).toBe(true);
    expect(calls.some(c => c.includes('a.example') || c.includes('b.example'))).toBe(
      true,
    );
  });
});
