/**
 * Observe-only mempool HTTP quality.
 *
 * MempoolClient records each network attempt here. Cache, failover, abort,
 * and return values are unchanged — this module is a subscriber fan-out for
 * CacheIndicator hints (slow vs fine vs bad).
 */

export type MempoolHealthQuality = 'fine' | 'slow' | 'bad';

export type MempoolAttempt = {
  ok: boolean;
  timeout: boolean;
  status: number;
  durationMs: number;
  at: number;
};

export type MempoolHealthState = MempoolAttempt & {
  quality: MempoolHealthQuality;
};

export const SLOW_THRESHOLD_MS = 3_000;
export const HEALTH_UI_THROTTLE_MS = 500;
export const SLOW_NETWORK_HINT = 'Network is slow';

type Subscriber = (state: MempoolHealthState) => void;

const subscribers = new Set<Subscriber>();
let lastState: MempoolHealthState | null = null;
let lastNotifyAt = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export function qualityFromAttempt(sample: MempoolAttempt): MempoolHealthQuality {
  if (!sample.ok || sample.timeout) {
    return 'bad';
  }
  if (sample.durationMs >= SLOW_THRESHOLD_MS) {
    return 'slow';
  }
  return 'fine';
}

/** Slow hint only; error copy on the bar wins over this. */
export function cacheIndicatorHealthHint(
  quality: MempoolHealthQuality | undefined | null,
  syncErrorMessage?: string | null,
): string | null {
  if (syncErrorMessage) {
    return null;
  }
  if (quality === 'slow') {
    return SLOW_NETWORK_HINT;
  }
  return null;
}

function notify(state: MempoolHealthState): void {
  subscribers.forEach(fn => {
    try {
      fn(state);
    } catch {
      // ignore subscriber errors
    }
  });
}

function scheduleNotify(state: MempoolHealthState): void {
  const now = Date.now();
  if (now - lastNotifyAt >= HEALTH_UI_THROTTLE_MS) {
    lastNotifyAt = now;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    notify(state);
    return;
  }
  if (pendingTimer) {
    return;
  }
  const wait = HEALTH_UI_THROTTLE_MS - (now - lastNotifyAt);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    lastNotifyAt = Date.now();
    if (lastState) {
      notify(lastState);
    }
  }, wait);
}

/** Record a completed network attempt. Does not affect HTTP behavior. */
export function recordMempoolAttempt(sample: MempoolAttempt): void {
  const next: MempoolHealthState = {
    ...sample,
    quality: qualityFromAttempt(sample),
  };
  lastState = next;
  scheduleNotify(next);
}

export function getMempoolHealth(): MempoolHealthState | null {
  return lastState;
}

export function subscribeMempoolHealth(fn: Subscriber): () => void {
  subscribers.add(fn);
  if (lastState) {
    fn(lastState);
  }
  return () => {
    subscribers.delete(fn);
  };
}

/** Test-only: clear recorded samples and pending throttle. */
export function resetMempoolHealthForTests(): void {
  lastState = null;
  lastNotifyAt = 0;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  subscribers.clear();
}
