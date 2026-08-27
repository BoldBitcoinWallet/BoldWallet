/**
 * @format
 */

import {formatBroadcastError} from '../services/broadcastErrorMessages';
import {WalletOfflineError} from '../services/walletOfflineError';

describe('formatBroadcastError', () => {
  it('maps failed-after-N PostTx wrapping to a friendly network message', () => {
    expect(
      formatBroadcastError(
        new Error('failed after 4 attempts: failed to send request: timeout'),
      ),
    ).toMatch(/couldn't reach the bitcoin api/i);
  });

  it('maps mempool reject body without exposing retry wrapping', () => {
    expect(
      formatBroadcastError(
        new Error(
          'failed after 4 attempts: failed to broadcast transaction: bad-txns-inputs-missingorspent',
        ),
      ),
    ).toMatch(/already spent/i);
  });

  it('maps already-in-mempool', () => {
    expect(
      formatBroadcastError(new Error('txn-already-in-mempool')),
    ).toMatch(/already in the mempool/i);
  });

  it('maps in-app offline sandbox', () => {
    expect(formatBroadcastError(new WalletOfflineError())).toMatch(
      /go online to broadcast/i,
    );
  });
});
