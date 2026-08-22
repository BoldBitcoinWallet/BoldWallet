/**
 * @format
 */

import {
  decideSendAfterBalanceRecheck,
  isBalanceRecheckTimeout,
} from '../services/sendBalanceRecheck';

describe('decideSendAfterBalanceRecheck', () => {
  it('opens Send when recheck succeeds with a positive balance', () => {
    expect(
      decideSendAfterBalanceRecheck(0, {ok: true, btc: 0.001}),
    ).toEqual({kind: 'openSend'});
  });

  it('shows Insufficient Balance only when recheck succeeds at zero', () => {
    expect(decideSendAfterBalanceRecheck(0, {ok: true, btc: 0})).toEqual({
      kind: 'insufficient',
    });
  });

  it('does not claim insufficient funds on timeout/throw when displayed is zero', () => {
    expect(decideSendAfterBalanceRecheck(0, {ok: false})).toEqual({
      kind: 'networkFail',
      openSend: false,
    });
  });

  it('opens Send on network fail when cached displayed balance is positive', () => {
    expect(decideSendAfterBalanceRecheck(0.5, {ok: false})).toEqual({
      kind: 'networkFail',
      openSend: true,
    });
  });
});

describe('isBalanceRecheckTimeout', () => {
  it('detects timeout and abort errors', () => {
    expect(isBalanceRecheckTimeout(new Error('Balance check timed out'))).toBe(
      true,
    );
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isBalanceRecheckTimeout(abort)).toBe(true);
    expect(isBalanceRecheckTimeout(new Error('network down'))).toBe(false);
  });
});
