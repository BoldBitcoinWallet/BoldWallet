import {formatFeeEstimationError} from '../services/feeErrorMessages';

describe('formatFeeEstimationError', () => {
  it('explains inflated need vs have after self-send sync lag', () => {
    const msg = formatFeeEstimationError(
      new Error('Insufficient UTXOs: need 229723 sats, have 114791'),
    );
    expect(msg).toMatch(/spendable balance/i);
    expect(msg).toMatch(/refresh/i);
  });
});
