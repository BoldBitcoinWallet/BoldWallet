/**
 * @format
 */

import {
  isMpcAbortedOrCanceledError,
  isPeerAbortedSessionError,
  peerAbortUserMessage,
  shouldShowMpcFlowAlert,
} from '../services/mpcFlowAlerts';

describe('mpcFlowAlerts', () => {
  it('blocks alerts when aborted', () => {
    expect(shouldShowMpcFlowAlert({aborted: true, focused: true})).toBe(false);
  });

  it('blocks alerts when unfocused', () => {
    expect(shouldShowMpcFlowAlert({focused: false, flowActive: true})).toBe(
      false,
    );
  });

  it('blocks alerts when flow inactive', () => {
    expect(shouldShowMpcFlowAlert({flowActive: false, focused: true})).toBe(
      false,
    );
  });

  it('allows alerts when flow is active and focused', () => {
    expect(
      shouldShowMpcFlowAlert({aborted: false, focused: true, flowActive: true}),
    ).toBe(true);
  });

  it('detects canceled native errors', () => {
    expect(
      isMpcAbortedOrCanceledError(
        new Error('nostr mpc aborted during pre-agreement'),
      ),
    ).toBe(true);
    expect(isMpcAbortedOrCanceledError(new Error('keysign timed out'))).toBe(
      false,
    );
  });

  it('still surfaces await-joiners timeouts (not treated as user abort)', () => {
    expect(
      isMpcAbortedOrCanceledError(
        new Error(
          'await joiners: timeout waiting for all parties after 30s (have [KeyShare1], need [KeyShare1 KeyShare2])',
        ),
      ),
    ).toBe(false);
  });

  it('detects peer-abort separately from local user abort', () => {
    const err = new Error(
      'peer aborted the session: deserialize failed: invalid scalar fragment length',
    );
    expect(isPeerAbortedSessionError(err)).toBe(true);
    expect(isPeerAbortedSessionError(new Error('context canceled'))).toBe(
      false,
    );
    expect(peerAbortUserMessage(err, 'keygen')).toContain(
      'Another device stopped key generation',
    );
    expect(peerAbortUserMessage(err, 'keygen')).toContain(
      'invalid scalar fragment length',
    );
  });
});
