/** User-facing message for fee estimation failures (SendBitcoinModal). */
export function formatFeeEstimationError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const m = msg.match(/Insufficient UTXOs: need (\d+) sats, have (\d+)/i);
  if (m) {
    const need = Number(m[1]);
    const have = Number(m[2]);
    const needBtc = (need / 1e8).toFixed(8);
    const haveBtc = (have / 1e8).toFixed(8);
    if (have > 0 && need > have * 1.5) {
      return (
        `Your spendable balance is about ${haveBtc} BTC, but this payment needs roughly ${needBtc} BTC including the network fee. ` +
        'That often happens right after sending coins to your own wallet while balances are still updating. ' +
        'Go back to the wallet home screen, pull to refresh, wait a moment for the pending transfer to sync, then try again.'
      );
    }
    return (
      `Not enough spendable coins (${haveBtc} BTC available, about ${needBtc} BTC required including fee). ` +
      'Try a lower amount or refresh your wallet balance.'
    );
  }
  if (/no utxos/i.test(msg)) {
    return (
      'No spendable coins found in the wallet database. Pull to refresh on the home screen, ' +
      'or wait for pending transactions to finish syncing.'
    );
  }
  if (msg.trim()) {
    return msg;
  }
  return 'Unable to estimate the network fee. Please try again in a moment.';
}
