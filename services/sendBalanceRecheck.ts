/**
 * Decide what Home Send should do after an optional live balance recheck.
 * Recheck runs only when the displayed balance looks empty; network failure
 * must not be treated as a true-zero wallet.
 */

export type BalanceRecheckResult =
  | {ok: true; btc: number}
  | {ok: false};

export type SendAfterRecheck =
  | {kind: 'openSend'}
  | {kind: 'insufficient'}
  | {kind: 'networkFail'; openSend: boolean};

export function decideSendAfterBalanceRecheck(
  displayedBtc: number,
  recheck: BalanceRecheckResult,
): SendAfterRecheck {
  if (recheck.ok) {
    return recheck.btc > 0 ? {kind: 'openSend'} : {kind: 'insufficient'};
  }
  return {kind: 'networkFail', openSend: displayedBtc > 0};
}

export function isBalanceRecheckTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = (error as {name?: string}).name ?? '';
  const message = (error as {message?: string}).message ?? '';
  return (
    name === 'AbortError' ||
    /timeout|timed out|aborted/i.test(message)
  );
}
