jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {show: jest.fn()},
}));

import {
  beginMpcFlowAttempt,
  clearMpcFlowAttempt,
  resetMpcFlowAttemptForTests,
  shouldShowMpcFlowAlert,
} from '../services/mpcFlowAlerts';

describe('mpcFlowAlerts attempt gating', () => {
  afterEach(() => {
    resetMpcFlowAttemptForTests();
  });

  it('suppresses alerts from a previous attempt after a new one starts', () => {
    const first = beginMpcFlowAttempt();
    expect(
      shouldShowMpcFlowAlert({flowActive: true, attemptId: first}),
    ).toBe(true);
    const second = beginMpcFlowAttempt();
    expect(
      shouldShowMpcFlowAlert({flowActive: true, attemptId: first}),
    ).toBe(false);
    expect(
      shouldShowMpcFlowAlert({flowActive: true, attemptId: second}),
    ).toBe(true);
  });

  it('suppresses after the live attempt is cleared', () => {
    const id = beginMpcFlowAttempt();
    clearMpcFlowAttempt(id);
    expect(shouldShowMpcFlowAlert({flowActive: true, attemptId: id})).toBe(
      false,
    );
  });
});
