export type ConnectionQualityLevel = 'unknown' | 'best' | 'medium' | 'low';

export type ConnectionQualityState = {
  level: ConnectionQualityLevel;
  label: string;
  transport: 'nostr' | 'lan';
  ewmaRttMs: number | null;
  consecutiveFails: number;
  samples: number;
  failSamples: number;
};

const EWMA_ALPHA = 0.3;
const BEST_RTT_MS = 250;
const MEDIUM_RTT_MS = 800;
const QUALITY_UI_THROTTLE_MS = 300;

export function emptyConnectionQuality(
  transport: 'nostr' | 'lan' = 'nostr',
): ConnectionQualityState {
  return {
    level: 'unknown',
    label: 'Connecting…',
    transport,
    ewmaRttMs: null,
    consecutiveFails: 0,
    samples: 0,
    failSamples: 0,
  };
}

export function labelForQualityLevel(level: ConnectionQualityLevel): string {
  if (level === 'best') {
    return 'Best';
  }
  if (level === 'medium') {
    return 'Medium';
  }
  if (level === 'low') {
    return 'Low';
  }
  return 'Connecting…';
}

function withLabel(state: ConnectionQualityState): ConnectionQualityState {
  return {...state, label: labelForQualityLevel(state.level)};
}

function nostrLevelFromStats(state: ConnectionQualityState): ConnectionQualityLevel {
  if (state.samples === 0) {
    return 'unknown';
  }
  if (state.consecutiveFails >= 3) {
    return 'low';
  }
  const failRate = state.failSamples / Math.max(1, state.samples);
  if (failRate >= 0.5 && state.samples >= 3) {
    return 'low';
  }
  if (state.ewmaRttMs == null) {
    return state.consecutiveFails > 0 ? 'low' : 'unknown';
  }
  if (state.ewmaRttMs < BEST_RTT_MS && state.consecutiveFails < 2 && failRate < 0.2) {
    return 'best';
  }
  if (state.ewmaRttMs < MEDIUM_RTT_MS) {
    return 'medium';
  }
  return 'low';
}

export function applyRelayFidelitySample(
  state: ConnectionQualityState,
  sample: {ok?: boolean; rtt_ms?: number; op?: string},
): ConnectionQualityState {
  const next: ConnectionQualityState = {
    ...state,
    transport: 'nostr',
    samples: state.samples + 1,
  };
  const blocked = sample.op === 'block';
  const ok = sample.ok === true && !blocked;
  if (ok) {
    next.consecutiveFails = 0;
    const rtt = typeof sample.rtt_ms === 'number' ? sample.rtt_ms : null;
    if (rtt != null && rtt >= 0) {
      next.ewmaRttMs =
        state.ewmaRttMs == null
          ? rtt
          : EWMA_ALPHA * rtt + (1 - EWMA_ALPHA) * state.ewmaRttMs;
    }
  } else {
    next.consecutiveFails = state.consecutiveFails + 1;
    next.failSamples = state.failSamples + 1;
  }
  next.level = nostrLevelFromStats(next);
  return withLabel(next);
}

export function applyLanQualitySignals(
  state: ConnectionQualityState,
  opts: {transportActive?: boolean; pulse?: boolean; stale?: boolean},
): ConnectionQualityState {
  let level: ConnectionQualityLevel = state.level;
  if (opts.stale) {
    level = 'low';
  } else if (opts.pulse) {
    level = 'best';
  } else if (opts.transportActive) {
    level = 'medium';
  } else if (state.samples === 0 && level === 'unknown') {
    level = 'unknown';
  }
  return withLabel({
    ...state,
    transport: 'lan',
    samples: state.samples + 1,
    level,
  });
}

export function shouldPublishQualityUpdate(
  prev: ConnectionQualityState,
  next: ConnectionQualityState,
  lastPublishAtMs: number,
  nowMs = Date.now(),
  minIntervalMs = QUALITY_UI_THROTTLE_MS,
): boolean {
  if (prev.level !== next.level || prev.label !== next.label) {
    return true;
  }
  return nowMs - lastPublishAtMs >= minIntervalMs;
}
