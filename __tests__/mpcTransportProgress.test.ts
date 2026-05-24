/**
 * @format
 */

import {
  emptyMpcTransportSubprogress,
  mapTransportHookToSubprogress,
} from '../services/mpcTransportProgress';
import type {MpcHookMessage} from '../services/mpcProgress';

describe('mpcTransportProgress', () => {
  it('maps Nostr chunk progress determinately', () => {
    const msg: MpcHookMessage = {
      type: 'transport',
      session: 'abc',
      transport: 'nostr',
      direction: 'out',
      chunk: 2,
      total: 5,
      active: true,
    } as MpcHookMessage;
    const result = mapTransportHookToSubprogress(msg);
    expect(result?.fraction).toBeCloseTo(0.4);
    expect(result?.label).toContain('2/5');
    expect(result?.visible).toBe(true);
  });

  it('maps LAN upload as indeterminate', () => {
    const msg: MpcHookMessage = {
      type: 'transport',
      session: 'abc',
      transport: 'lan',
      chunk: 0,
      total: 1,
      active: true,
    } as MpcHookMessage;
    const result = mapTransportHookToSubprogress(msg);
    expect(result?.fraction).toBeNull();
    expect(result?.label).toContain('LAN');
    expect(result?.transport).toBe('lan');
  });

  it('clears when inactive', () => {
    const msg: MpcHookMessage = {
      type: 'transport',
      session: 'abc',
      transport: 'nostr',
      chunk: 5,
      total: 5,
      active: false,
    } as MpcHookMessage;
    const result = mapTransportHookToSubprogress(msg);
    expect(result?.active).toBe(false);
    expect(result?.visible).toBe(false);
  });

  it('returns null for non-transport hooks', () => {
    expect(mapTransportHookToSubprogress({type: 'keygen', step: 1})).toBeNull();
    expect(emptyMpcTransportSubprogress().visible).toBe(false);
  });
});
