/**
 * CacheIndicator timeout-window fill math.
 *
 * A refresh is a queue of jobs (and a job may be many HTTP calls). The bar
 * fills the current slice over `timeoutMs` (the user-facing fetch timeout),
 * then holds at full if work continues past that window.
 */

export type SyncFillProgress = {current: number; total: number};

export type SyncFillWarmth = 'calm' | 'patience' | 'danger';

export type SyncFillFailureKind = 'timeout' | 'error';

export type SyncFillWindow = {
  /** 0–1 fill amount for the bar. */
  fill: number;
  /** True when elapsed has reached or passed the timeout window. */
  overtime: boolean;
  /** 0–1 progress through the timeout window (clamped). */
  windowProgress: number;
  warmth: SyncFillWarmth;
  /** Fill at the start of this window (progress floor). */
  sliceStart: number;
  /** Fill at the end of this window, before overtime snaps to 1. */
  sliceEnd: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  if (n >= 1) {
    return 1;
  }
  return n;
}

export function syncFillWarmth(windowProgress: number): SyncFillWarmth {
  const t = clamp01(windowProgress);
  if (t >= 0.9) {
    return 'danger';
  }
  if (t >= 0.6) {
    return 'patience';
  }
  return 'calm';
}

function sliceBounds(
  progress?: SyncFillProgress | null,
): {sliceStart: number; sliceEnd: number} {
  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;
  if (total <= 0 || current < 0) {
    return {sliceStart: 0, sliceEnd: 1};
  }
  const c = Math.min(current, total);
  return {
    sliceStart: clamp01(c / total),
    sliceEnd: clamp01((c + 1) / total),
  };
}

export function syncFillWindow(opts: {
  elapsedMs: number;
  timeoutMs: number;
  progress?: SyncFillProgress | null;
}): SyncFillWindow {
  const timeoutMs = opts.timeoutMs;
  const elapsedMs = Number.isFinite(opts.elapsedMs)
    ? Math.max(0, opts.elapsedMs)
    : 0;
  const {sliceStart, sliceEnd} = sliceBounds(opts.progress);
  const overtime = !(timeoutMs > 0) || elapsedMs >= timeoutMs;
  const windowProgress = overtime
    ? 1
    : elapsedMs / timeoutMs;
  const fill = overtime
    ? 1
    : sliceStart + (sliceEnd - sliceStart) * windowProgress;
  return {
    fill: clamp01(fill),
    overtime,
    windowProgress,
    warmth: syncFillWarmth(windowProgress),
    sliceStart,
    sliceEnd,
  };
}

/** User-facing address sync counter, e.g. "3 of 5 addresses". */
export function formatSyncFillProgress(
  progress: SyncFillProgress | null | undefined,
): string | null {
  if (!progress) {
    return null;
  }
  const total = Math.floor(progress.total);
  const current = Math.floor(progress.current);
  if (!Number.isFinite(total) || total <= 1 || current < 0) {
    return null;
  }
  const safeCurrent = Math.min(current, total);
  return `${safeCurrent} of ${total} addresses`;
}

/** Infer timeout vs other failure from CacheIndicator error copy. */
export function syncFillFailureKind(
  syncErrorMessage?: string | null,
): SyncFillFailureKind | null {
  if (!syncErrorMessage) {
    return null;
  }
  return /timed out/i.test(syncErrorMessage) ? 'timeout' : 'error';
}
