/**
 * Observe-only mempool HTTP quality.
 *
 * MempoolClient records each network attempt here. Cache, failover, abort,
 * and return values are unchanged for callers — this module is a subscriber
 * fan-out for CacheIndicator hints and the header provider health dot, plus
 * per-host scores used to order failover among enabled providers.
 */

export type MempoolHealthQuality = 'fine' | 'slow' | 'bad';

export type MempoolAttempt = {
  ok: boolean;
  timeout: boolean;
  status: number;
  durationMs: number;
  at: number;
  /** Protocol + host (no path), e.g. https://mempool.space */
  host?: string;
};

export type MempoolHealthState = MempoolAttempt & {
  quality: MempoolHealthQuality;
};

export const SLOW_THRESHOLD_MS = 3_000;
export const HEALTH_UI_THROTTLE_MS = 500;
export const SLOW_NETWORK_HINT = 'Network is slow';
/** Recent live attempts kept per host for ranking. */
export const HOST_ATTEMPT_WINDOW = 5;

type Subscriber = (state: MempoolHealthState) => void;

const subscribers = new Set<Subscriber>();
let lastState: MempoolHealthState | null = null;
let lastNotifyAt = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** host → recent attempts (newest last). */
const hostAttempts = new Map<string, MempoolAttempt[]>();

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

export type ProviderHealthDotColors = {
  primary: string;
  secondary: string;
  bitcoinOrange: string;
  background: string;
};

export type ProviderHealthDotStyle = {
  color: string;
  hollow: boolean;
  opacity: number;
};

/**
 * Theme-aware health/offline dot. Light uses primary as “alive”; dark uses
 * secondary (teal). Offline is a hollow ring so it is not confused with “down”.
 */
export function providerHealthDotStyle(
  colors: ProviderHealthDotColors,
  opts: {online: boolean; quality: MempoolHealthQuality | null},
): ProviderHealthDotStyle {
  const isDark = colors.background !== '#ffffff';
  const alive = isDark ? colors.secondary : colors.primary;
  const dead = isDark ? colors.primary : colors.secondary;
  if (!opts.online) {
    return {color: dead, hollow: true, opacity: 1};
  }
  if (opts.quality == null) {
    return {color: alive, hollow: false, opacity: 0.5};
  }
  if (opts.quality === 'slow') {
    return {color: colors.bitcoinOrange, hollow: false, opacity: 1};
  }
  if (opts.quality === 'bad') {
    return {color: dead, hollow: false, opacity: 1};
  }
  return {color: alive, hollow: false, opacity: 1};
}

export function providerHealthA11yQuality(
  quality: MempoolHealthQuality | null,
): string {
  if (quality === 'slow') {
    return 'slow';
  }
  if (quality === 'bad') {
    return 'unreachable';
  }
  if (quality === 'fine') {
    return 'healthy';
  }
  return 'checking';
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

function pushHostAttempt(host: string, sample: MempoolAttempt): void {
  const key = host.replace(/\/+$/, '');
  if (!key) {
    return;
  }
  const prev = hostAttempts.get(key) ?? [];
  const next = [...prev, sample];
  while (next.length > HOST_ATTEMPT_WINDOW) {
    next.shift();
  }
  hostAttempts.set(key, next);
}

/**
 * Higher is better. Cold hosts (no samples) score 0 so they sit between
 * proven-good (positive) and known-bad (negative) hosts.
 */
export function scoreHost(host: string): number {
  const key = (host || '').replace(/\/+$/, '');
  const samples = hostAttempts.get(key);
  if (!samples || samples.length === 0) {
    return 0;
  }
  let ok = 0;
  let totalLatency = 0;
  let latencyN = 0;
  for (const s of samples) {
    if (s.ok && !s.timeout) {
      ok += 1;
      totalLatency += s.durationMs;
      latencyN += 1;
    }
  }
  if (ok === 0) {
    // Known-bad: below cold (0).
    return -1;
  }
  const successRate = ok / samples.length;
  const avgLatency = latencyN > 0 ? totalLatency / latencyN : SLOW_THRESHOLD_MS;
  // success dominates; lower latency is a tie-breaker (scaled ~0–1).
  const latencyScore = 1 / (1 + avgLatency / 1000);
  return successRate * 10 + latencyScore;
}

/**
 * Order enabled host roots (protocol + host, no /api) best-first.
 * Preserves relative order for equal scores.
 */
export function rankedHosts(enabledHosts: string[]): string[] {
  const withIndex = enabledHosts.map((h, i) => ({
    host: h.replace(/\/+$/, ''),
    i,
    score: scoreHost(h),
  }));
  withIndex.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.i - b.i;
  });
  return withIndex.map(x => x.host);
}

export function getHostQuality(host: string): MempoolHealthQuality | null {
  const key = (host || '').replace(/\/+$/, '');
  const samples = hostAttempts.get(key);
  if (!samples || samples.length === 0) {
    return null;
  }
  return qualityFromAttempt(samples[samples.length - 1]);
}

/** Record a completed network attempt. Does not affect HTTP return values. */
export function recordMempoolAttempt(sample: MempoolAttempt): void {
  if (sample.host) {
    pushHostAttempt(sample.host, sample);
  }
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
  hostAttempts.clear();
}
