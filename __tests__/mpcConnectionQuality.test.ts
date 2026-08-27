/**
 * @format
 */

import {
  applyLanQualitySignals,
  applyRelayFidelitySample,
  emptyConnectionQuality,
  shouldPublishQualityUpdate,
} from '../services/mpcConnectionQuality';

describe('mpcConnectionQuality', () => {
  it('maps fast successful Nostr RTTs to Best', () => {
    let state = emptyConnectionQuality('nostr');
    state = applyRelayFidelitySample(state, {ok: true, rtt_ms: 80, op: 'publish'});
    state = applyRelayFidelitySample(state, {ok: true, rtt_ms: 90, op: 'publish'});
    expect(state.level).toBe('best');
    expect(state.label).toBe('Best');
  });

  it('maps mixed/slower RTTs to Medium', () => {
    let state = emptyConnectionQuality('nostr');
    state = applyRelayFidelitySample(state, {ok: true, rtt_ms: 400, op: 'publish'});
    state = applyRelayFidelitySample(state, {ok: true, rtt_ms: 500, op: 'publish'});
    expect(state.level).toBe('medium');
  });

  it('maps fail streaks and blocks to Low', () => {
    let state = emptyConnectionQuality('nostr');
    state = applyRelayFidelitySample(state, {ok: false, op: 'publish'});
    state = applyRelayFidelitySample(state, {ok: false, op: 'publish'});
    state = applyRelayFidelitySample(state, {ok: false, op: 'block'});
    expect(state.level).toBe('low');
    expect(state.label).toBe('Low');
  });

  it('maps LAN stale to Low and pulse to Best', () => {
    const stale = applyLanQualitySignals(emptyConnectionQuality('lan'), {
      stale: true,
    });
    expect(stale.level).toBe('low');
    const best = applyLanQualitySignals(emptyConnectionQuality('lan'), {
      pulse: true,
    });
    expect(best.level).toBe('best');
  });

  it('throttles same-level updates', () => {
    const a = emptyConnectionQuality('nostr');
    const b = applyRelayFidelitySample(a, {ok: true, rtt_ms: 80});
    expect(shouldPublishQualityUpdate(b, b, 1000, 1100, 300)).toBe(false);
    expect(shouldPublishQualityUpdate(a, b, 1000, 1100, 300)).toBe(true);
  });
});
