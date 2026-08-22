/** User-facing message for native PostTx / broadcast failures. */
export function formatBroadcastError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const stripped = raw
    .replace(/^failed after \d+ attempts:\s*/i, '')
    .replace(/^failed to broadcast transaction:\s*/i, '')
    .trim();
  const hay = `${raw} ${stripped}`.toLowerCase();

  if (/already in mempool|txn-already-in-mempool/i.test(hay)) {
    return 'This transaction is already in the mempool.';
  }
  if (/txn-mempool-conflict|replacement-adds-unconfirmed/i.test(hay)) {
    return 'This transaction conflicts with another unconfirmed transaction. Wait or use a different fee.';
  }
  if (
    /inputs-missingorspent|missingorspent|bad-txns-inputs-spent|missing inputs/i.test(
      hay,
    )
  ) {
    return 'Those coins were already spent. Refresh the wallet and try again.';
  }
  if (
    /min relay fee|insufficient fee|fee too low|absurdly-low-fee|mempool min fee/i.test(
      hay,
    )
  ) {
    return 'The network fee is too low to relay this transaction. Try a higher fee rate.';
  }
  if (/dust/i.test(hay)) {
    return 'An output is below the dust limit. Adjust the amount or fee and try again.';
  }
  if (/too-long-mempool-chain/i.test(hay)) {
    return 'Too many unconfirmed transactions are chained. Wait for a confirmation, then try again.';
  }
  if (
    /failed to send request|timeout|timed out|network request failed|connection|econnreset|enotfound/i.test(
      hay,
    )
  ) {
    return "Couldn't reach the Bitcoin API. Check your connection and try again.";
  }
  if (/invalid raw tx|invalid tx hex|decode/i.test(hay)) {
    return 'The signed transaction data looks invalid. Sign again and retry.';
  }
  if (stripped && stripped.length > 0 && stripped.length <= 180) {
    return `The network rejected this transaction: ${stripped}`;
  }
  return 'Could not broadcast this transaction. Check your connection and try again.';
}
