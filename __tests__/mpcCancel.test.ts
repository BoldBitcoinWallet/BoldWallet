import {
  assertCanStartNostrMpc,
  canStartNostrMpc,
  getMpcCancelState,
  markMpcInProgress,
  markNostrMpcAborted,
  NostrMpcCooldownError,
  NOSTR_ABORT_COOLDOWN_MS,
  nostrMpcCooldownMessage,
  nostrMpcCooldownMessageFromError,
  resetMpcCancelState,
  safeCancelMpc,
} from '../services/mpcCancel';

describe('mpcCancel', () => {
  beforeEach(() => {
    resetMpcCancelState('nostr');
    resetMpcCancelState('session');
  });

  it('cancels successfully on first request', async () => {
    markMpcInProgress('nostr');
    let calls = 0;
    const result = await safeCancelMpc('nostr', async () => {
      calls += 1;
    });
    expect(result.outcome).toBe('cancelled');
    expect(calls).toBe(1);
    expect(getMpcCancelState('nostr')).toBe('aborted');
  });

  it('is idempotent on repeated cancel', async () => {
    markMpcInProgress('nostr');
    let calls = 0;
    await safeCancelMpc('nostr', async () => {
      calls += 1;
    });
    const second = await safeCancelMpc('nostr', async () => {
      calls += 1;
    });
    expect(second.outcome).toBe('already_requested');
    expect(calls).toBe(1);
  });

  it('treats no active nostr mpc as noop by default (production)', async () => {
    markMpcInProgress('nostr');
    const result = await safeCancelMpc('nostr', async () => {
      throw new Error('no active nostr mpc operation');
    });
    expect(result.outcome).toBe('noop');
  });

  it('blocks nostr restart for 15s after abort', () => {
    markNostrMpcAborted();
    expect(canStartNostrMpc().ok).toBe(false);
    expect(nostrMpcCooldownMessage()).toMatch(/Wait \d+ seconds/);
  });

  it('assertCanStartNostrMpc throws with remaining seconds', () => {
    markNostrMpcAborted();
    expect(() => assertCanStartNostrMpc()).toThrow(NostrMpcCooldownError);
    try {
      assertCanStartNostrMpc();
    } catch (e) {
      expect(e).toBeInstanceOf(NostrMpcCooldownError);
      expect((e as NostrMpcCooldownError).waitSeconds).toBeGreaterThan(0);
      expect((e as Error).message).toMatch(/Wait \d+ seconds after abort/);
    }
  });

  it('parses native cooldown errors with seconds', () => {
    expect(
      nostrMpcCooldownMessageFromError(
        new Error(
          'Failed to send BTC via Nostr: nostr mpc aborted: wait 9 seconds before retrying',
        ),
      ),
    ).toBe('Wait 9 seconds after abort before retrying.');
  });

  it('allows nostr restart after cooldown elapses', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    markNostrMpcAborted();
    jest.spyOn(Date, 'now').mockReturnValue(now + NOSTR_ABORT_COOLDOWN_MS + 1);
    expect(canStartNostrMpc().ok).toBe(true);
    expect(nostrMpcCooldownMessage()).toBeNull();
    jest.restoreAllMocks();
  });

  it('rethrows unknown cancel errors', async () => {
    markMpcInProgress('session');
    await expect(
      safeCancelMpc('session', async () => {
        throw new Error('network down');
      }),
    ).rejects.toThrow('network down');
  });
});
