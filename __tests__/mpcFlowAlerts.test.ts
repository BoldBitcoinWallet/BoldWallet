/**
 * @format
 */

import {
  isMpcAbortedOrCanceledError,
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
});
