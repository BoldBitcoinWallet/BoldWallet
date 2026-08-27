/**
 * @format
 */

jest.mock('../utils', () => ({dbg: jest.fn()}));

import {
  mapPool,
  MULTI_PROVIDER_SYNC_CONCURRENCY,
  SINGLE_PROVIDER_SYNC_CONCURRENCY,
  PUBLIC_SYNC_CONCURRENCY,
  CUSTOM_HOST_SYNC_CONCURRENCY,
} from '../services/sync/rateLimitRetry';

describe('mapPool', () => {
  it('maps items in input order with a concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await mapPool([1, 2, 3, 4, 5], 2, async n => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 15));
      inFlight -= 1;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('reports completed count as work finishes', async () => {
    const ticks: number[] = [];
    await mapPool(
      ['a', 'b', 'c'],
      3,
      async item => item,
      (completed, total) => ticks.push(completed / total),
    );
    expect(ticks).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('stops taking new items after the first rejection', async () => {
    const started: number[] = [];
    await expect(
      mapPool([1, 2, 3, 4, 5], 1, async n => {
        started.push(n);
        if (n === 2) {
          throw new Error('boom');
        }
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });

  it('returns an empty array for empty input', async () => {
    expect(await mapPool([], 3, async x => x)).toEqual([]);
  });
});

describe('sync pool constants', () => {
  it('uses min(3, n) when multiple providers enabled and 1 when single', () => {
    expect(MULTI_PROVIDER_SYNC_CONCURRENCY).toBe(3);
    expect(SINGLE_PROVIDER_SYNC_CONCURRENCY).toBe(1);
    expect(PUBLIC_SYNC_CONCURRENCY).toBe(3);
    expect(CUSTOM_HOST_SYNC_CONCURRENCY).toBe(1);
  });
});
