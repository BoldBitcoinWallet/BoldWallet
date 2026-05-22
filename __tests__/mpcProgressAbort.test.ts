import {progressStateAfterAbort} from '../services/mpcProgress';
import {
  getMpcCancelState,
  markMpcInProgress,
  resetMpcCancelState,
  safeCancelMpc,
} from '../services/mpcCancel';

describe('mpc progress + cancel hardening', () => {
  beforeEach(() => {
    resetMpcCancelState('nostr');
  });

  it('progressStateAfterAbort caps at 99 and labels Aborted', () => {
    expect(progressStateAfterAbort(100)).toEqual({
      percent: 99,
      statusLabel: 'Aborted',
    });
    expect(progressStateAfterAbort(0)).toEqual({
      percent: 0,
      statusLabel: 'Aborted',
    });
  });

  it('mark in progress then abort leaves aborted state', async () => {
    markMpcInProgress('nostr');
    await safeCancelMpc('nostr', async () => undefined);
    expect(getMpcCancelState('nostr')).toBe('aborted');
  });
});
