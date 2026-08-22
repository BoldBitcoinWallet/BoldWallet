/**
 * @format
 */

import {
  cacheIndicatorHealthHint,
  qualityFromAttempt,
  recordMempoolAttempt,
  resetMempoolHealthForTests,
  subscribeMempoolHealth,
  SLOW_NETWORK_HINT,
  SLOW_THRESHOLD_MS,
} from '../services/mempoolHealth';

function sample(
  overrides: Partial<{
    ok: boolean;
    timeout: boolean;
    status: number;
    durationMs: number;
  }> = {},
) {
  return {
    ok: true,
    timeout: false,
    status: 200,
    durationMs: 100,
    at: Date.now(),
    ...overrides,
  };
}

describe('mempoolHealth', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMempoolHealthForTests();
  });

  afterEach(() => {
    resetMempoolHealthForTests();
    jest.useRealTimers();
  });

  it('maps a fast 200 to fine', () => {
    expect(qualityFromAttempt(sample({ok: true, status: 200, durationMs: 200}))).toBe(
      'fine',
    );
  });

  it('maps a slow 200 to slow', () => {
    expect(
      qualityFromAttempt(
        sample({ok: true, status: 200, durationMs: SLOW_THRESHOLD_MS}),
      ),
    ).toBe('slow');
  });

  it('maps timeout to bad', () => {
    expect(
      qualityFromAttempt(
        sample({ok: false, timeout: true, status: 0, durationMs: 5000}),
      ),
    ).toBe('bad');
  });

  it('maps HTTP fail to bad', () => {
    expect(
      qualityFromAttempt(
        sample({ok: false, timeout: false, status: 503, durationMs: 80}),
      ),
    ).toBe('bad');
  });

  it('records timeout vs 200 vs slow 200', () => {
    const seen: string[] = [];
    subscribeMempoolHealth(s => seen.push(s.quality));

    recordMempoolAttempt(sample({ok: true, status: 200, durationMs: 120}));
    jest.advanceTimersByTime(500);
    recordMempoolAttempt(
      sample({ok: true, status: 200, durationMs: SLOW_THRESHOLD_MS + 10}),
    );
    jest.advanceTimersByTime(500);
    recordMempoolAttempt(
      sample({ok: false, timeout: true, status: 0, durationMs: 5000}),
    );

    expect(seen).toEqual(['fine', 'slow', 'bad']);
  });

  it('throttles subscriber updates to ~500ms', () => {
    const seen: string[] = [];
    subscribeMempoolHealth(s => seen.push(s.quality));

    recordMempoolAttempt(sample({durationMs: 100}));
    recordMempoolAttempt(sample({durationMs: SLOW_THRESHOLD_MS + 1}));
    expect(seen).toEqual(['fine']);

    jest.advanceTimersByTime(500);
    expect(seen).toEqual(['fine', 'slow']);
  });
});

describe('CacheIndicator healthHint precedence', () => {
  it('shows slow hint when there is no error copy', () => {
    expect(cacheIndicatorHealthHint('slow', null)).toBe(SLOW_NETWORK_HINT);
  });

  it('lets error copy win over slow', () => {
    expect(
      cacheIndicatorHealthHint('slow', 'Request timed out — cached data'),
    ).toBeNull();
  });

  it('hides hint for fine and bad', () => {
    expect(cacheIndicatorHealthHint('fine', null)).toBeNull();
    expect(cacheIndicatorHealthHint('bad', null)).toBeNull();
  });
});
