/**
 * @format
 */

import {
  isApiTxConfirmed,
  phaseFromParentConfirmed,
} from '../services/txVisualizerPhase';

describe('tx visualizer confirmation', () => {
  it('does not treat a pending parent as confirmed', () => {
    expect(phaseFromParentConfirmed(false, true)).toBe('mempool');
  });

  it('uses confirmed only when the parent chip is confirmed', () => {
    expect(phaseFromParentConfirmed(true, true)).toBe('confirmed');
  });

  it('requires API confirmed === true, not a truthy string', () => {
    expect(isApiTxConfirmed({confirmed: false})).toBe(false);
    expect(isApiTxConfirmed({confirmed: 'false'})).toBe(false);
    expect(isApiTxConfirmed({confirmed: true})).toBe(true);
    expect(isApiTxConfirmed({})).toBe(false);
  });
});
