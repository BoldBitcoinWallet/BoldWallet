/**
 * @format
 */

import {
  formatSyncFillProgress,
  syncFillFailureKind,
  syncFillWarmth,
  syncFillWindow,
} from '../services/syncFillWindow';

describe('syncFillWindow', () => {
  it('starts empty with no progress', () => {
    expect(
      syncFillWindow({elapsedMs: 0, timeoutMs: 5000}),
    ).toMatchObject({
      fill: 0,
      overtime: false,
      windowProgress: 0,
      warmth: 'calm',
      sliceStart: 0,
      sliceEnd: 1,
    });
  });

  it('fills linearly over the timeout window', () => {
    expect(syncFillWindow({elapsedMs: 2500, timeoutMs: 5000}).fill).toBe(0.5);
    expect(
      syncFillWindow({elapsedMs: 2500, timeoutMs: 5000}).windowProgress,
    ).toBe(0.5);
  });

  it('warms from calm to patience to danger', () => {
    expect(syncFillWarmth(0)).toBe('calm');
    expect(syncFillWindow({elapsedMs: 2999, timeoutMs: 5000}).warmth).toBe(
      'calm',
    );
    expect(syncFillWindow({elapsedMs: 3000, timeoutMs: 5000}).warmth).toBe(
      'patience',
    );
    expect(syncFillWindow({elapsedMs: 4499, timeoutMs: 5000}).warmth).toBe(
      'patience',
    );
    expect(syncFillWindow({elapsedMs: 4500, timeoutMs: 5000}).warmth).toBe(
      'danger',
    );
  });

  it('clamps at full fill and flags overtime at timeout', () => {
    const at = syncFillWindow({elapsedMs: 5000, timeoutMs: 5000});
    expect(at.fill).toBe(1);
    expect(at.overtime).toBe(true);
    expect(at.warmth).toBe('danger');

    const past = syncFillWindow({elapsedMs: 8000, timeoutMs: 5000});
    expect(past.fill).toBe(1);
    expect(past.overtime).toBe(true);
  });

  it('uses progress as a floor and animates the current slice', () => {
    const start = syncFillWindow({
      elapsedMs: 0,
      timeoutMs: 5000,
      progress: {current: 2, total: 5},
    });
    expect(start.sliceStart).toBe(0.4);
    expect(start.sliceEnd).toBe(0.6);
    expect(start.fill).toBe(0.4);
    expect(start.overtime).toBe(false);

    const mid = syncFillWindow({
      elapsedMs: 2500,
      timeoutMs: 5000,
      progress: {current: 2, total: 5},
    });
    expect(mid.fill).toBeCloseTo(0.5);

    const end = syncFillWindow({
      elapsedMs: 5000 - 1,
      timeoutMs: 5000,
      progress: {current: 2, total: 5},
    });
    expect(end.fill).toBeCloseTo(0.6, 2);
    expect(end.overtime).toBe(false);
  });

  it('snaps to full bar once the window is overtime', () => {
    const overtime = syncFillWindow({
      elapsedMs: 5000,
      timeoutMs: 5000,
      progress: {current: 2, total: 5},
    });
    expect(overtime.fill).toBe(1);
    expect(overtime.overtime).toBe(true);
  });

  it('ignores empty or invalid progress', () => {
    expect(
      syncFillWindow({
        elapsedMs: 0,
        timeoutMs: 5000,
        progress: {current: 1, total: 0},
      }).sliceEnd,
    ).toBe(1);
    expect(
      syncFillWindow({elapsedMs: 0, timeoutMs: 5000, progress: null}).fill,
    ).toBe(0);
  });

  it('clamps a current value past total', () => {
    const w = syncFillWindow({
      elapsedMs: 0,
      timeoutMs: 5000,
      progress: {current: 9, total: 5},
    });
    expect(w.sliceStart).toBe(1);
    expect(w.sliceEnd).toBe(1);
    expect(w.fill).toBe(1);
  });

  it('treats non-positive timeout as already elapsed', () => {
    const w = syncFillWindow({elapsedMs: 0, timeoutMs: 0});
    expect(w.overtime).toBe(true);
    expect(w.fill).toBe(1);
  });

  it('clamps negative elapsed time', () => {
    expect(syncFillWindow({elapsedMs: -200, timeoutMs: 5000}).fill).toBe(0);
  });
});

describe('formatSyncFillProgress', () => {
  it('formats multi-address progress with a clear unit', () => {
    expect(formatSyncFillProgress({current: 3, total: 5})).toBe(
      '3 of 5 addresses',
    );
  });

  it('hides progress when there is only one address', () => {
    expect(formatSyncFillProgress({current: 1, total: 1})).toBeNull();
  });

  it('ignores invalid or empty progress', () => {
    expect(formatSyncFillProgress(null)).toBeNull();
    expect(formatSyncFillProgress({current: 0, total: 0})).toBeNull();
    expect(formatSyncFillProgress({current: -1, total: 5})).toBeNull();
  });

  it('clamps current past total', () => {
    expect(formatSyncFillProgress({current: 9, total: 5})).toBe(
      '5 of 5 addresses',
    );
  });
});

describe('syncFillFailureKind', () => {
  it('detects timeout copy', () => {
    expect(syncFillFailureKind('Request timed out — cached data')).toBe(
      'timeout',
    );
  });

  it('treats other copy as error', () => {
    expect(syncFillFailureKind('Sync failed — showing cached data')).toBe(
      'error',
    );
  });

  it('returns null when there is no message', () => {
    expect(syncFillFailureKind(null)).toBeNull();
    expect(syncFillFailureKind(undefined)).toBeNull();
    expect(syncFillFailureKind('')).toBeNull();
  });
});
